// Routes liées aux paramètres de tension (defaults + config tenant).
function registerTensionRoutes({
  app,
  requireLogin,
  defaults,
  helpers
}) {
  const { TENSION_DEFAULTS } = defaults;
  const {
    loadConfig,
    saveConfig,
    normalizeTensionColors,
    normalizeTensionLabels,
    normalizeTensionAudio
  } = helpers;

  // Defaults globaux de tension (communs)
  app.get("/api/tension-default", (req, res) => {
    res.json(TENSION_DEFAULTS);
  });

  // Mise à jour de la config tension pour un tenant
  app.put("/api/:tenantId/config/tension", requireLogin, (req, res) => {
    const tenantId = req.params.tenantId;
    const { tensionEnabled, tensionFont, tensionColors, tensionLabels, tensionAudio } = req.body || {};

    if (tenantId !== req.session.user.tenantId)
      return res.status(403).json({ error: "Forbidden tenant" });

    if (typeof tensionEnabled !== "boolean") {
      return res.status(400).json({ error: "tensionEnabled must be a boolean" });
    }

    if (tensionFont !== undefined && tensionFont !== null && typeof tensionFont !== "string") {
      return res.status(400).json({ error: "tensionFont must be a string or null" });
    }

    if (tensionColors !== undefined && tensionColors !== null && typeof tensionColors !== "object") {
      return res.status(400).json({ error: "tensionColors must be an object" });
    }

    if (tensionLabels !== undefined && tensionLabels !== null && typeof tensionLabels !== "object") {
      return res.status(400).json({ error: "tensionLabels must be an object" });
    }

    const config = loadConfig(tenantId);
    config.tensionEnabled = tensionEnabled;
    config.tensionFont = tensionFont || null;
    if (tensionColors) {
      config.tensionColors = normalizeTensionColors({
        ...config.tensionColors,
        ...tensionColors
      });
    }
    if (tensionLabels) {
      config.tensionLabels = normalizeTensionLabels({
        ...config.tensionLabels,
        ...tensionLabels
      });
    }
    if (tensionAudio) {
      config.tensionAudio = normalizeTensionAudio({
        ...config.tensionAudio,
        ...tensionAudio
      });
    }

    saveConfig(tenantId, config);

    res.json({ success: true, config });
  });
}

module.exports = {
  registerTensionRoutes
};
