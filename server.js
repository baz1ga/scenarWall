const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
process.env.TZ = process.env.TZ || "Europe/Paris";
const crypto = require("crypto");
const session = require("express-session");
const rateLimit = require("express-rate-limit"); // basic rate limiting for auth/uploads
const morgan = require("morgan"); // HTTP access logs
const multer = require("multer");
const { createPresence } = require("./presence");
const { initWebsocket } = require("./websocket");
const { registerRunStateRoutes } = require("./routes/runStateRoutes");
const { registerGodmodeRoutes } = require("./routes/godmodeRoutes");
const { registerSessionsScenesRoutes } = require("./routes/sessionsScenesRoutes");
const { registerScenarioRoutes } = require("./routes/scenarioRoutes");
const { registerCharacterRoutes } = require("./routes/characterRoutes");
const { registerNoteRoutes } = require("./routes/noteRoutes");
const { registerSessionTimerRoutes } = require("./routes/sessionTimerRoutes");
const { registerImageRoutes } = require("./routes/imageRoutes");
const { registerTensionRoutes } = require("./routes/tensionRoutes");
const { registerConfigRoutes } = require("./routes/configRoutes");
const { registerAudioRoutes } = require("./routes/audioRoutes");
const { registerAuthRoutes } = require("./routes/authRoutes");
// Utilitaires partagés (réutilisés par plusieurs modules de routes)
// Vérifie qu'un nom de fichier ne contient pas de traversée de répertoires.
function isSafeName(name = "") {
  return !name.includes("..") && !name.includes("/") && !name.includes("\\");
}
// Construit le chemin d'une image pour un tenant.
function imagePath(tenantId, name) {
  return path.join(TENANTS_DIR, tenantId, "images", name);
}
// Construit le chemin d'une miniature pour un tenant.
function thumbPath(tenantId, name) {
  return path.join(TENANTS_DIR, tenantId, "thumbs", name);
}
// Retourne le fichier d'ordre audio d'un tenant (avec chemin normalisé).
function audioOrderFile(tenantId) {
  return path.join(TENANTS_DIR, tenantId, "audio", "audio-order.json");
}
// Lit l'ordre des audios en gérant les migrations legacy.
function readAudioOrder(tenantId) {
  const file = audioOrderFile(tenantId);
  const legacy = path.join(TENANTS_DIR, tenantId, "audio-order.json");
  const audioDir = path.join(TENANTS_DIR, tenantId, "audio");
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  if (!fs.existsSync(file)) {
    if (fs.existsSync(legacy)) {
      try { fs.renameSync(legacy, file); } catch {}
    }
  }
  if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
// Écrit l'ordre des audios.
function writeAudioOrder(tenantId, order) {
  fs.writeFileSync(audioOrderFile(tenantId), JSON.stringify(order, null, 2));
}
// Retourne le fichier d'ordre des images (et migre le legacy si présent).
function imageOrderFile(tenantId) {
  const imagesDir = path.join(TENANTS_DIR, tenantId, "images");
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
  const file = path.join(imagesDir, "images-order.json");
  const legacy = path.join(TENANTS_DIR, tenantId, "order.json");
  if (!fs.existsSync(file) && fs.existsSync(legacy)) {
    try { fs.renameSync(legacy, file); } catch {}
  }
  if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");
  return file;
}
// Lit l'ordre des images.
function readImageOrder(tenantId) {
  const file = imageOrderFile(tenantId);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
// Écrit l'ordre des images.
function writeImageOrder(tenantId, order) {
  fs.writeFileSync(imageOrderFile(tenantId), JSON.stringify(order, null, 2));
}
// Supprime une miniature si elle existe.
function removeThumbnail(tenantId, name) {
  const dest = thumbPath(tenantId, name);
  if (fs.existsSync(dest)) {
    try { fs.unlinkSync(dest); } catch (err) { logger.error("Thumbnail delete failed", { tenantId, name, error: err?.message }); }
  }
}
// Retire une image de toutes les scènes et réordonne.
function removeImageFromScenes(tenantId, imageName) {
  const scenes = listScenes(tenantId);
  let updated = 0;
  scenes.forEach(scene => {
    if (!Array.isArray(scene.images) || scene.images.length === 0) return;
    const filtered = scene.images.filter(img => img?.name !== imageName);
    if (filtered.length === scene.images.length) return;
    scene.images = filtered.map((img, idx) => ({ ...img, order: idx + 1 }));
    scene.updatedAt = Math.floor(Date.now() / 1000);
    try {
      writeScene(tenantId, scene);
      updated++;
    } catch (err) {
      logger.error("Failed to update scene after image delete", { tenantId, sceneId: scene.id, imageName, err: err?.message });
    }
  });
  return updated;
}
// Retire un audio de toutes les scènes et réordonne.
function removeAudioFromScenes(tenantId, audioName) {
  const scenes = listScenes(tenantId);
  let updated = 0;
  scenes.forEach(scene => {
    if (!Array.isArray(scene.audio) || scene.audio.length === 0) return;
    const filtered = scene.audio.filter(a => {
      const name = typeof a === "string" ? a : a?.name;
      return name !== audioName;
    });
    if (filtered.length === scene.audio.length) return;
    scene.audio = filtered.map((item, idx) => {
      if (typeof item === "string") return { name: item, order: idx + 1 };
      return { ...item, order: idx + 1 };
    });
    scene.updatedAt = Math.floor(Date.now() / 1000);
    try {
      writeScene(tenantId, scene);
      updated++;
    } catch (err) {
      logger.error("Failed to update scene after audio delete", { tenantId, sceneId: scene.id, audioName, err: err?.message });
    }
  });
  return updated;
}

const app = express();
const server = http.createServer(app);
const PORT = 3100;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const TENANTS_DIR = path.join(DATA_DIR, "tenants");
const FAVICONS_DIR = path.join(PUBLIC_DIR, "assets", "favicons");
const FRONT_FILE = path.join(PUBLIC_DIR, "front", "index.html");
const GLOBAL_FILE = path.join(DATA_DIR, "default-quota.json");
const LEGACY_GLOBAL_FILE = path.join(DATA_DIR, "global.json");
const SESSION_STATES_FILE = path.join(DATA_DIR, "run-states.json");
const LEGACY_SESSION_STATES_FILE = path.join(DATA_DIR, "session-states.json");
const TENSION_DEFAULT_FILE = path.join(DATA_DIR, "default-tension.json");
const LEGACY_TENSION_DEFAULT_FILE = path.join(DATA_DIR, "tension-default.json");
const CSRF_COOKIE = "XSRF-TOKEN";
const IMAGE_EXT = /\.(jpg|jpeg|png|webp)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac)$/i;
const charAvatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(TENANTS_DIR, req.params.tenant, "characters", "avatars");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || ".png").toLowerCase();
      const base = sanitizeFilename(path.parse(file.originalname).name, "avatar");
      const finalName = uniqueFilename(path.join(TENANTS_DIR, req.params.tenant, "characters", "avatars"), base, ext);
      cb(null, finalName);
    }
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okMime = (file.mimetype || "").startsWith("image/");
    const okExt = IMAGE_EXT.test(file.originalname || "");
    if (okMime || okExt) return cb(null, true);
    const err = new Error("INVALID_IMAGE");
    err.code = "INVALID_IMAGE";
    return cb(err);
  }
});
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(TENANTS_DIR, req.params.tenantId, "images");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || ".png").toLowerCase();
      const base = sanitizeFilename(path.parse(file.originalname).name, "image");
      const finalName = uniqueFilename(path.join(TENANTS_DIR, req.params.tenantId, "images"), base, ext);
      cb(null, finalName);
    }
  }),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okMime = (file.mimetype || '').startsWith("image/");
    const okExt = IMAGE_EXT.test(file.originalname || "");
    if (okMime || okExt) return cb(null, true);
    const err = new Error("INVALID_IMAGE");
    err.code = "INVALID_IMAGE";
    return cb(err);
  }
});
const audioUpload = multer({
  storage: multer.diskStorage({
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
  }),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okMime = (file.mimetype || '').startsWith("audio/");
    const okExt = AUDIO_EXT.test(file.originalname || "");
    if (okMime || okExt) return cb(null, true);
    const err = new Error("INVALID_AUDIO");
    err.code = "INVALID_AUDIO";
    return cb(err);
  }
});
// Logger simple vers stdout/stderr (compatible PM2) avec heure locale TZ.
const logger = {
  info: (msg, meta = {}) => {
    console.log(JSON.stringify({
      level: "info",
      time: new Date().toLocaleString("fr-FR", {
        timeZone: "Europe/Paris"
      }),
      message: msg,
      ...meta
    }));
  },

  warn: (msg, meta = {}) => {
    console.warn(JSON.stringify({
      level: "warn",
      time: new Date().toLocaleString("fr-FR", {
        timeZone: "Europe/Paris"
      }),
      message: msg,
      ...meta
    }));
  },

  error: (msg, meta = {}) => {
    console.error(JSON.stringify({
      level: "error",
      time: new Date().toLocaleString("fr-FR", {
        timeZone: "Europe/Paris"
      }),
      message: msg,
      ...meta
    }));
  }
};


