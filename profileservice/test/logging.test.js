const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createApp } = require("../src/app");
const { createLogger, errorFields, failureReporter } = require("../src/logging");

test("repeated outages emit one failure and one recovery per transition", () => {
  const lines = [];
  const { reportFailure, recovered } = failureReporter(createLogger((line) => lines.push(JSON.parse(line))));
  for (let i = 0; i < 100; i++) reportFailure("broker_failed", new Error("secret"));
  assert.equal(lines.length, 1);
  recovered("broker_failed");
  recovered("broker_failed");
  reportFailure("broker_failed", new Error("secret"));
  assert.deepEqual(lines.map((r) => r.event), ["broker_failed", "broker_recovered", "broker_failed"]);
});

test("JSON logger emits one safe line including timestamp and service", () => {
  const lines = [];
  const logger = createLogger((line) => lines.push(line));
  logger.error("startup_failed", errorFields(new Error("mongodb://user:password@host\nprivate name")));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].split("\n").length, 2);
  const record = JSON.parse(lines[0]);
  assert.equal(record.level, "ERROR");
  assert.equal(record.service, "profileservice");
  assert.equal(record.error_type, "Error");
  assert.equal(record.message, "Startup failed.");
  assert.ok(Number.isFinite(Date.parse(record.timestamp)));
  assert.ok(!lines[0].includes("password"));
});

test("requests use safe route templates, IDs, severity and quiet health checks", async () => {
  const lines = [];
  const logger = createLogger((line) => lines.push(JSON.parse(line)));
  const server = createApp({
    logger,
    media: { get: async () => { throw new Error("private student name and password"); } },
    ready: async () => { throw new TypeError("connection credentials"); },
  }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/photos/students/private-id`, { method: "OPTIONS" })).status, 204);
    assert.equal(lines.length, 0);
    const response = await fetch(`${base}/photos/students/private-id?token=password`, {
      headers: { "X-Request-ID": "request-123" },
    });

    assert.equal(response.status, 500);
    assert.equal(response.headers.get("X-Request-ID"), "request-123");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].route, "/photos/:kind/:id");
    assert.equal(lines[0].level, "ERROR");
    assert.equal(lines[0].error_type, "Error");
    assert.ok(lines[0].duration_ms >= 0);
    assert.equal((await fetch(`${base}/ready`)).status, 503);
    assert.equal(lines[1].route, "/ready");
    const unknown = await fetch(`${base}/private-path`, { headers: { "X-Request-ID": "bad id" } });
    assert.match(unknown.headers.get("X-Request-ID"), /^[a-f0-9-]{36}$/);
    assert.equal(lines[2].route, "unmatched");
    assert.equal(lines[2].level, "WARN");
    assert.ok(!JSON.stringify(lines).match(/password|private-id|private-path|private student/));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("successful reads are quiet but writes remain readable", async () => {
  const lines = [];
  const server = createApp({
    logger: createLogger((line) => lines.push(JSON.parse(line))),
    media: { get: async () => ({}), remove: async () => {} },
  }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (let i = 0; i < 10; i++) await fetch(`${base}/profile/avatar`);
    assert.equal(lines.length, 0);
    assert.equal((await fetch(`${base}/profile/avatar`, { method: "DELETE" })).status, 204);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].message, "HTTP request completed.");
    assert.equal(lines[0].level, "INFO");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
