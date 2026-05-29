// ── EXPORT MODAL ─────────────────────────────────────────────────────────────
/** @type {HTMLCanvasElement | null} */
let _exportAtlasCanvas  = null;
/** @type {Region[]} */
let _exportRegions      = [];
/** @type {import('./packer').Placement[]} */
let _exportPlacements   = [];
/** @type {number} Native (un-scaled) atlas size — used for UV coordinate calculation. */
let _exportNativeAtlasSize = 0;
/** @type {"atlas" | "regions"} */
let _exportMode         = "atlas";
/** Scale multiplier for this export session — defaults to state.outputScale on open. */
let _exportScale        = 1;
/** @type {number | null} */
let _exportPreviewTimer = null;
/** @type {number | null} */
let _exportSizeTimer    = null;
/** @type {ResizeObserver | null} */
let _exportResizeObs    = null;

/** @type {{ zoom: number, panX: number, panY: number }} */
let _prevView    = { zoom: 1, panX: 0, panY: 0 };
/** @type {boolean} */
let _prevPanning = false;
/** @type {{ x: number, y: number }} */
let _prevPanStart = { x: 0, y: 0 };
/** @type {{ x: number, y: number }} */
let _prevPanOrigin = { x: 0, y: 0 };

/** @type {{ canvas: HTMLCanvasElement, key: string, src: HTMLCanvasElement } | null} */
let _prevScaled          = null;
/** @type {({ src: HTMLCanvasElement, key: string, canvas: HTMLCanvasElement } | null)[]} */
let _prevScaledRegions = [];

// DOM refs — cached once (script is deferred; DOM is ready at this point)
const _expBackdrop    = document.getElementById("exportModalBackdrop");
const _expPreviewWrap = document.getElementById("exportPreviewWrap");
const _expPreview     = document.getElementById("exportPreviewCanvas");
const _expLabel       = document.getElementById("exportPreviewLabel");
const _expFileSizeEl  = document.getElementById("exportFileSizeEst");
const _expFilenameEl  = document.getElementById("exportFilename");
const _expName        = document.getElementById("exportName");
const _expFormat      = document.getElementById("exportFormat");
const _expJpegRow     = document.getElementById("exportJpegRow");
const _expQuality     = document.getElementById("exportQuality");
const _expQualityVal  = document.getElementById("exportQualityVal");
const _expScaleOverride = document.getElementById("exportScaleOverride");
const _expOutputInfo    = document.getElementById("exportOutputInfo");
const _expFilter        = document.getElementById("exportFilter");
const _expUVSection   = document.getElementById("exportUVSection");
const _expEngine      = document.getElementById("exportEngine");
const _expNaming      = document.getElementById("exportNaming");
const _expModeAtlas   = document.getElementById("exportModeAtlas");
const _expModeRegion  = document.getElementById("exportModeRegions");

/** @type {{ [format: string]: { mime: string, ext: string } }} */
const _EXP_FMT = {
  png:  { mime: "image/png",  ext: ".png"  },
  webp: { mime: "image/webp", ext: ".webp" },
  jpeg: { mime: "image/jpeg", ext: ".jpg"  },
};

/**
 * @typedef {Object} ExportSettings
 * @property {string} name
 * @property {string} format
 * @property {number} quality
 * @property {string} filter
 * @property {string} engine
 * @property {string} naming
 */

/** @returns {ExportSettings} */
function _readExportSettings() {
  return {
    name:    (_expName.value.trim() || exportSlug(_exportRegions)).replace(/[^a-z0-9_.-]/gi, "_").replace(/_{2,}/g, "_").replace(/^_|_$/g, "") || "atlas",
    format:  _expFormat.value,
    quality: parseInt(_expQuality.value, 10),
    filter:  _expFilter.value,
    engine:  _expEngine.value,
    naming:  _expNaming.value,
  };
}

// ── Preview rendering ──────────────────────────────────────────────────────

/** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} w @param {number} h */
function _expDrawChecker(ctx, x, y, w, h) {
  const cell = 10;
  ctx.fillStyle = "#2a2c2e";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#222426";
  for (let row = 0; row * cell < h; row++) {
    for (let col = (row & 1); col * cell < w; col += 2) {
      ctx.fillRect(x + col * cell, y + row * cell,
        Math.min(cell, x + w - (x + col * cell)),
        Math.min(cell, y + h - (y + row * cell)));
    }
  }
}