// Ajoute un identifiant de requête pour le suivi des logs.
const requestId = (req, res, next) => {
  req.id = req.headers["x-request-id"] || crypto.randomBytes(12).toString("hex");
  res.setHeader("X-Request-Id", req.id);
  next();
};

// Handler commun appelé par rate-limit en cas de dépassement.
const rateLimitHandler = (name) => (req, res, next, options) => {
  logger.warn("rate-limit", { reqId: req.id, ip: req.ip, path: req.path, limiter: name, limit: options.limit });
  // Empêcher le cache (nginx/CDN) de garder une réponse 429
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Retry-After", Math.ceil(options.windowMs / 1000)); // seconds
  res.status(options.statusCode).send(options.message || "Too many requests");
};
// Limiteurs globaux/finement ciblés
const limiterGeneral = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("general"),
  skip: (req) => ["GET", "HEAD", "OPTIONS"].includes(req.method)
});
const limiterAuth = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("auth")
});
const limiterUpload = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("upload")
});
const DEFAULT_GLOBAL = {
  defaultQuotaMB: 100 // seul champ persistant dans global.json
};
const DEFAULT_DISCORD_SCOPES = ["identify"];
const DEFAULT_SCENARIO_ICON = "fa-solid fa-scroll";
const DEFAULT_SESSION_ICON = "fa-solid fa-clapperboard";
const FALLBACK_TENSION_DEFAULTS = {
  tensionEnabled: true,
  tensionColors: {
    level1: "#37aa32",
    level2: "#f8d718",
    level3: "#f39100",
    level4: "#e63027",
    level5: "#3a3a39"
  },
  tensionLabels: {
    level1: "0",
    level2: "-5",
    level3: "+5",
    level4: "+10",
    level5: "+15"
  },
  tensionFont: null,
  tensionAudio: {
    level1: null,
    level2: null,
    level3: null,
    level4: null,
    level5: null
  }
};

