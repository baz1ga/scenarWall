const fs = require("fs");

// Routes scénarios (CRUD) + helpers associés.
function registerScenarioRoutes({
  app,
  requireLogin,
  logger,
  defaults,
  utils,
  stores
}) {
  const { DEFAULT_SCENARIO_ICON, DEFAULT_TENANT_SESSION } = defaults;
  const { normalizeIconClass } = utils;
  const {
    listScenarios,
    readScenario,
    writeScenario,
    deleteScenario,
    listSessions,
    listScenes,
    deleteScene,
    writeSessionFile,
    writeScene
  } = stores;

  // Normalise l'input scénario avant écriture.
  function sanitizeScenarioInput(body = {}, existing = null) {
    const now = Math.floor(Date.now() / 1000);
    const base = existing ? { ...existing } : {
      id: `sc_${Date.now()}`,
      tenantId: body.tenantId,
      title: "",
      sessions: [],
      icon: DEFAULT_SCENARIO_ICON,
      createdAt: now,
      updatedAt: now
    };
    const payload = { ...base };
    if (typeof body.title === "string") payload.title = body.title.trim().slice(0, 200);
    if (Array.isArray(body.sessions)) payload.sessions = body.sessions.map(String);
    payload.icon = normalizeIconClass(body.icon, payload.icon);
    delete payload.description;
    delete payload.format;
    payload.updatedAt = now;
    return payload;
  }

  // Crée la scène par défaut pour une nouvelle session.
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
        title: "Scène 1",
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

  // Crée une session + scène par défaut si un scénario est vide.
  function ensureDefaultSessionForScenario(tenantId, scenario) {
    if (!tenantId || !scenario || !scenario.id) return scenario;
    try {
      if (Array.isArray(scenario.sessions) && scenario.sessions.length > 0) return scenario;
      const sessionId = `sess_${Date.now()}`;
      const now = Math.floor(Date.now() / 1000);
      const sessionPayload = {
        id: sessionId,
        tenantId,
        title: "Session 1",
        parentScenario: scenario.id,
        createdAt: now,
        updatedAt: now,
        timer: { ...DEFAULT_TENANT_SESSION.timer },
        hourglass: { ...DEFAULT_TENANT_SESSION.hourglass }
      };
      writeSessionFile(tenantId, sessionPayload);
      ensureDefaultSceneForSession(tenantId, sessionPayload);
      const updatedScenario = { ...scenario, sessions: [sessionId], updatedAt: now };
      writeScenario(tenantId, updatedScenario);
      return updatedScenario;
    } catch (err) {
      logger.error("ensureDefaultSessionForScenario failed", { tenantId, scenarioId: scenario?.id, err: err?.message });
      return scenario;
    }
  }

  // Liste des scénarios.
  app.get("/api/tenant/:tenant/scenarios", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    try {
      const list = listScenarios(tenantId);
      res.json(list);
    } catch (err) {
      logger.error("List scenarios failed", { tenantId, err: err?.message });
      res.status(500).json({ error: "Impossible de lister les scénarios" });
    }
  });

  // Récupère un scénario par id.
  app.get("/api/tenant/:tenant/scenarios/:id", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const scenario = readScenario(tenantId, id);
    if (!scenario) return res.status(404).json({ error: "Scenario not found" });
    res.json(scenario);
  });

  // Crée un scénario (et une session + scène par défaut).
  app.post("/api/tenant/:tenant/scenarios", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const payload = sanitizeScenarioInput({ ...req.body, tenantId });
    if (!payload.title) return res.status(400).json({ error: "Titre requis" });
    const stored = ensureDefaultSessionForScenario(tenantId, payload);
    writeScenario(tenantId, stored);
    res.status(201).json(stored);
  });

  // Met à jour un scénario.
  app.put("/api/tenant/:tenant/scenarios/:id", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const existing = readScenario(tenantId, id);
    if (!existing) return res.status(404).json({ error: "Scenario not found" });
    const payload = sanitizeScenarioInput({ ...req.body, tenantId }, existing);
    payload.id = existing.id;
    payload.tenantId = tenantId;
    payload.createdAt = existing.createdAt || payload.createdAt;
    writeScenario(tenantId, payload);
    res.json(payload);
  });

  // Supprime un scénario et cascade sur sessions/scenes.
  app.delete("/api/tenant/:tenant/scenarios/:id", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const existing = readScenario(tenantId, id);
    if (!existing) return res.status(404).json({ error: "Scenario not found" });
    deleteScenario(tenantId, id);
    try {
      const sessions = listSessions(tenantId).filter(s => s.parentScenario === id);
      sessions.forEach(sess => {
        const scenes = listScenes(tenantId).filter(sc => sc.parentSession === sess.id);
        scenes.forEach(sc => deleteScene(tenantId, sc.id));
        deleteSessionFile(tenantId, sess.id);
      });
    } catch (err) {
      logger.error("Cascade delete for scenario failed", { tenantId, scenarioId: id, err: err?.message });
    }
    res.json({ success: true });
  });
}

module.exports = {
  registerScenarioRoutes
};
