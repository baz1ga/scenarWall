//------------------------------------------------------------
//  SCENARWALL — SERVER.JS (Option 2 : tenant dans l’URL)
//------------------------------------------------------------
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const sharp = require("sharp");
const session = require("express-session");

const app = express();
const PORT = 3100;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const TENANTS_DIR = path.join(__dirname, "tenants");
const FAVICONS_DIR = path.join(PUBLIC_DIR, "assets", "favicons");
const FRONT_FILE = path.join(PUBLIC_DIR, "front", "index.html");
const GLOBAL_FILE = path.join(DATA_DIR, "global.json");
const THUMB_SIZE = 64;
const DEFAULT_GLOBAL = {
  defaultQuotaMB: 100,
  apiBase: null,
  discordClientId: null,
  discordClientSecret: null,
  discordRedirectUri: null,
  discordScopes: ["identify", "email"],
  allowedGuildId: null,
  sessionCookie: {
    secure: true,
    sameSite: "none"
  }
};
const DEFAULT_TENSION_COLORS = {
  level1: "#37aa32",
  level2: "#f8d718",
  level3: "#f39100",
  level4: "#e63027",
  level5: "#3a3a39"
};
const DEFAULT_TENSION_LABELS = {
  level1: "0",
  level2: "-5",
  level3: "+5",
  level4: "+10",
  level5: "+15"
};
const DEFAULT_CONFIG = {
  tensionEnabled: true,
  tensionColors: { ...DEFAULT_TENSION_COLORS },
  tensionLabels: { ...DEFAULT_TENSION_LABELS },
  tensionFont: null,
  tensionAudio: {
    level1: null,
    level2: null,
    level3: null,
    level4: null,
    level5: null
  },
  quotaMB: null
};

const DEFAULT_SESSION_COOKIE = {
  secure: false,
  sameSite: "lax"
};

function sanitizeFilename(name = "", fallback = "file") {
  const base = name.toString().replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").replace(/^[_\.-]+|[_\.-]+$/g, "");
  return base || fallback;
}

