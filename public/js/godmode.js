// =============================================
// 🌐 CONFIG API
// =============================================
const API = getApiBase();
let AUTH_HEADERS = {};

// DOM refs pour le changement de mot de passe
let currentPwdInput;
let newPwdInput;
let confirmPwdInput;
let pwdMessage;
let globalQuotaInput;
let globalQuotaMessage;
const SORT_DEFAULT = { key: "email", dir: "asc" };
let usersCache = [];
let userSort = { ...SORT_DEFAULT };
let quotaSort = { ...SORT_DEFAULT };
// =============================================
// 🔐 Vérification Admin + Chargement
// =============================================
document.addEventListener("DOMContentLoaded", () => {
  const token = getToken();
  if (!token || !isAdmin()) {
    window.location.href = "/login.html";
    return;
  }

  AUTH_HEADERS = {
    Authorization: "Bearer " + token
  };

  currentPwdInput = document.getElementById("currentPassword");
  newPwdInput = document.getElementById("newPassword");
  confirmPwdInput = document.getElementById("confirmPassword");
  pwdMessage = document.getElementById("pwdMessage");
  globalQuotaInput = document.getElementById("globalQuotaInput");
  globalQuotaMessage = document.getElementById("globalQuotaMessage");
  const filterInactiveCheckbox = document.getElementById("filterInactiveQuota");
  const filterInactiveUsersCheckbox = document.getElementById("filterInactiveUsers");

  if (filterInactiveCheckbox) {
    filterInactiveCheckbox.addEventListener("change", renderTables);
  }
  if (filterInactiveUsersCheckbox) {
    filterInactiveUsersCheckbox.addEventListener("change", renderTables);
  }

  document.querySelectorAll("th[data-sort-users]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sortUsers;
      userSort = computeNextSort(userSort, key);
      renderTables();
    });
  });

  document.querySelectorAll("th[data-sort-quota]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sortQuota;
      quotaSort = computeNextSort(quotaSort, key);
      renderTables();
    });
  });

  loadUsers();
  loadGlobalQuota();
});

function computeNextSort(current, key) {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: "asc" };
}

function updateSortIndicators() {
  document.querySelectorAll("th[data-sort-users]").forEach(th => {
    th.removeAttribute("data-sort-dir");
    if (th.dataset.sortUsers === userSort.key) {
      th.setAttribute("data-sort-dir", userSort.dir);
    }
  });
  document.querySelectorAll("th[data-sort-quota]").forEach(th => {
    th.removeAttribute("data-sort-dir");
    if (th.dataset.sortQuota === quotaSort.key) {
      th.setAttribute("data-sort-dir", quotaSort.dir);
    }
  });
}

function getUsageData(u) {
  const usageMB = u.quotaUsedBytes ? (u.quotaUsedBytes / 1024 / 1024) : 0;
  const quotaMB = u.quotaMB || 0;
  const percent = quotaMB > 0 ? Math.min(100, (usageMB / quotaMB) * 100) : 0;
  const quotaText = quotaMB
    ? `${usageMB.toFixed(2)} / ${quotaMB} Mo${u.quotaOverride ? " (perso)" : ""}`
    : `${usageMB.toFixed(2)} Mo (quota non défini)`;

  return { usageMB, quotaMB, percent, quotaText };
}

function getSortValue(u, key) {
  const { usageMB } = getUsageData(u);
  switch (key) {
    case "email":
      return (u.email || "").toLowerCase();
    case "images":
      return u.imageCount || 0;
    case "usage":
      return usageMB;
    case "lastLogin":
      return u.lastLogin ? new Date(u.lastLogin).getTime() : 0;
    case "active":
      return u.disabled ? 0 : 1;
    default:
      return 0;
  }
}

function sortUsers(list, sortConf) {
  if (!sortConf.key) return [...list];
  const factor = sortConf.dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = getSortValue(a, sortConf.key);
    const vb = getSortValue(b, sortConf.key);
    if (va < vb) return -1 * factor;
    if (va > vb) return 1 * factor;
    return 0;
  });
}

function renderTables() {
  renderUsersTable();
  renderQuotaTable();
  updateSortIndicators();
}

