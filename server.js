//------------------------------------------------------------
//  SCENARWALL — SERVER.JS (Option 2 : tenant dans l’URL)
//------------------------------------------------------------
const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const sharp = require("sharp");
const session = require("express-session");
const rateLimit = require("express-rate-limit"); // basic rate limiting for auth/uploads
const morgan = require("morgan"); // HTTP access logs
const WebSocket = require("ws");

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
// (history removed)
const LOG_DIR = path.join(DATA_DIR, "logs");
const CSRF_COOKIE = "XSRF-TOKEN";
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const accessLogStream = fs.createWriteStream(path.join(LOG_DIR, "access.log"), { flags: "a" });
const appLogStream = fs.createWriteStream(path.join(LOG_DIR, "app.log"), { flags: "a" });

function log(level, message, meta = {}) {
  const payload = {
    time: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  try {
    appLogStream.write(JSON.stringify(payload) + "\n");
  } catch (err) {
    console.error("Log write failed", err);
  }
}

const logger = {
  info: (msg, meta) => log("info", msg, meta),
  warn: (msg, meta) => log("warn", msg, meta),
  error: (msg, meta) => log("error", msg, meta)
};

const requestId = (req, res, next) => {
  req.id = req.headers["x-request-id"] || crypto.randomBytes(12).toString("hex");
  res.setHeader("X-Request-Id", req.id);
  next();
};

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
  skip: (req) => {
    // On ne limite pas les requêtes lecture (GET/HEAD/OPTIONS) pour éviter les 429 sur l'admin
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
    const p = req.path || "";
    return (
      p.startsWith("/admin") ||
      p.startsWith("/admin/js/") ||
      p.startsWith("/fragments/") ||
      p.startsWith("/assets/") ||
      p.startsWith("/js/") ||
      p.startsWith("/front/") ||
      p.startsWith("/t/") ||
      p.includes(".")
    );
  }
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
const THUMB_SIZE = 230;
const DEFAULT_GLOBAL = {
  defaultQuotaMB: 100 // seul champ persistant dans global.json
};
const DEFAULT_DISCORD_SCOPES = ["identify"];
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
  quotaMB: null
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
const SCENARIO_FORMATS = new Set(["campaign", "oneshot"]);

assertRequiredEnv();

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

function resolveDiscordRedirectUri(req) {
  if (ENV_GLOBAL.discordRedirectUri) return ENV_GLOBAL.discordRedirectUri;
  const host = req.get("host");
  if (!host) return null;
  const proto = req.protocol || "http";
  return `${proto}://${host}/api/auth/discord/callback`;
}

// Cookie de session : force secure+None en prod, lax en dev HTTP
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

function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const token = req.get("x-csrf-token");
  if (!req.session || !req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: "Invalid CSRF token" });
  }
  next();
}

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
// Access logs (to file)
morgan.token("id", (req) => req.id);
app.use(morgan('[:date[iso]] :id :remote-addr :method :url :status :res[content-length] - :response-time ms', { stream: accessLogStream }));
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
function scenarioDir(tenantId) {
  return path.join(TENANTS_DIR, tenantId, "scenario");
}

function scenarioPath(tenantId, id) {
  return path.join(scenarioDir(tenantId), `${id}.json`);
}

function ensureScenarioDir(tenantId) {
  const dir = scenarioDir(tenantId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listScenarios(tenantId) {
  const dir = scenarioDir(tenantId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  return files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); }
    catch { return null; }
  }).filter(Boolean);
}

