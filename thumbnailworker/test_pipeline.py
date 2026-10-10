"""Opt-in integration test against local APIs; uses disposable records only."""
import io
import json
import os
import time
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import boto3
from botocore.config import Config
from PIL import Image
from pymongo import MongoClient


BASE = os.environ.get("TEST_BASE_URL", "")
LOCAL_APIS = {
    "/student-svc": "http://localhost:5001",
    "/teacher-svc": "http://localhost:5002",
    "/employee-svc": "http://localhost:5003",
    "/profile-svc": "http://localhost:5004",
}
TOKEN = f"media-lab-{uuid.uuid4().hex[:12]}"


def request(path, method="GET", data=None, content_type="application/json"):
    encoded = json.dumps(data).encode() if isinstance(data, dict) else data
    url = BASE + path
    if not BASE:
        prefix = next((key for key in LOCAL_APIS if path.startswith(key + "/")), None)
        if prefix is None:
            raise ValueError("Unknown local API route.")
        url = LOCAL_APIS[prefix] + path[len(prefix):]
    with urlopen(Request(url, data=encoded, method=method,
                         headers={"Content-Type": content_type}), timeout=30) as response:
        body = response.read()
        return json.loads(body) if body and content_type == "application/json" else body


def upload(path, color="red"):
    image = io.BytesIO()
    Image.new("RGB", (800, 400), color).save(image, "PNG")
    boundary = uuid.uuid4().hex
    data = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"photo.png\"\r\n"
            "Content-Type: image/png\r\n\r\n").encode() + image.getvalue() + f"\r\n--{boundary}--\r\n".encode()
    response = request(path, "PUT", data, f"multipart/form-data; boundary={boundary}")
    return json.loads(response)


def wait_for(predicate, description):
    until = time.monotonic() + 45
    while time.monotonic() < until:
        result = predicate()
        if result:
            return result
        time.sleep(0.5)
    raise AssertionError(f"Timed out: {description}")


def main():
    mongo = MongoClient(os.environ["MONGODB_URI"], tz_aware=True)
    db = mongo[os.environ.get("DATABASE_NAME", "kindergarten")]
    s3 = boto3.client("s3", endpoint_url=os.environ["S3_ENDPOINT"],
                      aws_access_key_id=os.environ["S3_ACCESS_KEY"],
                      aws_secret_access_key=os.environ["S3_SECRET_KEY"],
                      region_name="us-east-1", config=Config(s3={"addressing_style": "path"}))
    created = []
    try:
        for kind, singular, id_field, detail in [
            ("students", "student", "roll", "address"),
            ("teachers", "teacher", "id", "subject"),
            ("employees", "employee", "id", "position")]:
            prefix = f"/{singular}-svc"
            record = request(f"{prefix}/add-{singular}", "POST", {
                "name": TOKEN, id_field: TOKEN, detail: "integration-test",
            })
            record_id = record["recordId"]
            created.append((kind, prefix, singular, id_field, record_id))
            saved = request(f"{prefix}/update-{singular}", "PUT", {
                "name": TOKEN, id_field: TOKEN, detail: "updated", "recordId": "000000000000000000000000",
            })
            assert saved["recordId"] == record_id, f"{kind}: stable ID changed"
            path = f"/profile-svc/photos/{kind}/{record_id}"
            pending = upload(path)
            assert pending["status"] == "processing"
            ready = wait_for(lambda: (r if (r := request(path))["status"] == "ready" else None), "first thumbnail")
            with urlopen(BASE + ready["imageUrl"]) as response:
                with Image.open(io.BytesIO(response.read())) as image:
                    assert image.size == (256, 256)
                    assert image.format == "WEBP"
                    assert len(image.getexif()) == 0
            try:
                urlopen(BASE + ready["imageUrl"].split("?")[0])
                raise AssertionError("Unsigned thumbnail was readable")
            except HTTPError as error:
                assert error.code == 403

            owner = db.media.find_one({"_id": f"{kind}/{record_id}"})
            old_key = owner["current"]["thumbnailKey"]
            replacement = upload(path, "blue")
            assert old_key in replacement["imageUrl"], "Current photo disappeared during replacement"
            wait_for(lambda: (r if (r := request(path))["status"] == "ready"
                              and r["version"] != ready["version"] else None), "replacement thumbnail")
            wait_for(lambda: len(db.media.find_one({"_id": owner["_id"]})["jobs"]) == 1, "old version cleanup")
            request(path, "DELETE")
            assert request(path)["status"] == "empty"
            wait_for(lambda: not db.media.find_one({"_id": owner["_id"]})["jobs"], "photo removal cleanup")
            upload(path)
            wait_for(lambda: request(path)["status"] == "ready", "thumbnail before record deletion")
            request(f"{prefix}/delete-{singular}?{id_field}={TOKEN}", "DELETE")
            wait_for(lambda: not db.media.find_one({"_id": owner["_id"]})["jobs"], "record deletion cleanup")
            for bucket in [os.environ["S3_BUCKET"], os.environ["S3_THUMBNAIL_BUCKET"]]:
                assert s3.list_objects_v2(Bucket=bucket, Prefix=f"{kind}/{record_id}/").get("KeyCount", 0) == 0
            print(f"PASS {kind}: stable ID, upload, WebP, private URL, replace, remove, deletion cleanup")
    finally:
        for kind, prefix, singular, id_field, record_id in created:
            try:
                request(f"{prefix}/delete-{singular}?{id_field}={TOKEN}", "DELETE")
            except HTTPError as error:
                if error.code != 404:
                    print(f"Cleanup failed for {kind}: HTTP {error.code}")
            for bucket in [os.environ["S3_BUCKET"], os.environ["S3_THUMBNAIL_BUCKET"]]:
                for obj in s3.list_objects_v2(Bucket=bucket, Prefix=f"{kind}/{record_id}/").get("Contents", []):
                    s3.delete_object(Bucket=bucket, Key=obj["Key"])
            db.media.delete_one({"_id": f"{kind}/{record_id}"})
        mongo.close()


if __name__ == "__main__":
    main()
