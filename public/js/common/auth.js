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
// Déconnexion globale
// ---------------------------------------------
function logout() {
  clearToken();
  clearTenant();
  clearAdmin();
  window.location.href = "/login.html";
}
