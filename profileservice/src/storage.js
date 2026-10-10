const { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand,
  PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

function isNotFound(error) {
  return error?.$metadata?.httpStatusCode === 404;
}

function createS3Client(config) {
  return new S3Client({
    endpoint: config.endpoint, region: config.region, forcePathStyle: true,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
  });
}

function createStorage({ s3, bucket, thumbnailBucket, publicPath, urlTtlSeconds, presign = getSignedUrl }) {
  return {
    async ensureBuckets() {
      for (const name of [bucket, thumbnailBucket]) {
        try {
          await s3.send(new HeadBucketCommand({ Bucket: name }));
        } catch (error) {
          if (!isNotFound(error)) throw error;
          await s3.send(new CreateBucketCommand({ Bucket: name }));
        }
      }
    },
    async isReady() {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      await s3.send(new HeadBucketCommand({ Bucket: thumbnailBucket }));
    },
    async thumbnailUrl(key) {
      const signed = new URL(await presign(s3,
        new GetObjectCommand({ Bucket: thumbnailBucket, Key: key }), { expiresIn: urlTtlSeconds }));
      // Local browsers reach S3 directly; keep the signed host and path unchanged.
      return publicPath ? `${publicPath}${signed.pathname}${signed.search}` : signed.href;
    },
    async putImage(key, buffer, contentType) {
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: buffer, ContentType: contentType,
      }));
    },
    async deleteVersion(job) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: job.sourceKey }));
      await s3.send(new DeleteObjectCommand({ Bucket: thumbnailBucket, Key: job.thumbnailKey }));
    },
    async getLegacyAvatar() {
      try {
        const result = await s3.send(new GetObjectCommand({
          Bucket: bucket, Key: "profiles/school-admin/avatar",
        }));
        return { buffer: Buffer.from(await result.Body.transformToByteArray()), type: result.ContentType };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async deleteLegacyAvatar() {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: "profiles/school-admin/avatar" }));
    },
  };
}

module.exports = { createStorage, createS3Client, isNotFound };
