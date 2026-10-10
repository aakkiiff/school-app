package observability

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"time"
)

var validID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func Configure() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
			switch a.Key {
			case slog.TimeKey:
				a.Key = "timestamp"
				a.Value = slog.TimeValue(a.Value.Time().UTC())
			case slog.MessageKey:
				a.Key = "message"
			}
			return a
		},
	})).With("service", "studentservice"))
	log.SetOutput(safeWriter{})
	log.SetFlags(0)
}

// net/http can write raw URLs and panic values to the standard logger.
type safeWriter struct{}

func (safeWriter) Write(p []byte) (int, error) {
	slog.Error("HTTP runtime error.", "event", "http_runtime_error")
	return len(p), nil
}

type response struct {
	http.ResponseWriter
	status int
}

func (w *response) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
		w.ResponseWriter.WriteHeader(status)
	}
}

func (w *response) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

func (w *response) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func Requests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if !validID.MatchString(id) {
			var bytes [16]byte
			if _, err := rand.Read(bytes[:]); err != nil {
				slog.Error("Request ID generation failed.", "event", "request_id_failed")
				http.Error(w, "Internal server error", http.StatusInternalServerError)
				return
			}
			id = hex.EncodeToString(bytes[:])
		}
		w.Header().Set("X-Request-ID", id)
		start := time.Now()
		out := &response{ResponseWriter: w}
		defer func() {
			panicked := false
			if failure := recover(); failure != nil {
				panicked = true
			}
			status := out.status
			if panicked {
				status = http.StatusInternalServerError
			}
			if status == 0 {
				status = http.StatusOK
			}
			if r.Method == http.MethodOptions && status < 400 {
				return
			}
			route := "unmatched"
			switch r.URL.Path {
			case "/students", "/add-student", "/update-student", "/delete-student":
				route = r.URL.Path
			}
			level := slog.LevelInfo
			message := "HTTP request completed."
			if status >= 500 {
				level = slog.LevelError
				message = "HTTP request failed."
			} else if status >= 400 {
				level = slog.LevelWarn
				message = "HTTP request rejected."
			} else if r.Method == http.MethodGet || r.Method == http.MethodHead {
				level = slog.LevelDebug
			}
			slog.Log(r.Context(), level, message, "event", "http_request", "request_id", id,
				"method", r.Method, "route", route, "status", status,
				"duration_ms", float64(time.Since(start).Microseconds())/1000)
			if panicked {
				panic(http.ErrAbortHandler)
			}
		}()
		next.ServeHTTP(out, r)
	})
}
