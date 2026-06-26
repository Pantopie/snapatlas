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
let _prevScaled        = null;
/** @type {({ src: HTMLCanvasElement, key: string, canvas: HTMLCanvasElement } | null)[]} */
let _prevScaledRegions = [];
/** Generation counter — increment to cancel any in-progress region build. */
let _buildRegionGen    = 0;

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
  if (_exportMode === "atlas") {
    const aw = (state.atlasCanvas?.width) || Math.max(1, Math.round(_exportNativeAtlasSize * _exportScale));
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
  if (_prevScaled?.key === key && _prevScaled?.src === _exportAtlasCanvas) return _prevScaled.canvas;
  const w = _exportAtlasCanvas.width, h = _exportAtlasCanvas.height;
  _prevScaled = { canvas: exportScaleCanvas(_exportAtlasCanvas, w, h, s.filter), key, src: _exportAtlasCanvas };
  return _prevScaled.canvas;
}

/**
 * Return the pre-built styled canvas for region i (sync, cache-lookup only).
 * Falls back to a plain scaled version while the build is in progress.
 * @param {Region} r @param {number} i @param {ExportSettings} s
 * @returns {HTMLCanvasElement}
 */
function _getStyledRegion(r, i, s) {
  const cached = _prevScaledRegions[i];
  if (cached?.src === r.extracted) return cached.canvas;
  // Fallback: plain scaled region while atlas-extraction build is pending
  const scale = _exportScale;
  const tw = Math.max(1, Math.round((r.outputW || r.extracted.width)  * scale));
  const th = Math.max(1, Math.round((r.outputH || r.extracted.height) * scale));
  return exportScaleCanvas(r.extracted, tw, th, s.filter);
}

/**
 * Crop region `i` out of `_exportAtlasCanvas`, un-rotating if the packer
 * rotated it. The result already has all global pipeline effects applied
 * because `_exportAtlasCanvas` was produced by the full atlas pipeline.
 * Returns null if the atlas canvas isn't ready yet.
 * @param {number} i
 * @returns {HTMLCanvasElement | null}
 */
function _extractRegionFromAtlas(i) {
  if (!_exportAtlasCanvas || !_exportPlacements[i]) return null;
  const p     = _exportPlacements[i];
  const scale = _exportScale;
  // Coords in the scaled atlas canvas
  const px = Math.round(p.x * scale);
  const py = Math.round(p.y * scale);
  const pw = Math.round(p.w * scale); // atlas-space width  (= srcH when rotated)
  const ph = Math.round(p.h * scale); // atlas-space height (= srcW when rotated)

  const c   = document.createElement("canvas");
  const ctx = c.getContext("2d");

  if (p.rotated) {
    // The region was drawn rotated 90° CW in the atlas.
    // Un-rotate 90° CCW: output is ph × pw = srcW × srcH.
    c.width  = ph; // = srcW * scale
    c.height = pw; // = srcH * scale
    ctx.translate(0, pw); // pw = srcH * scale
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(_exportAtlasCanvas, px, py, pw, ph, 0, 0, pw, ph);
  } else {
    c.width  = pw;
    c.height = ph;
    ctx.drawImage(_exportAtlasCanvas, px, py, pw, ph, 0, 0, pw, ph);
  }
  return c;
}

/**
 * Build per-region export canvases by cropping from the already-pipelined
 * `_exportAtlasCanvas`. This means global pipeline effects (stylize, levels,
 * etc.) are automatically included with no additional runner calls and zero
 * interference with the live atlas pipeline.
 *
 * Cancellable: incrementing `_buildRegionGen` aborts any in-progress build.
 * @returns {void}
 */
