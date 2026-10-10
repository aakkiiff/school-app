package observability

import (
	"encoding/json"
	"io"
	"log"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func captureLogs(t *testing.T) (*os.File, *os.File) {
	t.Helper()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	old, oldLogger, oldWriter, oldFlags := os.Stdout, slog.Default(), log.Writer(), log.Flags()
	os.Stdout = writer
	Configure()
	t.Cleanup(func() {
		os.Stdout = old
		slog.SetDefault(oldLogger)
		log.SetOutput(oldWriter)
		log.SetFlags(oldFlags)
		reader.Close()
		writer.Close()
	})
	return reader, writer
}

func TestRequestLogs(t *testing.T) {
	reader, writer := captureLogs(t)
	handler := Requests(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.URL.Path == "/healthy" {
			return
		}
		http.Error(w, "private response", http.StatusInternalServerError)
	}))
	request := httptest.NewRequest("GET", "/students?token=secret", nil)
	request.Header.Set("X-Request-ID", "test-123")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Header().Get("X-Request-ID") != "test-123" {
		t.Fatal("request ID not preserved")
	}
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("OPTIONS", "/students", nil))
	for i := 0; i < 10; i++ {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/healthy", nil))
	}
	writer.Close()
	output, _ := io.ReadAll(reader)
	var record map[string]interface{}
	if err := json.Unmarshal(output, &record); err != nil {
		t.Fatalf("expected exactly one JSON event: %v", err)
	}
	if record["service"] != "studentservice" || record["level"] != "ERROR" || record["route"] != "/students" {
		t.Fatalf("unexpected record: %v", record)
	}
	if record["message"] != "HTTP request failed." {
		t.Fatal("missing readable error message")
	}
	if _, err := time.Parse(time.RFC3339Nano, record["timestamp"].(string)); err != nil {
		t.Fatal(err)
	}
	if record["duration_ms"].(float64) < 0 || strings.Contains(string(output), "secret") {
		t.Fatal("invalid duration or query leak")
	}
}

func TestUnknownRoutesAndPanicAreSafe(t *testing.T) {
	reader, writer := captureLogs(t)
	req := httptest.NewRequest("GET", "/private-name?token=secret", nil)
	req.Header.Set("X-Request-ID", "bad id")
	res := httptest.NewRecorder()
	Requests(http.NotFoundHandler()).ServeHTTP(res, req)
	if !validID.MatchString(res.Header().Get("X-Request-ID")) {
		t.Fatal("unsafe generated ID")
	}
	func() {
		defer func() {
			if recover() != http.ErrAbortHandler {
				t.Error("panic should still abort the HTTP connection")
			}
		}()
		Requests(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			panic("private panic value")
		})).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/students", nil))
	}()
	writer.Close()
	output, _ := io.ReadAll(reader)
	if strings.Contains(string(output), "private") || strings.Contains(string(output), "secret") {
		t.Fatal("sensitive values leaked")
	}
	decoder := json.NewDecoder(strings.NewReader(string(output)))
	var first, second map[string]interface{}
	if err := decoder.Decode(&first); err != nil {
		t.Fatal(err)
	}
	if err := decoder.Decode(&second); err != nil {
		t.Fatal(err)
	}
	if first["route"] != "unmatched" || first["level"] != "WARN" || second["status"] != float64(500) {
		t.Fatalf("unexpected records: %v %v", first, second)
	}
	if err := decoder.Decode(&first); err != io.EOF {
		t.Fatal("duplicate error logs")
	}
}