function uniqueFilename(dir, baseName, ext) {
  let candidate = `${baseName}${ext}`;
  let counter = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${baseName}-${counter}${ext}`;
    counter += 1;
  }
  return candidate;
}

// Session store (file-based)
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
class FileStore extends session.Store {
  constructor(file) {
    super();
    this.file = file;
  }
  readAll() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return {};
    }
  }
  writeAll(data) {
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
  }
  get(sid, cb) {
    const data = this.readAll();
    cb(null, data[sid] || null);
  }
  set(sid, sessionData, cb) {
    const data = this.readAll();
    data[sid] = sessionData;
    this.writeAll(data);
    cb && cb(null);
  }
  destroy(sid, cb) {
    const data = this.readAll();
    delete data[sid];
    this.writeAll(data);
    cb && cb(null);
  }
}

app.use(express.json());
app.set("trust proxy", 1);
const globalConfig = getGlobalConfig();

app.use(session({
  secret: process.env.SESSION_SECRET || "change-me",
  resave: false,
  saveUninitialized: false,
  store: new FileStore(SESSIONS_FILE),
  cookie: {
    secure: globalConfig.sessionCookie?.secure ?? DEFAULT_SESSION_COOKIE.secure,
    sameSite: globalConfig.sessionCookie?.sameSite || DEFAULT_SESSION_COOKIE.sameSite,
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));
app.use(express.static(PUBLIC_DIR)); // serve login, signup, front, admin UIs
app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(FAVICONS_DIR, "favicon.ico"));
});

// Legacy filenames → new structured paths
app.get("/", (req, res) => res.redirect("/index.html"));
app.get("/admin.html", (req, res) => res.redirect("/admin/"));
app.get("/admin", (req, res) => res.redirect("/admin/"));
app.get("/godmode.html", (req, res) => res.redirect("/admin/"));
app.get("/godmode", (req, res) => res.redirect("/admin/"));
app.get("/front.html", (req, res) => res.redirect("/front/"));
app.get("/api/global-config", (req, res) => {
  res.json(getGlobalConfig());
});
app.get("/session-debug", (req, res) => {
  res.json({
    session: req.session || null,
    user: (req.session && req.session.user) || null
  });
});
app.get("/login", (req, res) => {
  if (req.session && req.session.user) return res.redirect("/admin");
  return res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});
app.get("/logout", (req, res) => {
  const clear = () => {
    res.clearCookie("connect.sid");
    return res.redirect("/index.html");
  };
  if (req.session) {
    req.session.user = null;
    req.session.destroy(err => {
      if (err) {
        console.error("Session destroy error", err);
        return clear();
      }
      clear();
    });
  } else {
    clear();
  }
});

//------------------------------------------------------------
//  FILES & DIRECTORIES
//------------------------------------------------------------
const USERS_FILE = path.join(DATA_DIR, "users.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");
if (!fs.existsSync(GLOBAL_FILE)) fs.writeFileSync(GLOBAL_FILE, JSON.stringify(DEFAULT_GLOBAL, null, 2));
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, "{}");
if (!fs.existsSync(TENANTS_DIR)) fs.mkdirSync(TENANTS_DIR);

function normalizeTensionColors(source) {
  const hexRegex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  const expand = (hex) => {
    if (!hexRegex.test(hex || "")) return null;
    const h = hex.startsWith("#") ? hex.slice(1) : hex;
    if (h.length === 3) {
      return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
    }
    return `#${h.toLowerCase()}`;
  };

  if (Array.isArray(source) && source.length === 5) {
    return {
      level1: expand(source[0]) || DEFAULT_TENSION_COLORS.level1,
      level2: expand(source[1]) || DEFAULT_TENSION_COLORS.level2,
      level3: expand(source[2]) || DEFAULT_TENSION_COLORS.level3,
      level4: expand(source[3]) || DEFAULT_TENSION_COLORS.level4,
      level5: expand(source[4]) || DEFAULT_TENSION_COLORS.level5
    };
  }

  const input = typeof source === "object" && source ? source : {};
  return {
    level1: expand(input.level1) || DEFAULT_TENSION_COLORS.level1,
    level2: expand(input.level2) || DEFAULT_TENSION_COLORS.level2,
    level3: expand(input.level3) || DEFAULT_TENSION_COLORS.level3,
    level4: expand(input.level4) || DEFAULT_TENSION_COLORS.level4,
    level5: expand(input.level5) || DEFAULT_TENSION_COLORS.level5
  };
}

function normalizeTensionLabels(source) {
  const trimLimit = (val, fallback) => {
    if (typeof val !== "string") return fallback;
    const v = val.trim().slice(0, 4);
    return v.length ? v : fallback;
  };
  const input = typeof source === "object" && source ? source : {};
  return {
    level1: trimLimit(input.level1, DEFAULT_TENSION_LABELS.level1),
    level2: trimLimit(input.level2, DEFAULT_TENSION_LABELS.level2),
    level3: trimLimit(input.level3, DEFAULT_TENSION_LABELS.level3),
    level4: trimLimit(input.level4, DEFAULT_TENSION_LABELS.level4),
    level5: trimLimit(input.level5, DEFAULT_TENSION_LABELS.level5)
  };
}

function loadConfig(tenantId) {
  const file = path.join(TENANTS_DIR, tenantId, "config.json");

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }

  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      ...DEFAULT_CONFIG,
      ...data,
      tensionColors: normalizeTensionColors(data.tensionColors),
      tensionLabels: normalizeTensionLabels(data.tensionLabels)
    };
  } catch (err) {
    console.error("Failed to read config, using defaults", err);
    return { ...DEFAULT_CONFIG };
  }
}

