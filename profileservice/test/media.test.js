const assert = require("node:assert/strict");
const { before, beforeEach, after, test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { MongoClient, ObjectId } = require("mongodb");
const { createMedia } = require("../src/media");
const { publishPending } = require("../src/publisher");

const enabled = Boolean(process.env.MONGODB_URI);
const integration = (name, run) => test(name, { skip: !enabled }, run);
let client, db, media, deleted, failDelete;
const storage = {
  async putImage() {},
  async thumbnailUrl(key) { return `/media/thumbs/${key}?signature=ok`; },
  async deleteVersion(job) {
    if (failDelete) throw new Error("storage down");
    deleted.push(job.version);
  },
};
before(async () => {
  if (!enabled) return;
  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db(`school_media_test_${randomUUID().replaceAll("-", "")}`);
});
beforeEach(async () => {
  if (!enabled) return;
  await db.collection("media").deleteMany({});
  await db.collection("students").deleteMany({});
  media = createMedia({ db, storage });
  deleted = []; failDelete = false;
});
after(async () => {
  if (client) { await db.dropDatabase(); await client.close(); }
});
const upload = () => media.upload("school", "admin", Buffer.from("validated-image"), "image/png");
const doc = () => media.owners.findOne({ _id: "school/admin" });
async function makeReady() {
  const owner = await doc();
  const job = owner.jobs.find((j) => j.version === owner.desired);
  await media.owners.updateOne({ _id: owner._id, "jobs.version": job.version }, {
    $set: { current: { version: job.version, thumbnailKey: job.thumbnailKey }, "jobs.$.state": "ready" },
  });
  return job.version;
}

integration("upload durably stores a pending outbox job", async () => {
  const response = await upload();
  assert.equal(response.status, "processing");
  const owner = await doc();
  assert.equal(owner.jobs.length, 1);
  assert.equal(owner.jobs[0].state, "pending");
  assert.equal(owner.jobs[0].version, owner.desired);
});
integration("replacement keeps previous thumbnail until new version is ready", async () => {
  await upload(); const old = await makeReady();
  const response = await upload();
  assert.match(response.imageUrl, new RegExp(old));
  assert.equal(response.status, "processing");
  await media.reconcile();
  assert.deepEqual(deleted, []);
  await makeReady(); await media.reconcile();
  assert.deepEqual(deleted, [old]);
  assert.equal((await doc()).jobs.length, 1);
});
integration("removal invalidates pending and current jobs and cleans objects", async () => {
  await upload(); await makeReady(); await upload();
  await media.remove("school", "admin");
  await media.reconcile();
  assert.equal(deleted.length, 2);
  assert.deepEqual(await media.get("school", "admin"), {
    imageUrl: null, status: "empty", error: null, version: null, expiresIn: 3600,
  });
});
integration("registry deletion schedules durable cleanup without a frontend callback", async () => {
  const id = new ObjectId();
  await db.collection("students").insertOne({ _id: id });
  await media.upload("students", id.toHexString(), Buffer.from("image"), "image/png");
  await db.collection("students").deleteOne({ _id: id });
  failDelete = true;
  await assert.rejects(media.reconcile(), /storage down/);
  const owner = await media.owners.findOne({ _id: `students/${id}` });
  assert.equal(owner.deleted, true);
  assert.equal(owner.desired, null);
  assert.equal(owner.jobs.length, 1);
  failDelete = false; await media.reconcile();
  assert.equal(deleted.length, 1);
});
integration("publisher uses confirms and immutable S3 references, not bytes", async () => {
  await upload();
  const sent = [];
  const channel = { sendToQueue(queue, body, options, callback) {
    sent.push({ queue, body: JSON.parse(body), options }); callback(null);
  } };
  await publishPending({ owners: media.owners, channel, bucket: "originals", thumbnailBucket: "thumbs" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.persistent, true);
  assert.equal(sent[0].body.schemaVersion, 1);
  assert.equal(sent[0].body.sourceBucket, "originals");
  assert.equal(sent[0].body.buffer, undefined);
  assert.equal((await doc()).jobs[0].state, "queued");
  await publishPending({ owners: media.owners, channel });
  assert.equal(sent.length, 1);
});
integration("publisher failure preserves a retryable outbox job", async () => {
  await upload();
  const channel = { sendToQueue(_queue, _body, _options, callback) { callback(new Error("broker down")); } };
  await assert.rejects(publishPending({ owners: media.owners, channel }), /broker down/);
  assert.equal((await doc()).jobs[0].state, "pending");
});
integration("expired publisher/worker leases are recovered", async () => {
  await upload();
  await media.owners.updateOne({ _id: "school/admin" }, {
    $set: { "jobs.0.state": "processing", "jobs.0.leaseUntil": new Date(0) },
  });
  let count = 0;
  const channel = { sendToQueue(_q, _b, _o, cb) { count += 1; cb(null); } };
  await publishPending({ owners: media.owners, channel });
  assert.equal(count, 1);
});
integration("retry resets failed job attempts atomically", async () => {
  await upload();
  await media.owners.updateOne({ _id: "school/admin" }, {
    $set: { "jobs.0.state": "failed", "jobs.0.attempts": 3, "jobs.0.error": "Thumbnail failed" },
  });
  assert.equal((await media.retry("school", "admin")).status, "processing");
  assert.equal((await doc()).jobs[0].attempts, 0);
});
integration("interrupted uploads become explicitly failed", async () => {
  await upload();
  await media.owners.updateOne({ _id: "school/admin" }, {
    $set: { "jobs.0.state": "uploading", "jobs.0.leaseUntil": new Date(0) },
  });
  await media.reconcile();
  assert.equal((await media.get("school", "admin")).status, "failed");
});
integration("unknown record cannot own a photo", async () => {
  await assert.rejects(media.upload("students", new ObjectId().toHexString(), Buffer.from("x"), "image/png"),
    (error) => error.status === 404);
  assert.equal(await media.owners.countDocuments(), 0);
});
