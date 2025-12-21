const WebSocket = require("ws");

// Initialise le serveur WebSocket et retourne les helpers d'intégration (diffusion, présence).
function initWebsocket({ server, logger }) {
  const log = logger || { info: () => {}, warn: () => {}, error: () => {} };
  const wss = new WebSocket.Server({ server, path: "/ws" });
  let presence = null;
  let cleanupInterval = null;

  // Diffuse un payload à tous les clients d'un tenant donné.
  function broadcastTenant(tenantId, payload) {
    const msg = JSON.stringify(payload);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && client.meta && client.meta.tenantId === tenantId) {
        client.send(msg);
      }
    });
  }

  // Vérifie s'il existe une socket ouverte pour un tenant/session/rôle.
  function hasOpenSocket(tenantId, sessionId, role) {
    let found = false;
    wss.clients.forEach(client => {
      if (found) return;
      if (client.readyState !== WebSocket.OPEN) return;
      if (!client.meta) return;
      if (tenantId && client.meta.tenantId !== tenantId) return;
      if (role && client.meta.role !== role) return;
      if (sessionId && client.meta.sessionId !== sessionId) return;
      found = true;
    });
    return found;
  }

  // Branche l'API de présence et démarre le nettoyage périodique offline.
  function attachPresence(presenceApi) {
    presence = presenceApi;
    if (cleanupInterval) clearInterval(cleanupInterval);
    if (presence && typeof presence.markOfflineIfStale === "function") {
      cleanupInterval = setInterval(() => presence.markOfflineIfStale(hasOpenSocket), 5000);
    }
  }

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

    const presenceApi = presence;
    if (!presenceApi) {
      log.warn("WebSocket connection without presence attached");
      return;
    }

    // Vérifie si l'autre rôle de la même session est en ligne.
    function counterpartOnline(sessionId) {
      if (!sessionId || !ws.meta.tenantId) return false;
      const state = presenceApi.getSessionState(ws.meta.tenantId, sessionId);
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
        presenceApi.updatePresence(ws.meta.tenantId, msg.sessionId, ws.meta.role, "online");
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
        const stillConnected = hasOpenSocket(ws.meta.tenantId, ws.meta.sessionId, ws.meta.role);
        if (!stillConnected) {
          presenceApi.updatePresence(ws.meta.tenantId, ws.meta.sessionId, ws.meta.role, "offline");
        }
      }
    });
  });

  return {
    wss,
    broadcastTenant,
    hasOpenSocket,
    attachPresence
  };
}

module.exports = {
  initWebsocket
};
