const { randomUUID } = require("node:crypto");
const { ObjectId } = require("mongodb");

const KINDS = ["students", "teachers", "employees", "school"];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function createMedia({ db, storage, urlTtlSeconds = 3600 }) {
  const owners = db.collection("media");
  const ownerKey = (kind, id) => `${kind}/${id}`;

  async function exists(kind, id) {
    if (!KINDS.includes(kind) || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return false;
    if (kind === "school") return id === "admin";
    const query = kind === "teachers"
      ? { recordId: id }
      : ObjectId.isValid(id) ? { _id: new ObjectId(id) } : null;
    return query !== null && Boolean(await db.collection(kind).findOne(query, { projection: { _id: 1 } }));
  }

  async function requireOwner(kind, id) {
    if (!await exists(kind, id)) throw new HttpError(404, "This record no longer exists.");
  }

  async function describe(doc) {
    if (!doc || doc.deleted) return { imageUrl: null, status: "empty" };
    const job = doc.jobs.find((item) => item.version === doc.desired);
    return {
      imageUrl: doc.current ? await storage.thumbnailUrl(doc.current.thumbnailKey) : null,
      status: job?.state === "ready" ? "ready" : job?.state === "failed" ? "failed"
        : job ? "processing" : "empty",
      error: job?.state === "failed" ? job.error : null,
      version: doc.desired, expiresIn: urlTtlSeconds,
    };
  }

  return {
    owners, exists,
    async get(kind, id) {
      await requireOwner(kind, id);
      return describe(await owners.findOne({ _id: ownerKey(kind, id) }));
    },
    async list(kind, ids) {
      if (!KINDS.includes(kind)) throw new HttpError(400, "Invalid record type.");
      if (ids.length > 100 || ids.some((id) => !/^[a-zA-Z0-9_-]{1,80}$/.test(id))) {
        throw new HttpError(400, "Provide up to 100 valid record IDs.");
      }
      const docs = await owners.find({ _id: { $in: ids.map((id) => ownerKey(kind, id)) } }).toArray();
      return Object.fromEntries(await Promise.all(ids.map(async (id) =>
        [id, await describe(docs.find((doc) => doc._id === ownerKey(kind, id)))])));
    },
    async upload(kind, id, buffer, contentType) {
      await requireOwner(kind, id);
      const version = randomUUID();
      const key = ownerKey(kind, id);
      const job = {
        version, sourceKey: `${key}/${version}/original`,
        thumbnailKey: `${key}/${version}/thumbnail.webp`,
        state: "uploading", attempts: 0, createdAt: new Date(),
        leaseUntil: new Date(Date.now() + 600000),
      };
      // The version and its outbox are recorded atomically before touching S3.
      await owners.updateOne({ _id: key }, {
        $set: { kind, recordId: id, desired: version, deleted: false },
        $push: { jobs: job },
      }, { upsert: true });
      try {
        await storage.putImage(job.sourceKey, buffer, contentType);
        await owners.updateOne({ _id: key, "jobs.version": version }, {
          $set: { "jobs.$.state": "pending", "jobs.$.nextPublishAt": new Date() },
        });
      } catch (error) {
        await owners.updateOne({ _id: key, "jobs.version": version }, {
          $set: { "jobs.$.state": "failed", "jobs.$.error": "Original upload failed. Choose the photo again." },
        });
        throw error;
      }
      // A record can be deleted while its image is uploading.
      if (!await exists(kind, id)) {
        await owners.updateOne({ _id: key }, { $set: { deleted: true, desired: null, current: null } });
        throw new HttpError(404, "Record deleted during upload; image cleanup has been scheduled.");
      }
      return this.get(kind, id);
    },
    async remove(kind, id) {
      await requireOwner(kind, id);
      await owners.updateOne({ _id: ownerKey(kind, id) }, {
        $set: { desired: null, current: null },
      });
    },
    async retry(kind, id) {
      await requireOwner(kind, id);
      const doc = await owners.findOne({ _id: ownerKey(kind, id) });
      const job = doc?.jobs.find((item) => item.version === doc.desired);
      if (!job || job.state !== "failed") throw new HttpError(409, "There is no failed photo to retry.");
      if (job.error?.startsWith("Original upload")) throw new HttpError(409, "Choose the photo again to retry its upload.");
      await owners.updateOne({ _id: doc._id, desired: job.version,
        jobs: { $elemMatch: { version: job.version, state: "failed" } } }, {
        $set: { "jobs.$.state": "pending", "jobs.$.attempts": 0,
          "jobs.$.error": null, "jobs.$.nextPublishAt": new Date() },
      });
      return this.get(kind, id);
    },
    async reconcile() {
      for await (const doc of owners.find({})) {
        if (!doc.deleted && !await exists(doc.kind, doc.recordId)) {
          await owners.updateOne({ _id: doc._id }, {
            $set: { deleted: true, desired: null, current: null },
          });
          doc.deleted = true; doc.desired = null; doc.current = null;
        }
        for (const job of doc.jobs) {
          if (job.version === doc.desired || job.version === doc.current?.version) {
            if (job.state === "uploading" && job.leaseUntil < new Date()) {
              await owners.updateOne({ _id: doc._id, "jobs.version": job.version }, {
                $set: { "jobs.$.state": "failed", "jobs.$.error": "Original upload interrupted. Choose the photo again." },
              });
            }
            continue;
          }
          if (["uploading", "processing"].includes(job.state) && job.leaseUntil > new Date()) continue;
          await storage.deleteVersion(job);
          await owners.updateOne({ _id: doc._id, desired: { $ne: job.version },
            "current.version": { $ne: job.version } }, { $pull: { jobs: { version: job.version } } });
        }
      }
    },
  };
}

module.exports = { createMedia, HttpError };