function getGlobalConfig() {
  if (!fs.existsSync(GLOBAL_FILE)) {
    fs.writeFileSync(GLOBAL_FILE, JSON.stringify(DEFAULT_GLOBAL, null, 2));
    return { ...DEFAULT_GLOBAL };
  }

  try {
    const data = JSON.parse(fs.readFileSync(GLOBAL_FILE, "utf8"));
    return { ...DEFAULT_GLOBAL, ...data };
  } catch (err) {
    console.error("Failed to read global config, using defaults", err);
    return { ...DEFAULT_GLOBAL };
  }
}

function getTenantQuota(tenantId) {
  const globalConfig = getGlobalConfig();
  const config = loadConfig(tenantId);
  const hasOverride = Object.prototype.hasOwnProperty.call(config, "quotaMB") && config.quotaMB !== null && config.quotaMB !== undefined;

  let quotaMB = hasOverride ? config.quotaMB : globalConfig.defaultQuotaMB;
  if (quotaMB === null || quotaMB === undefined || typeof quotaMB !== "number" || Number.isNaN(quotaMB)) {
    quotaMB = globalConfig.defaultQuotaMB;
  }

  return { quotaMB, override: hasOverride };
}

function dirSize(dir, filter) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).reduce((acc, file) => {
    if (filter && !filter(file)) return acc;
    try {
      return acc + fs.statSync(path.join(dir, file)).size;
    } catch {
      return acc;
    }
  }, 0);
}

function getTenantUsageBytes(tenantId) {
  const base = path.join(TENANTS_DIR, tenantId);
  const imagesSize = dirSize(path.join(base, "images"));
  const audioSize = dirSize(path.join(base, "audio"));
  return imagesSize + audioSize;
}

function normalizeTensionAudio(input) {
  const levels = ["level1", "level2", "level3", "level4", "level5"];
  const out = {};
  const src = typeof input === "object" && input ? input : {};
  levels.forEach(l => {
    const name = src[l];
    if (typeof name === "string" && isSafeName(name) && AUDIO_EXT.test(name)) {
      out[l] = name;
    } else {
      out[l] = null;
    }
  });
  return out;
}

function saveConfig(tenantId, config) {
  const file = path.join(TENANTS_DIR, tenantId, "config.json");
  const merged = {
    ...DEFAULT_CONFIG,
    ...config,
    tensionColors: normalizeTensionColors(config.tensionColors),
    tensionLabels: normalizeTensionLabels(config.tensionLabels)
  };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
}

//------------------------------------------------------------
//  AUTH HELPERS
//------------------------------------------------------------
function getUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

//------------------------------------------------------------
//  MIDDLEWARE: REQUIRE LOGIN
//------------------------------------------------------------
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  req.user = req.session.user;
  next();
}

//------------------------------------------------------------
//  MIDDLEWARE: REQUIRE GODMODE (superadmin)
//------------------------------------------------------------
function requireGodMode(req, res, next) {
  const user = req.session && req.session.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  if (user.admin !== true) return res.status(403).json({ error: "GodMode only" });
  req.superadmin = user;
  next();
}

//------------------------------------------------------------
//  SIGNUP
//------------------------------------------------------------
app.post("/api/signup", async (req, res) => {
  return res.status(403).json({ error: "La création de compte se fait uniquement via Discord." });
});

//------------------------------------------------------------
//  LOGIN
//------------------------------------------------------------
app.post("/api/login", async (req, res) => {
  return res.status(403).json({ error: "Authentification par email/mot de passe désactivée. Utilisez Discord." });
});

