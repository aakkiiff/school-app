import contextlib
import io
import json
import logging
import unittest
from unittest.mock import patch

import worker
from structured_logging import configure, event


class LoggingTests(unittest.TestCase):
    def setUp(self):
        self.output = io.StringIO()
        self.redirect = contextlib.redirect_stdout(self.output)
        self.redirect.__enter__()
        configure()

    def tearDown(self):
        self.redirect.__exit__(None, None, None)

    def records(self):
        return [json.loads(line) for line in self.output.getvalue().splitlines()]

    def test_json_and_safe_job_failure(self):
        event(logging.INFO, "consumer_ready")
        owners = unittest.mock.Mock()
        worker.fail_job(owners, "private owner", "private version", 2, ValueError("secret URL"), False)
        records = self.records()
        self.assertEqual(records[0]["service"], "thumbnailworker")
        self.assertEqual(records[1]["event"], "thumbnail_retry")
        self.assertEqual(records[1]["level"], "WARN")
        self.assertEqual(records[1]["error_type"], "ValueError")
        self.assertEqual(len(records[1]["job_id"]), 16)
        self.assertNotRegex(self.output.getvalue(), r"private|secret")

    def test_reconnect_logs_transitions_not_each_attempt(self):
        def consume(*args, on_ready):
            if consume.calls == 2:
                on_ready()
            consume.calls += 1
            raise OSError("password")
        consume.calls = 0
        with patch.object(worker, "load_dotenv"), patch.object(worker, "MongoClient"), \
                patch.object(worker.boto3, "client"), patch.object(worker, "consume", side_effect=consume), \
                patch.dict(worker.os.environ, {"MONGODB_URI": "test", "S3_ENDPOINT": "test",
                                              "S3_ACCESS_KEY": "test", "S3_SECRET_KEY": "test"}), \
                patch.object(worker.time, "sleep", side_effect=[None, None, KeyboardInterrupt]):
            with self.assertRaises(KeyboardInterrupt):
                worker.main()
        self.assertEqual([r["event"] for r in self.records()],
                         ["consumer_unavailable", "consumer_recovered", "consumer_unavailable"])


if __name__ == "__main__":
    unittest.main()
