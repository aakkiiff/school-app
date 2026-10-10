import contextlib
import importlib
import io
import json
import logging
import runpy
import threading
import unittest
from unittest.mock import patch

from structured_logging import configure, event
from werkzeug.serving import make_server

with patch("database.db.connect_db"):
    application = importlib.import_module("app")


class LoggingTests(unittest.TestCase):
    def setUp(self):
        self.output = io.StringIO()
        self.redirect = contextlib.redirect_stdout(self.output)
        self.redirect.__enter__()
        configure()
        application.app.config["TESTING"] = False
        self.client = application.app.test_client()

    def tearDown(self):
        self.redirect.__exit__(None, None, None)

    def records(self):
        return [json.loads(line) for line in self.output.getvalue().splitlines()]

    def test_json_format_and_library_privacy(self):
        event(logging.WARNING, "example", attempt=1)
        logging.getLogger("werkzeug").error("secret URI and private query")
        try:
            raise ValueError("private multiline\nexception details")
        except ValueError:
            logging.exception("secret")
        records = self.records()
        self.assertEqual(records[0]["level"], "WARN")
        self.assertEqual(records[0]["service"], "employeeservice")
        self.assertEqual(records[1]["event"], "runtime_event")
        self.assertEqual(records[2]["error_type"], "ValueError")
        self.assertNotIn("secret", self.output.getvalue())
        self.assertNotIn("private", self.output.getvalue())

    def test_requests_and_preflight(self):
        with patch.object(application, "get_employees", return_value=("", 200)):
            response = self.client.options("/employees")
        self.assertLess(response.status_code, 400)
        self.assertEqual(self.records(), [])
        with patch("handlers.employee.get_collection", side_effect=RuntimeError("private credentials")):
            response = self.client.get("/employees?token=secret", headers={"X-Request-ID": "test-123"})
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers["X-Request-ID"], "test-123")
        record = self.records()[0]
        self.assertEqual(record["route"], "/employees")
        self.assertEqual(record["level"], "ERROR")
        self.assertEqual(record["error_type"], "RuntimeError")
        self.assertEqual(record["message"], "HTTP request failed.")
        self.assertGreaterEqual(record["duration_ms"], 0)
        self.assertNotIn("credentials", self.output.getvalue())
        self.assertNotIn("secret", self.output.getvalue())
        response = self.client.get("/private-name", headers={"X-Request-ID": "bad id"})
        self.assertRegex(response.headers["X-Request-ID"], r"^[a-f0-9]{32}$")
        self.assertEqual(self.records()[-1]["route"], "unmatched")

    def test_server_bind_failure_is_json_without_stderr(self):
        errors = io.StringIO()
        with patch("database.db.connect_db"), patch("socket.create_server", side_effect=OSError("private host")), \
                contextlib.redirect_stderr(errors):
            with self.assertRaises(SystemExit) as exit_error:
                runpy.run_path("app.py", run_name="__main__")
        self.assertEqual(exit_error.exception.code, 1)
        self.assertEqual(errors.getvalue(), "")
        self.assertEqual(self.records()[0]["event"], "server_failed")
        self.assertNotIn("private host", self.output.getvalue())

    def test_threaded_server_uses_existing_socket_without_access_log(self):
        import socket
        from urllib.request import urlopen

        class QuietHandler(application.WSGIRequestHandler):
            def log_request(self, code="-", size="-"):
                pass

        with socket.create_server(("127.0.0.1", 0)) as listener:
            with make_server("127.0.0.1", 0, application.app, threaded=True,
                             request_handler=QuietHandler, fd=listener.fileno()) as server:
                thread = threading.Thread(target=server.serve_forever)
                thread.start()
                try:
                    with patch.object(application, "get_employees", return_value=("[]", 200)):
                        with urlopen(f"http://127.0.0.1:{server.port}/employees") as response:
                            self.assertEqual(response.status, 200)
                finally:
                    server.shutdown()
                    thread.join()
        self.assertEqual(self.records(), [])
        with patch.object(application, "add_employee", return_value=("{}", 201)):
            response = self.client.post("/add-employee")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.records()[0]["event"], "http_request")
        self.assertEqual(self.records()[0]["message"], "HTTP request completed.")


if __name__ == "__main__":
    unittest.main()
