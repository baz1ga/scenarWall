/*************************************************
 * SCENARWALL – front.js (Front public tenantisé)
 *************************************************/

// ---------------------------------------------------------
//  TENANT ID extrait depuis l’URL /t/<id>/front
// ---------------------------------------------------------
const TENANT = (() => {
  const match = window.location.pathname.match(/\/t\/([^/]+)\/front/);
  if (!match) {
    console.error("❌ Tenant ID introuvable dans l'URL !");
    return null;
  }
  return match[1];
})();

if (!TENANT) {
  document.body.innerHTML = "<h2 style='color:white;text-align:center;margin-top:50px;'>Erreur tenant</h2>";
  throw new Error("Missing TENANT_ID");
}

// API publique tenantisée
const API_IMAGES = `/t/${TENANT}/api/images`;

const zone1Img = document.getElementById("zone1-img");
const photoNumber = document.getElementById("photo-number");
const photoLoader = document.getElementById("photo-loader");
const photoWrapper = document.getElementById("photo-wrapper");

function showPhotoLoader(show) {
  if (!photoLoader || !photoWrapper) return;
  photoLoader.classList.toggle("hidden", !show);
  photoWrapper.classList.toggle("opacity-50", show);
}

async function loadInitialImage() {
  try {
    showPhotoLoader(true);
    const res = await fetch(API_IMAGES);
    const data = await res.json();
    // data = liste des images visibles déjà filtrées côté serveur
    const fallback = data && data.length ? data[0] : null;
    if (pendingSlideName) {
      const found = (data || []).find(img => img.name === pendingSlideName);
      applySlide(found);
      pendingSlideName = null;
    } else {
      applySlide(fallback);
    }
  } catch (err) {
    console.error("❌ Erreur chargement images :", err);
  } finally {
    showPhotoLoader(false);
  }
}

function applySlide(img) {
  if (!img || !img.url) {
    showPhotoLoader(false);
    return;
  }
  showPhotoLoader(true);
  zone1Img.src = img.url;
  photoNumber.textContent = img.name || "—";
  zone1Img.onload = () => showPhotoLoader(false);
}

// ---------------------------------------------------------
//  BARRE DE TENSION
// ---------------------------------------------------------
const items = document.querySelectorAll(".tension-item");
const zone1 = document.getElementById("zone1");
const tensionBar = document.querySelector(".tension-bar");
const SESSION_ID = new URLSearchParams(window.location.search).get("session") || null;
let tensionEnabled = true;
let tensionFont = "Audiowide";
let gmControlled = true;
let slideshowControlled = false;
let tensionSocket = null;
let tensionSocketTimer = null;
let presencePing = null;
let gmOnline = false;
let gmWarningTimer = null;
const gmOfflineBanner = document.getElementById("gm-offline-banner");

const defaultZoneBorder = { top: "13px", right: "30px", bottom: "13px", left: "30px" };
const defaultTensionColors = {
  level1: "#37aa32",
  level2: "#f8d718",
  level3: "#f39100",
  level4: "#e63027",
  level5: "#3a3a39"
};
const defaultTensionLabels = {
  level1: "0",
  level2: "-5",
  level3: "+5",
  level4: "+10",
  level5: "+15"
};
let tensionAudio = {
  level1: null,
  level2: null,
  level3: null,
  level4: null,
  level5: null
};
let audioPlayer = null;
let hourglass = null;
const hourglassTimeEl = document.getElementById("hourglass-time");
let hourglassVisible = false;
let hourglassShowTimer = false;
let configRequestRetries = 0;
let pendingSlideName = null;

function readableTextColor(bgColor) {
  const match = (bgColor || "").match(/(\d+)\D+(\d+)\D+(\d+)/);
  const r = match ? parseInt(match[1], 10) : 0;
  const g = match ? parseInt(match[2], 10) : 0;
  const b = match ? parseInt(match[3], 10) : 0;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? "#000" : "#fff";
}