function readScenario(tenantId, id) {
  const file = scenarioPath(tenantId, id);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

function writeScenario(tenantId, data) {
  const dir = ensureScenarioDir(tenantId);
  const file = scenarioPath(tenantId, data.id);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
}

function deleteScenario(tenantId, id) {
  const file = scenarioPath(tenantId, id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// Sessions storage helpers
function sessionDir(tenantId) {
  return path.join(TENANTS_DIR, tenantId, "sessions");
}

function sessionPath(tenantId, id) {
  return path.join(sessionDir(tenantId), `${id}.json`);
}

function ensureSessionDir(tenantId) {
  const dir = sessionDir(tenantId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

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

function listSessions(tenantId) {
  const dir = sessionDir(tenantId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  return files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); }
    catch { return null; }
  }).filter(Boolean).map(applySessionRuntimeDefaults);
}

function readSessionFile(tenantId, id) {
  const file = sessionPath(tenantId, id);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return applySessionRuntimeDefaults(data);
  }
  catch { return null; }
}

function writeSessionFile(tenantId, data) {
  const dir = ensureSessionDir(tenantId);
  const file = sessionPath(tenantId, data.id);
  // On n'écrit que les valeurs fournies, les defaults runtime sont appliqués en lecture.
  const payload = { ...data };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return data;
}

function deleteSessionFile(tenantId, id) {
  const file = sessionPath(tenantId, id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// Scenes storage helpers
function sceneDir(tenantId) {
  return path.join(TENANTS_DIR, tenantId, "scenes");
}

function legacySceneDir(tenantId) {
  return path.join(TENANTS_DIR, tenantId, "scnes");
}

function scenePath(tenantId, id) {
  return path.join(sceneDir(tenantId), `${id}.json`);
}

function ensureSceneDir(tenantId) {
  const dir = sceneDir(tenantId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

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

function readScene(tenantId, id) {
  const primary = scenePath(tenantId, id);
  const legacy = path.join(legacySceneDir(tenantId), `${id}.json`);
  const file = fs.existsSync(primary) ? primary : legacy;
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

function writeScene(tenantId, data) {
  const dir = ensureSceneDir(tenantId);
  const file = scenePath(tenantId, data.id);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
}

function deleteScene(tenantId, id) {
  const existing = readScene(tenantId, id);
  [scenePath(tenantId, id), path.join(legacySceneDir(tenantId), `${id}.json`)]
    .forEach(file => { if (fs.existsSync(file)) fs.unlinkSync(file); });
  const noteName = typeof existing?.notes === "string" ? existing.notes : "";
  if (noteName && isSafeName(noteName)) {
    const file = notePath(tenantId, noteName);
    if (fs.existsSync(file)) {
      try { fs.unlinkSync(file); } catch (err) {
        logger.error("Failed to delete scene note during scene removal", { tenantId, sceneId: id, err: err?.message });
      }
    }
  }
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
    logger.error("Failed to read config, using defaults", { err: err?.message, file });
    return { ...DEFAULT_CONFIG };
  }
}

function getGlobalConfig() {
  if (!fs.existsSync(GLOBAL_FILE)) {
    return { ...DEFAULT_GLOBAL };
  }

  try {
    const data = JSON.parse(fs.readFileSync(GLOBAL_FILE, "utf8")) || {};
    const defaultQuotaMB = (typeof data.defaultQuotaMB === "number" && data.defaultQuotaMB > 0)
      ? data.defaultQuotaMB
      : DEFAULT_GLOBAL.defaultQuotaMB;
    // Seul le quota par défaut peut provenir du fichier. Les autres valeurs viennent des env/fallbacks.
    return {
      defaultQuotaMB,
      //apiBase: ENV_GLOBAL.apiBase !== null ? ENV_GLOBAL.apiBase : null,
      //pixabayKey: ENV_GLOBAL.pixabayKey !== null ? ENV_GLOBAL.pixabayKey : null,
      //discordClientId: ENV_GLOBAL.discordClientId !== null ? ENV_GLOBAL.discordClientId : null,
      //discordClientSecret: ENV_GLOBAL.discordClientSecret !== null ? ENV_GLOBAL.discordClientSecret : null,
      //discordRedirectUri: ENV_GLOBAL.discordRedirectUri !== null ? ENV_GLOBAL.discordRedirectUri : null,
      //allowedGuildId: null,
      //discordScopes: (ENV_GLOBAL.discordScopes && ENV_GLOBAL.discordScopes.length)
      //  ? ENV_GLOBAL.discordScopes
      //  : DEFAULT_DISCORD_SCOPES
    };
  } catch (err) {
    logger.error("Failed to read global config, using defaults", { err: err?.message });
    return {
      defaultQuotaMB: DEFAULT_GLOBAL.defaultQuotaMB,
      //apiBase: ENV_GLOBAL.apiBase !== null ? ENV_GLOBAL.apiBase : null,
      //pixabayKey: ENV_GLOBAL.pixabayKey !== null ? ENV_GLOBAL.pixabayKey : null,
      //discordClientId: ENV_GLOBAL.discordClientId !== null ? ENV_GLOBAL.discordClientId : null,
      //discordClientSecret: ENV_GLOBAL.discordClientSecret !== null ? ENV_GLOBAL.discordClientSecret : null,
      //discordRedirectUri: ENV_GLOBAL.discordRedirectUri !== null ? ENV_GLOBAL.discordRedirectUri : null,
      //allowedGuildId: null,
      //discordScopes: DEFAULT_DISCORD_SCOPES
    };
  }
}

function getPublicGlobalConfig() {
  const config = getGlobalConfig();
  return {
    apiBase: config.apiBase || null,
    pixabayKey: ENV_GLOBAL.pixabayKey || null
  };
}

// Session runs persistence (historique des parties)
function normalizeSessionRuns(raw) {
  if (!Array.isArray(raw)) return [];

  // Already tenant grouped ? [{tenantId, sessions:[{sessionId,runs:[]}]}]
  const looksTenantGrouped = raw.length && raw[0] && Array.isArray(raw[0].sessions);
  if (looksTenantGrouped) {
    return raw.map(t => ({
      tenantId: t.tenantId,
      sessions: Array.isArray(t.sessions) ? t.sessions.map(s => ({
        sessionId: s.sessionId,
        runs: Array.isArray(s.runs) ? s.runs.slice() : []
      })) : []
    }));
  }

  // Session grouped format [{tenantId, sessionId, runs:[...]}]
  const looksSessionGrouped = raw.length && raw[0] && Array.isArray(raw[0].runs) && raw[0].sessionId;
  if (looksSessionGrouped) {
    const tmap = new Map();
    raw.forEach(s => {
      if (!s || !s.tenantId || !s.sessionId) return;
      if (!tmap.has(s.tenantId)) tmap.set(s.tenantId, { tenantId: s.tenantId, sessions: [] });
      tmap.get(s.tenantId).sessions.push({
        sessionId: s.sessionId,
        runs: Array.isArray(s.runs) ? s.runs.slice() : []
      });
    });
    return Array.from(tmap.values());
  }

  // Legacy flat -> group
  const tmap = new Map();
  raw.forEach(r => {
    if (!r || !r.tenantId || !r.sessionId) return;
    if (!tmap.has(r.tenantId)) tmap.set(r.tenantId, { tenantId: r.tenantId, sessions: [] });
    const tenant = tmap.get(r.tenantId);
    let session = tenant.sessions.find(s => s.sessionId === r.sessionId);
    if (!session) {
      session = { sessionId: r.sessionId, runs: [] };
      tenant.sessions.push(session);
    }
    session.runs.push({
      front: r.front || "offline",
      gm: r.gm || "offline",
      lastFrontPing: r.lastFrontPing || null,
      lastGmPing: r.lastGmPing || null,
      createdAt: r.createdAt || Date.now(),
      updatedAt: r.updatedAt || r.createdAt || Date.now()
    });
  });
  return Array.from(tmap.values()).map(t => {
    t.sessions.forEach(s => s.runs.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)));
    return t;
  });
}

function flattenRuns(groups) {
  const flat = [];
  (groups || []).forEach(t => {
    (t.sessions || []).forEach(s => {
      (s.runs || []).forEach(r => flat.push({ tenantId: t.tenantId, sessionId: s.sessionId, ...r }));
    });
  });
  return flat;
}

function loadSessionStates() {
  if (!fs.existsSync(SESSION_STATES_FILE)) {
    // migration depuis l'ancien nom
    if (fs.existsSync(LEGACY_SESSION_STATES_FILE)) {
      try { fs.renameSync(LEGACY_SESSION_STATES_FILE, SESSION_STATES_FILE); } catch {}
    }
    if (!fs.existsSync(SESSION_STATES_FILE)) {
      fs.writeFileSync(SESSION_STATES_FILE, JSON.stringify([], null, 2));
    }
  }
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_STATES_FILE, "utf8")) || [];
    return normalizeSessionRuns(data);
  } catch (err) {
    logger.error("Failed to read session-states, reset", { err: err?.message });
    return [];
  }
}

