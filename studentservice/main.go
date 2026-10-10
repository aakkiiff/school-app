package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"studentservice/database"
	"studentservice/handlers"
	"studentservice/observability"

	"github.com/joho/godotenv"
)

func enableCors(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, traceparent, tracestate, X-Request-ID")
	w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")
}

func main() {
	observability.Configure()
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		slog.Error("Environment configuration failed.", "event", "configuration_failed")
		os.Exit(1)
	}

	// Database connection
	if err := database.Connect(); err != nil {
		slog.Error("Database connection failed.", "event", "database_connection_failed", "error_type", fmt.Sprintf("%T", err))
		os.Exit(1)
	}

	// Student Routes
	http.HandleFunc("/add-student", func(w http.ResponseWriter, r *http.Request) {
		enableCors(w)
		if r.Method == http.MethodOptions {
			return
		}
		handlers.AddStudent(w, r)
	})

	http.HandleFunc("/students", func(w http.ResponseWriter, r *http.Request) {
		enableCors(w)
		if r.Method == http.MethodOptions {
			return
		}
		handlers.GetStudents(w, r)
	})

	http.HandleFunc("/delete-student", func(w http.ResponseWriter, r *http.Request) {
		enableCors(w)
		if r.Method == http.MethodOptions {
			return
		}
		if r.Method != http.MethodDelete {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		handlers.DeleteStudent(w, r)
	})

	http.HandleFunc("/update-student", func(w http.ResponseWriter, r *http.Request) {
		enableCors(w)
		if r.Method == http.MethodOptions {
			return
		}
		if r.Method != http.MethodPut {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		handlers.UpdateStudent(w, r)
	})

	slog.Info("Service started.", "event", "service_started", "port", 5001)
	if err := http.ListenAndServe(":5001", observability.Requests(http.DefaultServeMux)); err != nil {
		slog.Error("HTTP server failed.", "event", "server_failed", "error_type", fmt.Sprintf("%T", err))
		os.Exit(1)
	}
}