/** @returns {void} */
function _fitPrevView() {
  const W = _expPreview.clientWidth || 400, H = _expPreview.clientHeight || 400;
  const PAD = 28;
  if (_exportMode === "atlas" && _exportAtlasCanvas) {
    const aw = _exportAtlasCanvas.width;
    _prevView.zoom = Math.min((W - PAD * 2) / aw, (H - PAD * 2) / aw);
    _prevView.panX = (W - aw * _prevView.zoom) / 2;
    _prevView.panY = (H - aw * _prevView.zoom) / 2;
  } else if (_exportMode === "regions" && _exportRegions.length) {
    const { cols, maxW, maxH } = _expRegionGridLayout();
    const rows  = Math.ceil(_exportRegions.length / cols);
    const totalW = cols * maxW + (cols - 1) * 6;
    const totalH = rows * maxH + (rows - 1) * 6;
    _prevView.zoom = Math.min((W - PAD * 2) / totalW, (H - PAD * 2) / totalH);
    _prevView.panX = (W - totalW * _prevView.zoom) / 2;
    _prevView.panY = (H - totalH * _prevView.zoom) / 2;
  }
}

/** @returns {{ n: number, cols: number, maxW: number, maxH: number }} */
function _expRegionGridLayout() {
  const scale = _exportScale;
  const n    = _exportRegions.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const maxW = Math.max(1, ..._exportRegions.map(r => Math.round((r.outputW || r.extracted?.width  || 1) * scale)));
  const maxH = Math.max(1, ..._exportRegions.map(r => Math.round((r.outputH || r.extracted?.height || 1) * scale)));
  return { n, cols, maxW, maxH };
}

/** @param {ExportSettings} s @returns {HTMLCanvasElement | null} */
function _getScaledAtlas(s) {
  if (!_exportAtlasCanvas) return null;
  const key = s.filter;
  if (_prevScaled?.key !== key || _prevScaled?.src !== _exportAtlasCanvas) {
    const w = _exportAtlasCanvas.width, h = _exportAtlasCanvas.height;
    _prevScaled = { canvas: exportScaleCanvas(_exportAtlasCanvas, w, h, s.filter), key, src: _exportAtlasCanvas };
  }
  return _prevScaled.canvas;
}

/** @param {Region} r @param {number} i @param {ExportSettings} s @returns {HTMLCanvasElement} */
function _getStyledRegion(r, i, s) {
  const scale = _exportScale;
  const key = `${scale}|${s.filter}`;
  const c = _prevScaledRegions[i];
  if (c?.src === r.extracted && c?.key === key) return c.canvas;
  const tw = Math.max(1, Math.round((r.outputW || r.extracted.width)  * scale));
  const th = Math.max(1, Math.round((r.outputH || r.extracted.height) * scale));
  const canvas = exportScaleCanvas(r.extracted, tw, th, s.filter);
  _prevScaledRegions[i] = { src: r.extracted, key, canvas };
  return canvas;
}