function updateTensionTextContrast() {
  if (!items || !items.length) return;
  items.forEach((item) => {
    const bg = getComputedStyle(item).backgroundColor;
    item.style.color = readableTextColor(bg);
  });
}

function updateZoneBorderFromSelection() {
  if (!zone1 || !items.length || !tensionEnabled) return;
  const selected = Array.from(items).find((i) => i.classList.contains("selected"));
  const color = (selected || items[0]).dataset.color;
  if (color) zone1.style.borderColor = color;
}

function applyTensionColors(colors) {
  const palette = { ...defaultTensionColors, ...(colors || {}) };
  const values = [palette.level1, palette.level2, palette.level3, palette.level4, palette.level5];
  items.forEach((item, idx) => {
    const color = values[idx] || defaultTensionColors[`level${idx + 1}`];
    item.style.backgroundColor = color;
    item.dataset.color = color;
  });
  updateTensionTextContrast();
  updateZoneBorderFromSelection();
}

function applyTensionLabels(labels) {
  const values = { ...defaultTensionLabels, ...(labels || {}) };
  items.forEach((item, idx) => {
    const label = values[`level${idx + 1}`] || defaultTensionLabels[`level${idx + 1}`];
    item.textContent = label;
  });
}

function setDefaultTension() {
  if (!items.length) return;
  items.forEach(i => i.classList.remove("selected"));
  items[0].classList.add("selected");
  zone1.style.borderColor = items[0].dataset.color;
}

function clearTension() {
  items.forEach(i => i.classList.remove("selected"));
  zone1.style.borderColor = "transparent";
}

function setZoneBorder(enabled) {
  if (!zone1) return;
  if (enabled) {
    zone1.style.borderTopWidth = defaultZoneBorder.top;
    zone1.style.borderRightWidth = defaultZoneBorder.right;
    zone1.style.borderBottomWidth = defaultZoneBorder.bottom;
    zone1.style.borderLeftWidth = defaultZoneBorder.left;
  } else {
    zone1.style.borderTopWidth = "0";
    zone1.style.borderRightWidth = "0";
    zone1.style.borderBottomWidth = "0";
    zone1.style.borderLeftWidth = "0";
  }
}

function applyTensionState(enabled) {
  const bar = document.querySelector(".tension-bar");

  if (!bar) return;

  if (enabled) {
    bar.classList.add("enabled");
    setZoneBorder(true);
    setDefaultTension();
  } else {
    bar.classList.remove("enabled");
    clearTension();
    setZoneBorder(false);
  }
}

function applyTensionFont(fontName) {
  tensionFont = fontName || "Audiowide";
  if (!tensionBar) return;
  tensionBar.style.fontFamily = `"${tensionFont}", sans-serif`;
}

items.forEach(item => {
  item.addEventListener("click", () => {
    if (!tensionEnabled || gmControlled) return;
    items.forEach(i => i.classList.remove("selected"));
    item.classList.add("selected");
    zone1.style.borderColor = item.dataset.color;
    const level = item.dataset.level;
    if (level) playTensionAudio(level);
  });
});

function setGmControlled(state) {
  gmControlled = !!state;
  if (tensionBar) {
    tensionBar.classList.toggle("gm-controlled", gmControlled);
  }
  items.forEach(i => {
    i.style.pointerEvents = gmControlled ? "none" : "auto";
  });
}

function selectTensionLevel(level) {
  if (!items.length || !tensionEnabled) return;
  const target = Array.from(items).find(i => i.dataset.level === level) || items[0];
  items.forEach(i => i.classList.remove("selected"));
  target.classList.add("selected");
  zone1.style.borderColor = target.dataset.color;
  playTensionAudio(target.dataset.level);
}

function setSlideByName(name) {
  if (!name) return;
  pendingSlideName = name;
  // charge l'image demandée directement depuis l'API
  fetch(API_IMAGES)
    .then(res => res.json())
    .then(data => {
      const found = Array.isArray(data) ? data.find(img => img.name === name) : null;
      if (found) applySlide(found);
    })
    .catch(() => {});
}

