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

app.use(express.json());
app.use(express.static(__dirname)); // serve login.html, signup.html, admin.html, godmode.html

//------------------------------------------------------------
//  FILES & DIRECTORIES
//------------------------------------------------------------
const USERS_FILE = path.join(__dirname, "users.json");
const SESSIONS_FILE = path.join(__dirname, "sessions.json");
const TENANTS_DIR = path.join(__dirname, "tenants");

if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, "{}");
if (!fs.existsSync(TENANTS_DIR)) fs.mkdirSync(TENANTS_DIR);

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
    url: `/tenants/${tenantId}/images/${f}`,
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
  const filePath = path.join(__dirname, "front.html");
  res.sendFile(filePath);
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
//------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`🚀 ScenarWall API running at http://localhost:${PORT}`);
});