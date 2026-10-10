const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const sharp = require("sharp");
const { createApp, MAX_IMAGE_BYTES, validateImage } = require("../src/app");
const { HttpError } = require("../src/media");
const { createStorage } = require("../src/storage");

let server, baseUrl, calls, png;
const media = {
  async get(kind, id) { calls.push(["get", kind, id]); return { imageUrl: null, status: "empty" }; },
  async upload(kind, id, buffer, type) { calls.push(["upload", kind, id, buffer.length, type]); return { imageUrl: null, status: "processing" }; },
  async remove(kind, id) { calls.push(["remove", kind, id]); },
  async retry(kind, id) { calls.push(["retry", kind, id]); return { status: "processing" }; },
  async list(kind, ids) { calls.push(["list", kind, ids]); return {}; },
};
function upload(buffer, type = "image/png", path = "/profile/avatar", field = "image") {
  const form = new FormData();
  form.append(field, new Blob([buffer], { type }), "photo");
  return fetch(`${baseUrl}${path}`, { method: "PUT", body: form });
}
before(async () => {
  png = await sharp({ create: { width: 32, height: 64, channels: 3, background: "red" } }).png().toBuffer();
  server = createApp({ media, logger: { debug() {}, info() {}, warn() {}, error() {} } }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => { calls = []; });

test("school avatar GET remains compatible", async () => {
  const response = await fetch(`${baseUrl}/profile/avatar`);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["get", "school", "admin"]]);
});
for (const format of ["png", "jpeg", "webp"]) {
  test(`accepts decoded ${format} and responds asynchronously`, async () => {
    const data = await sharp(png).toFormat(format).toBuffer();
    const response = await upload(data, `image/${format}`);
    assert.equal(response.status, 202);
    assert.equal((await response.json()).status, "processing");
  });
}
for (const kind of ["students", "teachers", "employees"]) {
  test(`${kind} uses its stable ID for uploads`, async () => {
    const response = await upload(png, "image/png", `/photos/${kind}/record123`);
    assert.equal(response.status, 202);
    assert.equal(calls[0][1], kind); assert.equal(calls[0][2], "record123");
  });
}
test("rejects corrupt and mismatched images", async () => {
  assert.equal((await upload(Buffer.from("<svg/>"))).status, 415);
  assert.equal((await upload(png.subarray(0, 40))).status, 415);
  assert.equal((await upload(png, "image/jpeg")).status, 415);
  assert.equal(calls.length, 0);
});
test("checks exact 5 MB boundary", async () => {
  const atLimit = Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES - png.length)]);
  assert.equal((await upload(atLimit)).status, 202);
  assert.equal((await upload(Buffer.concat([atLimit, Buffer.alloc(1)]))).status, 413);
});
test("rejects decoded images above 20 megapixels", async () => {
  const huge = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(validateImage(huge, "image/png"), HttpError);
});
test("accepts exactly 20 megapixels", async () => {
  const limit = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: "red" } }).png().toBuffer();
  assert.equal(await validateImage(limit, "image/png"), "image/png");
});
test("requires one image field", async () => {
  assert.equal((await upload(png, "image/png", "/profile/avatar", "photo")).status, 400);
  assert.equal((await fetch(`${baseUrl}/profile/avatar`, { method: "PUT" })).status, 400);
});
test("remove and retry delegate to durable media operations", async () => {
  assert.equal((await fetch(`${baseUrl}/photos/students/abc`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${baseUrl}/photos/students/abc/retry`, { method: "POST" })).status, 202);
  assert.deepEqual(calls, [["remove", "students", "abc"], ["retry", "students", "abc"]]);
});
test("private thumbnail URL is rewritten without changing signature", async () => {
  const storage = createStorage({ s3: {}, thumbnailBucket: "thumbs", publicPath: "/media", urlTtlSeconds: 60,
    presign: async () => "http://object-storage:9000/thumbs/photo.webp?X-Amz-Signature=abc" });
  assert.equal(await storage.thumbnailUrl("photo.webp"), "/media/thumbs/photo.webp?X-Amz-Signature=abc");
});

test("local thumbnail links preserve the directly reachable signed S3 URL", async () => {
  const signed = "http://localhost:9000/thumbs/photo.webp?X-Amz-Signature=abc";
  const storage = createStorage({ s3: {}, thumbnailBucket: "thumbs", urlTtlSeconds: 60,
    presign: async () => signed });
  assert.equal(await storage.thumbnailUrl("photo.webp"), signed);
});

test("local browser origin can preflight photo uploads without a proxy", async () => {
  const allowed = await fetch(`${baseUrl}/profile/avatar`, {
    method: "OPTIONS", headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "PUT" },
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:3000");
  assert.match(allowed.headers.get("access-control-allow-methods"), /PUT/);
  const untrusted = await fetch(`${baseUrl}/profile/avatar`, { headers: { Origin: "http://example.invalid" } });
  assert.equal(untrusted.headers.get("access-control-allow-origin"), null);
});