function setupTensionSocket() {
  if (!TENANT) return;
  if (tensionSocket) {
    tensionSocket.close();
    tensionSocket = null;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws?tenantId=${encodeURIComponent(TENANT)}&role=front`);
  tensionSocket = ws;
  ws.onopen = () => {
    console.log("[Front][WS] open");
    setGmControlled(true);
    slideshowControlled = true;
    ws.send(JSON.stringify({ type: "presence:hello", sessionId: SESSION_ID || null }));
    presencePing = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "presence:hello", sessionId: SESSION_ID || null }));
      }
    }, 8000);
    // demande la config tension et l'index du diaporama de la session courante au GM
    ws.send(JSON.stringify({ type: "tension:request", sessionId: SESSION_ID || null }));
    ws.send(JSON.stringify({ type: "slideshow:request", sessionId: SESSION_ID || null }));
    if (tensionSocketTimer) {
      clearTimeout(tensionSocketTimer);
      tensionSocketTimer = null;
    };
  };
  ws.onclose = () => {
    console.log("[Front][WS] close");
    slideshowControlled = false;
    gmOnline = false;
    if (presencePing) {
      clearInterval(presencePing);
      presencePing = null;
    }
    tensionSocketTimer = setTimeout(setupTensionSocket, 2000);;
  };
  ws.onerror = (err) => {
    console.warn("[Front][WS] error", err);
    ws.close();
  };
  ws.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data || "{}");
      // si un id de session est fourni, ne traiter que la session demandée en paramètre d'URL
      if (data.sessionId && SESSION_ID && data.sessionId !== SESSION_ID) {
        return;
      }
      console.log("[Front][WS] message", data);
      if (data.type === "presence:update") {
        gmOnline = data.gm === "online";
        handleGmOnlineChange(gmOnline);
      }
      if (data.type === "tension:update" && data.level) {
        selectTensionLevel(data.level);
      }
      if (data.type === "tension:config" && data.config) {        
        applyTensionState(data.config.tensionEnabled);
        applyTensionFont(data.config.tensionFont);
        applyTensionColors(data.config.tensionColors);
        applyTensionLabels(data.config.tensionLabels);
        tensionAudio = { ...tensionAudio, ...(data.config.tensionAudio || {}) };
        configRequestRetries = 0;
      }
      if (data.type === "slideshow:update" && data.name) {
        slideshowControlled = true;
        setSlideByName(data.name);
        configRequestRetries = 0;
        console.log("[Front][Slideshow] applied", { name: data.name });
      }
      if (data.type === "hourglass:command" && data.action) {
        applyHourglassCommand(data);
      }
    } catch (e) {
      // ignore parse errors
    }
  };
}

async function loadTensionConfig() {
  try {
    const res = await fetch(`/t/${TENANT}/api/config`);
    if (!res.ok) throw new Error("Config fetch failed");
    const data = await res.json();
    applyTensionState(data.tensionEnabled);
    applyTensionFont(data.tensionFont);
    applyTensionColors(data.tensionColors);
    applyTensionLabels(data.tensionLabels);
    tensionAudio = { ...tensionAudio, ...(data.tensionAudio || {}) };
  } catch (err) {
    console.warn("Using default tension config", err);
    applyTensionState(true);
    applyTensionFont("Audiowide");
    applyTensionColors(defaultTensionColors);
    applyTensionLabels(defaultTensionLabels);
  }
}

async function loadSessionConfig() {
  if (!SESSION_ID) return;
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(TENANT)}/sessions/${encodeURIComponent(SESSION_ID)}`);
    if (!res.ok) throw new Error("Session fetch failed");
    const data = await res.json();
    applyTensionState(data.tensionEnabled);
    applyTensionFont(data.tensionFont);
    applyTensionColors(data.tensionColors);
    applyTensionLabels(data.tensionLabels);
    tensionAudio = { ...tensionAudio, ...(data.tensionAudio || {}) };
  } catch (err) {
    console.warn("Front session tension config unavailable", err);
  }
}

function playTensionAudio(level) {
  // Lecture audio désactivée côté front
}

