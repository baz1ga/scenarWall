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

// ---------------------------------------------------------
//  CARROUSEL
// ---------------------------------------------------------
let carouselImages = [];
let carouselIndex = 0;

const zone1Img = document.getElementById("zone1-img");
const photoNumber = document.getElementById("photo-number");

// ---------------------------------------------------------
//  CHARGEMENT DES IMAGES
// ---------------------------------------------------------
async function loadCarouselImages() {

  try {
    const res = await fetch(API_IMAGES);
    const data = await res.json();

    // data = liste des images visibles déjà filtrées côté serveur
    carouselImages = data.map(img => img.url);

    if (carouselImages.length === 0) {
      zone1Img.src = "";
      photoNumber.textContent = "—";
      return;
    }

    carouselIndex = 0;
    updateCarousel();

  } catch (err) {
    console.error("❌ Erreur chargement images :", err);
  }
}

function updateCarousel() {
  zone1Img.src = carouselImages[carouselIndex];
  photoNumber.textContent = carouselIndex + 1;
}

// ---------------------------------------------------------
//  FLECHES ← →
// ---------------------------------------------------------
document.getElementById("carousel-prev").onclick = () => {
  if (!carouselImages.length) return;
  carouselIndex = (carouselIndex - 1 + carouselImages.length) % carouselImages.length;
  updateCarousel();
};

document.getElementById("carousel-next").onclick = () => {
  if (!carouselImages.length) return;
  carouselIndex = (carouselIndex + 1) % carouselImages.length;
  updateCarousel();
};

// ---------------------------------------------------------
//  BARRE DE TENSION
// ---------------------------------------------------------
const items = document.querySelectorAll(".tension-item");
const zone1 = document.getElementById("zone1");
const tensionBar = document.querySelector(".tension-bar");
let tensionEnabled = true;
let tensionFont = "Audiowide";
let gmControlled = true;
let tensionSocket = null;
let tensionSocketTimer = null;
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
    setGmControlled(true);
    if (tensionSocketTimer) {
      clearTimeout(tensionSocketTimer);
      tensionSocketTimer = null;
    }
  };
  ws.onclose = () => {
    tensionSocketTimer = setTimeout(setupTensionSocket, 2000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data || "{}");
      if (data.type === "tension:update" && data.level) {
        selectTensionLevel(data.level);
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

function playTensionAudio(level) {
  const name = tensionAudio[level];
  if (!name) return;
  const url = `/t/${TENANT}/audio/${encodeURIComponent(name)}`;
  if (!audioPlayer) {
    audioPlayer = new Audio();
  }
  audioPlayer.pause();
  audioPlayer.src = url;
  audioPlayer.currentTime = 0;
  audioPlayer.play().catch(() => {});
}

// ---------------------------------------------------------
// INIT
// ---------------------------------------------------------
setGmControlled(true);
loadTensionConfig().then(() => {
  setupTensionSocket();
  loadCarouselImages();
});
