import io
import hashlib
import json
import logging
import os
import time
import warnings
from datetime import datetime, timedelta, timezone

import boto3
import pika
from botocore.config import Config
from dotenv import load_dotenv
from PIL import Image, ImageOps, UnidentifiedImageError
from pymongo import MongoClient
from structured_logging import configure, event as log_event

QUEUE = "media.thumbnail"
DEAD_QUEUE = "media.thumbnail.dead"
MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 20_000_000
MAX_ATTEMPTS = 3
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def thumbnail(data: bytes) -> bytes:
    if len(data) > MAX_BYTES:
        raise ValueError("Image exceeds 5 MB.")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as source:
            if source.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("Unsupported image format.")
            if source.width * source.height > MAX_PIXELS:
                raise ValueError("Image exceeds 20 megapixels.")
            if getattr(source, "n_frames", 1) != 1:
                raise ValueError("Animated images are not supported.")
            source.load()
            oriented = ImageOps.exif_transpose(source).convert("RGBA")
            oriented.thumbnail((256, 256), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (256, 256), "#f5f1fc")
            position = ((256 - oriented.width) // 2, (256 - oriented.height) // 2)
            canvas.paste(oriented, position, oriented)
            result = io.BytesIO()
            canvas.save(result, format="WEBP", quality=85, method=4)
            return result.getvalue()


def process_event(event: dict, owners, s3, source_bucket: str, thumbnail_bucket: str) -> str:
    if not isinstance(event, dict) or not all(isinstance(event.get(key), str) for key in (
            "owner", "version", "sourceBucket", "sourceKey", "thumbnailBucket", "thumbnailKey")):
        raise ValueError("Invalid event fields.")
    if event.get("schemaVersion") != 1 or event.get("type") != "image.uploaded":
        raise ValueError("Unknown event schema.")
    owner, version = event["owner"], event["version"]
    doc = owners.find_one({"_id": owner})
    if not doc or doc.get("deleted") or doc.get("desired") != version:
        return "stale"
    job = next((j for j in doc["jobs"] if j["version"] == version), None)
    if not job or job["state"] in {"ready", "failed"}:
        return "duplicate"
    if (event["sourceBucket"] != source_bucket or event["thumbnailBucket"] != thumbnail_bucket
            or event["sourceKey"] != job["sourceKey"] or event["thumbnailKey"] != job["thumbnailKey"]):
        raise ValueError("Event object references do not match the durable job.")
    now = datetime.now(timezone.utc)
    if job["state"] == "pending" and job.get("nextPublishAt", now) > now:
        return "duplicate"
    claim = owners.update_one({
        "_id": owner, "desired": version, "deleted": False,
        "jobs": {"$elemMatch": {
            "version": version,
            "$or": [
                {"state": {"$in": ["pending", "queued"]}},
                {"state": "processing", "leaseUntil": {"$lte": now}},
            ],
        }},
    }, {
        "$set": {"jobs.$.state": "processing", "jobs.$.leaseUntil": now + timedelta(minutes=5)},
        "$inc": {"jobs.$.attempts": 1},
    })
    if not claim.modified_count:
        return "duplicate"
    attempt = job["attempts"] + 1
    try:
        response = s3.get_object(Bucket=source_bucket, Key=job["sourceKey"])
        body = response["Body"]
        try:
            data = body.read(MAX_BYTES + 1)
        finally:
            body.close()
        output = thumbnail(data)
        s3.put_object(Bucket=thumbnail_bucket, Key=job["thumbnailKey"], Body=output,
                      ContentType="image/webp", CacheControl="private, max-age=300")
        # A newer upload/removal wins even if an older worker finishes afterwards.
        result = owners.update_one({
            "_id": owner, "desired": version, "deleted": False,
            "jobs": {"$elemMatch": {"version": version, "state": "processing", "attempts": attempt}},
        }, {"$set": {
            "current": {"version": version, "thumbnailKey": job["thumbnailKey"],
                        "sourceKey": job["sourceKey"]},
            "jobs.$.state": "ready", "jobs.$.error": None,
        }})
        if not result.modified_count:
            latest = owners.find_one({"_id": owner})
            if latest and (latest.get("current") or {}).get("version") == version:
                return "duplicate"
            s3.delete_object(Bucket=thumbnail_bucket, Key=job["thumbnailKey"])
            owners.update_one({"_id": owner, "jobs.version": version},
                              {"$set": {"jobs.$.state": "superseded"}})
            return "stale"
        return "ready"
    except (ValueError, UnidentifiedImageError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as error:
        fail_job(owners, owner, version, attempt, error, terminal=True)
        return "failed"
    except Exception as error:
        # Infrastructure failures must be durable and visible, never acknowledged as success.
        terminal = attempt >= MAX_ATTEMPTS
        fail_job(owners, owner, version, attempt, error, terminal)
        return "failed" if terminal else "retry"


def fail_job(owners, owner, version, attempt, error, terminal):
    log_event(logging.ERROR if terminal else logging.WARNING, "thumbnail_failed" if terminal else "thumbnail_retry",
              job_id=hashlib.sha256(version.encode()).hexdigest()[:16],
              attempt=attempt, error_type=type(error).__name__)
    owners.update_one({
        "_id": owner,
        "jobs": {"$elemMatch": {"version": version, "state": "processing", "attempts": attempt}},
    }, {"$set": {
        "jobs.$.state": "failed" if terminal else "pending",
        "jobs.$.error": "Thumbnail processing failed. Retry or choose another photo.",
        "jobs.$.nextPublishAt": datetime.now(timezone.utc) + timedelta(seconds=5 * 2 ** (attempt - 1)),
    }})


def consume(owners, s3, on_ready=None):
    parameters = pika.URLParameters(os.environ["RABBITMQ_URL"])
    parameters.heartbeat = 120
    parameters.blocked_connection_timeout = 30
    connection = pika.BlockingConnection(parameters)
    channel = connection.channel()
    channel.queue_declare(queue=DEAD_QUEUE, durable=True)
    channel.queue_declare(queue=QUEUE, durable=True, arguments={
        "x-dead-letter-exchange": "", "x-dead-letter-routing-key": DEAD_QUEUE,
    })
    channel.basic_qos(prefetch_count=1)

    def callback(ch, method, _properties, body):
        try:
            event = json.loads(body)
            result = process_event(event, owners, s3, os.environ["S3_BUCKET"],
                                   os.environ["S3_THUMBNAIL_BUCKET"])
            if result == "ready":
                log_event(logging.INFO, "thumbnail_ready",
                          job_id=hashlib.sha256(event["version"].encode()).hexdigest()[:16])
            if result == "failed":
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
            else:
                # Retry outcome is acknowledged only after its retry schedule is stored in MongoDB.
                ch.basic_ack(delivery_tag=method.delivery_tag)
        except (ValueError, KeyError, TypeError) as error:
            log_event(logging.WARNING, "invalid_message", error_type=type(error).__name__)
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        except Exception:
            connection.close()
            raise

    channel.basic_consume(queue=QUEUE, on_message_callback=callback)
    if on_ready:
        on_ready()
    log_event(logging.INFO, "consumer_ready")
    try:
        channel.start_consuming()
    finally:
        if connection.is_open:
            connection.close()


def main():
    load_dotenv()
    mongo = MongoClient(os.environ["MONGODB_URI"], serverSelectionTimeoutMS=5000, tz_aware=True)
    owners = mongo[os.environ.get("DATABASE_NAME", "kindergarten")]["media"]
    s3 = boto3.client(
        "s3", endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ["S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["S3_SECRET_KEY"],
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        config=Config(connect_timeout=5, read_timeout=30, retries={"max_attempts": 2},
                      s3={"addressing_style": "path"}),
    )
    unavailable = False
    def on_ready():
        nonlocal unavailable
        if unavailable:
            log_event(logging.INFO, "consumer_recovered")
        unavailable = False

    while True:
        try:
            consume(owners, s3, on_ready=on_ready)
        except Exception as error:
            if not unavailable:
                log_event(logging.ERROR, "consumer_unavailable", error_type=type(error).__name__, retry_seconds=5)
            unavailable = True
        time.sleep(5)


if __name__ == "__main__":
    configure()
    try:
        main()
    except KeyboardInterrupt:
        log_event(logging.INFO, "service_stopped")
    except Exception as error:
        log_event(logging.ERROR, "startup_failed", error_type=type(error).__name__)
        raise SystemExit(1) from None
