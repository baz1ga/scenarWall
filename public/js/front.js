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

function applyTensionState(enabled) {
  const bar = document.querySelector(".tension-bar");

  if (!bar) return;

  if (enabled) {
    bar.classList.add("enabled");
    setDefaultTension();
  } else {
    bar.classList.remove("enabled");
    clearTension();
  }
}

items.forEach(item => {
  item.addEventListener("click", () => {
    if (!tensionEnabled) return;
    items.forEach(i => i.classList.remove("selected"));
    item.classList.add("selected");
    zone1.style.borderColor = item.dataset.color;
  });
});

async function loadTensionConfig() {
  try {
    const res = await fetch(`/t/${TENANT}/api/config`);
    if (!res.ok) throw new Error("Config fetch failed");
    const data = await res.json();
    applyTensionState(data.tensionEnabled);
  } catch (err) {
    console.warn("Using default tension config", err);
    applyTensionState(true);
  }
}

// ---------------------------------------------------------
// INIT
// ---------------------------------------------------------
loadTensionConfig().then(loadCarouselImages);