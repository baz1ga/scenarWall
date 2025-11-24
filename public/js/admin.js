//-----------------------------------------------------
//  ADMIN.JS — Tenant-Aware Version (aligné server.js)
//-----------------------------------------------------

const API = getApiBase();
const token = getToken();
const tenantId = getTenant();

if (!token || !tenantId) {
  window.location.href = "/login.html";
}

const AUTH_HEADERS = {
  "Authorization": "Bearer " + token
};

// DOM
const fileInput = document.getElementById("fileInput");
const listVisible = document.getElementById("list-visible");
const listHidden = document.getElementById("list-hidden");
const currentPwdInput = document.getElementById("currentPassword");
const newPwdInput = document.getElementById("newPassword");
const confirmPwdInput = document.getElementById("confirmPassword");
const pwdMessage = document.getElementById("pwdMessage");
const uploadMessage = document.getElementById("uploadMessage");
const tensionToggle = document.getElementById("tensionToggle");
const tensionMessage = document.getElementById("tensionMessage");
const quotaValue = document.getElementById("quotaValue");
const quotaUsage = document.getElementById("quotaUsage");
const quotaProgress = document.getElementById("quotaProgress");
const quotaMessage = document.getElementById("quotaMessage");

let imageOrder = [];
let tenantConfig = { tensionEnabled: true };

//---------------------------------------------------------
//  LOAD IMAGES
//---------------------------------------------------------
async function loadImages() {
  try {
    const res = await fetch(`${API}/api/tenant/${tenantId}/images`, {
      headers: AUTH_HEADERS
    });

    if (!res.ok) {
      console.error("LoadImages failed");
      return;
    }

    const data = await res.json();

    const visible = data.filter(i => !i.hidden);
    const hidden = data.filter(i => i.hidden);

    imageOrder = visible.map(i => i.name);

    listVisible.innerHTML = "";
    listHidden.innerHTML = "";

    // ------- Visible -------
    visible.forEach((img, index) => {
      const div = document.createElement("div");
      div.className = "item";

      div.innerHTML = `
        <img src="${img.url}">
        <span>${img.name}</span>
        <div class="tools">
          <button class="btn" onclick="moveUp(${index})">⬆️</button>
          <button class="btn" onclick="moveDown(${index})">⬇️</button>
          <button class="btn" onclick="hideImage('${img.name}')">🙈</button>
        </div>
      `;

      listVisible.appendChild(div);
    });

    // ------- Hidden -------
    hidden.forEach((img) => {
      const div = document.createElement("div");
      div.className = "item";

      div.innerHTML = `
        <img src="${img.url}">
        <span>${img.name}</span>
        <div class="tools">
          <button class="btn" onclick="showImage('${img.name}')">👁️</button>
          <button class="btn danger" onclick="deleteImage('${img.name}')">❌</button>
        </div>
      `;

      listHidden.appendChild(div);
    });

  } catch (err) {
    console.error("loadImages ERROR:", err);
  } finally {
    loadQuota();
  }
}

//---------------------------------------------------------
//  UPLOAD
//---------------------------------------------------------
function setUploadMessage(text, type = "error") {
  if (!uploadMessage) return;
  uploadMessage.textContent = text;
  uploadMessage.className = `msg ${type}`;
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;

  const form = new FormData();
  form.append("image", file);

  try {
    const res = await fetch(`${API}/api/${tenantId}/images/upload`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: form
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 400 && data.error === "Quota exceeded") {
        setQuotaMessage("Quota dépassé : impossible d'ajouter cette image.");
        setUploadMessage("Quota dépassé : upload impossible.");
      } else {
        const msg = data.error || "Échec de l'upload.";
        setQuotaMessage(msg);
        setUploadMessage(msg);
      }
      fileInput.value = "";
      loadQuota();
      return;
    }

    setQuotaMessage("");
    setUploadMessage("Image uploadée avec succès.", "success");
    fileInput.value = "";
    loadImages();
  } catch (err) {
    console.error("Upload ERROR:", err);
    setQuotaMessage("Upload impossible (réseau).");
    setUploadMessage("Upload impossible (réseau).");
    fileInput.value = "";
  }
});

//---------------------------------------------------------
//  ORDER
//---------------------------------------------------------
async function saveOrder() {
  await fetch(`${API}/api/${tenantId}/images/order`, {
    method: "PUT",
    headers: {
      ...AUTH_HEADERS,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ order: imageOrder })
  });
}