function reloadSessionRuns() {
  sessionRuns = loadSessionStates();
  return sessionRuns;
}

function saveSessionStates(states) {
  try {
    fs.writeFileSync(SESSION_STATES_FILE, JSON.stringify(states, null, 2));
  } catch (err) {
    logger.error("Failed to write session-states", { err: err?.message });
  }
}

function presenceStateToArray() {
  return flattenRuns(sessionRuns);
}

function ensureTenantSession(tenantId, sessionId) {
  let tenant = sessionRuns.find(t => t.tenantId === tenantId);
  if (!tenant) {
    tenant = { tenantId, sessions: [] };
    sessionRuns.push(tenant);
  }
  let session = tenant.sessions.find(s => s.sessionId === sessionId);
  if (!session) {
    session = { sessionId, runs: [] };
    tenant.sessions.push(session);
  }
  return session;
}

function appendSessionRun(tenantId, sessionId, data = {}) {
  if (!tenantId || !sessionId) return null;
  const now = Date.now();
  const run = {
    front: data.front || "offline",
    gm: data.gm || "offline",
    lastFrontPing: data.lastFrontPing || null,
    lastGmPing: data.lastGmPing || null,
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now
  };
  const session = ensureTenantSession(tenantId, sessionId);
  session.runs.push(run);
  saveSessionStates(sessionRuns);
  return run;
}

function updateLatestRun(tenantId, sessionId, patch = {}) {
  const session = ensureTenantSession(tenantId, sessionId);
  if (!session.runs || !session.runs.length) {
    return appendSessionRun(tenantId, sessionId, patch);
  }
  const run = session.runs[session.runs.length - 1];
  Object.assign(run, patch);
  run.updatedAt = patch.updatedAt || Date.now();
  saveSessionStates(sessionRuns);
  return run;
}

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
      logger.error("Discord token error", { reqId: req.id, data: tokenData });
      return res.status(400).send("Echec OAuth Discord");
    }

    // Get user info
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
      fs.mkdirSync(dir);
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
    logger.error("Discord OAuth error", { reqId: req.id, err: err?.message, stack: err?.stack });
    res.status(500).send("Erreur OAuth Discord");
  }
});

