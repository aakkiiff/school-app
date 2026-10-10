import json
import logging
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record):
        fields = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": "WARN" if record.levelname == "WARNING" else record.levelname,
            "service": "employeeservice",
            "event": getattr(record, "event", "runtime_event"),
        }
        fields.update(getattr(record, "fields", {}))
        fields["logger"] = record.name
        if fields["event"] == "http_request":
            fields["message"] = "HTTP request failed." if fields["status"] >= 500 else \
                "HTTP request rejected." if fields["status"] >= 400 else "HTTP request completed."
        elif fields["event"] == "runtime_event":
            fields["message"] = "Runtime warning or error; see logger and error_type."
        else:
            fields["message"] = fields["event"].replace("_", " ").capitalize() + "."
        if record.exc_info and record.exc_info[0]:
            fields["error_type"] = record.exc_info[0].__name__
        return json.dumps(fields, ensure_ascii=True)


def configure():
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    for name in ("werkzeug", "pymongo"):
        logging.getLogger(name).setLevel(logging.WARNING)
    logging.captureWarnings(True)


def event(level, name, **fields):
    logging.getLogger("employeeservice").log(level, name, extra={"event": name, "fields": fields})
