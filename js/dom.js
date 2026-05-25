// ── DOM REFS ───────────────────────────────────────────────────────────────
const photoPanel     = document.getElementById("photo-panel");
const canvas         = document.getElementById("photo-canvas");
const ctx            = canvas.getContext("2d");
const pvCanvas       = document.getElementById("preview-canvas");
const pvHint         = document.getElementById("preview-hint");
const pvSize         = document.getElementById("preview-size");
const pvToggleBtns   = document.querySelectorAll(".opt-btn[data-mode]");
const dropOverlay    = document.getElementById("drop-overlay");
const fileInput      = document.getElementById("file-input");
const btnLoadPhoto   = document.getElementById("btn-load-photo");
const btnNew         = document.getElementById("btn-new");
const btnSaveProject = document.getElementById("btn-save-project");
const btnOpenProject = document.getElementById("btn-open-project");
const btnDownloadAtlas = document.getElementById("btn-download-atlas");
const atlasNameInput = document.getElementById("atlasName");
const projectInput   = document.getElementById("project-input");
const statusEl       = document.getElementById("status");
const inspectorEl    = document.getElementById("inspector");
const progressBar    = document.getElementById("progress-bar");
const toast          = document.getElementById("toast");
const cubeCanvas     = document.getElementById("cube-canvas");
const cubeControls   = document.getElementById("cube-controls");
const cubeUvSlider   = document.getElementById("cube-uv-scale");
const cubeUvVal      = document.getElementById("cube-uv-val");

// ── UI HELPERS ─────────────────────────────────────────────────────────────
/** @param {string} type @param {string} msg */
function setStatus(type, msg) {
  const textColor = type === "error" ? "text-danger" : type === "running" || type === "ok" ? "text-accent" : "";
  statusEl.className = textColor;
  statusEl.innerHTML = type === "running" ? `<div class="pulse"></div>${msg}` : msg;
}

/** @param {number} pct */
function setProgress(pct) {
  progressBar.style.width = pct + "%";
  if (pct >= 100) setTimeout(() => (progressBar.style.width = "0%"), 500);
}

let toastTimer;
/** @param {string} msg @param {string} [type] */
function showToast(msg, type = "success") {
  toast.textContent = msg;
  toast.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.className = ""), 2800);
}
