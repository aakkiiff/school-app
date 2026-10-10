# Profile/media service (Node.js)

Accepts photos for students, teachers, employees, and the shared school profile.
Originals live in the private `school-media` bucket; the Python worker writes
256 x 256 WebP thumbnails to the private `school-thumbnails` bucket.
The browser receives presigned thumbnail URLs directly to http://localhost:9000.

## API (local Node server at http://localhost:5004)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/photos/{kind}/{recordId}` | Photo status and current thumbnail URL |
| PUT | `/photos/{kind}/{recordId}` | One multipart `image` field; returns `202` |
| DELETE | `/photos/{kind}/{recordId}` | Remove current/pending photo; cleanup is asynchronous (`204`) |
| POST | `/photos/{kind}/{recordId}/retry` | Retry failed thumbnail generation (`202`) |
| GET | `/photos/{kind}?ids=id1,id2` | Batch status lookup (up to 100 IDs) |
| GET/PUT/DELETE | `/profile/avatar` | School profile; same pipeline as directory photos |
| POST | `/profile/avatar/retry` | Retry the school thumbnail |
| GET | `/health`, `/ready` | Liveness; MongoDB and bucket readiness |

`kind` is `students`, `teachers`, or `employees`. Use the registry response's
`recordId`, not its roll number or business `id`.

```json
{
  "imageUrl": "/media/school-thumbnails/students/record-id/version/thumbnail.webp?X-Amz-Signature=...",
  "status": "processing",
  "error": null,
  "version": "new-version",
  "expiresIn": 3600
}
```

Statuses: `empty`, `processing`, `ready`, `failed`. During replacement, `imageUrl`
continues pointing to the previous successful thumbnail. It is `null` until the
first thumbnail is ready. Clients poll for completion. Signed URLs expire in one
hour. URLs preserve the signed localhost host/path; no proxy rewrites them.

Uploads accept non-animated JPEG/PNG/WebP, up to **5 MiB** and **20,000,000
decoded pixels**. Sharp decodes the file before storing it; the worker independently
validates it. Original-upload failures require choosing the file again; processing
failures can be retried from the retained original.

## Reliability without MongoDB transactions

Each owner has one MongoDB `media` document containing `desired` version,
`current` thumbnail, and an array of durable jobs/outbox entries. An atomic
update records an uploading job before S3 is written. After S3 succeeds it becomes
pending. The relay publishes references with RabbitMQ publisher confirms and
persistent messages. Uploads can therefore succeed while RabbitMQ is down.

Job states: `uploading -> pending -> queued -> processing -> ready`, with `failed`
for terminal errors. Transient failures return to `pending` with exponential
backoff. Five-minute leases recover crashed publishers/workers; delivery is
**at least once**, not exactly once. The worker checks version and state so duplicate
or stale messages cannot replace a newer thumbnail.

The relay also reconciles records and storage every two seconds:

- Removed records are marked deleted before objects are cleaned up.
- Superseded originals/thumbnails are deleted after successful replacement.
- Photo removal invalidates both desired and current versions.
- Failed cleanup retains its durable job for the next pass.
- In-flight jobs are given time to finish; interrupted uploads become explicit failures.
- Existing school avatars are queued for conversion on first startup.

Teaching simplification: media reads the three registry collections in the shared
MongoDB database to validate ownership and discover deletions. For independently
owned databases, replace this reconciliation with durable registry lifecycle events.
MongoDB tombstone documents remain after record deletion; their object references
are removed after successful cleanup.

## Configuration

See [.env.example](.env.example) (copy to `.env`) and [Compose configuration](../docker-compose.yml).

| Variable | Default / requirement |
| --- | --- |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT` | required |
| `S3_REGION` | `us-east-1` |
| `S3_BUCKET`, `S3_THUMBNAIL_BUCKET` | `school-media`, `school-thumbnails` |
| `MONGODB_URI`, `RABBITMQ_URL` | required |
| `DATABASE_NAME` | `kindergarten` |
| `S3_PUBLIC_PATH` | empty (direct S3 URLs); legacy proxy deployments can override |
| `PORT` | `5004` |

Both buckets are created on startup without public-read policies. The local demo
uses the storage administrator credentials; production should separate least-privilege
uploader and worker credentials and add authentication. The S3 endpoint must be
reachable from both local processes and the browser.

## Tests

```sh
npm ci
npm test
```

Mongo integration tests are skipped unless `MONGODB_URI` is set. From the repository
root, run them with the local environment against an automatically created and
removed isolated test database:

```sh
bash scripts/run-local.sh media-test
```