// Tension defaults (communes)
app.get("/api/tension-default", (req, res) => {
  res.json(TENSION_DEFAULTS);
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
    logger.error("Thumbnail generation failed", { tenantId, name, error: err.message });
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
    try { fs.unlinkSync(dest); } catch (err) { logger.error("Thumbnail delete failed", { tenantId, name, error: err?.message }); }
  }
}

function removeImageFromScenes(tenantId, imageName) {
  const scenes = listScenes(tenantId);
  let updated = 0;
  scenes.forEach(scene => {
    if (!Array.isArray(scene.images) || scene.images.length === 0) return;
    const filtered = scene.images.filter(img => img?.name !== imageName);
    if (filtered.length === scene.images.length) return;
    // réindexation simple pour conserver un ordre cohérent
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

function tenantNotesDir(tenantId) {
  return path.join(TENANTS_DIR, tenantId, "notes");
}

function notePath(tenantId, name) {
  return path.join(tenantNotesDir(tenantId), name);
}

function audioOrderFile(tenantId) {
  return path.join(TENANTS_DIR, tenantId, "audio", "audio-order.json");
}

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

function writeAudioOrder(tenantId, order) {
  fs.writeFileSync(audioOrderFile(tenantId), JSON.stringify(order, null, 2));
}

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

function readImageOrder(tenantId) {
  const file = imageOrderFile(tenantId);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeImageOrder(tenantId, order) {
  fs.writeFileSync(imageOrderFile(tenantId), JSON.stringify(order, null, 2));
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
  const order = readImageOrder(tenantId);
  const hiddenPath = path.join(TENANTS_DIR, tenantId, "images", "images-hidden.json");
  const legacyHidden = path.join(TENANTS_DIR, tenantId, "images-hidden.json");
  if (!fs.existsSync(hiddenPath)) {
    if (fs.existsSync(legacyHidden)) {
      try { fs.renameSync(legacyHidden, hiddenPath); } catch {}
    }
  }
  if (!fs.existsSync(hiddenPath)) fs.writeFileSync(hiddenPath, "[]");
  const hidden = JSON.parse(fs.readFileSync(hiddenPath, "utf8"));

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

  limiterUpload(req, res, () => {
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
    const orderFile = imageOrderFile(tenantId);
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
});

// ORDER
app.put("/api/:tenantId/images/order", requireLogin, (req, res) => {
  const tenantId = req.params.tenantId;
  if (tenantId !== req.session.user.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });

  const orderInput = Array.isArray(req.body.order) ? req.body.order : [];
  const order = orderInput.filter(isSafeName);

  writeImageOrder(tenantId, order);

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
  if (!isSafeName(name)) return res.status(400).json({ error: "Invalid name" });

  const file = path.join(TENANTS_DIR, tenantId, "images", "images-hidden.json");
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
  if (!isSafeName(name)) return res.status(400).json({ error: "Invalid name" });

  const file = path.join(TENANTS_DIR, tenantId, "images", "images-hidden.json");
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
  if (!isSafeName(name)) return res.status(400).json({ error: "Invalid name" });

  const base = path.join(TENANTS_DIR, tenantId);
  const hiddenFile = path.join(base, "images", "images-hidden.json");
  const orderFile = imageOrderFile(tenantId);
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

  const scenesUpdated = removeImageFromScenes(tenantId, name);

  res.json({ success: true, scenesUpdated });
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

  const order = readAudioOrder(tenantId);
  const files = fs.readdirSync(dir).filter(f => AUDIO_EXT.test(f));
  const sorted = [...files].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    const va = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
    const vb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
    if (va !== vb) return va - vb;
    return a.localeCompare(b);
  });

  const list = sorted.map(name => {
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

  limiterUpload(req, res, () => {
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

    const order = readAudioOrder(tenantId);
    order.push(req.file.filename);
    writeAudioOrder(tenantId, order);

    res.json({ success: true, name: req.file.filename, size: fileSize });
  });
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
  const order = readAudioOrder(tenantId).filter(n => n !== name);
  writeAudioOrder(tenantId, order);
  const scenesUpdated = removeAudioFromScenes(tenantId, name);
  return res.json({ success: true, scenesUpdated });
});

app.put("/api/:tenantId/audio/order", requireLogin, (req, res) => {
  const { tenantId } = req.params;
  if (tenantId !== req.session.user.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });
  const newOrder = Array.isArray(req.body.order) ? req.body.order.filter(isSafeName) : [];
  writeAudioOrder(tenantId, newOrder);
  res.json({ success: true });
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
    const order = readAudioOrder(tenantId).map(n => n === name ? newName : n);
    writeAudioOrder(tenantId, order);
    return res.json({ success: true, name: newName });
  } catch (err) {
    return res.status(500).json({ error: "Rename failed" });
  }
});

//------------------------------------------------------------
//  SESSION (Timer) API
//------------------------------------------------------------
app.get("/api/:tenantId/session", requireLogin, (req, res) => {
  const { tenantId } = req.params;
  if (tenantId !== req.session.user.tenantId) {
    return res.status(403).json({ error: "Forbidden tenant" });
  }
  const sessionData = readTenantSession(tenantId);
  res.json(sessionData);
});

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

// Session-scoped GM state (timer / hourglass) --------------------------------
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

// Notes autosave (Markdown)
app.get("/api/:tenantId/session/notes", requireLogin, (req, res) => {
  const { tenantId } = req.params;
  if (tenantId !== req.session.user.tenantId) return res.status(403).send("Forbidden tenant");
  const sessionData = readTenantSession(tenantId);
  const notesDir = path.join(TENANTS_DIR, tenantId, "notes");
  const noteId = sessionData.notes?.noteId || null;
  let content = "";
  if (noteId) {
    const filePath = path.join(notesDir, `${noteId}.md`);
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, "utf8");
    }
  }
  res.json({
    id: noteId,
    history: Array.isArray(sessionData.notes?.history) ? sessionData.notes.history : [],
    content
  });
});