function _buildStyledRegions() {
  ++_buildRegionGen;
  // Ensure _exportAtlasCanvas reflects the latest pipelined atlas at the current scale
  _buildExportAtlas(_exportScale);
  if (!_exportAtlasCanvas) return; // no atlas at all yet

  const cacheKey = `atlas|${_exportAtlasCanvas.width}|${_exportScale}`;
  let changed = false;

  for (let i = 0; i < _exportRegions.length; i++) {
    const r = _exportRegions[i];
    if (!r.extracted) continue;
    if (_prevScaledRegions[i]?.key === cacheKey) continue; // already up-to-date

    const canvas = _extractRegionFromAtlas(i);
    if (!canvas) continue;
    _prevScaledRegions[i] = { src: r.extracted, key: cacheKey, canvas };
    changed = true;
  }

  if (changed) {
    _renderPrevCanvas();
    _scheduleFileSizeEst();
  }
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

  if (_exportMode === "atlas" && _exportAtlasCanvas) {
    const scaled = _getScaledAtlas(s);
    const aw = _exportAtlasCanvas.width;
    const sx = _prevView.panX, sy = _prevView.panY;
    const sw = aw * _prevView.zoom;

    _expDrawChecker(ctx, sx, sy, sw, sw);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scaled, sx, sy, sw, sw);

    _expLabel.textContent = `${aw} × ${aw} px`;
    if (_expOutputInfo) _expOutputInfo.textContent = `${aw} × ${aw} px`;

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
    const src = state.atlasCanvas;
    if (!src) { _expFileSizeEl.textContent = ""; return; }
    const aw = src.width;
    const scaled = exportScaleCanvas(src, aw, aw, s.filter);
    const blob   = await new Promise(res => scaled.toBlob(res, fmt.mime, qual));
    _expFileSizeEl.textContent = blob ? "≈ " + _fmtBytes(blob.size) : "";
    _expFilenameEl.textContent = s.name + fmt.ext;
  } else {
    let total = 0;
    for (let i = 0; i < _exportRegions.length; i++) {
      const r = _exportRegions[i];
      if (!r.extracted) continue;
      const scaled = _prevScaledRegions[i]?.canvas ?? (() => {
        const tw = Math.max(1, Math.round((r.outputW || r.extracted.width)  * _exportScale));
        const th = Math.max(1, Math.round((r.outputH || r.extracted.height) * _exportScale));
        return exportScaleCanvas(r.extracted, tw, th, s.filter);
      })();
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
async function _applyExportModeUI(mode) {
  _exportMode = mode;
  _expModeAtlas.classList.toggle("active",  mode === "atlas");
  _expModeRegion.classList.toggle("active", mode === "regions");
  _expUVSection.style.display = mode === "atlas" ? "" : "none";
  _fitPrevView();
  _renderPrevCanvas(); // shows fallback scaled regions immediately
  if (mode === "regions") {
    if (typeof _runAtlasPipelineAndStore === "function") {
      await _runAtlasPipelineAndStore();
    }
    _buildStyledRegions();
  } else _scheduleFileSizeEst();
}

// ── Open / close ───────────────────────────────────────────────────────────

/**
 * Build `_exportAtlasCanvas` — an OWNED COPY of the pipelined atlas at the
 * requested scale. Never shares a reference with `state.atlasCanvas`; always
 * a fresh canvas so the export is completely isolated from the live pipeline.
 * Called on open, on scale change, and when the pipeline finishes (via hook).
 * @param {number} scale
 */
function _buildExportAtlas(scale) {
  _prevScaled = null;

  const src = state.atlasCanvas || state.atlasBaseCanvas;
  const sz  = Math.max(1, Math.round(_exportNativeAtlasSize * scale));
  const c   = document.createElement("canvas");
  c.width   = sz; c.height = sz;
  const ctx = c.getContext("2d");

  if (src) {
    ctx.imageSmoothingEnabled = (sz !== src.width);
    if (ctx.imageSmoothingEnabled) ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, sz, sz);
  } else {
    // No atlas canvas yet — composite directly from regions
    _exportRegions.forEach((r, i) =>
      _drawOnAtlas(ctx, r.extracted, _exportPlacements[i], 0, 0, scale));
  }
  _exportAtlasCanvas = c;
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

  // Build the atlas canvas synchronously (now a pure rescale — no pipeline runners called)
  _buildExportAtlas(_exportScale);

  _expBackdrop.classList.add("open");
  _exportResizeObs = new ResizeObserver(() => _renderPrevCanvas());
  _exportResizeObs.observe(_expPreviewWrap);

  requestAnimationFrame(() => {
    _applyExportModeUI("atlas");
  });
}

/** @returns {void} */
function _closeExportModal() {
  _expBackdrop.classList.remove("open");
  _exportResizeObs?.disconnect();
  _exportResizeObs = null;
  clearTimeout(_exportPreviewTimer);
  clearTimeout(_exportSizeTimer);
  _prevScaled        = null;
  _prevScaledRegions = [];
  _exportAtlasCanvas = null; // release reference so the canvas can be GC'd
  _exportMode        = "atlas"; // reset for next open
  renderPreview();
}

// ── Export ─────────────────────────────────────────────────────────────────

/** @returns {Promise<void>} */
async function _doExport() {
  if (_exportMode === "atlas" && !state.atlasCanvas) return;
  const s    = _readExportSettings();
  const fmt  = _EXP_FMT[s.format] ?? _EXP_FMT.png;
  const qual = s.format === "jpeg" ? s.quality / 100 : undefined;

  if (_exportMode === "atlas") {
    // Use the live pipelined canvas — always current, never stale
    const exportSrc = _getScaledAtlas(s) ?? state.atlasCanvas;
    if (!exportSrc) return;
    const atlasW = exportSrc.width;
    const blob   = await new Promise(res => exportSrc.toBlob(res, fmt.mime, qual));
    if (blob) downloadBlob(blob, s.name + fmt.ext);

    if (s.engine !== "none") {
      // UV coords use native (un-scaled) placement coords
      if (s.engine === "blender_zenuv") {
        const svgStr = exportBuildZenUVSVG(_exportRegions, _exportPlacements, _exportNativeAtlasSize, s.naming, exportSrc);
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
    // Ensure styled regions are built (sync; usually already done by the time user clicks Export)
    _buildStyledRegions();
    const entries = await Promise.all(_exportRegions.map(async (r, i) => {
      const canvas = _prevScaledRegions[i]?.canvas ?? (() => {
        const tw = Math.max(1, Math.round((r.outputW || r.extracted.width)  * _exportScale));
        const th = Math.max(1, Math.round((r.outputH || r.extracted.height) * _exportScale));
        return exportScaleCanvas(r.extracted, tw, th, s.filter);
      })();
      const blob = await new Promise(res => canvas.toBlob(res, fmt.mime, qual));
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

_expModeAtlas.addEventListener("click",  () => { _applyExportModeUI("atlas"); });
_expModeRegion.addEventListener("click", async () => { await _applyExportModeUI("regions"); });

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
  // Ensure atlas pipeline is applied before building from state.atlasCanvas
  if (typeof _runAtlasPipelineAndStore === "function") {
    await _runAtlasPipelineAndStore();
  }
  _prevScaledRegions = []; // invalidate region cache — scale changed
  _buildExportAtlas(_exportScale); // sync rescale
  _fitPrevView();
  _buildStyledRegions(); // sync: re-extract regions from the rescaled atlas
  _renderPrevCanvas();
  _scheduleFileSizeEst();
});
_expFilter.addEventListener("change", () => {
  // Filter affects atlas scaling but not the atlas-extraction approach for regions
  // (regions are cropped from the already-rendered atlas, filter only applies to atlas preview)
  _scheduleExportPreview();
});
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
