const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

function registerAuthRoutes({
  app,
  limiterAuth,
  getGlobalConfig,
  resolveDiscordRedirectUri,
  getUsers,
  saveUsers,
  DEFAULT_CONFIG,
  DEFAULT_DISCORD_SCOPES,
  TENANTS_DIR,
  logger
}) {
  // SIGNUP / LOGIN fallback
  app.post("/api/signup", async (req, res) => {
    return res.status(403).json({ error: "La création de compte se fait uniquement via Discord." });
  });

  app.post("/api/login", async (req, res) => {
    return res.status(403).json({ error: "Authentification par email/mot de passe désactivée. Utilisez Discord." });
  });

  // DISCORD OAUTH2 (login + callback)
  app.get("/api/auth/discord/login", limiterAuth, (req, res) => {
    if (req.session && req.session.user) return res.redirect("/admin/");
    const config = getGlobalConfig();
    const { discordClientId, discordScopes } = config;
    const discordRedirectUri = resolveDiscordRedirectUri(req);
    if (!discordClientId || !discordRedirectUri) {
      return res.status(503).json({ error: "Discord OAuth non configuré" });
    }
    const scopes = Array.isArray(discordScopes) && discordScopes.length ? [...discordScopes] : [...DEFAULT_DISCORD_SCOPES];
    const scope = scopes.join(" ");
    const state = crypto.randomBytes(16).toString("hex");
    if (!req.session) req.session = {};
    req.session.oauthState = state;
    const url = new URL("https://discord.com/api/oauth2/authorize");
    url.searchParams.set("client_id", discordClientId);
    url.searchParams.set("redirect_uri", discordRedirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scope);
    url.searchParams.set("state", state);
    res.redirect(url.toString());
  });

  app.get("/api/auth/discord/callback", async (req, res) => {
    const config = getGlobalConfig();
    const { discordClientId, discordClientSecret } = config;
    const discordRedirectUri = resolveDiscordRedirectUri(req);
    const { code, state } = req.query;

    if (!discordClientId || !discordClientSecret || !discordRedirectUri) {
      return res.status(503).send("Discord OAuth non configuré");
    }
    if (!code || !state || !req.session || state !== req.session.oauthState) {
      return res.status(400).send("State ou code invalide");
    }
    delete req.session.oauthState;

    try {
      const params = new URLSearchParams({
        client_id: discordClientId,
        client_secret: discordClientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: discordRedirectUri
      });
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        logger.error("Discord token error", { reqId: req.id, data: tokenData });
        return res.status(400).send("Echec OAuth Discord");
      }

      const userRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const userData = await userRes.json();
      if (!userRes.ok || !userData.id) {
        logger.error("Discord user error", { reqId: req.id, data: userData });
        return res.status(400).send("Impossible de récupérer le compte Discord");
      }

      const discordId = userData.id;
      const displayName = userData.global_name || userData.username || null;
      const discNum = Number(userData.discriminator || "0");
      const avatarUrl = userData.avatar
        ? `https://cdn.discordapp.com/avatars/${discordId}/${userData.avatar}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${discNum % 5}.png`;

      const email = userData.email || null;
      const users = getUsers();
      let user = users.find(u => u.discordId === discordId) || (email ? users.find(u => u.email === email) : null);

      // Create tenant/user if needed
      if (!user) {
        const tenantId = "T" + crypto.randomBytes(4).toString("hex");
        const dir = path.join(TENANTS_DIR, tenantId);
        fs.mkdirSync(dir, { recursive: true });
        fs.mkdirSync(path.join(dir, "images"));
        fs.mkdirSync(path.join(dir, "thumbs"));
        fs.mkdirSync(path.join(dir, "audio"));
        fs.writeFileSync(path.join(dir, "images", "images-order.json"), "[]");
        fs.writeFileSync(path.join(dir, "audio", "audio-order.json"), "[]");
        fs.writeFileSync(path.join(dir, "images", "images-hidden.json"), "[]");
        fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(DEFAULT_CONFIG, null, 2));

        user = {
          email: email || `discord_${discordId}@placeholder.local`,
          password: null,
          discordId,
          displayName,
          avatarUrl,
          tenantId,
          admin: false,
          createdAt: new Date().toISOString(),
          lastLogin: null
        };
        users.push(user);
      } else {
        user.discordId = discordId;
        user.displayName = displayName || user.displayName || user.email;
        user.avatarUrl = avatarUrl;
        if (email) user.email = email;
      }

      user.lastLogin = new Date().toISOString();
      saveUsers(users);

      req.session.user = {
        email: user.email,
        tenantId: user.tenantId,
        admin: user.admin === true,
        displayName: user.displayName || displayName || user.email,
        avatarUrl: user.avatarUrl || avatarUrl || null
      };

      res.send(`<!DOCTYPE html><html><body><script>
        localStorage.setItem('sc_token', "session-cookie");
        localStorage.setItem('sc_tenant', ${JSON.stringify(user.tenantId)});
        localStorage.setItem('sc_admin', ${user.admin === true ? '"1"' : '"0"'});
        localStorage.setItem('sc_displayName', ${JSON.stringify(req.session.user.displayName)});
        if (${JSON.stringify(req.session.user.avatarUrl)} !== null) localStorage.setItem('sc_avatar', ${JSON.stringify(req.session.user.avatarUrl)});
        window.location.href = '/admin/';
      </script></body></html>`);
    } catch (err) {
      logger.error("Discord OAuth error", { reqId: req.id, err: err?.message, stack: err?.stack });
      res.status(500).send("Erreur OAuth Discord");
    }
  });
}

module.exports = {
  registerAuthRoutes
};