// ---------------------------------------------------------
// SABLIER
// ---------------------------------------------------------
function initHourglass() {
  const wrapper = document.querySelector("#hourglass-shell .hourglass-wrapper");
  if (!wrapper || !window.PixelHourglass) return;
  hourglass = new window.PixelHourglass(wrapper, { durationSeconds: 60, fillPercent: 97 });
  updateHourglassTime();
  setInterval(updateHourglassTime, 500);
  setHourglassVisibility(hourglassVisible);
  setHourglassTimerVisibility(hourglassShowTimer);
}

function updateHourglassTime() {
  if (!hourglass || !hourglassTimeEl) return;
  const remaining = Math.max(0, Math.ceil(hourglass.durationSeconds - (hourglass.elapsedMs / 1000)));
  hourglassTimeEl.textContent = `${remaining}s`;
}

function setHourglassVisibility(visible) {
  hourglassVisible = visible !== false;
  const container = document.getElementById("hourglass");
  if (container) {
    container.style.display = hourglassVisible ? "flex" : "none";
  }
  // Hide timer when hourglass hidden
  if (!hourglassVisible) {
    setHourglassTimerVisibility(false);
  } else {
    setHourglassTimerVisibility(hourglassShowTimer);
  }
}

function setHourglassTimerVisibility(show) {
  hourglassShowTimer = !!show;
  if (hourglassTimeEl) {
    hourglassTimeEl.style.display = hourglassShowTimer ? "block" : "none";
  }
}

function applyHourglassCommand(cmd) {
  if (!hourglass) return;
  const duration = Number(cmd.durationSeconds);
  const hasDuration = Number.isFinite(duration) && duration > 0;
  if (cmd.action === "flip") {
    hourglass.flip(hasDuration ? { durationSeconds: duration } : {});
  } else if (cmd.action === "reset") {
    hourglass.reset(hasDuration ? { durationSeconds: duration } : {});
  } else if (cmd.action === "play") {
    if (hasDuration) hourglass.reset({ durationSeconds: duration });
    hourglass.play();
  } else if (cmd.action === "setDuration") {
    hourglass.reset(hasDuration ? { durationSeconds: duration } : {});
  } else if (cmd.action === "visibility") {
    if (cmd.visible !== false && typeof cmd.show === "boolean") {
      setHourglassTimerVisibility(cmd.show);
    }
    setHourglassVisibility(cmd.visible !== false);
  } else if (cmd.action === "showTimer") {
    setHourglassTimerVisibility(cmd.show !== false);
  }
  updateHourglassTime();
}

function requestRemoteConfig() {
  if (tensionSocket && tensionSocket.readyState === WebSocket.OPEN) {
    tensionSocket.send(JSON.stringify({ type: "tension:request", sessionId: SESSION_ID || null }));
    tensionSocket.send(JSON.stringify({ type: "slideshow:request", sessionId: SESSION_ID || null }));
    configRequestRetries = 0;
    return;
  }
  if (configRequestRetries < 5) {
    configRequestRetries += 1;
    setTimeout(requestRemoteConfig, 800);
  }
}

// ---------------------------------------------------------
// INIT
// ---------------------------------------------------------
setGmControlled(true);
loadTensionConfig()
  .then(() => loadSessionConfig())
  .finally(() => {
    setupTensionSocket();
    loadInitialImage();
    initHourglass();
    requestRemoteConfig();
    handleGmOnlineChange(false);
  });

function handleGmOnlineChange(isOnline) {
  if (gmWarningTimer) {
    clearTimeout(gmWarningTimer);
    gmWarningTimer = null;
  }
  if (isOnline) {
    if (gmOfflineBanner) gmOfflineBanner.classList.add("hidden");
    return;
  }
  gmWarningTimer = setTimeout(() => {
    if (gmOfflineBanner) gmOfflineBanner.classList.remove("hidden");
    if (zone1Img) zone1Img.src = "";
    photoNumber.textContent = "";
    items.forEach(i => i.classList.remove("selected"));
  }, 5000);
}