// Normalise la classe d'icône pour scénarios/sessions.
function normalizeIconClass(value, fallback) {
  const fallbackIcon = typeof fallback === "string" && fallback.trim() ? fallback.trim() : fallback;
  const dest = fallbackIcon || DEFAULT_SCENARIO_ICON;
  if (typeof value !== "string") return dest;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : dest;
}

// Charge et valide les valeurs par défaut de tension (avec fallback).
function loadTensionDefaults() {
  const validateColors = (src) => {
    const s = typeof src === "object" && src ? src : {};
    const def = FALLBACK_TENSION_DEFAULTS.tensionColors;
    return {
      level1: typeof s.level1 === "string" ? s.level1 : def.level1,
      level2: typeof s.level2 === "string" ? s.level2 : def.level2,
      level3: typeof s.level3 === "string" ? s.level3 : def.level3,
      level4: typeof s.level4 === "string" ? s.level4 : def.level4,
      level5: typeof s.level5 === "string" ? s.level5 : def.level5
    };
  };
  const validateLabels = (src) => {
    const s = typeof src === "object" && src ? src : {};
    const def = FALLBACK_TENSION_DEFAULTS.tensionLabels;
    const trim = (v, f) => (typeof v === "string" && v.trim().length ? v.trim().slice(0, 4) : f);
    return {
      level1: trim(s.level1, def.level1),
      level2: trim(s.level2, def.level2),
      level3: trim(s.level3, def.level3),
      level4: trim(s.level4, def.level4),
      level5: trim(s.level5, def.level5)
    };
  };
  const validateAudio = (src) => {
    const s = typeof src === "object" && src ? src : {};
    const out = {};
    ["level1", "level2", "level3", "level4", "level5"].forEach(l => {
      out[l] = typeof s[l] === "string" ? s[l] : null;
    });
    return out;
  };

  // Migration ancien nom
  if (!fs.existsSync(TENSION_DEFAULT_FILE) && fs.existsSync(LEGACY_TENSION_DEFAULT_FILE)) {
    try { fs.renameSync(LEGACY_TENSION_DEFAULT_FILE, TENSION_DEFAULT_FILE); } catch {}
  }
  if (!fs.existsSync(TENSION_DEFAULT_FILE)) {
    fs.writeFileSync(TENSION_DEFAULT_FILE, JSON.stringify(FALLBACK_TENSION_DEFAULTS, null, 2));
    return FALLBACK_TENSION_DEFAULTS;
  }
  try {
    const data = JSON.parse(fs.readFileSync(TENSION_DEFAULT_FILE, "utf8")) || {};
    return {
      tensionEnabled: data.tensionEnabled !== undefined ? !!data.tensionEnabled : FALLBACK_TENSION_DEFAULTS.tensionEnabled,
      tensionColors: validateColors(data.tensionColors),
      tensionLabels: validateLabels(data.tensionLabels),
      tensionFont: data.tensionFont || null,
      tensionAudio: validateAudio(data.tensionAudio)
    };
  } catch {
    return FALLBACK_TENSION_DEFAULTS;
  }
}

const TENSION_DEFAULTS = loadTensionDefaults();
const DEFAULT_TENSION_COLORS = TENSION_DEFAULTS.tensionColors;
const DEFAULT_TENSION_LABELS = TENSION_DEFAULTS.tensionLabels;

const DEFAULT_CONFIG = {
  tensionEnabled: TENSION_DEFAULTS.tensionEnabled,
  tensionColors: { ...DEFAULT_TENSION_COLORS },
  tensionLabels: { ...DEFAULT_TENSION_LABELS },
  tensionFont: TENSION_DEFAULTS.tensionFont,
  tensionAudio: { ...TENSION_DEFAULTS.tensionAudio },
  quotaMB: null,
  lang: "fr"
};
const DEFAULT_TENANT_SESSION = {
  timer: {
    running: false,
    elapsedMs: 0,
    startedAt: null
  },
  hourglass: {
    durationSeconds: 60,
    showTimer: true
  },
  notes: {
    noteId: null,
    history: []
  }
};

