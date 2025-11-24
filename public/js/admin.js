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

let imageOrder = [];

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
  }
}

//---------------------------------------------------------
//  UPLOAD
//---------------------------------------------------------
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;

  const form = new FormData();
  form.append("image", file);

  await fetch(`${API}/api/${tenantId}/images/upload`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: form
  });

  loadImages();
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
//  FRONT TENANT
//---------------------------------------------------------
function openFront() {
  window.open(`/t/${tenantId}/front`, "_blank");
}

//---------------------------------------------------------
//  INIT
//---------------------------------------------------------
loadImages();
