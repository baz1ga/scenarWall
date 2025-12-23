const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const sharp = require("sharp");

function registerCharacterRoutes({ app, requireLogin, limiterUpload, uploadHandlerAvatar, paths, logger }) {
  const { TENANTS_DIR } = paths;

  const characterDir = (tenantId) => path.join(TENANTS_DIR, tenantId, "characters");
  const characterPath = (tenantId, id) => path.join(characterDir(tenantId), `${id}.json`);
  const avatarDir = (tenantId) => path.join(characterDir(tenantId), "avatars");
  const avatarPath = (tenantId, file) => path.join(avatarDir(tenantId), file);
  const avatarThumbPath = (tenantId, file) => path.join(avatarDir(tenantId), "thumbs", `thumb-${file}`);
  function cloneAvatar(tenantId, sourceFile, targetId) {
    if (!sourceFile) return null;
    const src = avatarPath(tenantId, sourceFile);
    if (!fs.existsSync(src)) return null;
    const ext = path.extname(sourceFile) || ".jpg";
    const newName = `avatar-${targetId}${ext}`;
    ensureAvatarDir(tenantId);
    const dest = avatarPath(tenantId, newName);
    try {
      fs.copyFileSync(src, dest);
      ensureAvatarThumb(tenantId, newName);
      return newName;
    } catch (err) {
      logger?.error?.("Failed to clone avatar", { tenantId, sourceFile, targetId, err: err?.message });
      return null;
    }
  }

  function ensureCharacterDir(tenantId) {
    const dir = characterDir(tenantId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  function ensureAvatarDir(tenantId) {
    const dir = avatarDir(tenantId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  async function ensureAvatarThumb(tenantId, file) {
    const src = avatarPath(tenantId, file);
    const dest = avatarThumbPath(tenantId, file);
    if (!fs.existsSync(src)) return null;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await sharp(src).resize(128, 128, { fit: "cover" }).toFile(dest);
      return dest;
    } catch (err) {
      logger?.error?.("Failed to create avatar thumbnail", { tenantId, file, err: err?.message });
      return null;
    }
  }

  function listCharacters(tenantId) {
    const dir = characterDir(tenantId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        } catch (err) {
          logger?.error?.("Failed to parse character file", { tenantId, file: f, err: err?.message });
          return null;
        }
      })
      .filter(Boolean);
  }

  function readCharacter(tenantId, id) {
    const file = characterPath(tenantId, id);
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (err) {
      logger?.error?.("Failed to read character", { tenantId, id, err: err?.message });
      return null;
    }
  }

  function writeCharacter(tenantId, data) {
    ensureCharacterDir(tenantId);
    const payload = { ...data };
    const file = characterPath(tenantId, payload.id);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    return payload;
  }

  function deleteCharacter(tenantId, id) {
    const existing = readCharacter(tenantId, id);
    if (existing?.avatar) {
      const file = avatarPath(tenantId, existing.avatar);
      if (fs.existsSync(file)) {
        try { fs.unlinkSync(file); } catch {}
      }
      const thumb = avatarThumbPath(tenantId, existing.avatar);
      if (fs.existsSync(thumb)) {
        try { fs.unlinkSync(thumb); } catch {}
      }
    }
    const file = characterPath(tenantId, id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  app.get("/api/tenant/:tenant/characters", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.user.tenantId) return res.status(403).json({ error: "Forbidden tenant" });
    const role = (req.query.role || "").toLowerCase();
    const sessionId = req.query.session || "";
    const scenarioId = req.query.scenario || "";
    const characters = listCharacters(tenantId).filter(ch => {
      const roleOk = role ? (ch.role || "").toLowerCase() === role : true;
      const sessionOk = sessionId ? Array.isArray(ch.sessions) && ch.sessions.includes(sessionId) : true;
      const scenarioOk = scenarioId ? (ch.parentScenario || "") === scenarioId : true;
      return roleOk && sessionOk && scenarioOk;
    });
    res.json(characters);
  });

  app.get("/api/tenant/:tenant/characters/:id", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.user.tenantId) return res.status(403).json({ error: "Forbidden tenant" });
    const ch = readCharacter(tenantId, req.params.id);
    if (!ch) return res.status(404).json({ error: "Not found" });
    res.json(ch);
  });

  app.post("/api/tenant/:tenant/characters", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.user.tenantId) return res.status(403).json({ error: "Forbidden tenant" });
    const now = Math.floor(Date.now() / 1000);
    const id = req.body?.id || `char-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const {
      name = "",
      role = "",
      type = "",
      race = "",
      history = "",
      hpCurrent = 0,
      hpMax = 0,
      sessions = [],
      parentScenario = null
    } = req.body || {};
    const payload = {
      id,
      name: String(name || "").trim(),
      role: String(role || "").toLowerCase(),
      type: String(type || "").trim(),
      race: String(race || "").trim(),
      history: String(history || ""),
      hpCurrent: Number.isFinite(hpCurrent) ? hpCurrent : 0,
      hpMax: Number.isFinite(hpMax) ? hpMax : 0,
      sessions: Array.isArray(sessions) ? sessions.filter(Boolean) : [],
      parentScenario: parentScenario || null,
      createdAt: now,
      updatedAt: now
    };
    if (req.body?.avatar) {
      const cloned = cloneAvatar(tenantId, req.body.avatar, id);
      if (cloned) payload.avatar = cloned;
    }
    writeCharacter(tenantId, payload);
    res.status(201).json(payload);
  });

  app.put("/api/tenant/:tenant/characters/:id", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.user.tenantId) return res.status(403).json({ error: "Forbidden tenant" });
    const existing = readCharacter(tenantId, req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const now = Math.floor(Date.now() / 1000);
    const next = {
      ...existing,
      ...req.body,
      id: existing.id,
      name: String(req.body?.name ?? existing.name ?? "").trim(),
      role: String(req.body?.role ?? existing.role ?? "").toLowerCase(),
      type: String(req.body?.type ?? existing.type ?? "").trim(),
      race: String(req.body?.race ?? existing.race ?? "").trim(),
      history: String(req.body?.history ?? existing.history ?? ""),
      hpCurrent: Number.isFinite(req.body?.hpCurrent) ? req.body.hpCurrent : Number(existing.hpCurrent) || 0,
      hpMax: Number.isFinite(req.body?.hpMax) ? req.body.hpMax : Number(existing.hpMax) || 0,
      sessions: Array.isArray(req.body?.sessions) ? req.body.sessions.filter(Boolean) : (Array.isArray(existing.sessions) ? existing.sessions : []),
      parentScenario: req.body?.parentScenario ?? existing.parentScenario ?? null,
      updatedAt: now
    };
    writeCharacter(tenantId, next);
    res.json(next);
  });

  app.delete("/api/tenant/:tenant/characters/:id", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.user.tenantId) return res.status(403).json({ error: "Forbidden tenant" });
    deleteCharacter(tenantId, req.params.id);
    res.json({ success: true });
  });

  app.get("/api/tenant/:tenant/characters/:id/avatar", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.user.tenantId) return res.status(403).json({ error: "Forbidden tenant" });
    const ch = readCharacter(tenantId, req.params.id);
    if (!ch?.avatar) return res.status(404).send("Not found");
    const file = avatarPath(tenantId, ch.avatar);
    if (!fs.existsSync(file)) return res.status(404).send("Not found");
    res.sendFile(file);
  });

  app.post("/api/tenant/:tenant/characters/:id/avatar", requireLogin, limiterUpload, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.user.tenantId) return res.status(403).json({ error: "Forbidden tenant" });
    const ch = readCharacter(tenantId, req.params.id);
    if (!ch) return res.status(404).json({ error: "Not found" });
    ensureAvatarDir(tenantId);
    uploadHandlerAvatar.single("avatar")(req, res, err => {
      if (err) {
        return res.status(400).json({ error: err.code || "Avatar upload failed" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "Missing file" });
      }
      if (ch.avatar && ch.avatar !== req.file.filename) {
        const prev = avatarPath(tenantId, ch.avatar);
        if (fs.existsSync(prev)) {
          try { fs.unlinkSync(prev); } catch {}
        }
        const prevThumb = avatarThumbPath(tenantId, ch.avatar);
        if (fs.existsSync(prevThumb)) {
          try { fs.unlinkSync(prevThumb); } catch {}
        }
      }
      const now = Math.floor(Date.now() / 1000);
      const updated = { ...ch, avatar: req.file.filename, updatedAt: now };
      ensureAvatarThumb(tenantId, req.file.filename).then(() => {
        writeCharacter(tenantId, updated);
        res.json(updated);
      }).catch(() => {
        writeCharacter(tenantId, updated);
        res.json(updated);
      });
    });
  });

  app.get("/api/tenant/:tenant/characters/:id/avatar-thumb", requireLogin, async (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.user.tenantId) return res.status(403).json({ error: "Forbidden tenant" });
    const ch = readCharacter(tenantId, req.params.id);
    if (!ch?.avatar) return res.status(404).send("Not found");
    const file = avatarThumbPath(tenantId, ch.avatar);
    if (!fs.existsSync(file)) {
      await ensureAvatarThumb(tenantId, ch.avatar);
    }
    if (!fs.existsSync(file)) return res.status(404).send("Not found");
    res.sendFile(file);
  });
}

module.exports = { registerCharacterRoutes };