const DEFAULT_SESSION_COOKIE = {
  secure: true,
  sameSite: "none"
};

const ENV_GLOBAL = {
  apiBase: process.env.API_BASE || null,
  pixabayKey: process.env.PIXABAY_KEY || null,
  discordClientId: process.env.DISCORD_CLIENT_ID || null,
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET || null,
  discordRedirectUri: process.env.DISCORD_REDIRECT_URI || null,
  allowedGuildId: null,
  discordScopes: process.env.DISCORD_SCOPES
    ? process.env.DISCORD_SCOPES.split(",").map(s => s.trim()).filter(Boolean)
    : null
};

const ENV_SESSION_COOKIE = {
  secure: process.env.SESSION_COOKIE_SECURE,
  sameSite: process.env.SESSION_COOKIE_SAMESITE
};

const UTF8_EXT = new Set([".html", ".htm", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".xml", ".webmanifest"]);
const NO_CACHE_ASSETS = new Set(["assets/css/tailwind.css"]);

assertRequiredEnv();

// Vérifie que les variables d'environnement critiques sont présentes.
function assertRequiredEnv() {
  const missing = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === "change-me") missing.push("SESSION_SECRET");
  if (!ENV_GLOBAL.discordClientId) missing.push("DISCORD_CLIENT_ID");
  if (!ENV_GLOBAL.discordClientSecret) missing.push("DISCORD_CLIENT_SECRET");
  if (missing.length) {
    logger.error(`Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
}

// Construit l'URL de redirection Discord en fonction de l'environnement ou de la requête.
function resolveDiscordRedirectUri(req) {
  if (ENV_GLOBAL.discordRedirectUri) return ENV_GLOBAL.discordRedirectUri;
  const host = req.get("host");
  if (!host) return null;
  const proto = req.protocol || "http";
  return `${proto}://${host}/api/auth/discord/callback`;
}

// Cookie de session : force secure+None en prod, lax en dev HTTP
// Calcule les options de cookie de session (secure/sameSite) selon l'environnement.
function resolveSessionCookieConfig() {
  const parseBool = (val) => {
    if (val === undefined || val === null || val === "") return null;
    return String(val).toLowerCase() === "true";
  };
  const envSecure = parseBool(ENV_SESSION_COOKIE.secure);
  const envSameSite = ENV_SESSION_COOKIE.sameSite || null;
  const isProd = process.env.NODE_ENV === "production";

  // Par défaut : secure en prod, sinon false. On ignore ce qui viendrait de global.json pour éviter les blocages HTTP.
  let secure = envSecure !== null ? envSecure : isProd;

  // SameSite : env prioritaire, sinon none en prod (si HTTPS), lax en dev.
  let sameSite = envSameSite || (isProd ? "none" : "lax");

  // sameSite=None requiert secure=true; si on n'est pas en HTTPS, on rétrograde en lax
  if (!secure && sameSite === "none") {
    sameSite = "lax";
  }

  return { secure, sameSite };
}

// Ajoute un cookie CSRF lisible par le client pour les requêtes mutantes.
function attachCsrfToken(req, res, next) {
  if (!req.session) return next();
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  }
  const { secure, sameSite } = resolveSessionCookieConfig();
  res.cookie(CSRF_COOKIE, req.session.csrfToken, {
    httpOnly: false,
    sameSite,
    secure,
    path: "/"
  });
  next();
}

// Valide le header CSRF sur les méthodes non idempotentes.
function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const token = req.get("x-csrf-token");
  if (!req.session || !req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: "Invalid CSRF token" });
  }
  next();
}

// Nettoie un nom de fichier en retirant les caractères interdits.
function sanitizeFilename(name = "", fallback = "file") {
  const base = name.toString().replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").replace(/^[_\.-]+|[_\.-]+$/g, "");
  return base || fallback;
}

// Génère un nom de fichier unique dans un dossier donné.
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
  // Store ultra simple : lecture/écriture synchrone sur fichier JSON
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
app.use(requestId);
// Access logs vers stdout (ignore GET/HEAD/OPTIONS pour limiter le bruit)
morgan.token("id", (req) => req.id);
app.use(morgan('[:date[iso]] :id :remote-addr :method :url :status :res[content-length] - :response-time ms', {
  skip: (req) => req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS"
}));
const globalConfig = getGlobalConfig();
app.use(limiterGeneral);

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new FileStore(SESSIONS_FILE),
  cookie: {
    ...resolveSessionCookieConfig(),
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));
app.use(attachCsrfToken);
app.use(requireCsrf);
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath || "").toLowerCase();
    if (UTF8_EXT.has(ext)) {
      const current = res.getHeader("Content-Type");
      if (current && !/charset=/i.test(String(current))) {
        res.setHeader("Content-Type", `${current}; charset=utf-8`);
      }
    }
    const relativePath = path.relative(PUBLIC_DIR, filePath || "").replace(/\\/g, "/");
    if (NO_CACHE_ASSETS.has(relativePath)) {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    }
  }
})); // serve login, signup, front, admin UIs
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
  res.json(getPublicGlobalConfig());
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
        logger.error("Session destroy error", { err: err?.message, reqId: req.id });
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
// Migration ancien nom global.json -> default-quota.json
if (!fs.existsSync(GLOBAL_FILE) && fs.existsSync(LEGACY_GLOBAL_FILE)) {
  try { fs.renameSync(LEGACY_GLOBAL_FILE, GLOBAL_FILE); } catch {}
}
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, "{}");
if (!fs.existsSync(TENANTS_DIR)) fs.mkdirSync(TENANTS_DIR);

