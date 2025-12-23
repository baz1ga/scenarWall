const fs = require("fs");
const path = require("path");

// Routes GodMode (superadmin)
function registerGodmodeRoutes({
  app,
  requireGodMode,
  getUsers,
  setTenantUserQuota,
  getTenantQuota,
  getTenantUsageBytes,
  getGlobalConfig,
  loadConfig,
  saveConfig,
  paths,
  audioExt
}) {
  const { TENANTS_DIR, GLOBAL_FILE } = paths;

  // Liste les utilisateurs enrichis de stats (quotas, volumes, compteurs).
  app.get("/api/godmode/users", requireGodMode, (req, res) => {
    const users = getUsers();

    const enriched = users.map(u => {
      const tenantDir = path.join(TENANTS_DIR, u.tenantId);
      const imagesDir = path.join(tenantDir, "images");
      const audioDir = path.join(tenantDir, "audio");

      let quota = 0;
      let count = 0;
      let effectiveQuotaMB = null;
      let override = false;

      if (fs.existsSync(imagesDir)) {
        const files = fs.readdirSync(imagesDir);

        count = files.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).length;
        files.forEach(f => {
          try {
            quota += fs.statSync(path.join(imagesDir, f)).size;
          } catch {}
        });
      }

      let audioCount = 0;
      if (fs.existsSync(audioDir)) {
        const audioFiles = fs.readdirSync(audioDir).filter(f => audioExt.test(f));
        audioCount = audioFiles.length;
        audioFiles.forEach(f => {
          try {
            quota += fs.statSync(path.join(audioDir, f)).size;
          } catch {}
        });
      }

      if (u.tenantId) {
        const tq = getTenantQuota(u.tenantId);
        effectiveQuotaMB = tq.quotaMB;
        override = tq.override;
      }

      const scenarioDir = path.join(tenantDir, "scenario");
      let scenarioCount = 0;
      if (fs.existsSync(scenarioDir)) {
        try {
          scenarioCount = fs.readdirSync(scenarioDir).filter(f => /\.json$/i.test(f)).length;
        } catch {}
      }
      const notesDir = path.join(tenantDir, "notes");
      let noteCount = 0;
      if (fs.existsSync(notesDir)) {
        try {
          noteCount = fs.readdirSync(notesDir).filter(f => /\.md$/i.test(f)).length;
        } catch {}
      }

      return {
        ...u,
        imageCount: count,
        audioCount,
        quotaUsedBytes: quota,
        quotaMB: effectiveQuotaMB,
        quotaOverride: override,
        scenarioCount,
        noteCount
      };
    });

    res.json(enriched);
  });

  // Récupère la configuration globale du quota par défaut.
  app.get("/api/godmode/global-quota", requireGodMode, (req, res) => {
    const globalConfig = getGlobalConfig();
    res.json({ defaultQuotaMB: globalConfig.defaultQuotaMB });
  });

  // Met à jour la configuration globale du quota par défaut.
  app.put("/api/godmode/global-quota", requireGodMode, (req, res) => {
    const { defaultQuotaMB } = req.body;

    if (typeof defaultQuotaMB !== "number" || Number.isNaN(defaultQuotaMB) || defaultQuotaMB <= 0) {
      return res.status(400).json({ error: "defaultQuotaMB must be a positive number" });
    }

    const current = getGlobalConfig();
    const updated = { ...current, defaultQuotaMB };
    fs.writeFileSync(GLOBAL_FILE, JSON.stringify(updated, null, 2));
    res.json({ success: true, defaultQuotaMB });
  });

  // Met à jour le quota d'un tenant (override ou reset).
  app.put("/api/godmode/tenant-quota", requireGodMode, (req, res) => {
    const { tenantId, quotaMB } = req.body;

    if (!tenantId) return res.status(400).json({ error: "Missing tenantId" });

    const tenantDir = path.join(TENANTS_DIR, tenantId);
    if (!fs.existsSync(tenantDir)) return res.status(404).json({ error: "Tenant not found" });

    if (quotaMB === null || quotaMB === undefined || quotaMB === "") {
      setTenantUserQuota(tenantId, null);
      const config = loadConfig(tenantId);
      config.quotaMB = null;
      saveConfig(tenantId, config);
    } else if (typeof quotaMB === "number" && quotaMB > 0) {
      setTenantUserQuota(tenantId, quotaMB);
      const config = loadConfig(tenantId);
      config.quotaMB = null; // migration users.json
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

  // Supprime un utilisateur (et son tenant) si non-superadmin.
  app.delete("/api/godmode/user/:email", requireGodMode, (req, res) => {
    const email = req.params.email;

    const users = getUsers();
    const user = users.find(u => u.email === email);

    if (!user) return res.status(404).json({ error: "Not found" });
    if (user.admin) return res.status(403).json({ error: "Cannot delete superadmin" });

    // remove tenant folder
    const dir = path.join(TENANTS_DIR, user.tenantId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });

    const filtered = users.filter(u => u.email !== email);
    saveUsers(filtered);

    res.json({ success: true });
  });
}

module.exports = {
  registerGodmodeRoutes
};
