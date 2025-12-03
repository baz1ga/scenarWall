// Configuration centralisée de l'API.
// - Peut être surchargée via window.SCENARWALL_API_BASE avant chargement de ce script.
// - Si servi via HTTP(S), utilise automatiquement l'origine courante.
// - En local (file://), retombe sur http://localhost:3100.
window.API_READY = (async function initApiBase() {
  const isHttp = location.protocol === "http:" || location.protocol === "https:";
  const fallback = isHttp ? location.origin : "http://localhost:3100";
  const explicit = window.SCENARWALL_API_BASE;
  window.API_BASE = explicit || fallback;

  try {
    const res = await fetch("/api/global-config", { cache: "no-cache" });
    if (res.ok) {
      const data = await res.json();
      if (data.apiBase) {
        window.API_BASE = data.apiBase;
      }
      window.PIXABAY_KEY = data.pixabayKey || null;
    }
  } catch (err) {
    console.warn("Impossible de charger la config globale, fallback utilisé", err);
  }
})();

function getApiBase() {
  return window.API_BASE;
}