// Normalise les couleurs de tension en format hex complet avec fallback.
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

// Normalise les libellés de tension en texte court.
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

// Lecture de l'état de session global pour un tenant.
function readTenantSession(tenantId) {
  const file = path.join(TENANTS_DIR, tenantId, "sessions.json");
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      ...DEFAULT_TENANT_SESSION,
      ...(data || {}),
      timer: { ...DEFAULT_TENANT_SESSION.timer, ...(data?.timer || {}) },
      hourglass: { ...DEFAULT_TENANT_SESSION.hourglass, ...(data?.hourglass || {}) },
      notes: {
        noteId: data?.notes?.noteId || null,
        history: Array.isArray(data?.notes?.history) ? data.notes.history : []
      }
    };
  } catch {
    return { ...DEFAULT_TENANT_SESSION };
  }
}

// Écriture de l'état de session global pour un tenant.
function writeTenantSession(tenantId, data) {
  const dir = path.join(TENANTS_DIR, tenantId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "sessions.json");
  const payload = {
    ...DEFAULT_TENANT_SESSION,
    ...(data || {}),
    timer: { ...DEFAULT_TENANT_SESSION.timer, ...(data?.timer || {}) },
    hourglass: { ...DEFAULT_TENANT_SESSION.hourglass, ...(data?.hourglass || {}) },
    notes: {
      noteId: data?.notes?.noteId || null,
      history: Array.isArray(data?.notes?.history) ? data.notes.history : []
    }
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}

// Scénarios storage helpers
// Retourne le dossier des scénarios pour un tenant.
function scenarioDir(tenantId) {
  return path.join(TENANTS_DIR, tenantId, "scenario");
}

// Chemin complet d'un fichier scénario.
function scenarioPath(tenantId, id) {
  return path.join(scenarioDir(tenantId), `${id}.json`);
}

// Crée le dossier scénario si absent.
function ensureScenarioDir(tenantId) {
  const dir = scenarioDir(tenantId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Liste tous les scénarios d'un tenant.
function listScenarios(tenantId) {
  const dir = scenarioDir(tenantId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  return files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); }
    catch { return null; }
  }).filter(Boolean);
}

