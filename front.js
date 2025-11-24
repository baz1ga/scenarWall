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

items.forEach(item => {
  item.addEventListener("click", () => {
    items.forEach(i => i.classList.remove("selected"));
    item.classList.add("selected");
    zone1.style.borderColor = item.dataset.color;
  });
});

// état par défaut : vert
(function initTension() {
  items[0].classList.add("selected");
  zone1.style.borderColor = items[0].dataset.color;
})();

// ---------------------------------------------------------
// INIT
// ---------------------------------------------------------
loadCarouselImages();