// ── INIT (called at end of file, after all DOM queries) ────────────────────
/** @returns {void} */
function _init() {
  Lucide.initIcons();
  loadProject();
  // Analytics banner is shown after onboarding resolves (see onboarding.js)
}

// ── API KEY MODAL ──────────────────────────────────────────────────────────
const apikeyModalBackdrop = document.getElementById("apikeyModalBackdrop");
const apikeyInput         = document.getElementById("api-key");
const apikeyModalSave     = document.getElementById("apikeyModalSave");
const apikeyModalCancel   = document.getElementById("apikeyModalCancel");
const apikeyModalClose    = document.getElementById("apikeyModalClose");
const btnApiKey           = document.getElementById("btn-api-key");

_updateKeyIndicator();

/** @type {(() => void) | null} */
let _apikeyCallback = null;

/** @returns {void} */
function _updateKeyIndicator() {
  btnApiKey.classList.toggle("key-set", !!state.apiKey);
}

/** @param {(() => void) | null} [onSaved] */
function showApiKeyModal(onSaved) {
  _apikeyCallback = onSaved ?? null;
  apikeyInput.value = state.apiKey || "";
  apikeyModalBackdrop.classList.add("open");
  requestAnimationFrame(() => apikeyInput.focus());
}

/** @returns {void} */
function _closeApiKeyModal() {
  apikeyModalBackdrop.classList.remove("open");
  _apikeyCallback = null;
}

/** @returns {void} */
function _saveApiKey() {
  const key = apikeyInput.value.trim();
  if (!key) return;
  const isNew = !state.apiKey;
  state.apiKey = key;
  localStorage.setItem("snapatlas_key", key);
  if (isNew) analytics.track("api_key_set");
  _updateKeyIndicator();
  const cb = _apikeyCallback; // capture before _closeApiKeyModal nulls it
  _closeApiKeyModal();
  if (cb) cb();
}

apikeyModalSave.addEventListener("click", _saveApiKey);
apikeyInput.addEventListener("keydown", (e) => e.key === "Enter" && _saveApiKey());
apikeyModalCancel.addEventListener("click", _closeApiKeyModal);
apikeyModalClose.addEventListener("click",  _closeApiKeyModal);
apikeyModalBackdrop.addEventListener("click", (e) => { if (e.target === apikeyModalBackdrop) _closeApiKeyModal(); });
btnApiKey.addEventListener("click", () => showApiKeyModal());

// ── PROJECT ────────────────────────────────────────────────────────────────
btnNew.addEventListener("click", () => {
  if (!confirm("Start a new project? Current work will be lost.")) return;
  localStorage.removeItem("snapatlas_project");
  _idbClear().catch(() => console.warn("[IDB] clear failed on new project"));
  state.photos = [];
  state.regions = [];
  state.regionCounter = 0;
  state.processed = false;
  state.atlasCanvas = null;
  state.inspectedIdx = null;
  state.atlasName = "";
  atlasNameInput.value = "Untitled Atlas";
  setTool("create");
  dropOverlay.classList.remove("hidden");
  btnNew.classList.add("is-hidden");
  renderCanvas();
  renderInspector();
  renderPreview();
  updateButtons();
  setStatus("", "");
});

// ── PHOTO LOADING ──────────────────────────────────────────────────────────
btnLoadPhoto.addEventListener("click", () => fileInput.click());
dropOverlay.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  [...e.target.files].forEach(f => loadFile(f));
  e.target.value = "";
});

btnSaveProject.addEventListener("click", () => exportProject());
btnOpenProject.addEventListener("click", () => projectInput.click());
projectInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) importProject(file);
  projectInput.value = "";
});

photoPanel.addEventListener("dragover", (e) => {
  e.preventDefault();
  photoPanel.classList.add("dragover");
});
photoPanel.addEventListener("dragleave", () =>
  photoPanel.classList.remove("dragover"),
);
photoPanel.addEventListener("drop", (e) => {
  e.preventDefault();
  photoPanel.classList.remove("dragover");
  const files = [...e.dataTransfer.files];
  const snapFile = files.find(f => f.name.endsWith(".snapatlas"));
  if (snapFile) { importProject(snapFile); return; }
  files.filter(f => f.type.startsWith("image/")).forEach(f => loadFile(f));
});

/** @param {HTMLImageElement} img @returns {Photo} */
function addPhoto(img) {
  const GAP = 32;
  const x = state.photos.length === 0
    ? 0
    : Math.max(...state.photos.map(p => p.x + p.img.width)) + GAP;
  const photo = { id: nanoid(), img, x, y: 0, _savedToIdb: false };
  state.photos.push(photo);
  return photo;
}

/** @param {File} file */
function loadFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const isFirst = state.photos.length === 0;
    addPhoto(img);
    if (isFirst) {
      fitPhotoView();
      dropOverlay.classList.add("hidden");
      document.getElementById("snap-ctrl").classList.remove("is-hidden");
      btnNew.classList.remove("is-hidden");
      btnSaveProject.classList.remove("is-hidden");
    }
    renderCanvas();
    renderPreview();
    renderInspector();
    updateButtons();
    saveProject();
    analytics.track("photo_imported");
    onboarding?.advance("first-texture", "import");
  };
  img.src = url;
}

_init();
