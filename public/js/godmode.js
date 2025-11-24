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
    filterInactiveCheckbox.addEventListener("change", loadUsers);
  }
  if (filterInactiveUsersCheckbox) {
    filterInactiveUsersCheckbox.addEventListener("change", loadUsers);
  }

  loadUsers();
  loadGlobalQuota();
});

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

    const users = await res.json();
    if (tbody) tbody.innerHTML = "";
    if (quotaBody) quotaBody.innerHTML = "";

    users.forEach(u => {
      const isSuperAdmin = u.admin === true;
      const usageMB = u.quotaUsedBytes ? (u.quotaUsedBytes / 1024 / 1024) : 0;
      const quotaMB = u.quotaMB || 0;
      const percent = quotaMB > 0 ? Math.min(100, (usageMB / quotaMB) * 100) : 0;
      const quotaText = quotaMB
        ? `${usageMB.toFixed(2)} / ${quotaMB} Mo${u.quotaOverride ? " (perso)" : ""}`
        : `${usageMB.toFixed(2)} Mo (quota non défini)`;

      if (tbody && !(hideInactiveInUsers && u.disabled)) {
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
      }

      if (quotaBody && !isSuperAdmin) {
        if (hideInactiveInQuota && u.disabled) return;
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${isSuperAdmin ? "👑 " : ""}${u.email}</td>
          <td>
            <div class="progress" title="${quotaMB ? `${usageMB.toFixed(2)} / ${quotaMB} Mo (${percent.toFixed(1)}%)` : `${usageMB.toFixed(2)} Mo (quota non défini)`}">
              <div class="progress-bar" style="width:${percent}%;"></div>
            </div>
            <div class="quota-label">${quotaText}</div>
          </td>
          <td>${u.disabled ? "🚫 Désactivé" : "✅ Actif"}</td>
          <td>
            ${
              isSuperAdmin
                ? "<span style='opacity:0.4'>—</span>"
                : `
                  <button class="btn" onclick="editTenantQuota('${u.tenantId || ""}', ${u.quotaOverride ? "true" : "false"}, ${u.quotaMB || 0})">Modifier quota</button>
                `
            }
          </td>
        `;
        quotaBody.appendChild(tr);
      }
    });

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
