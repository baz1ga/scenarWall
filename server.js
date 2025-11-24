//------------------------------------------------------------
//  SCENARWALL — SERVER.JS (Option 2 : tenant dans l’URL)
//------------------------------------------------------------
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const multer = require("multer");

const app = express();
const PORT = 3100;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const TENANTS_DIR = path.join(__dirname, "tenants");
const FRONT_FILE = path.join(PUBLIC_DIR, "front", "index.html");
const DEFAULT_CONFIG = {
  tensionEnabled: true,
  tensionColors: ["green", "yellow", "orange", "red", "black"]
};

app.use(express.json());
app.use(express.static(PUBLIC_DIR)); // serve login, signup, front, admin, godmode UIs

// Legacy filenames → new structured paths
app.get("/", (req, res) => res.redirect("/login.html"));
app.get("/admin.html", (req, res) => res.redirect("/admin/"));
app.get("/admin", (req, res) => res.redirect("/admin/"));
app.get("/godmode.html", (req, res) => res.redirect("/godmode/"));
app.get("/godmode", (req, res) => res.redirect("/godmode/"));
app.get("/front.html", (req, res) => res.redirect("/front/"));

//------------------------------------------------------------
//  FILES & DIRECTORIES
//------------------------------------------------------------
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, "{}");
if (!fs.existsSync(TENANTS_DIR)) fs.mkdirSync(TENANTS_DIR);

function loadConfig(tenantId) {
  const file = path.join(TENANTS_DIR, tenantId, "config.json");

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }

  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...DEFAULT_CONFIG, ...data };
  } catch (err) {
    console.error("Failed to read config, using defaults", err);
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(tenantId, config) {
  const file = path.join(TENANTS_DIR, tenantId, "config.json");
  fs.writeFileSync(file, JSON.stringify({ ...DEFAULT_CONFIG, ...config }, null, 2));
}

//------------------------------------------------------------
//  AUTH HELPERS
//------------------------------------------------------------
function getSessions() {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
}

function saveSessions(data) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
}

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
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Missing Authorization header" });

  const token = header.split(" ")[1];
  const sessions = getSessions();
  const session = sessions[token];

  if (!session) return res.status(401).json({ error: "Invalid session" });

  req.session = session;
  req.token = token;
  next();
}

//------------------------------------------------------------
//  MIDDLEWARE: REQUIRE GODMODE (superadmin)
//------------------------------------------------------------
function requireGodMode(req, res, next) {
  const header = req.headers["x-auth-token"];
  if (!header) return res.status(401).json({ error: "Missing token" });

  const sessions = getSessions();
  const session = sessions[header];
  if (!session) return res.status(401).json({ error: "Invalid session" });

  const users = getUsers();
  const user = users.find(u => u.email === session.email);

  if (!user || user.admin !== true)
    return res.status(403).json({ error: "GodMode only" });

  req.superadmin = user;
  next();
}

//------------------------------------------------------------
//  SIGNUP
//------------------------------------------------------------
app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Missing fields" });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email))
    return res.status(400).json({ error: "Email format invalid" });

  const users = getUsers();
  if (users.find(u => u.email === email))
    return res.status(400).json({ error: "Email already exists" });

  const tenantId = "T" + crypto.randomBytes(4).toString("hex");

  // tenant directory
  const dir = path.join(TENANTS_DIR, tenantId);
  fs.mkdirSync(dir);
  fs.mkdirSync(path.join(dir, "images"));
  fs.writeFileSync(path.join(dir, "order.json"), "[]");
  fs.writeFileSync(path.join(dir, "hidden.json"), "[]");
  fs.writeFileSync(path.join(dir, "config.json"),
    JSON.stringify({
      tensionEnabled: true,
      tensionColors: ["green", "yellow", "orange", "red", "black"]
    }, null, 2)
  );

  const hash = await bcrypt.hash(password, 10);

  users.push({
    email,
    password: hash,
    tenantId,
    admin: false,
    disabled: false,
    createdAt: new Date().toISOString(),
    lastLogin: null
  });

  saveUsers(users);

  res.json({ success: true, tenantId });
});

//------------------------------------------------------------
//  LOGIN
//------------------------------------------------------------
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const users = getUsers();
  const user = users.find(u => u.email === email);

  if (!user) return res.status(400).json({ error: "Unknown email" });
  if (user.disabled) return res.status(403).json({ error: "Account disabled" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: "Invalid password" });

  const token = crypto.randomBytes(20).toString("hex");

  const sessions = getSessions();
  sessions[token] = {
    email: user.email,
    tenantId: user.tenantId,
    createdAt: Date.now()
  };
  saveSessions(sessions);

  user.lastLogin = new Date().toISOString();
  saveUsers(users);

  res.json({
    success: true,
    token,
    tenantId: user.tenantId,
    admin: user.admin === true
  });
});

//------------------------------------------------------------
//  CHANGE PASSWORD (connected user)
//------------------------------------------------------------
app.post("/api/change-password", requireLogin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Champs requis manquants" });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Le nouveau mot de passe doit contenir au moins 8 caractères" });
  }

  const users = getUsers();
  const user = users.find(u => u.email === req.session.email);

  if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
  if (user.disabled) return res.status(403).json({ error: "Compte désactivé" });

  const isValid = await bcrypt.compare(currentPassword, user.password);
  if (!isValid) return res.status(400).json({ error: "Ancien mot de passe invalide" });

  const hash = await bcrypt.hash(newPassword, 10);
  user.password = hash;
  saveUsers(users);

  // Invalide les autres sessions actives de cet utilisateur
  const sessions = getSessions();
  Object.keys(sessions).forEach(tok => {
    if (sessions[tok].email === user.email && tok !== req.token) {
      delete sessions[tok];
    }
  });
  saveSessions(sessions);

  res.json({ success: true });
});

