/*************************************************
 * SCENARWALL – tenant-front.js
 * Front public tenant-aware (1 seul front.html)
 *************************************************/

// ---------------------------------------------
// 1. Vérification du TENANT_ID
// ---------------------------------------------
if (!window.TENANT_ID) {
  console.error("❌ TENANT_ID manquant dans front.html");
}

// ---------------------------------------------
// 2. CONFIG API
// ---------------------------------------------
const TENANT = window.TENANT_ID;
const API_IMAGES = `/t/${TENANT}/api/images`;

let carouselImages = [];
let carouselIndex = 0;

const zone1Img = document.getElementById("zone1-img");
const photoNumber = document.getElementById("photo-number");
const zone1 = document.getElementById("zone1");

// ---------------------------------------------
// 3. Sons (optionnels)
// ---------------------------------------------
const sounds = {
  green: document.getElementById("sound-green"),
  yellow: document.getElementById("sound-yellow"),
  orange: document.getElementById("sound-orange"),
  red: document.getElementById("sound-red"),
  black: document.getElementById("sound-black")
};

// ---------------------------------------------
// 4. Charger les images du tenant
// ---------------------------------------------
async function loadCarouselImages() {
  try {
    const res = await fetch(API_IMAGES);
    const data = await res.json();

    carouselImages = data.map(img => img.url);

    if (carouselImages.length === 0) {
      zone1Img.src = "";
      photoNumber.textContent = "—";
      return;
    }

    carouselIndex = 0;
    updateCarousel();
  } catch (err) {
    console.error("❌ Erreur de chargement des images :", err);
  }
}

// ---------------------------------------------
// 5. Mettre à jour l’image affichée
// ---------------------------------------------
function updateCarousel() {
  zone1Img.src = carouselImages[carouselIndex];
  photoNumber.textContent = carouselIndex + 1;
}

// ---------------------------------------------
// 6. Boutons gauche / droite
// ---------------------------------------------
document.getElementById("carousel-prev").addEventListener("click", () => {
  if (carouselImages.length === 0) return;
  carouselIndex = (carouselIndex - 1 + carouselImages.length) % carouselImages.length;
  updateCarousel();
});

document.getElementById("carousel-next").addEventListener("click", () => {
  if (carouselImages.length === 0) return;
  carouselIndex = (carouselIndex + 1) % carouselImages.length;
  updateCarousel();
});

// ---------------------------------------------
// 7. Barre de tension
// ---------------------------------------------
const items = document.querySelectorAll(".tension-item");
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
  tensionEnabled = enabled !== false;
  if (tensionBar) tensionBar.classList.toggle("disabled", !tensionEnabled);
  if (tensionEnabled) {
    setDefaultTension();
  } else {
    clearTension();
  }
}

items.forEach(item => {
  item.addEventListener("click", () => {
    if (!tensionEnabled) return;

    // reset visuel
    items.forEach(i => i.classList.remove("selected"));
    item.classList.add("selected");

    // couleur bordure
    const color = item.dataset.color;
    zone1.style.borderColor = color;

    // trouver le nom de couleur
    const colorName = Array.from(item.classList).find(c =>
      ["green", "yellow", "orange", "red", "black"].includes(c)
    );

    // stoppe tous les sons
    Object.values(sounds).forEach(s => {
      if (s) {
        s.pause();
        s.currentTime = 0;
      }
    });

    // jouer un son (optionnel)
    // if (sounds[colorName]) sounds[colorName].play();
  });
});

// ---------------------------------------------
// 8. Init tension
// ---------------------------------------------
async function initTension() {
  try {
    const res = await fetch(`/t/${TENANT}/api/config`);
    if (!res.ok) throw new Error("Config fetch failed");
    const config = await res.json();
    applyTensionState(config.tensionEnabled);
  } catch (err) {
    console.warn("Using default tension config", err);
    applyTensionState(true);
  }
}

// ---------------------------------------------
// 9. INITIALISATION DU FRONT
// ---------------------------------------------
initTension();
loadCarouselImages();