function renderUsersTable() {
  const tbody = document.getElementById("user-table");
  const filterInactiveUsersCheckbox = document.getElementById("filterInactiveUsers");
  const hideInactiveInUsers = filterInactiveUsersCheckbox ? filterInactiveUsersCheckbox.checked : false;
  if (!tbody) return;

  tbody.innerHTML = "";
  const list = sortUsers(usersCache, userSort);

  if (!list.length) {
    tbody.innerHTML = "<tr><td colspan='7'>Aucun utilisateur</td></tr>";
    return;
  }

  list.forEach(u => {
    if (hideInactiveInUsers && u.disabled) return;
    const isSuperAdmin = u.admin === true;
    const { usageMB, quotaMB, percent, quotaText } = getUsageData(u);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${isSuperAdmin ? "👑 " : ""}${u.email}</td>
      <td>${u.tenantId || "—"}</td>
      <td>${u.imageCount}</td>
      <td>
        <div class="progress" title="${quotaMB ? `${usageMB.toFixed(2)} / ${quotaMB} Mo (${percent.toFixed(1)}%)` : `${usageMB.toFixed(2)} Mo (quota non défini)`}">
          <div class="progress-bar" style="width:${percent}%;"></div>
        </div>
        <div class="quota-label">${quotaText}</div>
      </td>
      <td>${u.lastLogin ? new Date(u.lastLogin).toLocaleString("fr-FR") : "—"}</td>
      <td>${u.disabled ? "🚫 Désactivé" : "✅ Actif"}</td>
      <td>
        ${
          isSuperAdmin
            ? "<span style='opacity:0.4'>—</span>"
            : `
              <button class="btn" onclick="toggle('${u.email}')">
                ${u.disabled ? "Activer" : "Désactiver"}
              </button>
              <button class="btn danger" onclick="deleteUser('${u.email}')">
                ❌ Supprimer
              </button>
            `
        }
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderQuotaTable() {
  const quotaBody = document.getElementById("quota-user-table");
  const filterInactiveCheckbox = document.getElementById("filterInactiveQuota");
  const hideInactiveInQuota = filterInactiveCheckbox ? filterInactiveCheckbox.checked : false;
  if (!quotaBody) return;

  quotaBody.innerHTML = "";
  const list = sortUsers(usersCache.filter(u => !u.admin), quotaSort);

  if (!list.length) {
    quotaBody.innerHTML = "<tr><td colspan='4'>Aucun utilisateur</td></tr>";
    return;
  }

  list.forEach(u => {
    if (hideInactiveInQuota && u.disabled) return;
    const { usageMB, quotaMB, percent, quotaText } = getUsageData(u);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.email}</td>
      <td>
        <div class="progress" title="${quotaMB ? `${usageMB.toFixed(2)} / ${quotaMB} Mo (${percent.toFixed(1)}%)` : `${usageMB.toFixed(2)} Mo (quota non défini)`}">
          <div class="progress-bar" style="width:${percent}%;"></div>
        </div>
        <div class="quota-label">${quotaText}</div>
      </td>
      <td>${u.disabled ? "🚫 Désactivé" : "✅ Actif"}</td>
      <td>
        <button class="btn" onclick="editTenantQuota('${u.tenantId || ""}', ${u.quotaOverride ? "true" : "false"}, ${u.quotaMB || 0})">Modifier quota</button>
      </td>
    `;
    quotaBody.appendChild(tr);
  });
}

// =============================================
// 🔄 LOAD USERS
// =============================================
async function loadUsers() {
  const tbody = document.getElementById("user-table");
  const quotaBody = document.getElementById("quota-user-table");
  const filterInactiveCheckbox = document.getElementById("filterInactiveQuota");
  const filterInactiveUsersCheckbox = document.getElementById("filterInactiveUsers");
  const hideInactiveInQuota = filterInactiveCheckbox ? filterInactiveCheckbox.checked : false;
  const hideInactiveInUsers = filterInactiveUsersCheckbox ? filterInactiveUsersCheckbox.checked : false;

  if (tbody) tbody.innerHTML = "<tr><td colspan='7'>Chargement...</td></tr>";
  if (quotaBody) quotaBody.innerHTML = "<tr><td colspan='4'>Chargement...</td></tr>";

  try {
    const res = await fetch(API + "/api/godmode/users", {
      headers: {
        "x-auth-token": getToken()
      }
    });

    if (!res.ok) {
      if (tbody) tbody.innerHTML = "<tr><td colspan='7'>Erreur d'accès GodMode</td></tr>";
      if (quotaBody) quotaBody.innerHTML = "<tr><td colspan='4'>Erreur d'accès GodMode</td></tr>";
      return;
    }

    usersCache = await res.json();
    if (tbody) tbody.innerHTML = "";
    if (quotaBody) quotaBody.innerHTML = "";
    renderTables();

  } catch (err) {
    console.error("LOAD USERS ERROR:", err);
    if (tbody) tbody.innerHTML = "<tr><td colspan='7'>Erreur de chargement</td></tr>";
    if (quotaBody) quotaBody.innerHTML = "<tr><td colspan='4'>Erreur de chargement</td></tr>";
  }
}

// =============================================
// 🚫 ENABLE / DISABLE USER
// =============================================
async function toggle(email) {
  await fetch(API + "/api/godmode/toggle", {
    method: "PUT",
    headers: {
      "x-auth-token": getToken(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email })
  });

  loadUsers();
}

// =============================================
// 🔑 CHANGE PASSWORD
// =============================================
function setPwdMessage(text, type = "error") {
  if (!pwdMessage) return;
  pwdMessage.textContent = text;
  pwdMessage.className = `msg ${type}`;
}

async function changePassword() {
  if (!currentPwdInput || !newPwdInput || !confirmPwdInput) return;

  const currentPassword = currentPwdInput.value.trim();
  const newPassword = newPwdInput.value.trim();
  const confirmPassword = confirmPwdInput.value.trim();

  setPwdMessage("");

  if (!currentPassword || !newPassword || !confirmPassword) {
    setPwdMessage("Merci de remplir tous les champs.");
    return;
  }

  if (newPassword.length < 8) {
    setPwdMessage("Le nouveau mot de passe doit contenir au moins 8 caractères.");
    return;
  }

  if (newPassword !== confirmPassword) {
    setPwdMessage("Les mots de passe ne correspondent pas.");
    return;
  }

  try {
    const res = await fetch(`${API}/api/change-password`, {
      method: "POST",
      headers: {
        ...AUTH_HEADERS,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });

    const data = await res.json();

    if (!res.ok) {
      setPwdMessage(data.error || "Échec du changement de mot de passe.");
      return;
    }

    setPwdMessage("Mot de passe mis à jour.", "success");
    currentPwdInput.value = "";
    newPwdInput.value = "";
    confirmPwdInput.value = "";
  } catch (err) {
    console.error("ChangePassword ERROR:", err);
    setPwdMessage("Erreur réseau.");
  }
}

// =============================================
// ❌ DELETE USER
// =============================================
async function deleteUser(email) {
  if (!confirm("Supprimer définitivement ce compte ?")) return;

  await fetch(`${API}/api/godmode/user/${email}`, {
    method: "DELETE",
    headers: {
      "x-auth-token": getToken(),
      "Content-Type": "application/json"
    }
  });

  loadUsers();
}

// =============================================
// 🌍 GLOBAL QUOTA
// =============================================
function setGlobalQuotaMessage(text, type = "error") {
  if (!globalQuotaMessage) return;
  globalQuotaMessage.textContent = text;
  globalQuotaMessage.className = `msg ${type}`;
}

async function loadGlobalQuota() {
  if (!globalQuotaInput) return;
  try {
    const res = await fetch(`${API}/api/godmode/global-quota`, {
      headers: { "x-auth-token": getToken() }
    });
    if (!res.ok) throw new Error("Erreur de chargement");
    const data = await res.json();
    globalQuotaInput.value = data.defaultQuotaMB || "";
    setGlobalQuotaMessage("");
  } catch (err) {
    setGlobalQuotaMessage("Impossible de charger le quota global.");
  }
}

async function saveGlobalQuota() {
  if (!globalQuotaInput) return;
  const value = parseFloat(globalQuotaInput.value);

  if (Number.isNaN(value) || value <= 0) {
    setGlobalQuotaMessage("Entrez une valeur valide (>0).");
    return;
  }

  try {
    const res = await fetch(`${API}/api/godmode/global-quota`, {
      method: "PUT",
      headers: {
        "x-auth-token": getToken(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ defaultQuotaMB: value })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur");

    setGlobalQuotaMessage("Quota global mis à jour.", "success");
    loadUsers();
  } catch (err) {
    setGlobalQuotaMessage(err.message || "Échec de la mise à jour.");
  }
}

// =============================================
// 🧮 TENANT QUOTA
// =============================================
async function editTenantQuota(tenantId, hasOverride, currentQuota) {
  if (!tenantId) return;
  const defaultVal = hasOverride ? currentQuota : "";
  const input = prompt("Quota en Mo (laisser vide pour quota global)", defaultVal);
  if (input === null) return; // cancelled

  const trimmed = input.trim();
  let payloadValue = null;

  if (trimmed !== "") {
    const num = parseFloat(trimmed);
    if (Number.isNaN(num) || num <= 0) {
      alert("Veuillez saisir un nombre positif ou laisser vide.");
      return;
    }
    payloadValue = num;
  }

  try {
    const res = await fetch(`${API}/api/godmode/tenant-quota`, {
      method: "PUT",
      headers: {
        "x-auth-token": getToken(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tenantId, quotaMB: payloadValue })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur");
    loadUsers();
  } catch (err) {
    alert(err.message || "Impossible de mettre à jour le quota.");
  }
}
