const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const THUMB_SIZE = 230;

// Routes images (list, upload, order, hide/show, delete) – dépend de l'upload module pour le handler multer.
function registerImageRoutes({
  app,
  requireLogin,
  limiterUpload,
  uploadHandler,
  deps
}) {
  const {
    TENANTS_DIR,
    getTenantQuota,
    getTenantUsageBytes,
    readImageOrder,
    writeImageOrder,
    removeThumbnail,
    removeImageFromScenes,
    imagePath,
    thumbPath,
    isSafeName
  } = deps;

  async function ensureThumbnail(tenantId, name) {
    const source = imagePath(tenantId, name);
    const dest = thumbPath(tenantId, name);
    if (!fs.existsSync(source)) return null;
    if (fs.existsSync(dest)) return dest;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await sharp(source)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover" })
        .toFormat("jpeg", { quality: 70 })
        .toFile(dest);
      return dest;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Thumbnail generation failed", { tenantId, name, error: err.message });
      return null;
    }
  }

  async function ensureThumbnails(tenantId, files = []) {
    const tasks = files.map(name => ensureThumbnail(tenantId, name));
    await Promise.all(tasks);
  }

  // LIST IMAGES
  app.get("/api/tenant/:tenant/images", requireLogin, async (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const dir = path.join(TENANTS_DIR, tenantId, "images");
    const order = readImageOrder(tenantId);
    const hiddenPath = path.join(TENANTS_DIR, tenantId, "images", "images-hidden.json");
    const legacyHidden = path.join(TENANTS_DIR, tenantId, "images-hidden.json");
    if (!fs.existsSync(hiddenPath)) {
      if (fs.existsSync(legacyHidden)) {
        try { fs.renameSync(legacyHidden, hiddenPath); } catch {}
      }
    }
    if (!fs.existsSync(hiddenPath)) fs.writeFileSync(hiddenPath, "[]");
    const hidden = JSON.parse(fs.readFileSync(hiddenPath, "utf8"));

    if (!fs.existsSync(dir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(dir)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));

    await ensureThumbnails(tenantId, files);

    const sorted = [...files].sort((a, b) => {
      return order.indexOf(a) - order.indexOf(b);
    });

    const list = sorted.map(f => ({
      name: f,
      url: `/t/${tenantId}/images/${f}`,
      thumbUrl: `/t/${tenantId}/thumbs/${f}`,
      hidden: hidden.includes(f)
    }));

    res.json(list);
  });

  // UPLOAD IMAGE
  app.post("/api/:tenantId/images/upload", requireLogin, (req, res) => {
    const tenantId = req.params.tenantId;
    if (tenantId !== req.session.user.tenantId)
      return res.status(403).json({ error: "Forbidden tenant" });

    limiterUpload(req, res, () => {
      uploadHandler.single("image")(req, res, async err => {
        if (err) {
          if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "Image too large (6 MB max)" });
          if (err.code === "INVALID_IMAGE") return res.status(400).json({ error: "Unsupported image format" });
          return res.status(400).json({ error: "Image upload failed" });
        }

        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const base = path.join(TENANTS_DIR, tenantId);
        const orderFile = path.join(base, "images", "images-order.json");
        const uploadedPath = req.file.path || path.join(base, "images", req.file.filename);

        const { quotaMB } = getTenantQuota(tenantId);
        const quotaBytes = quotaMB * 1024 * 1024;
        const usageBytes = getTenantUsageBytes(tenantId);
        const projectedUsage = usageBytes + (req.file.size || 0);

        if (projectedUsage > quotaBytes) {
          if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
          return res.status(400).json({ error: "Quota exceeded" });
        }

        const order = JSON.parse(fs.readFileSync(orderFile));
        order.push(req.file.filename);
        fs.writeFileSync(orderFile, JSON.stringify(order, null, 2));

        await ensureThumbnail(tenantId, req.file.filename);

        res.json({ success: true });
      });
    });
  });

  // ORDER IMAGES
  app.put("/api/:tenantId/images/order", requireLogin, (req, res) => {
    const tenantId = req.params.tenantId;
    if (tenantId !== req.session.user.tenantId)
      return res.status(403).json({ error: "Forbidden tenant" });

    const orderInput = Array.isArray(req.body.order) ? req.body.order : [];
    const order = orderInput.filter(isSafeName);

    writeImageOrder(tenantId, order);

    res.json({ success: true });
  });

  // HIDE/SHOW IMAGE
  app.put("/api/:tenantId/images/:name/hide", requireLogin, (req, res) => {
    const tenantId = req.params.tenantId;
    const { name } = req.params;
    const { hidden } = req.body || {};

    if (tenantId !== req.session.user.tenantId)
      return res.status(403).json({ error: "Forbidden tenant" });
    if (!isSafeName(name)) return res.status(400).json({ error: "Invalid name" });

    const dir = path.join(TENANTS_DIR, tenantId, "images");
    const hiddenFile = path.join(dir, "images-hidden.json");
    if (!fs.existsSync(hiddenFile)) fs.writeFileSync(hiddenFile, "[]");

    let list = [];
    try { list = JSON.parse(fs.readFileSync(hiddenFile)); } catch {}
    if (hidden === true) {
      if (!list.includes(name)) list.push(name);
    } else {
      list = list.filter(n => n !== name);
    }
    fs.writeFileSync(hiddenFile, JSON.stringify(list, null, 2));
    res.json({ success: true });
  });

  // DELETE IMAGE
  app.delete("/api/:tenantId/images/:name", requireLogin, (req, res) => {
    const tenantId = req.params.tenantId;
    const { name } = req.params;
    if (tenantId !== req.session.user.tenantId)
      return res.status(403).json({ error: "Forbidden tenant" });
    if (!isSafeName(name)) return res.status(400).json({ error: "Invalid name" });

    const filePath = imagePath(tenantId, name);
    const dir = path.join(TENANTS_DIR, tenantId, "images");
    const orderFile = path.join(dir, "images-order.json");
    const hiddenFile = path.join(dir, "images-hidden.json");

    if (!fs.existsSync(dir)) return res.status(404).json({ error: "Not found" });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });

    try { fs.unlinkSync(filePath); } catch {}
    removeThumbnail(tenantId, name);

    let order = [];
    if (fs.existsSync(orderFile)) {
      try { order = JSON.parse(fs.readFileSync(orderFile)); } catch {}
    }
    order = order.filter(n => n !== name);
    fs.writeFileSync(orderFile, JSON.stringify(order, null, 2));

    let hidden = [];
    if (fs.existsSync(hiddenFile)) {
      try { hidden = JSON.parse(fs.readFileSync(hiddenFile)); } catch {}
    }
    hidden = hidden.filter(n => n !== name);
    fs.writeFileSync(hiddenFile, JSON.stringify(hidden, null, 2));

    removeImageFromScenes(tenantId, name);

    return res.json({ success: true });
  });

  // API accessible côté front (tenant public)
  app.get("/t/:tenantId/api/images", async (req, res) => {
    const tenantId = req.params.tenantId;
    const base = path.join(TENANTS_DIR, tenantId);

    const dir = path.join(base, "images");
    const order = readImageOrder(tenantId);
    const hiddenFile = path.join(base, "images", "images-hidden.json");
    const legacyHidden = path.join(base, "images-hidden.json");
    if (!fs.existsSync(hiddenFile) && fs.existsSync(legacyHidden)) {
      try { fs.renameSync(legacyHidden, hiddenFile); } catch {}
    }
    let hidden = [];
    try {
      if (fs.existsSync(hiddenFile)) {
        hidden = JSON.parse(fs.readFileSync(hiddenFile, "utf8")) || [];
      } else {
        fs.writeFileSync(hiddenFile, "[]");
      }
    } catch {
      hidden = [];
    }

    if (!fs.existsSync(dir)) return res.json([]);

    const files = fs.readdirSync(dir)
      .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));

    await ensureThumbnails(tenantId, files);

    const list = files.map(f => ({
      name: f,
      url: `/t/${tenantId}/images/${f}`,
      thumbUrl: `/t/${tenantId}/thumbs/${f}`,
      hidden: hidden.includes(f)
    }));

    res.json(list);
  });

  // PUBLIC serve image
  app.get("/t/:tenantId/images/:name", (req, res) => {
    const { tenantId, name } = req.params;
    if (!isSafeName(name)) return res.status(400).send("Invalid name");
    const file = imagePath(tenantId, name);
    if (!fs.existsSync(file)) return res.status(404).send("Image not found");
    res.sendFile(file);
  });

  // PUBLIC serve thumbnail (generates if missing)
  app.get("/t/:tenantId/thumbs/:name", async (req, res) => {
    const { tenantId, name } = req.params;
    if (!isSafeName(name)) return res.status(400).send("Invalid name");
    const thumbFile = thumbPath(tenantId, name);
    if (!fs.existsSync(thumbFile)) {
      const source = imagePath(tenantId, name);
      if (!fs.existsSync(source)) return res.status(404).send("Image not found");
      await ensureThumbnail(tenantId, name);
    }
    if (!fs.existsSync(thumbFile)) return res.status(404).send("Thumbnail not found");
    return res.sendFile(thumbFile);
  });
}

module.exports = {
  registerImageRoutes
};
