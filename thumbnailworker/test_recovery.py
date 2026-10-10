"""Two-stage outage/corrupt-image lab. See README for the Compose commands."""
import argparse
import io
import json
import os

import boto3
import pika
from botocore.config import Config
from PIL import Image
from pymongo import MongoClient

from test_pipeline import request, upload, wait_for


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=["prepare", "verify"])
    parser.add_argument("scenario", choices=["outage", "corrupt"])
    parser.add_argument("token")
    args = parser.parse_args()
    token = f"media-recovery-{args.token}"
    mongo = MongoClient(os.environ["MONGODB_URI"], tz_aware=True)
    db = mongo[os.environ.get("DATABASE_NAME", "kindergarten")]
    s3 = boto3.client("s3", endpoint_url=os.environ["S3_ENDPOINT"],
                      aws_access_key_id=os.environ["S3_ACCESS_KEY"],
                      aws_secret_access_key=os.environ["S3_SECRET_KEY"],
                      region_name="us-east-1", config=Config(s3={"addressing_style": "path"}))
    if args.stage == "prepare":
        record = request("/student-svc/add-student", "POST",
                         {"name": token, "roll": token, "address": "recovery-test"})
        record_id = record["recordId"]
        path = f"/profile-svc/photos/students/{record_id}"
        result = upload(path)
        assert result["status"] == "processing"
        owner = db.media.find_one({"_id": f"students/{record_id}"})
        job = owner["jobs"][0]
        if args.scenario == "corrupt":
            # Worker must be stopped for this stage.
            s3.put_object(Bucket=os.environ["S3_BUCKET"], Key=job["sourceKey"],
                          Body=b"corrupt-image", ContentType="image/png")
        else:
            assert job["state"] == "pending", "Stop RabbitMQ before preparing the outage test."
        print(f"PREPARED {args.scenario}: original saved and job durable")
        mongo.close()
        return

    record = db.students.find_one({"roll": token})
    assert record, "Run the prepare stage first."
    record_id = str(record["_id"])
    owner_id = f"students/{record_id}"
    path = f"/profile-svc/photos/students/{record_id}"
    try:
        if args.scenario == "corrupt":
            wait_for(lambda: request(path)["status"] == "failed", "explicit failed photo")
            owner = db.media.find_one({"_id": owner_id})
            job = owner["jobs"][0]
            connection = pika.BlockingConnection(pika.URLParameters(os.environ["RABBITMQ_URL"]))
            channel = connection.channel()
            method, _props, body = channel.basic_get("media.thumbnail.dead")
            assert method is not None, "Failed message was not dead-lettered."
            if json.loads(body)["version"] != job["version"]:
                channel.basic_nack(method.delivery_tag, requeue=True)
                connection.close()
                raise AssertionError("Another lab's dead letter is first; inspect the console before rerunning.")
            channel.basic_ack(method.delivery_tag)
            connection.close()
            good = io.BytesIO()
            Image.new("RGB", (400, 200), "green").save(good, "PNG")
            s3.put_object(Bucket=os.environ["S3_BUCKET"], Key=job["sourceKey"],
                          Body=good.getvalue(), ContentType="image/png")
            request(path + "/retry", "POST")
        ready = wait_for(lambda: (r if (r := request(path))["status"] == "ready" else None),
                         "recovered thumbnail")
        assert "/school-thumbnails/" in ready["imageUrl"]
        print(f"PASS {args.scenario}: {'DLQ + manual retry' if args.scenario == 'corrupt' else 'broker restart + outbox recovery'}")
    finally:
        request(f"/student-svc/delete-student?roll={token}", "DELETE")
        wait_for(lambda: not db.media.find_one({"_id": owner_id})["jobs"], "recovery lab object cleanup")
        db.media.delete_one({"_id": owner_id})
        mongo.close()


if __name__ == "__main__":
    main()