app.put("/api/:tenantId/session/notes", requireLogin, (req, res) => {
  const { tenantId } = req.params;
  if (tenantId !== req.session.user.tenantId) return res.status(403).send("Forbidden tenant");
  const { id, content } = req.body || {};
  const notesDir = path.join(TENANTS_DIR, tenantId, "notes");
  if (!fs.existsSync(notesDir)) fs.mkdirSync(notesDir, { recursive: true });
  const noteId = typeof id === "string" && id.trim() ? id.trim() : `note-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const filePath = path.join(notesDir, `${noteId}.md`);
  fs.writeFileSync(filePath, content || "", "utf8");

  const sessionData = readTenantSession(tenantId);
  const history = Array.isArray(sessionData.notes?.history) ? sessionData.notes.history : [];
  if (!history.includes(noteId)) history.push(noteId);
  sessionData.notes = { noteId, history };
  writeTenantSession(tenantId, sessionData);
  res.json({ id: noteId });
});

//------------------------------------------------------------
//  SCENARIOS
//------------------------------------------------------------
function sanitizeScenarioInput(body = {}, existing = null) {
  const now = Math.floor(Date.now() / 1000);
  const base = existing ? { ...existing } : {
    id: `sc_${Date.now()}`,
    tenantId: body.tenantId,
    title: "",
    sessions: [],
    createdAt: now,
    updatedAt: now
  };
  const payload = { ...base };
  if (typeof body.title === "string") payload.title = body.title.trim().slice(0, 200);
  if (Array.isArray(body.sessions)) payload.sessions = body.sessions.map(String);
  delete payload.description;
  delete payload.format;
  payload.updatedAt = now;
  return payload;
}

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
      updatedAt: now
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

function touchScenarioUpdated(tenantId, scenarioId) {
  if (!tenantId || !scenarioId) return;
  const scenario = readScenario(tenantId, scenarioId);
  if (!scenario) return;
  scenario.updatedAt = Math.floor(Date.now() / 1000);
  writeScenario(tenantId, scenario);
}

function touchScenarioFromSession(tenantId, sessionId) {
  if (!tenantId || !sessionId) return;
  const session = readSessionFile(tenantId, sessionId);
  if (session?.parentScenario) {
    touchScenarioUpdated(tenantId, session.parentScenario);
  }
}

function touchSessionUpdated(tenantId, sessionId) {
  if (!tenantId || !sessionId) return;
  const session = readSessionFile(tenantId, sessionId);
  if (!session) return;
  session.updatedAt = Math.floor(Date.now() / 1000);
  writeSessionFile(tenantId, session);
}

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

app.delete("/api/tenant/:tenant/scenarios/:id", requireLogin, (req, res) => {
  const tenantId = req.params.tenant;
  const { id } = req.params;
  if (tenantId !== req.session.user.tenantId) {
    return res.status(403).json({ error: "Forbidden tenant" });
  }
  const existing = readScenario(tenantId, id);
  if (!existing) return res.status(404).json({ error: "Scenario not found" });
  deleteScenario(tenantId, id);
  // cascade delete sessions and scenes linked to this scenario
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

//------------------------------------------------------------
//  SESSIONS (scénarios)
//------------------------------------------------------------
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
  const payload = { ...base };
  if (typeof body.title === "string") payload.title = body.title.trim().slice(0, 200);
  if (typeof body.parentScenario === "string") {
    const v = body.parentScenario.trim();
    payload.parentScenario = v || null;
  }
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
    payload.tensionAudio = {
      level1: typeof body.tensionAudio.level1 === "string" ? body.tensionAudio.level1 : null,
      level2: typeof body.tensionAudio.level2 === "string" ? body.tensionAudio.level2 : null,
      level3: typeof body.tensionAudio.level3 === "string" ? body.tensionAudio.level3 : null,
      level4: typeof body.tensionAudio.level4 === "string" ? body.tensionAudio.level4 : null,
      level5: typeof body.tensionAudio.level5 === "string" ? body.tensionAudio.level5 : null
    };
  }
  if (body.resetTensionDefaults === true) {
    delete payload.tensionEnabled;
    delete payload.tensionFont;
    delete payload.tensionColors;
    delete payload.tensionLabels;
    delete payload.tensionAudio;
  }
  if (body.clearTension === true) {
    delete payload.tensionFont;
    delete payload.tensionColors;
    delete payload.tensionLabels;
    delete payload.tensionAudio;
  }
  delete payload.description;
  delete payload.date;
  delete payload.format;
  payload.updatedAt = now;
  return payload;
}

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
    res.status(500).json({ error: "Impossible de lister les sessions" });
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
  if (!payload.title) return res.status(400).json({ error: "Titre requis" });
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
  touchScenarioUpdated(tenantId, existing.parentScenario);
  res.json({ success: true });
});

//------------------------------------------------------------
//  SCENES (sessions)
//------------------------------------------------------------

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
      title: "Scène 1" || 'Nouvelle scène',
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
    res.status(500).json({ error: "Impossible de lister les scènes" });
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
  if (!payload.title) return res.status(400).json({ error: "Titre requis" });
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

// Scene note (markdown file)
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
    if (fs.existsSync(file)) {
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

//------------------------------------------------------------
//  SCENES (sessions)
//------------------------------------------------------------

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
    res.status(500).json({ error: "Impossible de réordonner les scènes" });
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

      count = files.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).length;
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

  const current = getGlobalConfig();
  const updated = { ...current, defaultQuotaMB };
  fs.writeFileSync(GLOBAL_FILE, JSON.stringify(updated, null, 2));
  res.json({ success: true, defaultQuotaMB });
});

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

app.get("/t/:tenantId/notes/:name", (req, res) => {
  const { tenantId, name } = req.params;
  if (!req.session?.user || req.session.user.tenantId !== tenantId) {
    return res.status(403).send("Forbidden tenant");
  }
  if (!isSafeName(name)) return res.status(400).send("Invalid name");
  const file = path.join(TENANTS_DIR, tenantId, "notes", name);
  if (!fs.existsSync(file)) {
    return res.status(404).send("Note not found");
  }
  res.type("text/markdown");
  res.sendFile(file);
});

app.put("/t/:tenantId/notes/:name", (req, res) => {
  const { tenantId, name } = req.params;
  if (!req.session?.user || req.session.user.tenantId !== tenantId) {
    return res.status(403).send("Forbidden tenant");
  }
  if (!isSafeName(name)) return res.status(400).send("Invalid name");
  const notesDir = path.join(TENANTS_DIR, tenantId, "notes");
  if (!fs.existsSync(notesDir)) fs.mkdirSync(notesDir, { recursive: true });
  const content = typeof req.body?.content === "string" ? req.body.content : "";
  fs.writeFileSync(path.join(notesDir, name), content, "utf8");
  res.json({ ok: true });
});

app.delete("/t/:tenantId/notes/:name", (req, res) => {
  const { tenantId, name } = req.params;
  if (!req.session?.user || req.session.user.tenantId !== tenantId) {
    return res.status(403).send("Forbidden tenant");
  }
  if (!isSafeName(name)) return res.status(400).send("Invalid name");
  const file = path.join(TENANTS_DIR, tenantId, "notes", name);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
  res.json({ ok: true });
});

app.get("/t/:tenantId/api/notes", (req, res) => {
  const { tenantId } = req.params;
  if (!req.session?.user || req.session.user.tenantId !== tenantId) {
    return res.status(403).send("Forbidden tenant");
  }
  const dir = path.join(TENANTS_DIR, tenantId, "notes");
  if (!fs.existsSync(dir)) return res.json([]);
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => /\.md$/i.test(f) && isSafeName(f));
    const list = files.map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return {
        name,
        updatedAt: stat.mtimeMs
      };
    });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: "Cannot read notes" });
  }
});

app.get("/t/:tenantId/api/images", async (req, res) => {
  const tenantId = req.params.tenantId;
  const base = path.join(TENANTS_DIR, tenantId);

  const dir = path.join(base, "images");
  const order = readImageOrder(tenantId);
  const hiddenFile = path.join(base, "images", "images-hidden.json");
  const legacyHidden = path.join(base, "images-hidden.json");
  if (!fs.existsSync(hiddenFile) && fs.existsSync(legacyHidden)) {
    try { fs.renameSync(legacyHidden, hiddenFile); } catch {}
  }
  let hidden = [];
  try {
    if (fs.existsSync(hiddenFile)) {
      hidden = JSON.parse(fs.readFileSync(hiddenFile, "utf8")) || [];
    } else {
      fs.writeFileSync(hiddenFile, "[]");
    }
  } catch {
    hidden = [];
  }

  if (!fs.existsSync(dir)) return res.json([]);

  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));

  await ensureThumbnails(tenantId, files);

  const list = files.map(f => ({
    name: f,
    url: `/t/${tenantId}/images/${f}`,
    thumbUrl: `/t/${tenantId}/thumbs/${f}`,
    hidden: hidden.includes(f)
  }));

  res.json(list);
});

app.get("/t/:tenantId/api/config", (req, res) => {
  const config = loadConfig(req.params.tenantId);
  res.json(config);
});

//------------------------------------------------------------
//  GLOBAL ERROR HANDLER
//------------------------------------------------------------
app.use((err, req, res, next) => {
  logger.error("Unhandled error", {
    reqId: req.id,
    path: req.originalUrl,
    method: req.method,
    message: err.message,
    stack: err.stack
  });
  res.status(500).json({ error: "Internal error", requestId: req.id });
});

//------------------------------------------------------------
//  WEBSOCKET (tension sync)
//------------------------------------------------------------
const wss = new WebSocket.Server({ server, path: "/ws" });

function broadcastTenant(tenantId, payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.meta && client.meta.tenantId === tenantId) {
      client.send(msg);
    }
  });
}

// In-memory presence state
const presenceState = new Map(); // key: tenantId -> Map(sessionId -> { front: 'online'|'offline', gm: 'online'|'offline', lastFrontPing, lastGmPing, createdAt, updatedAt })
const PRESENCE_TTL = 16000; // ms
let sessionRuns = loadSessionStates(); // historique des runs

// hydrate presence map with latest known status per session (offline by default)
(() => {
  const latestBySession = new Map();
  (flattenRuns(sessionRuns) || []).forEach(run => {
    if (!run || !run.tenantId || !run.sessionId) return;
    const key = `${run.tenantId}::${run.sessionId}`;
    const existing = latestBySession.get(key);
    if (!existing || (run.updatedAt || 0) > (existing.updatedAt || 0)) {
      latestBySession.set(key, run);
    }
  });
  latestBySession.forEach(run => {
    const state = getSessionState(run.tenantId, run.sessionId);
    state.front = run.front || "offline";
    state.gm = run.gm || "offline";
    state.lastFrontPing = run.lastFrontPing || null;
    state.lastGmPing = run.lastGmPing || null;
    state.createdAt = run.createdAt || Date.now();
    state.updatedAt = run.updatedAt || Date.now();
  });
})();

function getSessionState(tenantId, sessionId) {
  if (!tenantId || !sessionId) return null;
  if (!presenceState.has(tenantId)) presenceState.set(tenantId, new Map());
  const sessions = presenceState.get(tenantId);
  if (!sessions.has(sessionId)) sessions.set(sessionId, {
    front: "offline",
    gm: "offline",
    lastFrontPing: null,
    lastGmPing: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  return sessions.get(sessionId);
}

function updatePresence(tenantId, sessionId, role, status) {
  const state = getSessionState(tenantId, sessionId);
  if (!state) return;
  const prevFront = state.front;
  const prevGm = state.gm;
  const wasOnlinePair = state.front === "online" && state.gm === "online";
  if (role === "front") {
    state.front = status;
    state.lastFrontPing = status === "online" ? Date.now() : state.lastFrontPing || Date.now();
  }
  if (role === "gm") {
    state.gm = status;
    state.lastGmPing = status === "online" ? Date.now() : state.lastGmPing || Date.now();
  }
  state.updatedAt = Date.now();

  // Si le GM vient de passer offline -> online, on démarre un nouveau run
  if (role === "gm" && prevGm !== "online" && status === "online") {
    appendSessionRun(tenantId, sessionId, {
      gm: "online",
      front: state.front,
      lastFrontPing: state.lastFrontPing,
      lastGmPing: state.lastGmPing,
      createdAt: state.updatedAt,
      updatedAt: state.updatedAt
    });
  }

  broadcastTenant(tenantId, {
    type: "presence:update",
    sessionId,
    front: state.front,
    gm: state.gm,
    lastFrontPing: state.lastFrontPing,
    lastGmPing: state.lastGmPing,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt
  });
  updateLatestRun(tenantId, sessionId, {
    front: state.front,
    gm: state.gm,
    lastFrontPing: state.lastFrontPing,
    lastGmPing: state.lastGmPing,
    updatedAt: state.updatedAt
  });
}

function markOfflineIfStale(now = Date.now()) {
  presenceState.forEach((sessions, tenantId) => {
    sessions.forEach((state, sessionId) => {
      let changed = false;
      if (state.front === "online" && (!state.lastFrontPing || now - state.lastFrontPing > PRESENCE_TTL)) {
        state.front = "offline";
        changed = true;
      }
      if (state.gm === "online" && (!state.lastGmPing || now - state.lastGmPing > PRESENCE_TTL)) {
        state.gm = "offline";
        changed = true;
      }
      if (changed) {
        state.updatedAt = Date.now();
        broadcastTenant(tenantId, {
          type: "presence:update",
          sessionId,
          front: state.front,
          gm: state.gm,
          lastFrontPing: state.lastFrontPing,
          lastGmPing: state.lastGmPing,
          createdAt: state.createdAt,
          updatedAt: state.updatedAt
        });
        updateLatestRun(tenantId, sessionId, {
          front: state.front,
          gm: state.gm,
          lastFrontPing: state.lastFrontPing,
          lastGmPing: state.lastGmPing,
          updatedAt: state.updatedAt
        });
      }
    });
  });
}

setInterval(() => markOfflineIfStale(), 5000);

// ------------------------------------------------------------
//  API: SESSION STATES
// ------------------------------------------------------------
app.get("/api/tenant/:tenantId/session-states", requireLogin, (req, res) => {
  const { tenantId } = req.params;
  const states = presenceStateToArray().filter(s => s.tenantId === tenantId);
  res.json(states);
});

// Liste complète des états de sessions (superadmin)
app.get("/api/admin/session-states", requireGodMode, (req, res) => {
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
  const run = appendSessionRun(tenantId, sessionId, {
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

wss.on("connection", (ws, req) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    ws.meta = {
      tenantId: urlObj.searchParams.get("tenantId") || null,
      role: urlObj.searchParams.get("role") || "front",
      sessionId: null
    };
  } catch {
    ws.meta = { tenantId: null, role: "front", sessionId: null };
  }

  function counterpartOnline(sessionId) {
    if (!sessionId || !ws.meta.tenantId) return false;
    const state = getSessionState(ws.meta.tenantId, sessionId);
    if (!state) return false;
    if (ws.meta.role === "gm") return state.front === "online";
    if (ws.meta.role === "front") return state.gm === "online";
    return false;
  }

  ws.on("message", data => {
    let msg = null;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!ws.meta || !ws.meta.tenantId) return;

    if (msg.type === "presence:hello" && typeof msg.sessionId === "string") {
      ws.meta.sessionId = msg.sessionId;
      updatePresence(ws.meta.tenantId, msg.sessionId, ws.meta.role, "online");
      return;
    }

    const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : null;

    if (msg.type === "tension:update" && typeof msg.level === "string") {
      if (sessionId && !counterpartOnline(sessionId)) return;
      const payload = { type: "tension:update", level: msg.level };
      if (sessionId) payload.sessionId = sessionId;
      broadcastTenant(ws.meta.tenantId, payload);
    }
    if (msg.type === "slideshow:update" && (typeof msg.index === "number" || typeof msg.name === "string")) {
      if (sessionId && !counterpartOnline(sessionId)) return;
      const payload = { type: "slideshow:update" };
      if (typeof msg.index === "number") payload.index = msg.index;
      if (typeof msg.name === "string") payload.name = msg.name;
      if (sessionId) payload.sessionId = sessionId;
      broadcastTenant(ws.meta.tenantId, payload);
    }
    if (msg.type === "hourglass:command" && typeof msg.action === "string") {
      if (sessionId && !counterpartOnline(sessionId)) return;
      const payload = { type: "hourglass:command", action: msg.action };
      if (typeof msg.durationSeconds === "number") payload.durationSeconds = msg.durationSeconds;
      if (typeof msg.visible === "boolean") payload.visible = msg.visible;
      if (typeof msg.show === "boolean") payload.show = msg.show;
      broadcastTenant(ws.meta.tenantId, payload);
    }
    if (msg.type === "tension:config" && msg.config && typeof msg.config === "object") {
      // On autorise le config même si le pair n'est pas détecté online, pour resynchroniser au front
      const payload = { type: "tension:config", config: msg.config };
      if (sessionId) payload.sessionId = sessionId;
      broadcastTenant(ws.meta.tenantId, payload);
    }
  });

  ws.on("close", () => {
    if (ws.meta && ws.meta.tenantId && ws.meta.sessionId) {
      updatePresence(ws.meta.tenantId, ws.meta.sessionId, ws.meta.role, "offline");
    }
  });
});

server.listen(PORT, () => {
  logger.info("Server started", { url: `http://localhost:${PORT}` });
});
