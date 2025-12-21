const fs = require("fs");

// Routes sessions et scènes (CRUD + notes).
function registerSessionsScenesRoutes({
  app,
  requireLogin,
  logger,
  defaults,
  utils,
  stores
}) {
  const {
    DEFAULT_SESSION_ICON,
    DEFAULT_TENANT_SESSION
  } = defaults;

  const {
    normalizeIconClass,
    listSessions,
    readSessionFile,
    writeSessionFile,
    deleteSessionFile,
    attachSessionToScenario,
    listScenes,
    writeScene,
    readScene,
    deleteScene,
    touchSessionUpdated,
    touchScenarioFromSession,
    readScenario,
    writeScenario,
    listScenarios,
    sanitizeFilename,
    uniqueFilename,
    isSafeName,
    notePath,
    tenantNotesDir
  } = stores;

  // Nettoie/normalise une session entrante avant écriture.
  function sanitizeSessionInput(body = {}, existing = null) {
    const now = Math.floor(Date.now() / 1000);
    const base = existing ? { ...existing } : {
      id: `sess_${Date.now()}`,
      tenantId: body.tenantId,
      title: '',
      parentScenario: null,
      createdAt: now,
      updatedAt: now,
      timer: { ...DEFAULT_TENANT_SESSION.timer },
      hourglass: { ...DEFAULT_TENANT_SESSION.hourglass }
    };
    base.icon = base.icon || DEFAULT_SESSION_ICON;
    const payload = { ...base };
    if (typeof body.title === "string") payload.title = body.title.trim().slice(0, 200);
    if (typeof body.parentScenario === "string") {
      const v = body.parentScenario.trim();
      payload.parentScenario = v || null;
    }
    payload.icon = normalizeIconClass(body.icon, payload.icon || DEFAULT_SESSION_ICON);
    if (typeof body.tensionEnabled === "boolean") {
      payload.tensionEnabled = body.tensionEnabled;
    }
    if (typeof body.tensionFont === "string") {
      payload.tensionFont = body.tensionFont.trim().slice(0, 80);
    }
    const sanitizeColor = (hex, fallback) => {
      const h = (hex || '').toString().trim().toLowerCase();
      const normalized = h.startsWith('#') ? h : `#${h}`;
      const short = normalized.match(/^#([0-9a-f]{3})$/i);
      if (short) {
        const c = short[1];
        return `#${c[0]}${c[0]}${c[1]}${c[1]}${c[2]}${c[2]}`.toLowerCase();
      }
      return /^#([0-9a-f]{6})$/i.test(normalized) ? normalized : fallback;
    };
    const sanitizeLabel = (val, fb) => {
      if (typeof val !== "string") return fb;
      const s = val.trim().slice(0, 4);
      return s.length ? s : fb;
    };
    const defaultsColors = payload.tensionColors || {};
    const defaultsLabels = payload.tensionLabels || {};
    if (body.tensionColors && typeof body.tensionColors === "object") {
      payload.tensionColors = {
        level1: sanitizeColor(body.tensionColors.level1, defaultsColors.level1),
        level2: sanitizeColor(body.tensionColors.level2, defaultsColors.level2),
        level3: sanitizeColor(body.tensionColors.level3, defaultsColors.level3),
        level4: sanitizeColor(body.tensionColors.level4, defaultsColors.level4),
        level5: sanitizeColor(body.tensionColors.level5, defaultsColors.level5)
      };
    }
    if (body.tensionLabels && typeof body.tensionLabels === "object") {
      payload.tensionLabels = {
        level1: sanitizeLabel(body.tensionLabels.level1, defaultsLabels.level1),
        level2: sanitizeLabel(body.tensionLabels.level2, defaultsLabels.level2),
        level3: sanitizeLabel(body.tensionLabels.level3, defaultsLabels.level3),
        level4: sanitizeLabel(body.tensionLabels.level4, defaultsLabels.level4),
        level5: sanitizeLabel(body.tensionLabels.level5, defaultsLabels.level5)
      };
    }
    if (body.tensionAudio && typeof body.tensionAudio === "object") {
      payload.tensionAudio = { ...payload.tensionAudio, ...body.tensionAudio };
    }
    payload.updatedAt = now;
    return payload;
  }

  // Nettoie/normalise une scène entrante avant écriture.
  function sanitizeSceneInput(body = {}, existing = null) {
    const now = Math.floor(Date.now() / 1000);
    const base = existing ? { ...existing } : {
      id: `scene_${Date.now()}`,
      tenantId: body.tenantId,
      title: '',
      parentSession: null,
      order: 0,
      images: [],
      audio: [],
      tension: null,
      notes: null,
      createdAt: now,
      updatedAt: now
    };
    const payload = { ...base };
    if (typeof body.title === "string") payload.title = body.title.trim().slice(0, 200);
    if (typeof body.parentSession === "string") {
      const v = body.parentSession.trim();
      payload.parentSession = v || null;
    }
    if (typeof body.order === "number") payload.order = body.order;
    if (Array.isArray(body.images)) {
      payload.images = body.images
        .map((item, idx) => {
          if (typeof item === "string") return { name: item, order: idx + 1 };
          const name = typeof item?.name === "string" ? item.name : "";
          const order = typeof item?.order === "number" ? item.order : idx + 1;
          if (!name) return null;
          return { name, order };
        })
        .filter(Boolean);
    }
    if (Array.isArray(body.audio)) {
      payload.audio = body.audio
        .map((item, idx) => {
          if (typeof item === "string") return { name: item, order: idx + 1 };
          const name = typeof item?.name === "string" ? item.name : "";
          if (!name) return null;
          const order = typeof item?.order === "number" ? item.order : idx + 1;
          return { name, order };
        })
        .filter(Boolean)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    if (body.tension !== undefined) payload.tension = body.tension;
    if (typeof body.notes === "string") payload.notes = body.notes;
    delete payload.description;
    delete payload.format;
    payload.updatedAt = now;
    if (!existing && (!payload.order || payload.order <= 0)) {
      try {
        const siblings = listScenes(payload.tenantId).filter(s => s.parentSession === payload.parentSession);
        payload.order = siblings.length + 1;
      } catch {}
    }
    return payload;
  }

  // Crée une scène par défaut si une session vient d'être créée sans enfants.
  function ensureDefaultSceneForSession(tenantId, sessionPayload) {
    const parentId = sessionPayload?.id;
    if (!tenantId || !parentId) return;
    try {
      const scenes = listScenes(tenantId).filter(s => s.parentSession === parentId);
      if (scenes.length > 0) return;
      const now = Math.floor(Date.now() / 1000);
      const scene = {
        id: `scene_${Date.now()}`,
        tenantId,
        title: "Scene 1",
        parentSession: parentId,
        order: 1,
        images: [],
        audio: [],
        tension: null,
        notes: null,
        createdAt: now,
        updatedAt: now
      };
      writeScene(tenantId, scene);
    } catch (err) {
      logger.error("ensureDefaultSceneForSession failed", { tenantId, sessionId: parentId, err: err?.message });
    }
  }

  // Sessions CRUD
  app.get("/api/tenant/:tenant/sessions", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    try {
      const list = listSessions(tenantId);
      res.json(list);
    } catch (err) {
      logger.error("List sessions failed", { tenantId, err: err?.message });
      res.status(500).json({ error: "Unable to list sessions" });
    }
  });

  app.get("/api/tenant/:tenant/sessions/:id", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const session = readSessionFile(tenantId, id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json(session);
  });

  app.post("/api/tenant/:tenant/sessions", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const payload = sanitizeSessionInput({ ...req.body, tenantId });
    if (!payload.title) return res.status(400).json({ error: "Title is required" });
    writeSessionFile(tenantId, payload);
    attachSessionToScenario(tenantId, payload);
    ensureDefaultSceneForSession(tenantId, payload);
    res.status(201).json(payload);
  });

  app.put("/api/tenant/:tenant/sessions/:id", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const existing = readSessionFile(tenantId, id);
    if (!existing) return res.status(404).json({ error: "Session not found" });
    const payload = sanitizeSessionInput({ ...req.body, tenantId }, existing);
    payload.id = existing.id;
    payload.tenantId = tenantId;
    payload.createdAt = existing.createdAt || payload.createdAt;
    writeSessionFile(tenantId, payload);
    attachSessionToScenario(tenantId, payload, existing.parentScenario);
    res.json(payload);
  });

  app.delete("/api/tenant/:tenant/sessions/:id", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const existing = readSessionFile(tenantId, id);
    if (!existing) return res.status(404).json({ error: "Session not found" });
    deleteSessionFile(tenantId, id);
    if (existing.parentScenario) {
      const scenario = readScenario(tenantId, existing.parentScenario);
      if (scenario && Array.isArray(scenario.sessions)) {
        scenario.sessions = scenario.sessions.filter(s => s !== id);
        scenario.updatedAt = Math.floor(Date.now() / 1000);
        writeScenario(tenantId, scenario);
      }
    }
    try {
      const scenes = listScenes(tenantId).filter(sc => sc.parentSession === id);
      scenes.forEach(sc => deleteScene(tenantId, sc.id));
    } catch (err) {
      logger.error("Cascade delete scenes for session failed", { tenantId, sessionId: id, err: err?.message });
    }
    touchScenarioFromSession(tenantId, existing.parentScenario);
    res.json({ success: true });
  });

  // Scenes CRUD
  app.get("/api/tenant/:tenant/scenes", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    try {
      const list = listScenes(tenantId);
      res.json(list);
    } catch (err) {
      logger.error("List scenes failed", { tenantId, err: err?.message });
      res.status(500).json({ error: "Unable to list scenes" });
    }
  });

  app.get("/api/tenant/:tenant/scenes/:id", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const scene = readScene(tenantId, id);
    if (!scene) return res.status(404).json({ error: "Scene not found" });
    res.json(scene);
  });

  app.post("/api/tenant/:tenant/scenes", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const payload = sanitizeSceneInput({ ...req.body, tenantId });
    if (!payload.title) return res.status(400).json({ error: "Title is required" });
    writeScene(tenantId, payload);
    touchSessionUpdated(tenantId, payload.parentSession);
    touchScenarioFromSession(tenantId, payload.parentSession);
    res.status(201).json(payload);
  });

  app.put("/api/tenant/:tenant/scenes/:id", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const existing = readScene(tenantId, id);
    if (!existing) return res.status(404).json({ error: "Scene not found" });
    const payload = sanitizeSceneInput({ ...req.body, tenantId }, existing);
    payload.id = existing.id;
    payload.tenantId = tenantId;
    payload.createdAt = existing.createdAt || payload.createdAt;
    writeScene(tenantId, payload);
    touchSessionUpdated(tenantId, payload.parentSession);
    touchScenarioFromSession(tenantId, payload.parentSession);
    res.json(payload);
  });

  app.delete("/api/tenant/:tenant/scenes/:id", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const existing = readScene(tenantId, id);
    if (!existing) return res.status(404).json({ error: "Scene not found" });
    deleteScene(tenantId, id);
    touchSessionUpdated(tenantId, existing.parentSession);
    touchScenarioFromSession(tenantId, existing.parentSession);
    res.json({ success: true });
  });

  app.put("/api/tenant/:tenant/scenes/reorder", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const orderArr = Array.isArray(req.body.order) ? req.body.order.map(String) : [];
    try {
      const list = listScenes(tenantId);
      const indexMap = new Map(orderArr.map((id, idx) => [id, idx + 1]));
      const touchedSessions = new Set();
      const updated = list.map(scene => {
        if (indexMap.has(scene.id)) {
          scene.order = indexMap.get(scene.id);
          if (scene.parentSession) touchedSessions.add(scene.parentSession);
        }
        return scene;
      });
      updated.forEach(scene => writeScene(tenantId, scene));
      touchedSessions.forEach(sessionId => {
        touchSessionUpdated(tenantId, sessionId);
      });
      touchedSessions.forEach(sessionId => touchScenarioFromSession(tenantId, sessionId));
      res.json({ success: true });
    } catch (err) {
      logger.error("Reorder scenes failed", { tenantId, err: err?.message });
      res.status(500).json({ error: "Unable to reorder scenes" });
    }
  });

  // Scene notes (markdown file)
  app.get("/api/tenant/:tenant/scenes/:id/note", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const scene = readScene(tenantId, id);
    if (!scene) return res.status(404).json({ error: "Scene not found" });

    const rawNotes = typeof scene.notes === "string" ? scene.notes : "";
    let name = "";
    let content = "";
    if (rawNotes && rawNotes.length < 500 && isSafeName(rawNotes)) {
      name = rawNotes;
      const file = notePath(tenantId, name);
      if (file) {
        try { content = fs.readFileSync(file, "utf8"); } catch (_) { content = ""; }
      }
    } else if (rawNotes) {
      // legacy inline note content
      content = rawNotes;
    }
    return res.json({ name, content });
  });

  app.put("/api/tenant/:tenant/scenes/:id/note", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const scene = readScene(tenantId, id);
    if (!scene) return res.status(404).json({ error: "Scene not found" });

    const dir = tenantNotesDir(tenantId);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}

    const baseId = sanitizeFilename(scene.id || "scene", "scene");
    let noteName = `${baseId}.md`;
    if (!noteName || !isSafeName(noteName)) {
      const base = sanitizeFilename(scene.title || scene.id || "note", "note");
      noteName = uniqueFilename(dir, base, ".md");
    }
    const filePath = notePath(tenantId, noteName);
    try {
      fs.writeFileSync(filePath, content || "", "utf8");
      const updated = { ...scene, notes: noteName, updatedAt: Math.floor(Date.now() / 1000) };
      writeScene(tenantId, updated);
      touchSessionUpdated(tenantId, scene.parentSession);
      touchScenarioFromSession(tenantId, scene.parentSession);
      return res.json({ success: true, name: noteName });
    } catch (err) {
      logger.error("Failed to write scene note", { tenantId, sceneId: id, err: err?.message });
      // fallback: store inline to avoid data loss but do not fail the client
      const updated = { ...scene, notes: content, updatedAt: Math.floor(Date.now() / 1000) };
      try { writeScene(tenantId, updated); } catch (_) {}
      touchSessionUpdated(tenantId, scene.parentSession);
      touchScenarioFromSession(tenantId, scene.parentSession);
      return res.json({ success: true, name: noteName || "", inline: true });
    }
  });

  app.delete("/api/tenant/:tenant/scenes/:id/note", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const scene = readScene(tenantId, id);
    if (!scene) return res.status(404).json({ error: "Scene not found" });

    const noteName = typeof scene.notes === "string" ? scene.notes : "";
    if (noteName && isSafeName(noteName)) {
      const file = notePath(tenantId, noteName);
      if (fs.existsSync(file)) {
        try { fs.unlinkSync(file); } catch (e) {
          logger.error("Failed to delete scene note file", { tenantId, sceneId: id, err: e?.message });
        }
      }
    }
    const updated = { ...scene, notes: null, updatedAt: Math.floor(Date.now() / 1000) };
    writeScene(tenantId, updated);
    touchSessionUpdated(tenantId, scene.parentSession);
    touchScenarioFromSession(tenantId, scene.parentSession);
    return res.json({ success: true });
  });
}

module.exports = {
  registerSessionsScenesRoutes
};
