// Routes configuration/quotas d'un tenant.
function registerConfigRoutes({
  app,
  requireLogin,
  deps
}) {
  const {
    loadConfig,
    saveConfig,
    getTenantQuota,
    getTenantUsageBytes,
    setTenantUserQuota
  } = deps;

  // Retourne la config complète du tenant.
  app.get("/api/:tenantId/config", requireLogin, (req, res) => {
    const tenantId = req.params.tenantId;

    if (tenantId !== req.session.user.tenantId)
      return res.status(403).json({ error: "Forbidden tenant" });

    const config = loadConfig(tenantId);
    res.json(config);
  });

  // Retourne le quota et l'usage.
  app.get("/api/:tenantId/quota", requireLogin, (req, res) => {
    const tenantId = req.params.tenantId;

    if (tenantId !== req.session.user.tenantId)
      return res.status(403).json({ error: "Forbidden tenant" });

    const { quotaMB, override } = getTenantQuota(tenantId);
    const usageBytes = getTenantUsageBytes(tenantId);
    const usageMB = Number((usageBytes / 1024 / 1024).toFixed(2));

    res.json({ quotaMB, usage: usageMB, override });
  });

  // Met à jour le quota du tenant.
  app.put("/api/:tenantId/quota", requireLogin, (req, res) => {
    const tenantId = req.params.tenantId;
    const { quotaMB } = req.body;

    if (tenantId !== req.session.user.tenantId)
      return res.status(403).json({ error: "Forbidden tenant" });

    if (quotaMB === null || quotaMB === undefined || quotaMB === "") {
      setTenantUserQuota(tenantId, null);
      const config = loadConfig(tenantId);
      config.quotaMB = null;
      saveConfig(tenantId, config);
    } else if (typeof quotaMB === "number" && quotaMB > 0) {
      setTenantUserQuota(tenantId, quotaMB);
      const config = loadConfig(tenantId);
      config.quotaMB = null; // on migre vers users.json
      saveConfig(tenantId, config);
    } else {
      return res.status(400).json({ error: "quotaMB must be a positive number or null" });
    }

    const updated = getTenantQuota(tenantId);
    const usageBytes = getTenantUsageBytes(tenantId);

    res.json({
      success: true,
      quotaMB: updated.quotaMB,
      override: updated.override,
      usage: Number((usageBytes / 1024 / 1024).toFixed(2))
    });
  });
}

module.exports = {
  registerConfigRoutes
};
