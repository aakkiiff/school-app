import logging
import re
import socket
import time
import uuid
from flask import Flask, g, request
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.serving import WSGIRequestHandler, make_server
from structured_logging import configure, event

configure()
load_dotenv()

from database.db import connect_db
from handlers.employee import (
    add_employee,
    get_employees,
    delete_employee,
    update_employee,
)

app = Flask(__name__)
CORS(app, expose_headers=["X-Request-ID"])

try:
    connect_db()
except Exception as error:
    event(logging.ERROR, "startup_failed", error_type=type(error).__name__)
    raise SystemExit(1) from None


@app.before_request
def start_request():
    supplied = request.headers.get("X-Request-ID", "")
    g.request_id = supplied if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", supplied) else uuid.uuid4().hex
    g.request_started = time.monotonic()


@app.after_request
def finish_request(response):
    response.headers["X-Request-ID"] = g.request_id
    if request.method != "OPTIONS" or response.status_code >= 400:
        level = logging.ERROR if response.status_code >= 500 else logging.WARNING if response.status_code >= 400 \
            else logging.DEBUG if request.method in {"GET", "HEAD"} else logging.INFO
        fields = {
            "request_id": g.request_id, "method": request.method,
            "route": request.url_rule.rule if request.url_rule else "unmatched",
            "status": response.status_code,
            "duration_ms": round((time.monotonic() - g.request_started) * 1000, 3),
        }
        if getattr(g, "error_type", None):
            fields["error_type"] = g.error_type
        event(level, "http_request", **fields)
    return response


@app.route("/add-employee", methods=["POST", "OPTIONS"])
def add_employee_route():
    return add_employee()


@app.route("/employees", methods=["GET", "OPTIONS"])
def get_employees_route():
    return get_employees()


@app.route("/delete-employee", methods=["DELETE", "OPTIONS"])
def delete_employee_route():
    return delete_employee()


@app.route("/update-employee", methods=["PUT", "OPTIONS"])
def update_employee_route():
    return update_employee()


if __name__ == "__main__":
    class QuietRequestHandler(WSGIRequestHandler):
        def log_request(self, code="-", size="-"):
            pass

    try:
        # Binding ourselves avoids Werkzeug's plain-text error/exit on port conflicts.
        with socket.create_server(("0.0.0.0", 5003)) as listener:
            with make_server("0.0.0.0", 5003, app, threaded=True,
                             request_handler=QuietRequestHandler, fd=listener.fileno()) as server:
                event(logging.INFO, "service_started", port=5003)
                server.serve_forever()
    except KeyboardInterrupt:
        event(logging.INFO, "service_stopped")
    except (Exception, SystemExit) as error:
        event(logging.ERROR, "server_failed", error_type=type(error).__name__)
        raise SystemExit(1) from None