//------------------------------------------------------------
//  DISCORD OAUTH2 (login + callback)
//------------------------------------------------------------
app.get("/api/auth/discord/login", (req, res) => {
  if (req.session && req.session.user) return res.redirect("/dashboard");
  const config = getGlobalConfig();
  const { discordClientId, discordRedirectUri, discordScopes } = config;
  if (!discordClientId || !discordRedirectUri) {
    return res.status(503).json({ error: "Discord OAuth non configuré" });
  }
  const scope = Array.isArray(discordScopes) && discordScopes.length ? discordScopes.join(" ") : "identify";
  const state = crypto.randomBytes(16).toString("hex");
  if (!req.session) req.session = {};
  req.session.oauthState = state;
  const expectedRedirect = discordRedirectUri;
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
  const { discordClientId, discordClientSecret, discordRedirectUri, allowedGuildId } = config;
  const { code, state } = req.query;

  if (!discordClientId || !discordClientSecret || !discordRedirectUri) {
    return res.status(503).send("Discord OAuth non configuré");
  }
  if (!code || !state || !req.session || state !== req.session.oauthState) {
    return res.status(400).send("State ou code invalide");
  }
  delete req.session.oauthState;

  try {
    // Exchange code
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
      console.error("Discord token error", tokenData);
      return res.status(400).send("Echec OAuth Discord");
    }

    // Get user info
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const userData = await userRes.json();
    if (!userRes.ok || !userData.id) {
      console.error("Discord user error", userData);
      return res.status(400).send("Impossible de récupérer le compte Discord");
    }

    const discordId = userData.id;
    const displayName = userData.global_name || userData.username || null;
    const discNum = Number(userData.discriminator || "0");
    const avatarUrl = userData.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${userData.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${discNum % 5}.png`;

    // Optional guild check
    if (allowedGuildId) {
      const guildRes = await fetch("https://discord.com/api/users/@me/guilds", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      if (guildRes.ok) {
        const guilds = await guildRes.json();
        const inGuild = Array.isArray(guilds) && guilds.some(g => g.id === allowedGuildId);
        if (!inGuild) {
          return res.status(403).send("Accès réservé (guilde requise)");
        }
      } else {
        console.error("Discord guilds error", await guildRes.text());
      }
    }

    const email = userData.email || null;
    const users = getUsers();
    let user = users.find(u => u.discordId === discordId) || (email ? users.find(u => u.email === email) : null);

    // Create tenant/user if needed
    if (!user) {
      const tenantId = "T" + crypto.randomBytes(4).toString("hex");
      const dir = path.join(TENANTS_DIR, tenantId);
      fs.mkdirSync(dir);
      fs.mkdirSync(path.join(dir, "images"));
      fs.mkdirSync(path.join(dir, "thumbs"));
      fs.mkdirSync(path.join(dir, "audio"));
      fs.writeFileSync(path.join(dir, "order.json"), "[]");
      fs.writeFileSync(path.join(dir, "hidden.json"), "[]");
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

    // Small HTML to set client context then redirect to admin
    res.send(`<!DOCTYPE html><html><body><script>
      localStorage.setItem('sc_token', "session-cookie");
      localStorage.setItem('sc_tenant', ${JSON.stringify(user.tenantId)});
      localStorage.setItem('sc_admin', ${user.admin === true ? '"1"' : '"0"'});
      localStorage.setItem('sc_displayName', ${JSON.stringify(req.session.user.displayName)});
      if (${JSON.stringify(req.session.user.avatarUrl)} !== null) localStorage.setItem('sc_avatar', ${JSON.stringify(req.session.user.avatarUrl)});
      window.location.href = '/admin/';
    </script></body></html>`);
  } catch (err) {
    console.error("Discord OAuth error", err);
    res.status(500).send("Erreur OAuth Discord");
  }
});

//------------------------------------------------------------
//  MULTER STORAGE
//------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(TENANTS_DIR, req.params.tenantId, "images");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    const base = sanitizeFilename(path.parse(file.originalname).name, "img");
    const finalName = uniqueFilename(path.join(TENANTS_DIR, req.params.tenantId, "images"), base, ext);
    cb(null, finalName);
  }
});
const IMAGE_EXT = /\.(jpg|jpeg|png|webp)$/i;
const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okExt = IMAGE_EXT.test(file.originalname || "");
    const okMime = (file.mimetype || "").startsWith("image/");
    if (okExt || okMime) return cb(null, true);
    const err = new Error("INVALID_IMAGE");
    err.code = "INVALID_IMAGE";
    return cb(err);
  }
});
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac)$/i;
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(TENANTS_DIR, req.params.tenantId, "audio");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    const base = sanitizeFilename(path.parse(file.originalname).name, "audio");
    const finalName = uniqueFilename(path.join(TENANTS_DIR, req.params.tenantId, "audio"), base, ext);
    cb(null, finalName);
  }
});
const audioUpload = multer({
  storage: audioStorage,
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okMime = (file.mimetype || '').startsWith("audio/");
    const okExt = AUDIO_EXT.test(file.originalname || "");
    if (okMime || okExt) return cb(null, true);
    const err = new Error("INVALID_AUDIO");
    err.code = "INVALID_AUDIO";
    return cb(err);
  }
});

function isSafeName(name = "") {
  return !name.includes("..") && !name.includes("/") && !name.includes("\\");
}

function imagePath(tenantId, name) {
  return path.join(TENANTS_DIR, tenantId, "images", name);
}

function thumbPath(tenantId, name) {
  return path.join(TENANTS_DIR, tenantId, "thumbs", name);
}

async function ensureThumbnail(tenantId, name) {
  const source = imagePath(tenantId, name);
  const dest = thumbPath(tenantId, name);

  if (!fs.existsSync(source)) return null;
  if (fs.existsSync(dest)) return dest;

  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await sharp(source)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover" })
      .toFormat("jpeg", { quality: 70 })
      .toFile(dest);
    return dest;
  } catch (err) {
    console.error("Thumbnail generation failed", { tenantId, name, error: err.message });
    return null;
  }
}

async function ensureThumbnails(tenantId, files = []) {
  const tasks = files.map(name => ensureThumbnail(tenantId, name));
  await Promise.all(tasks);
}

function removeThumbnail(tenantId, name) {
  const dest = thumbPath(tenantId, name);
  if (fs.existsSync(dest)) {
    try { fs.unlinkSync(dest); } catch (err) { console.error("Thumbnail delete failed", err); }
  }
}

//------------------------------------------------------------
//  IMAGES API (tenant-based URL)
//------------------------------------------------------------

// LIST IMAGES
app.get("/api/tenant/:tenant/images", requireLogin, async (req, res) => {
  const tenantId = req.params.tenant;

  // Sécurité : le user ne peut lire que son tenant
  if (tenantId !== req.session.user.tenantId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const dir = path.join(TENANTS_DIR, tenantId, "images");
  const order = JSON.parse(fs.readFileSync(path.join(TENANTS_DIR, tenantId, "order.json"), "utf8"));
  const hidden = JSON.parse(fs.readFileSync(path.join(TENANTS_DIR, tenantId, "hidden.json"), "utf8"));

  if (!fs.existsSync(dir)) {
    return res.json([]);
  }

  const files = fs.readdirSync(dir)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));

  await ensureThumbnails(tenantId, files);

  const sorted = [...files].sort((a, b) => {
    return order.indexOf(a) - order.indexOf(b);
  });

  const list = sorted.map(f => ({
    name: f,
    url: `/t/${tenantId}/images/${f}`,
    thumbUrl: `/t/${tenantId}/thumbs/${f}`,
    hidden: hidden.includes(f)
  }));

  res.json(list);
});

// UPLOAD IMAGE
app.post("/api/:tenantId/images/upload", requireLogin, (req, res) => {
  const tenantId = req.params.tenantId;
  if (tenantId !== req.session.user.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });

  upload.single("image")(req, res, async err => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "Image trop volumineuse (6 Mo max)" });
      if (err.code === "INVALID_IMAGE") return res.status(400).json({ error: "Format d'image non supporté" });
      return res.status(400).json({ error: "Échec de l'upload image" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const base = path.join(TENANTS_DIR, tenantId);
    const orderFile = path.join(base, "order.json");
    const uploadedPath = req.file.path || path.join(base, "images", req.file.filename);

    const { quotaMB } = getTenantQuota(tenantId);
    const quotaBytes = quotaMB * 1024 * 1024;
    const usageBytes = getTenantUsageBytes(tenantId);
    const projectedUsage = usageBytes + (req.file.size || 0);

    if (projectedUsage > quotaBytes) {
      if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
      return res.status(400).json({ error: "Quota exceeded" });
    }

    const order = JSON.parse(fs.readFileSync(orderFile));

    order.push(req.file.filename);
    fs.writeFileSync(orderFile, JSON.stringify(order, null, 2));

    await ensureThumbnail(tenantId, req.file.filename);

    res.json({ success: true });
  });
});

// ORDER
app.put("/api/:tenantId/images/order", requireLogin, (req, res) => {
  const tenantId = req.params.tenantId;
  if (tenantId !== req.session.user.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });

  fs.writeFileSync(
    path.join(TENANTS_DIR, tenantId, "order.json"),
    JSON.stringify(req.body.order, null, 2)
  );

  res.json({ success: true });
});

// TENANT CONFIG
app.get("/api/:tenantId/config", requireLogin, (req, res) => {
  const tenantId = req.params.tenantId;

  if (tenantId !== req.session.user.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });

  const config = loadConfig(tenantId);
  res.json(config);
});

app.get("/api/:tenantId/quota", requireLogin, (req, res) => {
  const tenantId = req.params.tenantId;

  if (tenantId !== req.session.user.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });

  const { quotaMB, override } = getTenantQuota(tenantId);
  const usageBytes = getTenantUsageBytes(tenantId);
  const usageMB = Number((usageBytes / 1024 / 1024).toFixed(2));

  res.json({ quotaMB, usage: usageMB, override });
});

app.put("/api/:tenantId/quota", requireLogin, (req, res) => {
  const tenantId = req.params.tenantId;
  const { quotaMB } = req.body;

  if (tenantId !== req.session.user.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });

  const config = loadConfig(tenantId);

  if (quotaMB === null || quotaMB === undefined || quotaMB === "") {
    config.quotaMB = null;
  } else if (typeof quotaMB === "number" && quotaMB > 0) {
    config.quotaMB = quotaMB;
  } else {
    return res.status(400).json({ error: "quotaMB must be a positive number or null" });
  }

  saveConfig(tenantId, config);
  const updated = getTenantQuota(tenantId);
  const usageBytes = getTenantUsageBytes(tenantId);

  res.json({
    success: true,
    quotaMB: updated.quotaMB,
    override: updated.override,
    usage: Number((usageBytes / 1024 / 1024).toFixed(2))
  });
});

app.put("/api/:tenantId/config/tension", requireLogin, (req, res) => {
  const tenantId = req.params.tenantId;
  const { tensionEnabled, tensionFont, tensionColors, tensionLabels, tensionAudio } = req.body;

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

// HIDE
app.put("/api/:tenantId/images/hide/:name", requireLogin, (req, res) => {
  const tenantId = req.params.tenantId;
  const name = req.params.name;

  if (tenantId !== req.session.user.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });

  const file = path.join(TENANTS_DIR, tenantId, "hidden.json");
  let hidden = JSON.parse(fs.readFileSync(file));

  if (!hidden.includes(name)) hidden.push(name);

  fs.writeFileSync(file, JSON.stringify(hidden, null, 2));
  res.json({ success: true });
});

// SHOW
app.put("/api/:tenantId/images/show/:name", requireLogin, (req, res) => {
  const tenantId = req.params.tenantId;
  const name = req.params.name;

  if (tenantId !== req.session.user.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });

  const file = path.join(TENANTS_DIR, tenantId, "hidden.json");
  let hidden = JSON.parse(fs.readFileSync(file));

  hidden = hidden.filter(h => h !== name);

  fs.writeFileSync(file, JSON.stringify(hidden, null, 2));
  res.json({ success: true });
});

// DELETE
app.delete("/api/:tenantId/images/:name", requireLogin, (req, res) => {
  const tenantId = req.params.tenantId;
  const name = req.params.name;

  if (tenantId !== req.session.user.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });

  const base = path.join(TENANTS_DIR, tenantId);
  const hiddenFile = path.join(base, "hidden.json");
  const orderFile = path.join(base, "order.json");
  const imagesDir = path.join(base, "images");

  let hidden = JSON.parse(fs.readFileSync(hiddenFile));
  if (!hidden.includes(name))
    return res.status(403).json({ error: "Image must be hidden before deletion" });

  const filePath = path.join(imagesDir, name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  removeThumbnail(tenantId, name);

  hidden = hidden.filter(h => h !== name);
  fs.writeFileSync(hiddenFile, JSON.stringify(hidden, null, 2));

  let order = JSON.parse(fs.readFileSync(orderFile));
  order = order.filter(o => o !== name);
  fs.writeFileSync(orderFile, JSON.stringify(order, null, 2));

  res.json({ success: true });
});

//------------------------------------------------------------
//  AUDIO API
//------------------------------------------------------------
app.get("/api/tenant/:tenant/audio", requireLogin, (req, res) => {
  const tenantId = req.params.tenant;
  if (tenantId !== req.session.user.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });

  const dir = path.join(TENANTS_DIR, tenantId, "audio");
  if (!fs.existsSync(dir)) {
    return res.json([]);
  }

  const files = fs.readdirSync(dir).filter(f => AUDIO_EXT.test(f));
  const list = files.map(name => {
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

app.post("/api/:tenantId/audio/upload", requireLogin, (req, res) => {
  const tenantId = req.params.tenantId;
  if (tenantId !== req.session.user.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });

  audioUpload.single("audio")(req, res, err => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "Fichier trop volumineux (1 Mo max)" });
      if (err.code === "INVALID_AUDIO") return res.status(400).json({ error: "Format audio non supporté" });
      return res.status(400).json({ error: "Échec de l'upload audio" });
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

    res.json({ success: true, name: req.file.filename, size: fileSize });
  });
});

app.delete("/api/:tenantId/audio/:name", requireLogin, (req, res) => {
  const { tenantId, name } = req.params;
  if (tenantId !== req.session.user.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });
  if (!isSafeName(name)) return res.status(400).json({ error: "Invalid name" });

  const filePath = path.join(TENANTS_DIR, tenantId, "audio", name);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch {}
  }
  return res.json({ success: true });
});

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
  if (fs.existsSync(dest)) return res.status(400).json({ error: "Le nom existe déjà" });

  try {
    fs.renameSync(src, dest);
    return res.json({ success: true, name: newName });
  } catch (err) {
    return res.status(500).json({ error: "Rename failed" });
  }
});

//------------------------------------------------------------
//  GODMODE MODULE
//------------------------------------------------------------
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

      count = files.filter(f => /\.(png|jpg|jpeg)$/i.test(f)).length;
      files.forEach(f => {
        try {
          quota += fs.statSync(path.join(imagesDir, f)).size;
        } catch {}
      });
    }

    let audioCount = 0;
    if (fs.existsSync(audioDir)) {
      const audioFiles = fs.readdirSync(audioDir).filter(f => AUDIO_EXT.test(f));
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

    return {
      ...u,
      imageCount: count,
      audioCount,
      quotaUsedBytes: quota,
      quotaMB: effectiveQuotaMB,
      quotaOverride: override
    };
  });

  res.json(enriched);
});

app.get("/api/godmode/global-quota", requireGodMode, (req, res) => {
  const globalConfig = getGlobalConfig();
  res.json({ defaultQuotaMB: globalConfig.defaultQuotaMB });
});

app.put("/api/godmode/global-quota", requireGodMode, (req, res) => {
  const { defaultQuotaMB } = req.body;

  if (typeof defaultQuotaMB !== "number" || Number.isNaN(defaultQuotaMB) || defaultQuotaMB <= 0) {
    return res.status(400).json({ error: "defaultQuotaMB must be a positive number" });
  }

  const data = { defaultQuotaMB };
  fs.writeFileSync(GLOBAL_FILE, JSON.stringify(data, null, 2));
  res.json({ success: true, defaultQuotaMB });
});

app.put("/api/godmode/tenant-quota", requireGodMode, (req, res) => {
  const { tenantId, quotaMB } = req.body;

  if (!tenantId) return res.status(400).json({ error: "Missing tenantId" });

  const tenantDir = path.join(TENANTS_DIR, tenantId);
  if (!fs.existsSync(tenantDir)) return res.status(404).json({ error: "Tenant not found" });

  const config = loadConfig(tenantId);

  if (quotaMB === null || quotaMB === undefined || quotaMB === "") {
    config.quotaMB = null;
  } else if (typeof quotaMB === "number" && quotaMB > 0) {
    config.quotaMB = quotaMB;
  } else {
    return res.status(400).json({ error: "quotaMB must be a positive number or null" });
  }

  saveConfig(tenantId, config);
  const updated = getTenantQuota(tenantId);
  const usageBytes = getTenantUsageBytes(tenantId);

  res.json({
    success: true,
    quotaMB: updated.quotaMB,
    override: updated.override,
    usage: Number((usageBytes / 1024 / 1024).toFixed(2))
  });
});

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
// ---------------------------------------------
// FRONT PUBLIC TENANTISÉ (pas besoin d'être loggé)
// ---------------------------------------------
app.get("/t/:tenantId/front", (req, res) => {
  res.sendFile(FRONT_FILE);
});

app.get("/t/:tenantId/images/:name", (req, res) => {
  const { tenantId, name } = req.params;
  if (!isSafeName(name)) return res.status(400).send("Invalid name");
  const file = imagePath(tenantId, name);

  if (!fs.existsSync(file)) {
    return res.status(404).send("Image not found");
  }

  res.sendFile(file);
});

app.get("/t/:tenantId/thumbs/:name", async (req, res) => {
  const { tenantId, name } = req.params;
  if (!isSafeName(name)) return res.status(400).send("Invalid name");
  const thumbFile = thumbPath(tenantId, name);
  if (!fs.existsSync(thumbFile)) {
    const source = imagePath(tenantId, name);
    if (!fs.existsSync(source)) return res.status(404).send("Image not found");
    await ensureThumbnail(tenantId, name);
  }
  if (!fs.existsSync(thumbFile)) return res.status(404).send("Thumbnail not found");
  return res.sendFile(thumbFile);
});

app.get("/t/:tenantId/audio/:name", (req, res) => {
  const { tenantId, name } = req.params;
  if (!isSafeName(name)) return res.status(400).send("Invalid name");
  const file = path.join(TENANTS_DIR, tenantId, "audio", name);
  if (!fs.existsSync(file)) {
    return res.status(404).send("Audio not found");
  }
  res.sendFile(file);
});

app.get("/t/:tenantId/api/images", async (req, res) => {
  const tenantId = req.params.tenantId;
  const base = path.join(TENANTS_DIR, tenantId);

  const dir = path.join(base, "images");
  const order = JSON.parse(fs.readFileSync(path.join(base, "order.json")));
  const hidden = JSON.parse(fs.readFileSync(path.join(base, "hidden.json")));

  if (!fs.existsSync(dir)) return res.json([]);

  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .filter(f => !hidden.includes(f))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map(f => f);

  await ensureThumbnails(tenantId, files);

  const list = files.map(f => ({
    name: f,
    url: `/t/${tenantId}/images/${f}`,
    thumbUrl: `/t/${tenantId}/thumbs/${f}`
  }));

  res.json(list);
});

app.get("/t/:tenantId/api/config", (req, res) => {
  const config = loadConfig(req.params.tenantId);
  res.json(config);
});
//------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`🚀 ScenarWall API running at http://localhost:${PORT}`);
});
