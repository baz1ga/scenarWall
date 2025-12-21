const fs = require("fs");

// Uniformise le format des runs (legacy ou groupé) en structure groupée par tenant/session.
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

// Aplati la structure groupée pour un accès direct aux runs.
function flattenRuns(groups) {
  const flat = [];
  (groups || []).forEach(t => {
    (t.sessions || []).forEach(s => {
      (s.runs || []).forEach(r => flat.push({ tenantId: t.tenantId, sessionId: s.sessionId, ...r }));
    });
  });
  return flat;
}

// Nettoie l'historique en retirant les runs trop courts (offline/offline sous le seuil).
function pruneShortRunsHistory(groups, minRunDurationMs) {
  // Retire de l'historique les runs terminés en moins de 2 minutes (front + GM offline)
  return (groups || []).map(t => ({
    tenantId: t.tenantId,
    sessions: (t.sessions || []).map(s => {
      const runs = (s.runs || []).filter(r => {
        const duration = (r.updatedAt || r.createdAt || 0) - (r.createdAt || 0);
        const bothOffline = (r.front || "offline") === "offline" && (r.gm || "offline") === "offline";
        if (bothOffline && duration < minRunDurationMs) return false;
        return true;
      });
      return { sessionId: s.sessionId, runs };
    })
  }));
}

