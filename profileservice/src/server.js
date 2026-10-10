const { logger, errorFields, failureReporter } = require("./logging");
const { MongoClient } = require("mongodb");
const { createApp, validateImage } = require("./app");
const { createMedia } = require("./media");
const { connectPublisher, publishPending } = require("./publisher");
const { createS3Client, createStorage } = require("./storage");

function required(name) {
  if (!process.env[name]) throw new Error(`Missing environment variable ${name}`);
  return process.env[name];
}

async function main() {
  // Replace Node's default plain-text warning output with the JSON handler.
  process.removeAllListeners("warning");
  process.on("warning", (warning) => logger.warn("runtime_warning", errorFields(warning)));
  try { process.loadEnvFile(); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const config = {
    endpoint: required("S3_ENDPOINT"), region: process.env.S3_REGION || "us-east-1",
    bucket: process.env.S3_BUCKET || "school-media",
    thumbnailBucket: process.env.S3_THUMBNAIL_BUCKET || "school-thumbnails",
    accessKey: required("S3_ACCESS_KEY"), secretKey: required("S3_SECRET_KEY"),
    publicPath: process.env.S3_PUBLIC_PATH || "", urlTtlSeconds: 3600,
  };
  const mongo = new MongoClient(required("MONGODB_URI"), { serverSelectionTimeoutMS: 5000 });
  await mongo.connect();
  const db = mongo.db(process.env.DATABASE_NAME || "kindergarten");
  const s3 = createS3Client(config);
  const storage = createStorage({ s3, ...config });
  await storage.ensureBuckets();
  const media = createMedia({ db, storage });

  // One-time conversion of the existing shared avatar; keep its source until the job is durable.
  if (!await media.owners.findOne({ _id: "school/admin" })) {
    const legacy = await storage.getLegacyAvatar();
    if (legacy) {
      await validateImage(legacy.buffer, legacy.type);
      await media.upload("school", "admin", legacy.buffer, legacy.type);
      await storage.deleteLegacyAvatar();
    }
  }

  let publisher;
  let stopped = false;
  const { reportFailure, recovered } = failureReporter(logger);
  const relay = async () => {
    while (!stopped) {
      try {
        await media.reconcile();
        recovered("reconciliation_failed");
      } catch (error) { reportFailure("reconciliation_failed", error); }
      try {
        if (!publisher) {
          publisher = await connectPublisher(required("RABBITMQ_URL"));
          publisher.connection.on("error", (error) => reportFailure("broker_connection_failed", error));
          publisher.channel.on("error", (error) => reportFailure("broker_channel_failed", error));
          const connected = publisher;
          publisher.connection.on("close", () => { if (publisher === connected) publisher = null; });
          publisher.channel.on("close", () => { if (publisher === connected) publisher = null; });
        }
        await publishPending({ owners: media.owners, channel: publisher.channel, ...config });
        recovered("outbox_publish_failed");
        recovered("broker_connection_failed");
        recovered("broker_channel_failed");
      } catch (error) {
        reportFailure("outbox_publish_failed", error);
        if (publisher) {
          try {
            await publisher.connection.close();
            recovered("broker_close_failed");
          } catch (closeError) { reportFailure("broker_close_failed", closeError); }
          publisher = null;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  };
  relay().catch((error) => { logger.error("relay_terminated", errorFields(error)); process.exit(1); });
  const server = createApp({ media, frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:3000", ready: async () => {
    await db.command({ ping: 1 }); await storage.isReady();
  } }).listen(Number(process.env.PORT || 5004), () => logger.info("service_started", { port: Number(process.env.PORT || 5004) }));
  server.on("error", (error) => { logger.error("server_failed", errorFields(error)); process.exit(1); });
  const shutdown = () => {
    stopped = true;
    server.close(async () => {
      try {
        if (publisher) await publisher.connection.close();
        await mongo.close(); s3.destroy();
        logger.info("service_stopped");
        process.exit(0);
      } catch (error) {
        logger.error("shutdown_failed", errorFields(error));
        process.exit(1);
      }
    });
    setTimeout(() => { logger.error("shutdown_timeout"); process.exit(1); }, 10000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
main().catch((error) => { logger.error("startup_failed", errorFields(error)); process.exit(1); });
