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

  loadUsers();
});

// =============================================
// 🔄 LOAD USERS
// =============================================
async function loadUsers() {
  const tbody = document.getElementById("user-table");
  tbody.innerHTML = "<tr><td colspan='7'>Chargement...</td></tr>";

  try {
    const res = await fetch(API + "/api/godmode/users", {
      headers: {
        "x-auth-token": getToken()
      }
    });

    if (!res.ok) {
      tbody.innerHTML = "<tr><td colspan='7'>Erreur d'accès GodMode</td></tr>";
      return;
    }

    const users = await res.json();
    tbody.innerHTML = "";

    users.forEach(u => {
      const isSuperAdmin = u.admin === true;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${isSuperAdmin ? "👑 " : ""}${u.email}</td>
        <td>${u.tenantId || "—"}</td>
        <td>${u.imageCount}</td>
        <td>${(u.quotaUsedBytes / 1024 / 1024).toFixed(2)} Mo</td>
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

  } catch (err) {
    console.error("LOAD USERS ERROR:", err);
    tbody.innerHTML = "<tr><td colspan='7'>Erreur de chargement</td></tr>";
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
