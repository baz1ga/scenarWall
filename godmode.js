// =============================================
// 🌐 CONFIG API
// =============================================
const API = getApiBase();
// =============================================
// 🔐 Vérification Admin + Chargement
// =============================================
document.addEventListener("DOMContentLoaded", () => {
  if (!isAdmin()) {
    window.location.href = "login.html";
    return;
  }

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
