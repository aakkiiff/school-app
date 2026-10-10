import json
import logging
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record):
        fields = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": "WARN" if record.levelname == "WARNING" else record.levelname,
            "service": "thumbnailworker",
            "event": getattr(record, "event", "runtime_event"),
        }
        fields.update(getattr(record, "fields", {}))
        fields["logger"] = record.name
        fields["message"] = "Runtime warning or error; see logger and error_type." \
            if fields["event"] == "runtime_event" else fields["event"].replace("_", " ").capitalize() + "."
        if record.exc_info and record.exc_info[0]:
            fields["error_type"] = record.exc_info[0].__name__
        return json.dumps(fields, ensure_ascii=True)


def configure():
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    for name in ("pika", "pymongo", "botocore", "boto3"):
        logging.getLogger(name).setLevel(logging.CRITICAL)
    logging.captureWarnings(True)


def event(level, name, **fields):
    logging.getLogger("thumbnailworker").log(level, name, extra={"event": name, "fields": fields})