//------------------------------------------------------------
//  MULTER STORAGE
//------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(TENANTS_DIR, req.params.tenantId, "images");
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  }
});
const upload = multer({ storage });

//------------------------------------------------------------
//  IMAGES API (tenant-based URL)
//------------------------------------------------------------

// LIST IMAGES
app.get("/api/tenant/:tenant/images", requireLogin, (req, res) => {
  const tenantId = req.params.tenant;

  // Sécurité : le user ne peut lire que son tenant
  if (tenantId !== req.session.tenantId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const dir = path.join(TENANTS_DIR, tenantId, "images");
  const order = JSON.parse(fs.readFileSync(path.join(TENANTS_DIR, tenantId, "order.json"), "utf8"));
  const hidden = JSON.parse(fs.readFileSync(path.join(TENANTS_DIR, tenantId, "hidden.json"), "utf8"));

  if (!fs.existsSync(dir)) {
    return res.json([]);
  }

  const files = fs.readdirSync(dir)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f));

  const sorted = [...files].sort((a, b) => {
    return order.indexOf(a) - order.indexOf(b);
  });

  const list = sorted.map(f => ({
    name: f,
    url: `/t/${tenantId}/images/${f}`,
    hidden: hidden.includes(f)
  }));

  res.json(list);
});

// UPLOAD IMAGE
app.post("/api/:tenantId/images/upload", requireLogin, upload.single("image"), (req, res) => {
  const tenantId = req.params.tenantId;
  if (tenantId !== req.session.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });

  const base = path.join(TENANTS_DIR, tenantId);
  const order = JSON.parse(fs.readFileSync(path.join(base, "order.json")));

  order.push(req.file.filename);
  fs.writeFileSync(path.join(base, "order.json"), JSON.stringify(order, null, 2));

  res.json({ success: true });
});

// ORDER
app.put("/api/:tenantId/images/order", requireLogin, (req, res) => {
  const tenantId = req.params.tenantId;
  if (tenantId !== req.session.tenantId)
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

  if (tenantId !== req.session.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });

  const config = loadConfig(tenantId);
  res.json(config);
});

app.put("/api/:tenantId/config/tension", requireLogin, (req, res) => {
  const tenantId = req.params.tenantId;
  const { tensionEnabled } = req.body;

  if (tenantId !== req.session.tenantId)
    return res.status(403).json({ error: "Forbidden tenant" });

  if (typeof tensionEnabled !== "boolean") {
    return res.status(400).json({ error: "tensionEnabled must be a boolean" });
  }

  const config = loadConfig(tenantId);
  config.tensionEnabled = tensionEnabled;
  saveConfig(tenantId, config);

  res.json({ success: true, config });
});

// HIDE
app.put("/api/:tenantId/images/hide/:name", requireLogin, (req, res) => {
  const tenantId = req.params.tenantId;
  const name = req.params.name;

  if (tenantId !== req.session.tenantId)
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

  if (tenantId !== req.session.tenantId)
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

  if (tenantId !== req.session.tenantId)
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

  hidden = hidden.filter(h => h !== name);
  fs.writeFileSync(hiddenFile, JSON.stringify(hidden, null, 2));

  let order = JSON.parse(fs.readFileSync(orderFile));
  order = order.filter(o => o !== name);
  fs.writeFileSync(orderFile, JSON.stringify(order, null, 2));

  res.json({ success: true });
});

//------------------------------------------------------------
//  GODMODE MODULE
//------------------------------------------------------------
app.get("/api/godmode/users", requireGodMode, (req, res) => {
  const users = getUsers();

  const enriched = users.map(u => {
    const tenantDir = path.join(TENANTS_DIR, u.tenantId);
    const imagesDir = path.join(tenantDir, "images");

    let quota = 0;
    let count = 0;

    if (fs.existsSync(imagesDir)) {
      const files = fs.readdirSync(imagesDir);

      count = files.filter(f => /\.(png|jpg|jpeg)$/i.test(f)).length;
      files.forEach(f => {
        try {
          quota += fs.statSync(path.join(imagesDir, f)).size;
        } catch {}
      });
    }

    return {
      ...u,
      imageCount: count,
      quotaUsedBytes: quota
    };
  });

  res.json(enriched);
});

app.put("/api/godmode/toggle", requireGodMode, (req, res) => {
  const { email } = req.body;

  const users = getUsers();
  const user = users.find(u => u.email === email);

  if (!user) return res.status(404).json({ error: "Not found" });

  if (user.admin) return res.status(403).json({ error: "Cannot disable superadmin" });

  user.disabled = !user.disabled;
  saveUsers(users);

  res.json({ success: true });
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
  const file = path.join(TENANTS_DIR, req.params.tenantId, "images", req.params.name);

  if (!fs.existsSync(file)) {
    return res.status(404).send("Image not found");
  }

  res.sendFile(file);
});

app.get("/t/:tenantId/api/images", (req, res) => {
  const tenantId = req.params.tenantId;
  const base = path.join(TENANTS_DIR, tenantId);

  const dir = path.join(base, "images");
  const order = JSON.parse(fs.readFileSync(path.join(base, "order.json")));
  const hidden = JSON.parse(fs.readFileSync(path.join(base, "hidden.json")));

  if (!fs.existsSync(dir)) return res.json([]);

  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
    .filter(f => !hidden.includes(f))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map(f => ({
      name: f,
      url: `/t/${tenantId}/images/${f}`
    }));

  res.json(files);
});

app.get("/t/:tenantId/api/config", (req, res) => {
  const config = loadConfig(req.params.tenantId);
  res.json(config);
});
//------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`🚀 ScenarWall API running at http://localhost:${PORT}`);
});
