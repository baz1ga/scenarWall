// Configuration centralisée de l'API.
// - Peut être surchargée via window.SCENARWALL_API_BASE avant chargement de ce script.
// - Si servi via HTTP(S), utilise automatiquement l'origine courante.
// - En local (file://), retombe sur http://localhost:3100.
(function initApiBase() {
  const isHttp = location.protocol === "http:" || location.protocol === "https:";
  const fallback = isHttp ? location.origin : "http://localhost:3100";
  const explicit = window.SCENARWALL_API_BASE;

  window.API_BASE = explicit || fallback;
})();

function getApiBase() {
  return window.API_BASE;
}