/** @returns {void} */
function _renderPrevCanvas() {
  const s   = _readExportSettings();
  const dpr = window.devicePixelRatio || 1;
  const W   = _expPreview.clientWidth, H = _expPreview.clientHeight;
  if (!W || !H) return;

  // Resize pixel buffer to match physical pixels
  const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
  if (_expPreview.width !== bw)  _expPreview.width  = bw;
  if (_expPreview.height !== bh) _expPreview.height = bh;

  const ctx = _expPreview.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);  // work in CSS px space

  // Dark background
  ctx.fillStyle = "#0d0f11";
  ctx.fillRect(0, 0, W, H);

  // Atlas still building — show a centred loading message
  if (_exportMode === "atlas" && !_exportAtlasCanvas) {
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.font = `${12 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillText("Building preview…", bw / 2, bh / 2);
    _expLabel.textContent = "";
    if (_expOutputInfo) _expOutputInfo.textContent = "";
    return;
  }

  if (_exportMode === "atlas" && _exportAtlasCanvas) {
    // Draw the size/filter-corrected version so the preview faithfully shows
    // downscale quality (blockiness at low res, bilinear blur, etc.).
    const scaled = _getScaledAtlas(s);
    const aw = _exportAtlasCanvas.width;  // world-space size stays fixed for pan/zoom continuity
    const sx = _prevView.panX, sy = _prevView.panY;
    const sw = aw * _prevView.zoom;

    // Checkerboard behind transparent areas
    _expDrawChecker(ctx, sx, sy, sw, sw);

    // Disable browser smoothing so we see actual pixels from the scaled canvas
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scaled, sx, sy, sw, sw);

    const atlasW = _exportAtlasCanvas.width;
    _expLabel.textContent = `${atlasW} × ${atlasW} px`;
    if (_expOutputInfo) _expOutputInfo.textContent = `${atlasW} × ${atlasW} px`;

  } else if (_exportMode === "regions" && _exportRegions.length) {
    const { n, cols, maxW, maxH } = _expRegionGridLayout();
    const GAP = 6;
    ctx.imageSmoothingEnabled = false; // already stylized/scaled — show exact pixels
    for (let i = 0; i < n; i++) {
      const r = _exportRegions[i];
      if (!r.extracted) continue;
      const styled = _getStyledRegion(r, i, s);
      const col = i % cols, row = Math.floor(i / cols);
      const dx = _prevView.panX + col * (maxW + GAP) * _prevView.zoom;
      const dy = _prevView.panY + row * (maxH + GAP) * _prevView.zoom;
      const dw = Math.max(1, Math.round((r.outputW || r.extracted?.width  || 1) * _exportScale)) * _prevView.zoom;
      const dh = Math.max(1, Math.round((r.outputH || r.extracted?.height || 1) * _exportScale)) * _prevView.zoom;
      _expDrawChecker(ctx, dx, dy, dw, dh);
      ctx.drawImage(styled, dx, dy, dw, dh);
    }
    _expLabel.textContent = `${n} region${n !== 1 ? "s" : ""} → .zip`;
    if (_expOutputInfo) _expOutputInfo.textContent = `up to ${maxW} × ${maxH} px`;
  }
}

// ── File size estimation ───────────────────────────────────────────────────

/** @param {number} n @returns {string} */
function _fmtBytes(n) {
  if (n < 1024)       return n + " B";
  if (n < 1048576)    return (n / 1024).toFixed(0) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

/** @returns {void} */
function _scheduleFileSizeEst() {
  clearTimeout(_exportSizeTimer);
  _expFileSizeEl.textContent = "≈ …";
  _exportSizeTimer = setTimeout(_doFileSizeEst, 600);
}

/** @returns {Promise<void>} */
async function _doFileSizeEst() {
  if (!_exportAtlasCanvas) return;
  const s   = _readExportSettings();
  const fmt = _EXP_FMT[s.format] ?? _EXP_FMT.png;
  const qual = s.format === "jpeg" ? s.quality / 100 : undefined;

  if (_exportMode === "atlas") {
    const aw = _exportAtlasCanvas.width;
    const scaled = exportScaleCanvas(_exportAtlasCanvas, aw, aw, s.filter);
    const blob   = await new Promise(res => scaled.toBlob(res, fmt.mime, qual));
    _expFileSizeEl.textContent = blob ? "≈ " + _fmtBytes(blob.size) : "";
    _expFilenameEl.textContent = s.name + fmt.ext;
  } else {
    let total = 0;
    for (const r of _exportRegions) {
      if (!r.extracted) continue;
      const tw   = Math.max(1, Math.round((r.outputW || r.extracted.width)  * _exportScale));
      const th   = Math.max(1, Math.round((r.outputH || r.extracted.height) * _exportScale));
      const scaled = exportScaleCanvas(r.extracted, tw, th, s.filter);
      const blob   = await new Promise(res => scaled.toBlob(res, fmt.mime, qual));
      if (blob) total += blob.size;
    }
    _expFileSizeEl.textContent = total ? "≈ " + _fmtBytes(total) + " total" : "";
    _expFilenameEl.textContent = s.name + "_regions.zip";
  }
}

// ── Scheduling ─────────────────────────────────────────────────────────────

/** @returns {void} */
function _scheduleExportPreview() {
  clearTimeout(_exportPreviewTimer);
  _exportPreviewTimer = setTimeout(() => {
    _renderPrevCanvas();
    _scheduleFileSizeEst();
  }, 80);
}

// ── Mode UI ────────────────────────────────────────────────────────────────

/** @param {"atlas" | "regions"} mode */
function _applyExportModeUI(mode) {
  _exportMode = mode;
  _expModeAtlas.classList.toggle("active",  mode === "atlas");
  _expModeRegion.classList.toggle("active", mode === "regions");
  _expUVSection.style.display = mode === "atlas" ? "" : "none";
  _fitPrevView();
  _renderPrevCanvas(); // also updates _expOutputInfo inline
  _scheduleFileSizeEst();
}

// ── Open / close ───────────────────────────────────────────────────────────

/**
 * Build (or rebuild) the export atlas canvas at the given scale, running
 * the global atlas pipeline on the result. Stores into _exportAtlasCanvas.
 * Safe to call while the modal is already open (e.g. on scale change).
 *
 * Fast paths (in order of preference):
 *   1. scale === state.outputScale and state.atlasCanvas exists
 *      → reuse the already-pipelined preview canvas directly (0 ms).
 *   2. state.atlasBaseCanvas exists (raw composite at state.outputScale)
 *      → rescale it with a single drawImage, then run pipeline only.
 *   3. Fallback: redraw every region and run pipeline (original behaviour).
 *
 * @param {number} scale
 * @returns {Promise<void>}
 */
async function _buildExportAtlas(scale) {
  // ── Fast path 1: scale matches preview — reuse the live atlas canvas ──────
  if (scale === (state.outputScale ?? 1) && state.atlasCanvas) {
    _exportAtlasCanvas = state.atlasCanvas;
    _prevScaled = null;
    return;
  }

  const atlasSize = Math.max(1, Math.round(_exportNativeAtlasSize * scale));
  let rawAtlas = document.createElement("canvas");
  rawAtlas.width = rawAtlas.height = atlasSize;
  const actx = rawAtlas.getContext("2d");

  // ── Fast path 2: rescale the base composite instead of redrawing regions ──
  if (state.atlasBaseCanvas) {
    actx.drawImage(state.atlasBaseCanvas, 0, 0, atlasSize, atlasSize);
  } else {
    // ── Fallback: composite from per-region extracted canvases ────────────────
    _exportRegions.forEach((r, i) => _drawOnAtlas(actx, r.extracted, _exportPlacements[i], 0, 0, scale));
  }

  // Apply global atlas pipeline without touching live preview caches
  let pipelined = rawAtlas;
  for (const b of state.atlas.pipeline) {
    if (!b.enabled) continue;
    const runner = BLOCK_RUNNERS[b.type];
    if (!runner) continue;
    const pCtx = { region: null, state, block: b, ai: null, signal: null };
    try {
      const out = await runner(pipelined, b.params, pCtx);
      if (out) pipelined = out;
    } catch (e) {
      console.warn(`[Export] atlas pipeline block "${b.type}" failed:`, e);
    }
  }
  _exportAtlasCanvas = pipelined;
  _prevScaled = null; // invalidate scaled-atlas cache
}

/** @returns {Promise<void>} */
async function openExportModal() {
  const selected = state.regions.filter(r => r.selected);
  if (!selected.length) return;

  // Build region list — fall back to crop if pipeline hasn't run yet
  _exportRegions = (await Promise.all(selected.map(async r => {
    if (r.extracted) return r;
    const fb = r.parentId ? _variantInputCanvas(r) : _rawCropScaled(r);
    if (!fb) return null;
    return { ...r, extracted: fb };
  }))).filter(Boolean);

  if (!_exportRegions.length) return;
  const layout = packAtlas(_exportRegions);
  if (!layout) return;
  _exportPlacements      = layout.placements;
  _exportNativeAtlasSize = layout.atlasSize;

  // Populate the scale selector from the shared options list and set its initial value
  _exportScale = state.outputScale ?? 1;
  if (_expScaleOverride) {
    _expScaleOverride.innerHTML = OUTPUT_SCALE_OPTIONS.map(o =>
      `<option value="${o.value}"${o.value === _exportScale ? " selected" : ""}>${o.label}</option>`
    ).join("");
  }

  _expName.value = state.atlasName || "Untitled Atlas";
  _prevScaledRegions = [];
  _exportAtlasCanvas = null; // clear stale canvas so preview shows loading state

  // ── Open immediately so the user sees the modal at once ──────────────────
  _expBackdrop.classList.add("open");
  requestAnimationFrame(() => {
    _applyExportModeUI("atlas");
  });

  _exportResizeObs = new ResizeObserver(() => _renderPrevCanvas());
  _exportResizeObs.observe(_expPreviewWrap);

  // ── Build the atlas canvas in the background ──────────────────────────────
  // This can be slow (pipeline blocks, stylize dithering) so we do it after
  // the modal is visible. The preview re-renders automatically when done.
  await _buildExportAtlas(_exportScale);
  _fitPrevView();
  _renderPrevCanvas();
  _scheduleFileSizeEst();
}

/** @returns {void} */
function _closeExportModal() {
  _expBackdrop.classList.remove("open");
  _exportResizeObs?.disconnect();
  _exportResizeObs = null;
  clearTimeout(_exportPreviewTimer);
  clearTimeout(_exportSizeTimer);
  _prevScaled = null;
  _prevScaledRegions = [];
}

// ── Export ─────────────────────────────────────────────────────────────────

/** @returns {Promise<void>} */
async function _doExport() {
  if (_exportMode === "atlas" && !_exportAtlasCanvas) return; // still building
  const s    = _readExportSettings();
  const fmt  = _EXP_FMT[s.format] ?? _EXP_FMT.png;
  const qual = s.format === "jpeg" ? s.quality / 100 : undefined;

  if (_exportMode === "atlas") {
    const atlasW = _exportAtlasCanvas.width;
    const scaled = exportScaleCanvas(_exportAtlasCanvas, atlasW, atlasW, s.filter);
    const blob   = await new Promise(res => scaled.toBlob(res, fmt.mime, qual));
    if (blob) downloadBlob(blob, s.name + fmt.ext);

    if (s.engine !== "none") {
      // UV coords are always in normalised [0,1] space relative to the native atlas grid.
      // Pass _exportNativeAtlasSize (not the scaled atlasW) so pixel ↔ UV maths stay correct.
      if (s.engine === "blender_zenuv") {
        const svgStr = exportBuildZenUVSVG(_exportRegions, _exportPlacements, _exportNativeAtlasSize, s.naming, _exportAtlasCanvas);
        downloadBlob(new Blob([svgStr], { type: "image/svg+xml" }), s.name + ".svg");
      } else {
        const uvData = exportBuildUVData(s.engine, _exportRegions, _exportPlacements, _exportNativeAtlasSize, s.naming, s.name + fmt.ext);
        const suffix = s.engine === "snapatlas" ? "_uv.json" : ".json";
        downloadBlob(new Blob([JSON.stringify(uvData, null, 2)], { type: "application/json" }), s.name + suffix);
      }
    }
    showToast(`Exported — ${atlasW}×${atlasW}px`);

  } else {
    // Individual regions → ZIP
    const entries = await Promise.all(_exportRegions.map(async r => {
      const tw     = Math.max(1, Math.round((r.outputW || r.extracted.width)  * _exportScale));
      const th     = Math.max(1, Math.round((r.outputH || r.extracted.height) * _exportScale));
      const scaled = exportScaleCanvas(r.extracted, tw, th, s.filter);
      const blob   = await new Promise(res => scaled.toBlob(res, fmt.mime, qual));
      if (!blob) return null;
      const ab = await blob.arrayBuffer();
      return { name: exportApplyNaming(r.label, s.naming) + fmt.ext, data: new Uint8Array(ab) };
    }));
    const files = entries.filter(Boolean);
    downloadBlob(exportBuildZip(files), s.name + "_regions.zip");
    showToast(`Exported ${files.length} region${files.length !== 1 ? "s" : ""}`);
  }

  analytics.track("export", {
    mode: _exportMode,
    format: s.format,
    engine: s.engine === "none" ? null : s.engine,
    outputScale: _exportScale,
  });
  _closeExportModal();
}

// ── Atlas name ─────────────────────────────────────────────────────────────

atlasNameInput.addEventListener("input", () => {
  state.atlasName = atlasNameInput.value.trim();
  if (_expName) _expName.value = state.atlasName || "Untitled Atlas";
  saveProject();
});

// ── Event wiring ───────────────────────────────────────────────────────────

btnDownloadAtlas.addEventListener("click", openExportModal);
btnDownloadAtlas.addEventListener("click", () => onboarding?.advance("first-texture", "export"));

document.getElementById("exportModalClose").addEventListener("click",  _closeExportModal);
document.getElementById("exportModalCancel").addEventListener("click", _closeExportModal);
document.getElementById("exportModalExport").addEventListener("click", _doExport);
_expBackdrop.addEventListener("click", e => { if (e.target === _expBackdrop) _closeExportModal(); });

_expModeAtlas.addEventListener("click",  () => _applyExportModeUI("atlas"));
_expModeRegion.addEventListener("click", () => _applyExportModeUI("regions"));

_expFormat.addEventListener("change", () => {
  _expJpegRow.style.display = _expFormat.value === "jpeg" ? "" : "none";
  _scheduleExportPreview();
});
_expQuality.addEventListener("input", () => {
  _expQualityVal.textContent = _expQuality.value;
  _scheduleExportPreview();
});
_expScaleOverride.addEventListener("change", async () => {
  _exportScale = parseFloat(_expScaleOverride.value);
  _prevScaledRegions = [];
  if (_exportMode === "atlas") {
    await _buildExportAtlas(_exportScale);
  }
  _fitPrevView();
  _renderPrevCanvas(); // updates output info + preview immediately
  _scheduleFileSizeEst();
});
_expFilter.addEventListener("change",  _scheduleExportPreview);
_expName.addEventListener("input", () => {
  state.atlasName = _expName.value.trim();
  atlasNameInput.value = state.atlasName || "Untitled Atlas";
  saveProject();
  _scheduleExportPreview();
});
// Preview pan/zoom — left-drag to pan
_expPreviewWrap.addEventListener("mousedown", e => {
  if (e.button !== 0) return;
  e.preventDefault();
  _prevPanning   = true;
  _prevPanStart  = { x: e.clientX, y: e.clientY };
  _prevPanOrigin = { x: _prevView.panX, y: _prevView.panY };
  _expPreviewWrap.classList.add("panning");
});
window.addEventListener("mousemove", e => {
  if (!_prevPanning) return;
  _prevView.panX = _prevPanOrigin.x + e.clientX - _prevPanStart.x;
  _prevView.panY = _prevPanOrigin.y + e.clientY - _prevPanStart.y;
  _renderPrevCanvas();
});
window.addEventListener("mouseup", () => {
  if (_prevPanning) { _prevPanning = false; _expPreviewWrap.classList.remove("panning"); }
});

// Trackpad two-finger pan/pinch (via touch events on Chrome/Safari macOS)
const _exportTouch = _makeTouchHandler(() => _expPreview, () => _prevView, _renderPrevCanvas, 0.03, 64);
_expPreviewWrap.addEventListener("touchstart", (e) => _exportTouch.onTouchStart(e), { passive: false });
_expPreviewWrap.addEventListener("touchmove",  (e) => _exportTouch.onTouchMove(e),  { passive: false });
_expPreviewWrap.addEventListener("touchend",   (e) => _exportTouch.onTouchEnd(e));

function _applyExportZoom(factor, cx, cy) {
  const prev = _prevView.zoom;
  _prevView.zoom = Math.max(0.03, Math.min(64, _prevView.zoom * factor));
  const dz = _prevView.zoom / prev;
  _prevView.panX = cx - dz * (cx - _prevView.panX);
  _prevView.panY = cy - dz * (cy - _prevView.panY);
}
_expPreviewWrap.addEventListener("wheel", _makeCanvasWheelHandler(
  () => _prevView, _renderPrevCanvas,
  (e) => {
    const r = _expPreview.getBoundingClientRect();
    _applyExportZoom(1 - e.deltaY * 0.03, e.clientX - r.left, e.clientY - r.top);
  },
  (factor, e) => {
    const r = _expPreview.getBoundingClientRect();
    _applyExportZoom(factor, e.clientX - r.left, e.clientY - r.top);
  },
), { passive: false });

// Double-click to fit
_expPreviewWrap.addEventListener("dblclick", () => { _fitPrevView(); _renderPrevCanvas(); });
