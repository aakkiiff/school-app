# Local thumbnail worker (Python / Pillow)

The worker runs locally, not in Compose:

```sh
bash scripts/run-local.sh worker
```

MongoDB, RabbitMQ, and RustFS are reached through published localhost ports.
The launch script loads `thumbnailworker/.env` (copy from `.env.example`); install worker dependencies in
`thumbnailworker/.venv` as described in the [root guide](../READEME.md).

Consumes the durable `media.thumbnail` queue with prefetch 1 and manual
acknowledgements. Messages contain S3 references, not image bytes:

```json
{
  "schemaVersion": 1,
  "type": "image.uploaded",
  "owner": "students/stable-record-id",
  "version": "upload-uuid",
  "sourceBucket": "school-media",
  "sourceKey": "students/stable-record-id/upload-uuid/original",
  "thumbnailBucket": "school-thumbnails",
  "thumbnailKey": "students/stable-record-id/upload-uuid/thumbnail.webp"
}
```

The worker checks references against MongoDB, claims the job atomically, validates
5 MiB/20 megapixel limits, applies EXIF orientation, and fits the whole photo on a
256 x 256 pale canvas. Output is WebP without original metadata. Originals remain
private; signed thumbnail links go directly to RustFS.

Acknowledgement happens after S3 write and MongoDB promotion. Duplicate/stale jobs
cannot promote older versions. Transient failures have three attempts with durable
5/10-second retry scheduling; terminal failures go to `media.thumbnail.dead`.
The UI retry action resets a failed job. Five-minute leases recover process crashes.

## Tests (repository root)

```sh
bash scripts/run-local.sh worker-test
# Start all local APIs, media, and worker first:
bash scripts/run-local.sh pipeline-test
```

Pipeline tests use disposable records and verify stable IDs, private thumbnails,
replacement, removal, and record deletion cleanup across Go/Java/Python.

## Failure labs (local stack only)

```sh
docker compose stop rabbitmq
bash scripts/run-local.sh recovery-test prepare outage lab1
docker compose up -d --wait rabbitmq
bash scripts/run-local.sh recovery-test verify outage lab1
```

To test terminal failure and retry:

1. Stop the local worker with Ctrl+C in its terminal.
2. Run `bash scripts/run-local.sh recovery-test prepare corrupt lab2`.
3. Restart the worker with `bash scripts/run-local.sh worker`.
4. Run `bash scripts/run-local.sh recovery-test verify corrupt lab2`.

The verifier checks the failed status and dead letter, restores the source image,
triggers retry, and cleans up its disposable record. Use a unique token each run
and an empty DLQ for the corruption lab.

RabbitMQ console: http://localhost:15672, credentials from the root `.env`.
