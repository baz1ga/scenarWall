// ---------------------------------------------
// Stockage local du token / tenant / admin
// ---------------------------------------------

function setToken(token) {
  localStorage.setItem("sc_token", token);
}

function getToken() {
  return localStorage.getItem("sc_token");
}

function clearToken() {
  localStorage.removeItem("sc_token");
}

// ---------------------------------------------
function setTenant(tenantId) {
  localStorage.setItem("sc_tenant", tenantId);
}

function getTenant() {
  return localStorage.getItem("sc_tenant");
}

function clearTenant() {
  localStorage.removeItem("sc_tenant");
}

// ---------------------------------------------
function setAdmin(isAdmin) {
  localStorage.setItem("sc_admin", isAdmin ? "1" : "0");
}

function isAdmin() {
  return localStorage.getItem("sc_admin") === "1";
}

function clearAdmin() {
  localStorage.removeItem("sc_admin");
}

// ---------------------------------------------
// CSRF token (double-submit cookie)
// ---------------------------------------------
function getCsrfToken() {
  const m = document.cookie.split(";").map(s => s.trim()).find(c => c.startsWith("XSRF-TOKEN="));
  if (!m) return null;
  return decodeURIComponent(m.split("=").slice(1).join("="));
}

function withCsrf(headers = {}) {
  const csrf = getCsrfToken();
  return csrf ? { ...headers, "x-csrf-token": csrf } : headers;
}

// ---------------------------------------------
// Display name
// ---------------------------------------------
function setDisplayName(name) {
  if (name) localStorage.setItem("sc_displayName", name);
}

function getDisplayName() {
  return localStorage.getItem("sc_displayName");
}

function clearDisplayName() {
  localStorage.removeItem("sc_displayName");
}

// ---------------------------------------------
// Avatar
// ---------------------------------------------
function setAvatar(url) {
  if (url) localStorage.setItem("sc_avatar", url);
}

function getAvatar() {
  return localStorage.getItem("sc_avatar");
}

function clearAvatar() {
  localStorage.removeItem("sc_avatar");
}

// ---------------------------------------------
// Déconnexion globale
// ---------------------------------------------
function logout() {
  clearToken();
  clearTenant();
  clearAdmin();
  clearDisplayName();
  clearAvatar();
  window.location.href = "/logout";
}
