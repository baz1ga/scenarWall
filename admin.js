//-----------------------------------------------------
//  ADMIN.JS — Tenant-Aware Version (aligné server.js)
//-----------------------------------------------------

const API = "http://localhost:3100";
const token = getToken();
const tenantId = getTenant();

if (!token || !tenantId) {
  window.location.href = "login.html";
}

const AUTH_HEADERS = {
  "Authorization": "Bearer " + token
};

// DOM
const fileInput = document.getElementById("fileInput");
const listVisible = document.getElementById("list-visible");
const listHidden = document.getElementById("list-hidden");

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
//  FRONT TENANT
//---------------------------------------------------------
function openFront() {
  window.open(`/t/${tenantId}/front`, "_blank");
}

//---------------------------------------------------------
//  INIT
//---------------------------------------------------------
loadImages();