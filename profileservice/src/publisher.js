const amqp = require("amqplib");

const QUEUE = "media.thumbnail";
const DEAD_QUEUE = "media.thumbnail.dead";

async function connectPublisher(url) {
  const connection = await amqp.connect(url);
  const channel = await connection.createConfirmChannel();
  await channel.assertQueue(DEAD_QUEUE, { durable: true });
  await channel.assertQueue(QUEUE, {
    durable: true, arguments: { "x-dead-letter-exchange": "", "x-dead-letter-routing-key": DEAD_QUEUE },
  });
  return { connection, channel };
}

async function publishPending({ owners, channel, bucket, thumbnailBucket }) {
  const now = new Date();
  for await (const doc of owners.find({ deleted: false, desired: { $ne: null } })) {
    const job = doc.jobs.find((item) => item.version === doc.desired);
    if (!job || !["pending", "queued", "processing"].includes(job.state)) continue;
    if (job.state === "pending" ? job.nextPublishAt > now : job.leaseUntil > now) continue;
    const leaseUntil = new Date(Date.now() + 300000);
    const claimed = await owners.updateOne({
      _id: doc._id, desired: job.version,
      jobs: { $elemMatch: { version: job.version, state: job.state,
        ...(job.state === "pending" ? { nextPublishAt: { $lte: now } } : { leaseUntil: { $lte: now } }) } },
    }, { $set: { "jobs.$.state": "queued", "jobs.$.leaseUntil": leaseUntil } });
    if (!claimed.modifiedCount) continue;
    const event = {
      schemaVersion: 1, type: "image.uploaded", owner: doc._id, version: job.version,
      sourceBucket: bucket, sourceKey: job.sourceKey,
      thumbnailBucket, thumbnailKey: job.thumbnailKey,
    };
    try {
      await new Promise((resolve, reject) => channel.sendToQueue(QUEUE,
        Buffer.from(JSON.stringify(event)), { persistent: true, contentType: "application/json",
          messageId: job.version }, (error) => error ? reject(error) : resolve()));
    } catch (error) {
      await owners.updateOne({ _id: doc._id,
        jobs: { $elemMatch: { version: job.version, state: "queued" } } }, {
        $set: { "jobs.$.state": "pending", "jobs.$.nextPublishAt": new Date(Date.now() + 5000) },
      });
      throw error;
    }
  }
}

module.exports = { connectPublisher, publishPending, QUEUE, DEAD_QUEUE };