// Lit un scénario par id.
function readScenario(tenantId, id) {
  const file = scenarioPath(tenantId, id);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

// Écrit un scénario.
function writeScenario(tenantId, data) {
  const dir = ensureScenarioDir(tenantId);
  const file = scenarioPath(tenantId, data.id);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
}

// Supprime un scénario.
function deleteScenario(tenantId, id) {
  const file = scenarioPath(tenantId, id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// Sessions storage helpers
// Dossier des sessions pour un tenant.
function sessionDir(tenantId) {
  return path.join(TENANTS_DIR, tenantId, "sessions");
}

// Chemin d'un fichier session.
function sessionPath(tenantId, id) {
  return path.join(sessionDir(tenantId), `${id}.json`);
}

// Crée le dossier session si besoin.
function ensureSessionDir(tenantId) {
  const dir = sessionDir(tenantId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Ajoute les valeurs runtime par défaut à une session.
function applySessionRuntimeDefaults(session) {
  if (!session || typeof session !== "object") return session;
  const mergedTensionColors = normalizeTensionColors(session.tensionColors || DEFAULT_CONFIG.tensionColors);
  const mergedTensionLabels = normalizeTensionLabels(session.tensionLabels || DEFAULT_CONFIG.tensionLabels);
  const mergedTensionAudio = normalizeTensionAudio(session.tensionAudio || DEFAULT_CONFIG.tensionAudio);
  return {
    ...session,
    timer: {
      ...DEFAULT_TENANT_SESSION.timer,
      ...(session.timer || {})
    },
    hourglass: {
      ...DEFAULT_TENANT_SESSION.hourglass,
      ...(session.hourglass || {})
    },
    tensionEnabled: session.tensionEnabled !== undefined ? !!session.tensionEnabled : DEFAULT_CONFIG.tensionEnabled,
    tensionFont: session.tensionFont || DEFAULT_CONFIG.tensionFont || null,
    tensionColors: mergedTensionColors,
    tensionLabels: mergedTensionLabels,
    tensionAudio: mergedTensionAudio
  };
}

// Liste toutes les sessions d'un tenant.
function listSessions(tenantId) {
  const dir = sessionDir(tenantId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  return files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); }
    catch { return null; }
  }).filter(Boolean).map(applySessionRuntimeDefaults);
}

// Lit un fichier session par id.
function readSessionFile(tenantId, id) {
  const file = sessionPath(tenantId, id);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return applySessionRuntimeDefaults(data);
  }
  catch { return null; }
}

// Écrit un fichier session.
function writeSessionFile(tenantId, data) {
  const dir = ensureSessionDir(tenantId);
  const file = sessionPath(tenantId, data.id);
  // On n'écrit que les valeurs fournies, les defaults runtime sont appliqués en lecture.
  const payload = { ...data };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return data;
}

// Supprime un fichier session.
function deleteSessionFile(tenantId, id) {
  const file = sessionPath(tenantId, id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// Scenes storage helpers
// Dossier des scènes.
function sceneDir(tenantId) {
  return path.join(TENANTS_DIR, tenantId, "scenes");
}

// Ancien dossier legacy des scènes.
function legacySceneDir(tenantId) {
  return path.join(TENANTS_DIR, tenantId, "scnes");
}

// Chemin complet d'une scène.
function scenePath(tenantId, id) {
  return path.join(sceneDir(tenantId), `${id}.json`);
}

// Crée le dossier scène au besoin.
function ensureSceneDir(tenantId) {
  const dir = sceneDir(tenantId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Liste toutes les scènes (incluant legacy).
function listScenes(tenantId) {
  const dirs = [sceneDir(tenantId), legacySceneDir(tenantId)];
  const seen = new Set();
  const entries = [];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(f => {
      if (!f.endsWith(".json")) return;
      const id = f.replace(/\.json$/, "");
      if (seen.has(id)) return;
      seen.add(id);
      entries.push({ dir, file: f });
    });
  });
  return entries.map(({ dir, file }) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")); }
    catch { return null; }
  }).filter(Boolean);
}

// Lit une scène par id (support legacy).
function readScene(tenantId, id) {
  const primary = scenePath(tenantId, id);
  const legacy = path.join(legacySceneDir(tenantId), `${id}.json`);
  const file = fs.existsSync(primary) ? primary : legacy;
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

// Écrit une scène.
function writeScene(tenantId, data) {
  const dir = ensureSceneDir(tenantId);
  const file = scenePath(tenantId, data.id);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
}

// Supprime une scène et son éventuelle note.
function deleteScene(tenantId, id) {
  const existing = readScene(tenantId, id);
  [scenePath(tenantId, id), path.join(legacySceneDir(tenantId), `${id}.json`)]
    .forEach(file => { if (fs.existsSync(file)) fs.unlinkSync(file); });
  const noteName = typeof existing?.notes === "string" ? existing.notes : "";
  if (noteName && isSafeName(noteName)) {
    const file = path.join(TENANTS_DIR, tenantId, "notes", noteName);
    if (fs.existsSync(file)) {
      try { fs.unlinkSync(file); } catch (err) {
        logger.error("Failed to delete scene note during scene removal", { tenantId, sceneId: id, err: err?.message });
      }
    }
  }
}

// Dossier des notes Markdown pour un tenant.
function tenantNotesDir(tenantId) {
  return path.join(TENANTS_DIR, tenantId, "notes");
}

// Chemin sécurisé d'une note Markdown.
function notePath(tenantId, name) {
  if (!name || !isSafeName(name)) return null;
  return path.join(tenantNotesDir(tenantId), name);
}

// Charge la configuration d'un tenant (et crée le fichier si absent).
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
    logger.error("Failed to read config, using defaults", { err: err?.message, file });
    return { ...DEFAULT_CONFIG };
  }
}

// Récupère la configuration globale (quota par défaut) avec fallback.
function getGlobalConfig() {
  if (!fs.existsSync(GLOBAL_FILE)) {
    return {
      ...DEFAULT_GLOBAL,
      discordClientId: ENV_GLOBAL.discordClientId || null,
      discordClientSecret: ENV_GLOBAL.discordClientSecret || null,
      discordRedirectUri: ENV_GLOBAL.discordRedirectUri || null,
      discordScopes: ENV_GLOBAL.discordScopes || null
    };
  }

  try {
    const data = JSON.parse(fs.readFileSync(GLOBAL_FILE, "utf8")) || {};
    const defaultQuotaMB = (typeof data.defaultQuotaMB === "number" && data.defaultQuotaMB > 0)
      ? data.defaultQuotaMB
      : DEFAULT_GLOBAL.defaultQuotaMB;
    const discordClientId = data.discordClientId || ENV_GLOBAL.discordClientId || null;
    const discordClientSecret = data.discordClientSecret || ENV_GLOBAL.discordClientSecret || null;
    const discordRedirectUri = data.discordRedirectUri || ENV_GLOBAL.discordRedirectUri || null;
    const discordScopes = Array.isArray(data.discordScopes) && data.discordScopes.length
      ? data.discordScopes
      : (ENV_GLOBAL.discordScopes || null);
    return {
      defaultQuotaMB,
      discordClientId,
      discordClientSecret,
      discordRedirectUri,
      discordScopes
    };
  } catch (err) {
    logger.error("Failed to read global config, using defaults", { err: err?.message });
    return {
      defaultQuotaMB: DEFAULT_GLOBAL.defaultQuotaMB,
      discordClientId: ENV_GLOBAL.discordClientId || null,
      discordClientSecret: ENV_GLOBAL.discordClientSecret || null,
      discordRedirectUri: ENV_GLOBAL.discordRedirectUri || null,
      discordScopes: ENV_GLOBAL.discordScopes || null
    };
  }
}

// Expose la config globale publique au front.
function getPublicGlobalConfig() {
  const config = getGlobalConfig();
  return {
    apiBase: config.apiBase || null,
    pixabayKey: ENV_GLOBAL.pixabayKey || null
  };
}

// Retourne le quota d'un tenant (avec overrides user/config).
function getTenantQuota(tenantId) {
  const globalConfig = getGlobalConfig();
  const config = loadConfig(tenantId);
  const userQuotaInfo = getTenantUserQuotaInfo(tenantId);
  const hasUserOverride = userQuotaInfo.quotaMB !== undefined && userQuotaInfo.quotaMB !== null;
  const hasConfigOverride = Object.prototype.hasOwnProperty.call(config, "quotaMB") && config.quotaMB !== null && config.quotaMB !== undefined;

  let quotaMB = hasUserOverride ? userQuotaInfo.quotaMB : (hasConfigOverride ? config.quotaMB : globalConfig.defaultQuotaMB);
  let override = hasUserOverride || hasConfigOverride;

  if (quotaMB === null || quotaMB === undefined || typeof quotaMB !== "number" || Number.isNaN(quotaMB)) {
    quotaMB = globalConfig.defaultQuotaMB;
    override = false;
  }

  return { quotaMB, override };
}

// Calcule la taille d'un dossier (optionnellement filtré).
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

// Calcule l'usage disque d'un tenant (images + audio).
function getTenantUsageBytes(tenantId) {
  const base = path.join(TENANTS_DIR, tenantId);
  const imagesSize = dirSize(path.join(base, "images"));
  const audioSize = dirSize(path.join(base, "audio"));
  return imagesSize + audioSize;
}

// Normalise la config audio de tension.
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

// Sauvegarde la config tenant avec normalisation tension.
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
// Lit la liste des utilisateurs.
function getUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

// Écrit la liste des utilisateurs.
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Récupère les informations de quota déclarées dans users.json.
function getTenantUserQuotaInfo(tenantId) {
  const users = getUsers();
  let quota = undefined;
  users.forEach(u => {
    if (u?.tenantId === tenantId && quota === undefined) {
      quota = u.quotaMB;
    }
  });
  return { quotaMB: quota, users };
}

// Met à jour le quota d'un tenant côté users.json (override).
function setTenantUserQuota(tenantId, quotaMB) {
  const { users } = getTenantUserQuotaInfo(tenantId);
  let touched = false;
  const updated = users.map(u => {
    if (u?.tenantId === tenantId) {
      touched = true;
      return { ...u, quotaMB };
    }
    return u;
  });
  if (touched) {
    saveUsers(updated);
  }
  return touched;
}

//------------------------------------------------------------
//  MIDDLEWARE: REQUIRE LOGIN
//------------------------------------------------------------
// Exige qu'une session utilisateur soit présente.
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
// Restreint l'accès aux administrateurs globaux.
function requireGodMode(req, res, next) {
  const user = req.session && req.session.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  if (user.admin !== true) return res.status(403).json({ error: "GodMode only" });
  req.superadmin = user;
  next();
}

// Marque un scénario comme modifié.
function touchScenarioUpdated(tenantId, scenarioId) {
  if (!tenantId || !scenarioId) return;
  const scenario = readScenario(tenantId, scenarioId);
  if (!scenario) return;
  scenario.updatedAt = Math.floor(Date.now() / 1000);
  writeScenario(tenantId, scenario);
}

// Met à jour le scénario parent d'une session si présent.
function touchScenarioFromSession(tenantId, sessionId) {
  if (!tenantId || !sessionId) return;
  const session = readSessionFile(tenantId, sessionId);
  if (session?.parentScenario) {
    touchScenarioUpdated(tenantId, session.parentScenario);
  }
}

// Marque une session comme modifiée.
function touchSessionUpdated(tenantId, sessionId) {
  if (!tenantId || !sessionId) return;
  const session = readSessionFile(tenantId, sessionId);
  if (!session) return;
  session.updatedAt = Math.floor(Date.now() / 1000);
  writeSessionFile(tenantId, session);
}

// Associe une session à un scénario cible (et détache l'ancien au besoin).
function attachSessionToScenario(tenantId, sessionPayload, previousScenarioId = null) {
  if (!sessionPayload?.parentScenario) return;
  const targetId = sessionPayload.parentScenario;
  try {
    const scenario = readScenario(tenantId, targetId);
    if (scenario) {
      const sessions = Array.isArray(scenario.sessions) ? [...scenario.sessions] : [];
      if (!sessions.includes(sessionPayload.id)) sessions.push(sessionPayload.id);
      scenario.sessions = sessions;
      scenario.updatedAt = Math.floor(Date.now() / 1000);
      writeScenario(tenantId, scenario);
    }
    if (previousScenarioId && previousScenarioId !== targetId) {
      const prev = readScenario(tenantId, previousScenarioId);
      if (prev && Array.isArray(prev.sessions)) {
        prev.sessions = prev.sessions.filter(s => s !== sessionPayload.id);
        writeScenario(tenantId, prev);
      }
    }
    touchScenarioUpdated(tenantId, targetId);
  } catch (err) {
    logger.error("attachSessionToScenario failed", { tenantId, sessionId: sessionPayload?.id, err: err?.message });
  }
}

//------------------------------------------------------------
//  ROUTES REGISTRATION
//------------------------------------------------------------
const { wss, broadcastTenant, attachPresence } = initWebsocket({ server, logger });
const presence = createPresence({
  tenantBaseDir: TENANTS_DIR,
  legacySessionStatesFile: [SESSION_STATES_FILE, LEGACY_SESSION_STATES_FILE],
  logger,
  broadcastTenant
});
attachPresence(presence);

registerAuthRoutes({
  app,
  limiterAuth,
  getGlobalConfig,
  resolveDiscordRedirectUri,
  getUsers,
  saveUsers,
  DEFAULT_CONFIG,
  DEFAULT_DISCORD_SCOPES,
  TENANTS_DIR,
  logger,
  requireLogin
});

registerRunStateRoutes({
  app,
  requireLogin,
  requireGodMode,
  presence
});

registerGodmodeRoutes({
  app,
  requireGodMode,
  getUsers,
  setTenantUserQuota,
  getTenantQuota,
  getTenantUsageBytes,
  getGlobalConfig,
  loadConfig,
  saveConfig,
  paths: { TENANTS_DIR, GLOBAL_FILE },
  audioExt: AUDIO_EXT
});

registerScenarioRoutes({
  app,
  requireLogin,
  logger,
  defaults: { DEFAULT_SCENARIO_ICON, DEFAULT_TENANT_SESSION },
  utils: { normalizeIconClass },
  stores: {
    listScenarios,
    readScenario,
    writeScenario,
    deleteScenario,
    listSessions,
    listScenes,
    deleteScene,
    writeSessionFile,
    writeScene
  }
});

registerCharacterRoutes({
  app,
  requireLogin,
  limiterUpload,
  uploadHandlerAvatar: charAvatarUpload,
  paths: { TENANTS_DIR },
  logger
});

registerSessionsScenesRoutes({
  app,
  requireLogin,
  logger,
  defaults: { DEFAULT_SESSION_ICON, DEFAULT_TENANT_SESSION },
  utils: { normalizeIconClass },
  stores: {
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
  }
});

registerNoteRoutes({
  app,
  requireLogin,
  TENANTS_DIR,
  readTenantSession,
  writeTenantSession,
  isSafeName
});

registerSessionTimerRoutes({
  app,
  requireLogin,
  defaults: { DEFAULT_TENANT_SESSION },
  stores: { readTenantSession, writeTenantSession, readSessionFile, writeSessionFile }
});

registerImageRoutes({
  app,
  requireLogin,
  limiterUpload,
  uploadHandler: imageUpload,
  deps: {
    TENANTS_DIR,
    getTenantQuota,
    getTenantUsageBytes,
    readImageOrder,
    writeImageOrder,
    removeThumbnail,
    removeImageFromScenes,
    imagePath,
    thumbPath,
    isSafeName
  }
});

registerAudioRoutes({
  app,
  requireLogin,
  limiterUpload,
  audioUpload,
  deps: {
    TENANTS_DIR,
    AUDIO_EXT,
    getTenantQuota,
    getTenantUsageBytes,
    readAudioOrder,
    writeAudioOrder,
    removeAudioFromScenes,
    isSafeName
  }
});

registerTensionRoutes({
  app,
  requireLogin,
  defaults: { TENSION_DEFAULTS },
  helpers: {
    loadConfig,
    saveConfig,
    normalizeTensionColors,
    normalizeTensionLabels,
    normalizeTensionAudio
  }
});

registerConfigRoutes({
  app,
  requireLogin,
  deps: {
    loadConfig,
    saveConfig,
    getTenantQuota,
    getTenantUsageBytes,
    setTenantUserQuota
  }
});

//------------------------------------------------------------
//  FRONT PUBLIC TENANTISÉ (pas besoin d'être loggé)
//------------------------------------------------------------
app.get("/t/:tenantId/front", (req, res) => {
  res.sendFile(FRONT_FILE);
});

server.listen(PORT, () => {
  logger.info("Server started", { url: `http://localhost:${PORT}` });
});