// Construit l'API de présence (état en mémoire + persistance disque).
function createPresence({
  sessionStatesFile,
  legacySessionStatesFile,
  logger,
  broadcastTenant,
  presenceTtl = 16000,
  minRunDurationMs = 2 * 60 * 1000
}) {
  const log = logger || { info: () => {}, warn: () => {}, error: () => {} };
  const presenceState = new Map(); // tenantId -> Map(sessionId -> state)
  let sessionRuns = loadSessionStates();

  // Charge les états depuis le disque (avec migration/initialisation).
  function loadSessionStates() {
    if (!fs.existsSync(sessionStatesFile)) {
      // migration depuis l'ancien nom
      if (legacySessionStatesFile && fs.existsSync(legacySessionStatesFile)) {
        try { fs.renameSync(legacySessionStatesFile, sessionStatesFile); } catch {}
      }
      if (!fs.existsSync(sessionStatesFile)) {
        fs.writeFileSync(sessionStatesFile, JSON.stringify([], null, 2));
      }
    }
    try {
      const data = JSON.parse(fs.readFileSync(sessionStatesFile, "utf8")) || [];
      return pruneShortRunsHistory(normalizeSessionRuns(data), minRunDurationMs);
    } catch (err) {
      log.error("Failed to read session-states, reset", { err: err?.message });
      return [];
    }
  }

  // Recharge en mémoire les runs depuis le disque.
  function reloadSessionRuns() {
    sessionRuns = loadSessionStates();
    return sessionRuns;
  }

  // Sauvegarde les runs sur disque.
  function saveSessionStates(states) {
    try {
      fs.writeFileSync(sessionStatesFile, JSON.stringify(states, null, 2));
    } catch (err) {
      log.error("Failed to write session-states", { err: err?.message });
    }
  }

  // Retourne l'état des runs sous forme aplatie.
  function presenceStateToArray() {
    return flattenRuns(sessionRuns);
  }

  // Garantit l'existence d'une entrée tenant/session en mémoire.
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

  // Récrée le fichier si supprimé pendant le run du serveur.
  function ensureSessionRunsFile() {
    // Si le fichier a été supprimé manuellement pendant que le serveur tourne, on remet l'état en mémoire à zéro
    if (!fs.existsSync(sessionStatesFile)) {
      sessionRuns = [];
      fs.writeFileSync(sessionStatesFile, JSON.stringify([], null, 2));
    }
  }

  // Ajoute un nouveau run pour une session donnée.
  function appendSessionRun(tenantId, sessionId, data = {}) {
    if (!tenantId || !sessionId) return null;
    // recharge depuis le disque au cas où le fichier aurait été vidé manuellement
    sessionRuns = loadSessionStates();
    ensureSessionRunsFile();
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

  // Met à jour le dernier run (sans en créer un nouveau).
  function updateLatestRun(tenantId, sessionId, patch = {}) {
    // recharge depuis le disque au cas où le fichier aurait été vidé manuellement
    sessionRuns = loadSessionStates();
    ensureSessionRunsFile();
    const session = ensureTenantSession(tenantId, sessionId);
    if (!session.runs || !session.runs.length) {
      // on ne crée pas de run ici : il doit être explicitement démarré via /session-runs
      return null;
    }
    const run = session.runs[session.runs.length - 1];
    Object.assign(run, patch);
    run.updatedAt = patch.updatedAt || Date.now();
    if (run.front === "offline" && run.gm === "offline") {
      const duration = (run.updatedAt || Date.now()) - (run.createdAt || run.updatedAt || Date.now());
      // On ne conserve pas en historique les runs de moins de 2 minutes
      if (duration < minRunDurationMs) {
        session.runs.pop();
        saveSessionStates(sessionRuns);
        return null;
      }
    }
    saveSessionStates(sessionRuns);
    return run;
  }

  // Récupère le dernier run d'une session.
  function getLastRun(tenantId, sessionId) {
    const session = ensureTenantSession(tenantId, sessionId);
    if (!session.runs || !session.runs.length) return null;
    return session.runs[session.runs.length - 1];
  }

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

  // Donne l'état de présence en mémoire pour une session (créé au besoin).
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

  // Notifie les clients d'un tenant d'un changement de présence.
  function emitPresenceUpdate(tenantId, sessionId, state) {
    if (!broadcastTenant || !tenantId || !sessionId) return;
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
  }

  // Met à jour l'état de présence (front/gm) et persiste le run courant.
  function updatePresence(tenantId, sessionId, role, status) {
    const state = getSessionState(tenantId, sessionId);
    if (!state) return;
    const prevFront = state.front;
    const prevGm = state.gm;
    if (role === "front") {
      state.front = status;
      state.lastFrontPing = status === "online" ? Date.now() : state.lastFrontPing || Date.now();
    }
    if (role === "gm") {
      state.gm = status;
      state.lastGmPing = status === "online" ? Date.now() : state.lastGmPing || Date.now();
    }
    state.updatedAt = Date.now();

    emitPresenceUpdate(tenantId, sessionId, state);
    updateLatestRun(tenantId, sessionId, {
      front: state.front,
      gm: state.gm,
      lastFrontPing: state.lastFrontPing,
      lastGmPing: state.lastGmPing,
      updatedAt: state.updatedAt
    });
  }

  // Force offline si les heartbeats ou sockets sont absents au-delà du TTL.
  function markOfflineIfStale(hasOpenSocket, now = Date.now()) {
    presenceState.forEach((sessions, tenantId) => {
      sessions.forEach((state, sessionId) => {
        let changed = false;
        const hasFrontSocket = typeof hasOpenSocket === "function" ? hasOpenSocket(tenantId, sessionId, "front") : false;
        const hasGmSocket = typeof hasOpenSocket === "function" ? hasOpenSocket(tenantId, sessionId, "gm") : false;
        if (state.front === "online" && (!state.lastFrontPing || now - state.lastFrontPing > presenceTtl)) {
          state.front = "offline";
          changed = true;
        }
        const gmHeartbeatStale = state.gm === "online" && (!state.lastGmPing || now - state.lastGmPing > presenceTtl);
        // Tant que le front est online, on garde le GM en vie même si son heartbeat est en retard
        if (gmHeartbeatStale && state.front !== "online") {
          state.gm = "offline";
          changed = true;
        }
        // Si un rôle est déclaré online mais qu'aucune socket n'est ouverte pour ce rôle/session, force offline après le TTL
        if (state.front === "online" && !hasFrontSocket && now - (state.updatedAt || state.createdAt || 0) > presenceTtl) {
          state.front = "offline";
          changed = true;
        }
        if (state.gm === "online" && !hasGmSocket && state.front !== "online" && now - (state.updatedAt || state.createdAt || 0) > presenceTtl) {
          state.gm = "offline";
          changed = true;
        }
        if (changed) {
          state.updatedAt = Date.now();
          emitPresenceUpdate(tenantId, sessionId, state);
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

  return {
    presenceStateToArray,
    reloadSessionRuns,
    appendSessionRun,
    updateLatestRun,
    getLastRun,
    getSessionState,
    updatePresence,
    markOfflineIfStale,
    presenceState
  };
}

module.exports = {
  createPresence,
  normalizeSessionRuns,
  flattenRuns
};
