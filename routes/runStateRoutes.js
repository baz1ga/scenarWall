// Routes liées aux états de run (présence, historique).
function registerRunStateRoutes({
  app,
  requireLogin,
  requireGodMode,
  presence
}) {
  const {
    presenceStateToArray,
    reloadSessionRuns,
    appendSessionRun,
    updateLatestRun,
    getLastRun,
    updatePresence
  } = presence;

  // Retourne l'état de présence pour un tenant donné.
  app.get("/api/tenant/:tenantId/run-states", requireLogin, (req, res) => {
    const { tenantId } = req.params;
    const states = presenceStateToArray().filter(s => s.tenantId === tenantId);
    res.json(states);
  });

  // Liste complète des états de runs (superadmin)
  app.get("/api/admin/run-states", requireGodMode, (req, res) => {
    // Recharge depuis le disque pour refléter les modifications manuelles éventuelles
    const fresh = reloadSessionRuns();
    res.json(JSON.parse(JSON.stringify(fresh)));
  });

  // Démarre un nouveau run de session (clic sur "Présenter")
  app.post("/api/tenant/:tenantId/session-runs", requireLogin, (req, res) => {
    const { tenantId } = req.params;
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

    const now = Date.now();
    const last = getLastRun(tenantId, sessionId);
    const gmAlreadyOnline = last && last.gm === "online";
    const run = gmAlreadyOnline
      ? updateLatestRun(tenantId, sessionId, {
        gm: "online",
        front: last.front || "offline",
        lastGmPing: now,
        updatedAt: now
      })
      : appendSessionRun(tenantId, sessionId, {
        gm: "online",
        front: "offline",
        lastGmPing: now,
        lastFrontPing: null,
        createdAt: now,
        updatedAt: now
      });

    // Synchronise aussi l'état en mémoire et notifie
    updatePresence(tenantId, sessionId, "gm", "online");

    res.json(run);
  });
}

module.exports = {
  registerRunStateRoutes
};
