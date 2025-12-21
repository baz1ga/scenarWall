const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

// Notes autosave (Markdown) pour une session globale (tenant).
function registerNoteRoutes({
  app,
  requireLogin,
  TENANTS_DIR,
  readTenantSession,
  writeTenantSession,
  isSafeName
}) {
  const notesDir = (tenantId) => path.join(TENANTS_DIR, tenantId, "notes");
  const notePath = (tenantId, name) => {
    if (!name || !isSafeName(name)) return null;
    return path.join(notesDir(tenantId), name);
  };

  app.get("/api/:tenantId/session/notes", requireLogin, (req, res) => {
    const { tenantId } = req.params;
    if (tenantId !== req.session.user.tenantId) return res.status(403).send("Forbidden tenant");
    const sessionData = readTenantSession(tenantId);
    const dir = notesDir(tenantId);
    const noteId = sessionData.notes?.noteId || null;
    let content = "";
    if (noteId) {
      const filePath = path.join(dir, `${noteId}.md`);
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
    const dir = notesDir(tenantId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const noteId = typeof id === "string" && id.trim() ? id.trim() : `note-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const filePath = path.join(dir, `${noteId}.md`);
    fs.writeFileSync(filePath, content || "", "utf8");

    const sessionData = readTenantSession(tenantId);
    const history = Array.isArray(sessionData.notes?.history) ? sessionData.notes.history : [];
    if (!history.includes(noteId)) history.push(noteId);
    sessionData.notes = { noteId, history };
    writeTenantSession(tenantId, sessionData);
    res.json({ id: noteId });
  });

  // Notes publiques par tenant (lecture/écriture/suppression/listing).
  app.get("/t/:tenantId/notes/:name", requireLogin, (req, res) => {
    const { tenantId, name } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).send("Forbidden tenant");
    }
    const file = notePath(tenantId, name);
    if (!file || !fs.existsSync(file)) {
      return res.status(404).send("Note not found");
    }
    res.type("text/markdown");
    res.sendFile(file);
  });

  app.put("/t/:tenantId/notes/:name", requireLogin, (req, res) => {
    const { tenantId, name } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).send("Forbidden tenant");
    }
    const file = notePath(tenantId, name);
    if (!file) return res.status(400).send("Invalid name");
    const dir = notesDir(tenantId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    fs.writeFileSync(file, content, "utf8");
    res.json({ ok: true });
  });

  app.delete("/t/:tenantId/notes/:name", requireLogin, (req, res) => {
    const { tenantId, name } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).send("Forbidden tenant");
    }
    const file = notePath(tenantId, name);
    if (!file) return res.status(400).send("Invalid name");
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    res.json({ ok: true });
  });

  app.get("/t/:tenantId/api/notes", requireLogin, (req, res) => {
    const { tenantId } = req.params;
    if (tenantId !== req.session.user.tenantId) {
      return res.status(403).send("Forbidden tenant");
    }
    const dir = notesDir(tenantId);
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
}

module.exports = {
  registerNoteRoutes
};
