// Routes timer/sablier pour les sessions (global tenant + session ciblée).
function registerSessionTimerRoutes({
  app,
  requireLogin,
  defaults,
  stores
}) {
  const { DEFAULT_TENANT_SESSION } = defaults;
  const {
    readTenantSession,
    writeTenantSession,
    readSessionFile,
    writeSessionFile
  } = stores;

  // État global de session (tenant)
  app.get("/api/:tenantId/session", requireLogin, (req, res) => {
    const { tenantId } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const sessionData = readTenantSession(tenantId);
    res.json(sessionData);
  });

  // Met à jour le timer global (tenant)
  app.put("/api/:tenantId/session/timer", requireLogin, (req, res) => {
    const { tenantId } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const { running, elapsedMs, startedAt } = req.body || {};
    const sessionData = readTenantSession(tenantId);
    sessionData.timer = {
      running: !!running,
      elapsedMs: typeof elapsedMs === "number" && elapsedMs >= 0 ? elapsedMs : 0,
      startedAt: startedAt || null
    };
    writeTenantSession(tenantId, sessionData);
    res.json(sessionData.timer);
  });

  // Met à jour le sablier global (tenant)
  app.put("/api/:tenantId/session/hourglass", requireLogin, (req, res) => {
    const { tenantId } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const { durationSeconds, showTimer } = req.body || {};
    const sessionData = readTenantSession(tenantId);
    sessionData.hourglass = {
      durationSeconds: typeof durationSeconds === "number" && durationSeconds > 0 ? durationSeconds : sessionData.hourglass.durationSeconds,
      showTimer: showTimer === undefined ? sessionData.hourglass.showTimer : !!showTimer
    };
    writeTenantSession(tenantId, sessionData);
    res.json(sessionData.hourglass);
  });

  // État GM pour une session donnée
  app.get("/api/tenant/:tenant/sessions/:id/gm-state", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const session = readSessionFile(tenantId, id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    return res.json({
      timer: { ...DEFAULT_TENANT_SESSION.timer, ...(session.timer || {}) },
      hourglass: { ...DEFAULT_TENANT_SESSION.hourglass, ...(session.hourglass || {}) }
    });
  });

  // Met à jour le timer d'une session
  app.put("/api/tenant/:tenant/sessions/:id/timer", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const session = readSessionFile(tenantId, id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    const { running, elapsedMs, startedAt } = req.body || {};
    session.timer = {
      running: !!running,
      elapsedMs: typeof elapsedMs === "number" && elapsedMs >= 0 ? elapsedMs : 0,
      startedAt: startedAt || null
    };
    session.updatedAt = Math.floor(Date.now() / 1000);
    writeSessionFile(tenantId, session);
    res.json(session.timer);
  });

  // Met à jour le sablier d'une session
  app.put("/api/tenant/:tenant/sessions/:id/hourglass", requireLogin, (req, res) => {
    const tenantId = req.params.tenant;
    const { id } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).json({ error: "Forbidden tenant" });
    }
    const session = readSessionFile(tenantId, id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    const { durationSeconds, showTimer } = req.body || {};
    const current = session.hourglass || { ...DEFAULT_TENANT_SESSION.hourglass };
    session.hourglass = {
      durationSeconds: typeof durationSeconds === "number" && durationSeconds > 0 ? durationSeconds : current.durationSeconds,
      showTimer: showTimer === undefined ? current.showTimer : !!showTimer
    };
    session.updatedAt = Math.floor(Date.now() / 1000);
    writeSessionFile(tenantId, session);
    res.json(session.hourglass);
  });
}

module.exports = {
  registerSessionTimerRoutes
};
