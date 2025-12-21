const fs = require("fs");
const path = require("path");

// Routes audio (upload/list/order/rename/delete).
function registerAudioRoutes({
  app,
  requireLogin,
  limiterUpload,
  audioUpload,
  deps
}) {
  const {
    TENANTS_DIR,
    AUDIO_EXT,
    getTenantQuota,
    getTenantUsageBytes,
    readAudioOrder,
    writeAudioOrder,
    removeAudioFromScenes,
    isSafeName
  } = deps;

  // LIST AUDIO
  app.get("/api/tenant/:tenant/audio", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.session.user.tenantId)
      return res.status(403).json({ error: "Forbidden tenant" });

    const dir = path.join(TENANTS_DIR, tenantId, "audio");
    if (!fs.existsSync(dir)) return res.json([]);

    const order = readAudioOrder(tenantId);
    const files = fs.readdirSync(dir).filter(f => AUDIO_EXT.test(f));
    const sorted = [...files].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      const va = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
      const vb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
      if (va !== vb) return va - vb;
      return a.localeCompare(b);
    });

    const list = sorted.map(name => {
      const filePath = path.join(dir, name);
      let size = 0;
      try {
        size = fs.statSync(filePath).size;
      } catch {}
      return {
        name,
        url: `/t/${tenantId}/audio/${name}`,
        size
      };
    });

    res.json(list);
  });

  // UPLOAD AUDIO
  app.post("/api/:tenantId/audio/upload", requireLogin, (req, res) => {
    const tenantId = req.params.tenantId;
    if (tenantId !== req.session.user.tenantId)
      return res.status(403).json({ error: "Forbidden tenant" });

    limiterUpload(req, res, () => {
      audioUpload.single("audio")(req, res, err => {
        if (err) {
          if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "File too large (1 MB max)" });
          if (err.code === "INVALID_AUDIO") return res.status(400).json({ error: "Unsupported audio format" });
          return res.status(400).json({ error: "Audio upload failed" });
        }
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const { quotaMB } = getTenantQuota(tenantId);
        const quotaBytes = quotaMB * 1024 * 1024;
        const usageBytes = getTenantUsageBytes(tenantId);
        const fileSize = req.file.size || 0;

        if (usageBytes + fileSize > quotaBytes) {
          try { if (req.file.path) fs.unlinkSync(req.file.path); } catch {}
          return res.status(400).json({ error: "Quota exceeded" });
        }

        const order = readAudioOrder(tenantId);
        order.push(req.file.filename);
        writeAudioOrder(tenantId, order);

        res.json({ success: true, name: req.file.filename, size: fileSize });
      });
    });
  });

  // DELETE AUDIO
  app.delete("/api/:tenantId/audio/:name", requireLogin, (req, res) => {
    const { tenantId, name } = req.params;
    if (tenantId !== req.session.user.tenantId)
      return res.status(403).json({ error: "Forbidden tenant" });
    if (!isSafeName(name)) return res.status(400).json({ error: "Invalid name" });

    const filePath = path.join(TENANTS_DIR, tenantId, "audio", name);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
    const order = readAudioOrder(tenantId).filter(n => n !== name);
    writeAudioOrder(tenantId, order);
    const scenesUpdated = removeAudioFromScenes(tenantId, name);
    return res.json({ success: true, scenesUpdated });
  });

  // ORDER AUDIO
  app.put("/api/:tenantId/audio/order", requireLogin, (req, res) => {
    const { tenantId } = req.params;
    if (tenantId !== req.session.user.tenantId)
      return res.status(403).json({ error: "Forbidden tenant" });
    const newOrder = Array.isArray(req.body.order) ? req.body.order.filter(isSafeName) : [];
    writeAudioOrder(tenantId, newOrder);
    res.json({ success: true });
  });

  // RENAME AUDIO
  app.put("/api/:tenantId/audio/:name", requireLogin, (req, res) => {
    const { tenantId, name } = req.params;
    const { newName } = req.body || {};
    if (tenantId !== req.session.user.tenantId)
      return res.status(403).json({ error: "Forbidden tenant" });
    if (!isSafeName(name) || !isSafeName(newName)) return res.status(400).json({ error: "Invalid name" });
    if (!newName || !AUDIO_EXT.test(newName)) return res.status(400).json({ error: "Invalid audio name" });

    const dir = path.join(TENANTS_DIR, tenantId, "audio");
    if (!fs.existsSync(dir)) return res.status(404).json({ error: "Not found" });

    const src = path.join(dir, name);
    const dest = path.join(dir, newName);

    if (!fs.existsSync(src)) return res.status(404).json({ error: "Not found" });
    if (fs.existsSync(dest)) return res.status(400).json({ error: "Name already exists" });

    try {
      fs.renameSync(src, dest);
      const order = readAudioOrder(tenantId).map(n => n === name ? newName : n);
      writeAudioOrder(tenantId, order);
      removeAudioFromScenes(tenantId, name);
      res.json({ success: true, name: newName });
    } catch (err) {
      res.status(500).json({ error: "Rename failed" });
    }
  });

  // PUBLIC serve audio
  app.get("/t/:tenantId/audio/:name", (req, res) => {
    const { tenantId, name } = req.params;
    if (!isSafeName(name)) return res.status(400).send("Invalid name");
    const file = path.join(TENANTS_DIR, tenantId, "audio", name);
    if (!fs.existsSync(file)) return res.status(404).send("Audio not found");
    res.sendFile(file);
  });
}

module.exports = {
  registerAudioRoutes
};
