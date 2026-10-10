const { randomUUID } = require("node:crypto");

function createLogger(write = (line) => process.stdout.write(line)) {
  const log = (level, event, fields = {}) => {
    const description = event === "http_request"
      ? fields.status >= 500 ? "HTTP request failed." : fields.status >= 400 ? "HTTP request rejected." : "HTTP request completed."
      : `${event.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())}.`;
    write(`${JSON.stringify({
      timestamp: new Date().toISOString(), level, service: "profileservice", event, message: description, ...fields,
    })}\n`);
  };
  return {
    debug: (event, fields) => {
      if (process.env.LOG_LEVEL === "DEBUG") log("DEBUG", event, fields);
    },
    info: (event, fields) => log("INFO", event, fields),
    warn: (event, fields) => log("WARN", event, fields),
    error: (event, fields) => log("ERROR", event, fields),
  };
}

const logger = createLogger();
const errorFields = (error) => ({
  error_type: error instanceof Error ? error.constructor.name : "UnknownError",
});

function failureReporter(log) {
  const failures = new Set();
  return {
    reportFailure(event, error) {
      if (!failures.has(event)) log.error(event, errorFields(error));
      failures.add(event);
    },
    recovered(event) {
      if (failures.delete(event)) log.info(`${event.replace(/_failed$/, "")}_recovered`);
    },
  };
}

function requestLogging(log) {
  return (req, res, next) => {
    const supplied = req.get("X-Request-ID");
    req.requestId = /^[A-Za-z0-9_-]{1,64}$/.test(supplied || "") ? supplied : randomUUID();
    res.set("X-Request-ID", req.requestId);
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const route = req.route?.path || "unmatched";
      if (res.statusCode < 400 && (req.method === "OPTIONS" || route === "/health" || route === "/ready")) return;
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn"
        : req.method === "GET" || req.method === "HEAD" ? "debug" : "info";
      log[level]("http_request", {
        request_id: req.requestId, method: req.method, route, status: res.statusCode,
        duration_ms: Number(process.hrtime.bigint() - start) / 1e6,
        ...(res.locals.errorType ? { error_type: res.locals.errorType } : {}),
      });
    });
    next();
  };
}

module.exports = { createLogger, logger, errorFields, requestLogging, failureReporter };