function moveUp(i) {
  if (i === 0) return;
  [imageOrder[i - 1], imageOrder[i]] = [imageOrder[i], imageOrder[i - 1]];
  saveOrder().then(loadImages);
}

function moveDown(i) {
  if (i === imageOrder.length - 1) return;
  [imageOrder[i + 1], imageOrder[i]] = [imageOrder[i], imageOrder[i + 1]];
  saveOrder().then(loadImages);
}

//---------------------------------------------------------
//  HIDE / SHOW / DELETE
//---------------------------------------------------------
async function hideImage(name) {
  await fetch(`${API}/api/${tenantId}/images/hide/${name}`, {
    method: "PUT",
    headers: AUTH_HEADERS
  });
  loadImages();
}

async function showImage(name) {
  await fetch(`${API}/api/${tenantId}/images/show/${name}`, {
    method: "PUT",
    headers: AUTH_HEADERS
  });
  loadImages();
}

async function deleteImage(name) {
  if (!confirm("Supprimer définitivement cette image ? Elle doit être cachée.")) return;

  await fetch(`${API}/api/${tenantId}/images/${name}`, {
    method: "DELETE",
    headers: AUTH_HEADERS
  });

  loadImages();
}

//---------------------------------------------------------
//  CHANGE PASSWORD
//---------------------------------------------------------
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

//---------------------------------------------------------
//  TENSION BAR CONFIG
//---------------------------------------------------------
function setTensionMessage(text, type = "error") {
  if (!tensionMessage) return;
  tensionMessage.textContent = text;
  tensionMessage.className = `msg ${type}`;
}

async function loadTenantConfig() {
  if (!tensionToggle) return;

  try {
    const res = await fetch(`${API}/api/${tenantId}/config`, { headers: AUTH_HEADERS });
    if (!res.ok) throw new Error("Fetch config failed");
    tenantConfig = await res.json();
    tensionToggle.checked = tenantConfig.tensionEnabled !== false;
    setTensionMessage("");
  } catch (err) {
    console.error("loadTenantConfig ERROR:", err);
    setTensionMessage("Impossible de charger la configuration.");
  }
}

async function toggleTension(enabled) {
  if (!tensionToggle) return;

  try {
    const res = await fetch(`${API}/api/${tenantId}/config/tension`, {
      method: "PUT",
      headers: {
        ...AUTH_HEADERS,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tensionEnabled: enabled })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Échec de la mise à jour");
    }

    tenantConfig = data.config;
    setTensionMessage(enabled ? "Barre de tension activée." : "Barre de tension désactivée.", "success");
  } catch (err) {
    console.error("toggleTension ERROR:", err);
    setTensionMessage(err.message || "Erreur réseau.");
    tensionToggle.checked = tenantConfig.tensionEnabled !== false;
  }
}

if (tensionToggle) {
  tensionToggle.addEventListener("change", () => toggleTension(tensionToggle.checked));
}

//---------------------------------------------------------
//  FRONT TENANT
//---------------------------------------------------------
function openFront() {
  window.open(`/t/${tenantId}/front`, "_blank");
}

//---------------------------------------------------------
//  INIT
//---------------------------------------------------------
loadImages();
loadTenantConfig();

//---------------------------------------------------------
//  QUOTA
//---------------------------------------------------------
function setQuotaMessage(text, type = "error") {
  if (!quotaMessage) return;
  quotaMessage.textContent = text;
  quotaMessage.className = `msg ${type}`;
}

async function loadQuota() {
  if (!quotaValue || !quotaUsage || !quotaProgress) return;

  try {
    const res = await fetch(`${API}/api/${tenantId}/quota`, {
      headers: AUTH_HEADERS
    });
    if (!res.ok) throw new Error("Erreur quota");
    const data = await res.json();

    quotaValue.textContent = `${data.quotaMB} Mo${data.override ? " (perso)" : ""}`;
    quotaUsage.textContent = `${data.usage} Mo`;
    const percent = data.quotaMB > 0 ? Math.min(100, (data.usage / data.quotaMB) * 100) : 0;
    quotaProgress.style.width = `${percent}%`;
    setQuotaMessage("");
  } catch (err) {
    console.error("loadQuota ERROR:", err);
    quotaValue.textContent = "—";
    quotaUsage.textContent = "—";
    quotaProgress.style.width = "0%";
    setQuotaMessage("Impossible de charger le quota.");
  }
}

async function saveTenantQuota() {
  // Non modifiable côté admin
}
