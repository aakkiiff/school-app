const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const { HttpError } = require("./media");
const { logger: defaultLogger, errorFields, requestLogging } = require("./logging");

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 20000000;
const TYPES = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

async function validateImage(buffer, declaredType) {
  try {
    const image = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: "warning" });
    const meta = await image.metadata();
    if (!TYPES[meta.format] || TYPES[meta.format] !== declaredType || (meta.pages || 1) !== 1) {
      throw new Error("Unsupported format");
    }
    // Decode all pixels to reject corrupt files, not just valid-looking headers.
    await image.stats();
    return TYPES[meta.format];
  } catch {
    throw new HttpError(415, "Use a valid, non-animated JPEG, PNG, or WebP image of at most 20 megapixels.");
  }
}

function createApp({ media, ready = async () => {}, logger = defaultLogger, frontendOrigin = "http://localhost:3000" }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestLogging(logger));
  app.use((req, res, next) => {
    if (req.headers.origin === frontendOrigin) {
      res.set("Access-Control-Allow-Origin", frontendOrigin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, X-Request-ID");
      res.set("Access-Control-Expose-Headers", "X-Request-ID");
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });
  const upload = multer({ storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 1 } }).single("image");

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/ready", async (_req, res) => {
    try { await ready(); res.json({ status: "ready" }); }
    catch (error) { res.locals.errorType = errorFields(error).error_type; res.status(503).json({ status: "unavailable" }); }
  });

  const send = (res, data, status = 200) => res.set("Cache-Control", "no-store").status(status).json(data);
  const registerPhoto = (path, owner) => {
    app.get(path, async (req, res) => {
      const [kind, id] = owner(req);
      send(res, await media.get(kind, id));
    });
    app.put(path, (req, res, next) => {
      upload(req, res, async (error) => {
        try {
          if (error) throw error;
          if (!req.file) throw new HttpError(400, 'Attach one image in the "image" form field.');
          const type = await validateImage(req.file.buffer, req.file.mimetype);
          const [kind, id] = owner(req);
          send(res, await media.upload(kind, id, req.file.buffer, type), 202);
        } catch (failure) { next(failure); }
      });
    });
    app.delete(path, async (req, res) => {
      const [kind, id] = owner(req);
      await media.remove(kind, id);
      res.status(204).end();
    });
    app.post(`${path}/retry`, async (req, res) => {
      const [kind, id] = owner(req);
      send(res, await media.retry(kind, id), 202);
    });
  };
  registerPhoto("/profile/avatar", () => ["school", "admin"]);
  registerPhoto("/photos/:kind/:id", (req) => [req.params.kind, req.params.id]);
  app.get("/photos/:kind", async (req, res) => {
    send(res, await media.list(req.params.kind, String(req.query.ids || "").split(",").filter(Boolean)));
  });
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
      const large = error.code === "LIMIT_FILE_SIZE";
      return res.status(large ? 413 : 400).json({
        error: large ? "Images must be 5 MB or smaller." : 'Upload exactly one image in the "image" form field.',
      });
    }
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    res.locals.errorType = errorFields(error).error_type;
    return res.status(500).json({ error: "The photo operation failed. Please retry." });
  });
  return app;
}

module.exports = { createApp, validateImage, MAX_IMAGE_BYTES, MAX_PIXELS };
