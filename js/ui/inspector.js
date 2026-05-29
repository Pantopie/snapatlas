// ── REGION MANAGEMENT ──────────────────────────────────────────────────────
/** @param {Photo} photo @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
function addRegion(photo, x1, y1, x2, y2) {
  const n = ++state.regionCounter;
  const thumb = thumbCrop(photo.img, x1, y1, x2, y2);
  const srcW = (x2 - x1) * photo.img.width;
  const srcH = (y2 - y1) * photo.img.height;
  const { outputW, outputH } = _defaultDims(srcW, srcH);
  const newIdx = state.regions.length;
  state.regions.push({
    id: nanoid(),
    photoId: photo.id,
    label: `region_${n}`,
    _userNamed: false,
    box: [x1, y1, x2, y2],
    outputW,
    outputH,
    selected: true,
    noRotate: true,
    material: null,
    thumb,
    parentId: null,
    cropX: 0,
    cropY: 0,
    pipeline: defaultPipeline(),
    extracted: null,
    _rawCrop: null,
    _variantInputCache: null,
    _variantInputDirty: true,
    _classifying: false,
    _runController: null,
  });

  state.processed = false;
  state.atlasCanvas = null;
  state.atlasBaseCanvas = null;

  // Auto-open newly created region in the inspector
  selectRegion(newIdx);

  renderCanvas();
  renderPreview();
  updateButtons();
  saveProject();
  onboarding?.advance("first-texture", "region");

  // Kick off the CPU pipeline immediately so the atlas preview populates
  // without requiring a manual run. Async blocks are skipped by autoRunCPU.
  autoRunCPU(state.regions[newIdx], 0);
}

/** @param {HTMLImageElement} img @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @returns {string} */
function thumbCrop(img, x1, y1, x2, y2) {
  const c = document.createElement("canvas");
  c.width = 88;
  c.height = 56;
  c.getContext("2d").drawImage(
    img,
    x1 * img.width,
    y1 * img.height,
    (x2 - x1) * img.width,
    (y2 - y1) * img.height,
    0,
    0,
    88,
    56,
  );
  return c.toDataURL();
}

// ── REGION INSPECTOR ──────────────────────────────────────────────────────
/** @param {number|null} idx */
function selectRegion(idx) {
  if (idx !== state.inspectedIdx) {
    // Reset tile view when switching regions so the new texture is framed cleanly
    tileView.zoom = 1; tileView.panX = 0; tileView.panY = 0;
  }
  state.inspectedIdx = idx;
  renderInspector();
  renderCanvas();
  renderPreview();
}

/** @returns {void} */
function _rebuildAtlasFromState() {
  const selected = state.regions.filter(r => r.selected && r.extracted);
  if (!selected.length) {
    state.atlasBaseCanvas = null;
    state.atlasCanvas = null;
    return;
  }
  const layout = packAtlas(selected);
  if (!layout) {
    state.atlasBaseCanvas = null;
    state.atlasCanvas = null;
    return;
  }
  state.packedLayout = layout;
  state.packedStrips = selected;
  const { atlasSize, placements } = layout;
  const scale = state.outputScale ?? 1;
  const scaledSize = Math.max(1, Math.round(atlasSize * scale));
  const c = document.createElement("canvas");
  c.width = scaledSize; c.height = scaledSize;
  const actx = c.getContext("2d");
  selected.forEach((r, i) => _drawOnAtlas(actx, r.extracted, placements[i], 0, 0, scale));
  state.atlasBaseCanvas = c;
  state.atlasCanvas = c; // pre-pipeline fallback until pipeline completes
  invalidateAtlasFrom(state.atlas, 0); // base changed — all atlas blocks are stale
  _runAtlasPipelineAndStore();
}

/** @returns {void} */
function rebuildAtlas() {
  _rebuildAtlasFromState();
}

// ── ATLAS PIPELINE EXECUTION ──────────────────────────────────────────────

let _atlasPipelineGen = 0;
/** @type {AbortController | null} */
let _atlasPipelineAbort = null;

/** Run the global atlas pipeline and store the result in state. */
async function _runAtlasPipelineAndStore() {
  if (!state.atlasBaseCanvas) return;
  // Cancel any in-flight run so its async yields abort immediately
  _atlasPipelineAbort?.abort();
  const ctrl = new AbortController();
  _atlasPipelineAbort = ctrl;
  const gen = ++_atlasPipelineGen;
  const result = await runAtlasPipeline(state.atlas, state.atlasBaseCanvas, ctrl.signal);
  if (gen !== _atlasPipelineGen) return; // a newer run has taken over
  state.atlasCanvas = result || state.atlasBaseCanvas;
  renderPreview();
  // Update block preview canvases in-place without rebuilding the inspector DOM.
  // A full renderInspector() would destroy range sliders mid-drag.
  _refreshAtlasBlockPreviews();
}

/**
 * Toggle the running visual on a single atlas block card without re-rendering
 * the whole inspector (which would destroy active range sliders).
 * Called from runAtlasPipeline before/after each block executes.
 * @param {number} bi   Block index
 * @param {boolean} on  true = show spinner, false = restore icon
 */
function _refreshAtlasBlockRunningState(bi, on) {
  if (state.inspectedIdx !== null) return; // atlas inspector not visible
  const item = inspectorEl.querySelector(`.block-item[data-block="${bi}"]`);
  if (!item) return;
  item.classList.toggle("running", on);
  const iconEl = item.querySelector(".block-icon");
  if (!iconEl) return;
  const def = BLOCK_DEFS[state.atlas.pipeline[bi]?.type];
  iconEl.innerHTML = on
    ? `<span class="block-spinner">${Lucide.iconHTML("loader", 14)}</span>`
    : Lucide.iconHTML(def?.icon ?? "square");
}

/**
 * Update atlas block preview canvases after the pipeline runs.
 * Uses an in-place canvas draw to avoid destroying active slider elements.
 * Falls back to a full renderInspector() only when a block has a new cache
 * but its canvas element hasn't been rendered yet (first-run case).
 */
function _refreshAtlasBlockPreviews() {
  if (state.inspectedIdx !== null) return; // atlas inspector not visible
  // If any block now has a cache but no canvas element in the DOM, we need a
  // full re-render (happens the first time a block produces output).
  const needsRebuild = state.atlas.pipeline.some(
    (b, bi) => b._cache && !inspectorEl.querySelector(`#bpvc-${bi}`)
  );
  if (needsRebuild) {
    renderInspector();
    return;
  }
  _setupBlockPreviews(inspectorEl, state.atlas.pipeline);
}

// ── MATERIAL CLASSIFICATION ──────────────────────────────────────────────────
/** @param {Region} r @returns {Promise<void>} */
async function classifyRegion(r) {
  // Variants always inherit from parent — never classify independently.
  if (r.parentId) {
    const par = getParentRegion(r);
    if (par?.material) { showToast("Classification inherited from parent"); return; }
    showToast("Classify the parent region first", "error"); return;
  }
  if (!state.apiKey) { showApiKeyModal(() => classifyRegion(r)); return; }
  const rawCanvas = _rawCropCanvas(r);
  if (!rawCanvas) { showToast("No image to classify", "error"); return; }
  r._classifying = true;
  renderInspector();
  try {
    r.material = await _classifyMaterial(rawCanvas);
    // Auto-name from subtype when the user hasn't renamed the region yet
    if (!r._userNamed && r.material.subtype) {
      r.label = r.material.subtype
        .split(/[,;]/)[0]
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "") || r.label;
      renderCanvas();
    }
    // Propagate to any variants that don't have their own override
    getVariants(r).forEach(v => { if (!v.material) renderInspector(); });
    saveProject();
  } catch (e) {
    console.error("[Classify] failed:", e);
    showToast("Classification failed", "error");
  }
  r._classifying = false;
  renderInspector();
}

// ── CROP CANVAS ───────────────────────────────────────────────────────────────
/** @param {Region} r @param {Region | null} parent @param {HTMLCanvasElement} canvas */
function _initCropCanvas(r, parent, canvas) {
  if (!parent?.extracted) {
    // Parent not run yet — just size the canvas and show a placeholder
    canvas.width  = canvas.parentElement?.clientWidth - 20 || 240;
    canvas.height = 48;
    const cx = canvas.getContext("2d");
    cx.fillStyle = "#1a1a1a";
    cx.fillRect(0, 0, canvas.width, canvas.height);
    cx.fillStyle = "#555";
    cx.font = "10px system-ui";
    cx.textAlign = "center";
    cx.fillText("Run parent region first", canvas.width / 2, canvas.height / 2 + 4);
    return;
  }

  const src  = parent.extracted;
  const MAXW = (canvas.parentElement?.clientWidth || 280) - 20;
  const MAXH = 200;
  const scale = Math.min(MAXW / src.width, MAXH / src.height);
  const cW = Math.round(src.width  * scale);
  const cH = Math.round(src.height * scale);
  canvas.width  = cW;
  canvas.height = cH;

  // Mirror _variantInputCanvas crop math exactly:
  // when r.outputW >= parent.outputW, no sub-region crop — the variant covers
  // the full parent output. Otherwise, scale r.outputW through the parent
  // extract-to-output ratio so the crop window is proportional.
  const noCrop = r.outputW >= parent.outputW && r.outputH >= parent.outputH;
  const cropScaleX = src.width  / parent.outputW;
  const cropScaleY = src.height / parent.outputH;
  const cropW = noCrop ? src.width  : Math.round(Math.min(r.outputW * cropScaleX, src.width));
  const cropH = noCrop ? src.height : Math.round(Math.min(r.outputH * cropScaleY, src.height));
  const maxOx = Math.max(0, src.width  - cropW);
  const maxOy = Math.max(0, src.height - cropH);

  function draw() {
    const cx = canvas.getContext("2d");
    cx.drawImage(src, 0, 0, cW, cH);

    if (noCrop) {
      // Full coverage — subtle border, no dim
      cx.strokeStyle = "rgba(255,255,255,0.4)";
      cx.lineWidth = 1;
      cx.strokeRect(0.5, 0.5, cW - 1, cH - 1);
      cx.fillStyle = "rgba(255,255,255,0.65)";
      cx.font = "bold 9px system-ui";
      const lbl = `${r.outputW}×${r.outputH} (full)`;
      const tw = cx.measureText(lbl).width;
      cx.fillStyle = "rgba(0,0,0,0.55)";
      cx.fillRect(4, 4, tw + 8, 14);
      cx.fillStyle = "#fff";
      cx.fillText(lbl, 8, 14);
      return;
    }

    const ox = Math.round(r.cropX * maxOx);
    const oy = Math.round(r.cropY * maxOy);
    const rx = ox * scale, ry = oy * scale;
    const rw = cropW * scale, rh = cropH * scale;

    // Dim outside the crop window
    cx.fillStyle = "rgba(0,0,0,0.55)";
    cx.fillRect(0,       0,       cW,  ry            );
    cx.fillRect(0,       ry + rh, cW,  cH - ry - rh  );
    cx.fillRect(0,       ry,      rx,  rh             );
    cx.fillRect(rx + rw, ry,      cW - rx - rw, rh   );

    // Crop border
    cx.strokeStyle = "rgba(255,255,255,0.85)";
    cx.lineWidth = 1.5;
    cx.strokeRect(rx + 0.75, ry + 0.75, rw - 1.5, rh - 1.5);

    // Rule-of-thirds lines
    cx.strokeStyle = "rgba(255,255,255,0.2)";
    cx.lineWidth = 0.5;
    for (let t = 1; t <= 2; t++) {
      cx.beginPath(); cx.moveTo(rx + rw * t / 3, ry); cx.lineTo(rx + rw * t / 3, ry + rh); cx.stroke();
      cx.beginPath(); cx.moveTo(rx, ry + rh * t / 3); cx.lineTo(rx + rw, ry + rh * t / 3); cx.stroke();
    }

    // Corner handles
    const HS = 5;
    cx.fillStyle = "#fff";
    [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]].forEach(([hx, hy]) => {
      cx.fillRect(hx - HS / 2, hy - HS / 2, HS, HS);
    });

    // Dimensions label
    const lbl = `${r.outputW}×${r.outputH}`;
    cx.font = "bold 9px system-ui";
    const tw = cx.measureText(lbl).width;
    cx.fillStyle = "rgba(0,0,0,0.6)";
    cx.fillRect(rx + 3, ry + 3, tw + 6, 14);
    cx.fillStyle = "#fff";
    cx.fillText(lbl, rx + 6, ry + 13);
  }

  draw();

  let dragging = false, startPx = 0, startPy = 0, startCropX = 0, startCropY = 0;

  canvas.addEventListener("pointerdown", e => {
    if (noCrop) return; // full coverage — nothing to drag
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    startPx = e.offsetX;
    startPy = e.offsetY;
    startCropX = r.cropX;
    startCropY = r.cropY;
    canvas.style.cursor = "grabbing";
  });

  canvas.addEventListener("pointermove", e => {
    if (!dragging) return;
    const mox = Math.max(1, maxOx);
    const moy = Math.max(1, maxOy);
    r.cropX = Math.max(0, Math.min(1, startCropX + (e.offsetX - startPx) / (mox * scale)));
    r.cropY = Math.max(0, Math.min(1, startCropY + (e.offsetY - startPy) / (moy * scale)));
    r._variantInputDirty = true;
    invalidateCacheFrom(r, 0);
    draw();
    autoRunCPU(r, 0);
  });

  canvas.addEventListener("pointerup", () => {
    dragging = false;
    canvas.style.cursor = noCrop ? "default" : "grab";
    saveProject();
  });

  canvas.style.cursor = noCrop ? "default" : "grab";
}

// ── BLOCK HTML BUILDER ────────────────────────────────────────────────────

/**
 * Build HTML for a pipeline's block list.
 * @param {Block[]} pipeline
 * @returns {string}
 */
function _buildBlocksHTML(pipeline) {
  return pipeline.map((b, bi) => {
    const def = BLOCK_DEFS[b.type] ?? { label: b.type, icon: "square", isAsync: false, hasConfigure: false, paramsUI: [] };
    const isRunning = b._running;
    const isDone = !b._dirty && b._cache;

    // Colored status dot — shown only for async blocks, hidden while running
    const asyncDot = (def.isAsync && !isRunning) ? (() => {
      if (isDone)          return `<span class="block-dot green"  title="Output cached — ready to use">●</span>`;
      if (b._everRun)      return `<span class="block-dot yellow" title="Output stale — re-run to update">●</span>`;
      return                      `<span class="block-dot red"    title="Not run yet">●</span>`;
    })() : "";

    const paramsHTML = (() => {
      const SECTION_LABELS = {
        dir: "Direction",
        shift: "Shift",
        band: "Band",
        sharpen: "Sharpen",
        noise: "Noise",
        debug: "",
        offset: "Offset",
        scale: "Scale",
        rotate: "Rotate",
      };

      const filtered = (def.paramsUI ?? []).filter(p => {
        if (!p.showIf) return true;
        const depKey = Object.keys(p.showIf)[0];
        return p.showIf[depKey].includes(b.params[depKey]);
      });

      // Group by group field, preserving order
      const groups = [];
      const seen = new Set();
      for (const p of filtered) {
        const g = p.group || "_ungrouped";
        if (!seen.has(g)) { seen.add(g); groups.push({ key: g, params: [] }); }
        groups.find(x => x.key === g).params.push(p);
      }

      const base = groups.map(sg => {
        const label = SECTION_LABELS[sg.key] ?? "";
        const html = sg.params.map(p => {
          const val = b.params[p.key];
          if (p.type === "range") {
            return `<label class="block-param">
              <span class="block-param-label">${p.label}</span>
              <input type="range" class="block-range" data-block="${bi}" data-key="${p.key}"
                min="${p.min}" max="${p.max}" step="${p.step}" value="${val}">
              <span class="block-param-val" id="bpv-${bi}-${p.key}" data-block="${bi}" data-key="${p.key}">${val}${p.suffix ?? ""}</span>
            </label>`;
          }
          if (p.type === "select") {
            const opts = p.options.map(o => `<option value="${o.value}" ${val == o.value ? "selected" : ""}>${o.label}</option>`).join("");
            return `<label class="block-param">
              <span class="block-param-label">${p.label}</span>
              <select class="block-select" data-block="${bi}" data-key="${p.key}">${opts}</select>
            </label>`;
          }
          if (p.type === "toggle") {
            return `<label class="block-param block-param-toggle">
              <span class="block-param-label">${p.label}</span>
              <input type="checkbox" class="block-toggle" data-block="${bi}" data-key="${p.key}" ${val ? "checked" : ""}>
            </label>`;
          }
          if (p.type === "textarea") {
            return `<div class="block-param block-param-textarea">
              <span class="block-param-label">${p.label}</span>
              <textarea class="block-textarea" data-block="${bi}" data-key="${p.key}"
                placeholder="${p.placeholder ?? ""}" rows="3">${val ?? ""}</textarea>
            </div>`;
          }
          return "";
        }).join("");
        const header = label ? `<h3 class="param-section-header">${label}</h3>` : "";
        return `<div class="param-section${!label ? " param-section-flush" : ""}">${header}${html}</div>`;
      }).join("");

      if (b.type !== "curves") return base;

      const ch = b._activeCh || "rgb";
      return base + `<div class="curves-inline">
        <div class="opt-strip opt-strip--plain">
          <button class="opt-btn opt-btn--sm ${ch==="rgb"?"active":""}" data-ch="rgb">RGB</button>
          <button class="opt-btn opt-btn--sm ${ch==="r"?"active":""}" data-ch="r">R</button>
          <button class="opt-btn opt-btn--sm ${ch==="g"?"active":""}" data-ch="g">G</button>
          <button class="opt-btn opt-btn--sm ${ch==="b"?"active":""}" data-ch="b">B</button>
          <button class="curves-ireset">Reset</button>
        </div>
        <canvas class="curves-inline-canvas" id="curves-cv-${bi}"></canvas>
        <div class="curves-inline-hint">click add · drag move · dbl-click remove</div>
      </div>`;
    })();

    const aiRunning = isRunning && def.isAsync;

    const pvHTML = aiRunning
      ? `<div class="block-pv-wrap block-pv-running"><span class="block-ai-running-text">Sending to AI…</span></div>`
      : b._cache
        ? `<div class="block-pv-wrap${!b.enabled ? " block-pv-disabled" : ""}"><canvas class="block-pv-canvas" id="bpvc-${bi}"></canvas></div>`
        : !b.enabled ? ""
        : `<div class="block-pv-wrap block-pv-empty"></div>`;

    // Prominent full-width action button for blocks that need explicit user interaction
    const footerHTML = (() => {
      if (def.hasConfigure) {
        const label = b.type === "perspective" ? `${Lucide.iconHTML('locate-fixed')} Edit Corners`
                    : b.type === "curves"      ? `${Lucide.iconHTML('pencil')} Edit Curves`
                    :                            `${Lucide.iconHTML('pencil')} Configure`;
        return `<button class="block-footer-btn block-configure" data-block="${bi}">${label}</button>`;
      }
      if (def.isAsync) {
        const label = aiRunning  ? `<span class="block-spinner">${Lucide.iconHTML('loader', 14)}</span> Running…`
                    : b._everRun ? `${Lucide.iconHTML('play')} Re-run`
                    :              `${Lucide.iconHTML('play')} Run`;
        return `<button class="block-footer-btn block-run" data-block="${bi}" ${aiRunning ? "disabled" : ""}>${label}</button>`;
      }
      return "";
    })();

    return `<div class="block-item ${aiRunning ? "running" : ""} ${!b.enabled ? "is-disabled" : ""}"
              data-block="${bi}">
      <div class="block-drag" data-block="${bi}">${Lucide.iconHTML('grip-vertical')}</div>
      <button class="block-toggle-btn ${b.enabled ? "on" : "off"}" data-block="${bi}" title="${b.enabled ? "Disable" : "Enable"}">${Lucide.iconHTML('circle')}</button>
      <div class="block-identity">
        <span class="block-icon">${Lucide.iconHTML(def.icon)}</span>
        <span class="block-label">${def.label}</span>
        ${asyncDot}
        ${!def.isAsync && isDone && !aiRunning ? `<span class="block-done">${Lucide.iconHTML('check')}</span>` : ""}
      </div>
      <div class="block-actions">
        ${def.isAsync && b._debug ? `<button class="block-btn block-debug" data-block="${bi}" title="Inspect AI request / response">${Lucide.iconHTML('search')}</button>` : ""}
        <button class="block-btn block-remove" data-block="${bi}" title="Remove block">${Lucide.iconHTML('x')}</button>
      </div>
      ${paramsHTML ? `<div class="block-params">${paramsHTML}</div>` : ""}
      ${pvHTML}
      ${footerHTML}
    </div>`;
  }).join("");
}

/**
 * Draw cached block previews into their canvas elements.
 * @param {Element} containerEl
 * @param {Block[]} pipeline
 */
function _setupBlockPreviews(containerEl, pipeline) {
  const _inspW = inspectorEl.clientWidth - 20;
  pipeline.forEach((b, bi) => {
    if (!b._cache) return;
    const pvc = containerEl.querySelector(`#bpvc-${bi}`);
    if (!pvc) return;
    const maxW = _inspW > 40 ? _inspW : 200;
    const maxH = 96;
    const scale = Math.min(maxW / b._cache.width, maxH / b._cache.height);
    pvc.width  = b._cache.width;
    pvc.height = b._cache.height;
    pvc.style.width  = Math.round(b._cache.width  * scale) + "px";
    pvc.style.height = Math.round(b._cache.height * scale) + "px";
    pvc.getContext("2d").drawImage(b._cache, 0, 0);
  });
}

// Module-level save debounce (shared across inspector renders)
let _saveTimer;
const _debounceSave = (ms) => { clearTimeout(_saveTimer); _saveTimer = setTimeout(saveProject, ms); };

/**
 * Run the CPU pipeline on every selected region that is dirty or has never
 * produced an extracted canvas. Async blocks are always skipped by autoRunCPU.
 * Call this whenever the atlas needs to be up-to-date without a manual run.
 */
function _autoRunDirtyRegions() {
  for (const r of state.regions) {
    if (!r.selected) continue;
    if (r._runController) continue; // already running
    const needsRun = !r.extracted || r.pipeline.some(
      b => b.enabled && !BLOCK_DEFS[b.type]?.isAsync && b._dirty
    );
    if (needsRun) autoRunCPU(r, 0);
  }
}

// ── INSPECTOR DISPATCH ────────────────────────────────────────────────────

/** @returns {void} */
function renderInspector() {
  if (state.inspectedIdx === null || !state.regions[state.inspectedIdx]) {
    _renderAtlasInspector();
    return;
  }
  _renderRegionInspector(state.inspectedIdx);
}

// ── ATLAS INSPECTOR ───────────────────────────────────────────────────────

function _renderAtlasInspector() {
  const atlas = state.atlas;
  const total = state.regions.length;
  const included = state.regions.filter(r => r.selected && r.extracted).length;
  const atlasSize = state.packedLayout?.atlasSize || 0;

  const regionListHTML = total
    ? state.regions.map((r, i) => {
        const color = regionColor(r, i);
        return `<div class="atlas-region-row ${!r.selected ? "is-excluded" : ""}">
          <label class="atlas-region-toggle" title="${r.selected ? "Exclude from atlas" : "Include in atlas"}">
            <input type="checkbox" class="atlas-region-check" data-idx="${i}" ${r.selected ? "checked" : ""}>
          </label>
          <span class="atlas-region-swatch" style="background:${color}"></span>
          <button class="atlas-region-name" data-goto="${i}">${r.label.replace(/_/g, " ")}${r.parentId ? ` <span class="chip chip-accent" style="font-size:9px">v</span>` : ""}</button>
          <span class="atlas-region-dims">${r.outputW}×${r.outputH}</span>
        </div>`;
      }).join("")
    : `<div class="empty-state" style="padding:var(--s2) var(--s3)">No regions yet</div>`;

  const blocksHTML = _buildBlocksHTML(atlas.pipeline);

  const atlasBlockPickerHTML = (() => {
    const cats = BLOCK_CATEGORIES.map(cat => {
      const items = Object.entries(BLOCK_DEFS).filter(([type, def]) =>
        !def.hidden && def.category === cat.key && ATLAS_BLOCK_TYPES.has(type)
      );
      if (!items.length) return "";
      return `<div class="block-picker-cat">${cat.label}</div>` +
        items.map(([type, def]) =>
          `<button class="block-picker-item" data-type="${type}">
            <span class="picker-item-icon">${Lucide.iconHTML(def.icon)}</span>
            <span class="picker-item-label">${def.label}</span>
            ${def.desc ? `<span class="picker-item-desc">${def.desc}</span>` : ""}
          </button>`
        ).join("");
    }).join("");
    return cats;
  })();

  const outputScale  = state.outputScale ?? 1;
  const scaledSize   = atlasSize ? Math.max(1, Math.round(atlasSize * outputScale)) : 0;

  const sizeHTML = atlasSize ? `
    <div class="atlas-size-section">
      <div class="atlas-size-row">
        <span class="atlas-size-label">Native</span>
        <span class="atlas-size-val">${atlasSize} × ${atlasSize} px</span>
      </div>
      <div class="atlas-size-row">
        <span class="atlas-size-label">Output</span>
        <span class="atlas-size-val atlas-size-val--accent">${scaledSize} × ${scaledSize} px</span>
        ${outputScaleSelectHTML("atlas-scale-sel", outputScale)}
      </div>
    </div>` : "";

  const footerHTML = atlasSize
    ? `<div class="atlas-info-footer">${Lucide.iconHTML('package', 12)} ${included} texture${included !== 1 ? "s" : ""} · ${scaledSize} × ${scaledSize} px output</div>`
    : "";

  inspectorEl.innerHTML = `
    <div class="insp-header" style="border-left:3px solid var(--border2)">
      <div class="insp-meta">
        <div class="insp-label" style="cursor:default;display:flex;align-items:center;gap:var(--s1)">${Lucide.iconHTML('layout-grid', 14)} Texture Atlas</div>
        <div class="insp-dims" style="color:var(--muted);font-size:var(--fs-label)">${atlasSize ? `${included}/${total} regions` : "No atlas built yet"}</div>
      </div>
    </div>
    ${sizeHTML}
    <h2 class="insp-pipeline-label">Regions <span class="chip chip-surface">${total}</span></h2>
    <div class="atlas-region-list" id="atlas-region-list">${regionListHTML}</div>
    <h2 class="insp-pipeline-label">Global Pipeline</h2>
    <div class="insp-pipeline" id="insp-pipeline">${blocksHTML || `<div class="empty-state">No global blocks — add one below</div>`}</div>
    <div class="block-add-wrap">
      <button class="block-footer-btn" id="insp-add-block">${Lucide.iconHTML('plus')} Add Block</button>
      <div class="block-picker" id="insp-block-picker" style="display:none">${atlasBlockPickerHTML}</div>
    </div>
    ${footerHTML}
  `;

  // Draw block preview canvases
  _setupBlockPreviews(inspectorEl, atlas.pipeline);

  // Init inline curves editors for atlas
  atlas.pipeline.forEach((b, bi) => {
    if (b.type === "curves") {
      initInlineCurvesEditor(
        { pipeline: atlas.pipeline },
        bi,
        () => { invalidateAtlasFrom(atlas, bi); _runAtlasPipelineAndStore(); saveProject(); }
      );
    }
  });

  // Output scale selector — delegates to shared handler (syncs toolbar, rebuilds, saves)
  inspectorEl.querySelector("#atlas-scale-sel")?.addEventListener("change", e => {
    applyOutputScale(parseFloat(e.target.value));
  });

  // Region list events
  inspectorEl.querySelectorAll(".atlas-region-check").forEach(cb => {
    cb.addEventListener("change", e => {
      const idx = +e.target.dataset.idx;
      state.regions[idx].selected = e.target.checked;
      // If the newly-included region hasn't been processed, kick off its CPU run
      if (e.target.checked) _autoRunDirtyRegions();
      renderCanvas(); renderPreview(); updateButtons(); saveProject();
    });
  });
  inspectorEl.querySelectorAll(".atlas-region-name").forEach(btn => {
    btn.addEventListener("click", e => {
      selectRegion(+e.currentTarget.dataset.goto);
    });
  });

  // Wire atlas block events
  _wireAtlasBlockEvents(atlas);
}

/**
 * Wire all block-level events for the atlas pipeline.
 * @param {{ pipeline: Block[] }} atlas
 */
function _wireAtlasBlockEvents(atlas) {
  const pipeline = atlas.pipeline;

  const invalidate = (bi) => invalidateAtlasFrom(atlas, bi);
  const run = () => _runAtlasPipelineAndStore();

  // Block enable/disable toggle
  inspectorEl.querySelectorAll(".block-toggle-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      const bi = +e.currentTarget.dataset.block;
      pipeline[bi].enabled = !pipeline[bi].enabled;
      // Preserve this block's own cache — only downstream blocks need to re-run.
      // This means re-enabling a block (e.g. stylize) reuses its cached output
      // instead of re-running the full pixel loop from scratch.
      invalidate(bi + 1);
      run();
      renderInspector();
      saveProject();
    });
  });

  // Double-click param value label to reset to default
  inspectorEl.querySelectorAll(".block-param-val").forEach(valEl => {
    valEl.style.cursor = "default";
    valEl.title = "Double-click to reset";
    valEl.addEventListener("dblclick", e => {
      const bi = +e.target.dataset.block;
      if (isNaN(bi) || !pipeline[bi]) return;
      const key = e.target.dataset.key;
      const defaultVal = BLOCK_DEFS[pipeline[bi].type]?.defaultParams?.[key];
      if (defaultVal === undefined) return;
      pipeline[bi].params[key] = defaultVal;
      const rangeEl = inspectorEl.querySelector(`.block-range[data-block="${bi}"][data-key="${key}"]`);
      if (rangeEl) rangeEl.value = defaultVal;
      const pDef = BLOCK_DEFS[pipeline[bi].type]?.paramsUI?.find(p => p.key === key);
      e.target.textContent = defaultVal + (pDef?.suffix ?? "");
      invalidate(bi);
      run();
      renderInspector();
      _debounceSave(300);
    });
  });

  // Range sliders
  inspectorEl.querySelectorAll(".block-range").forEach(inp => {
    inp.addEventListener("pointerup", () => renderInspector());
    inp.addEventListener("input", e => {
      const bi = +e.target.dataset.block;
      if (isNaN(bi) || !pipeline[bi]) return;
      const key = e.target.dataset.key;
      const pDef = BLOCK_DEFS[pipeline[bi].type]?.paramsUI?.find(p => p.key === key);
      const val = pDef?.step && pDef.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
      pipeline[bi].params[key] = val;
      const valEl = inspectorEl.querySelector(`#bpv-${bi}-${key}`);
      if (valEl) valEl.textContent = val + (pDef?.suffix ?? "");
      invalidate(bi);
      run();
      _debounceSave(300);
    });
  });

  // Select dropdowns
  inspectorEl.querySelectorAll(".block-select").forEach(sel => {
    sel.addEventListener("change", e => {
      const bi = +e.target.dataset.block;
      const key = e.target.dataset.key;
      pipeline[bi].params[key] = e.target.value;
      invalidate(bi);
      run();
      renderInspector();
      saveProject();
    });
  });

  // Checkbox toggles
  inspectorEl.querySelectorAll(".block-toggle").forEach(cb => {
    cb.addEventListener("change", e => {
      const bi = +e.target.dataset.block;
      const key = e.target.dataset.key;
      pipeline[bi].params[key] = e.target.checked;
      invalidate(bi);
      run();
      renderInspector();
      saveProject();
    });
  });

  // Textareas
  inspectorEl.querySelectorAll(".block-textarea").forEach(ta => {
    ta.addEventListener("input", e => {
      const bi = +e.target.dataset.block;
      const key = e.target.dataset.key;
      pipeline[bi].params[key] = e.target.value;
      invalidate(bi);
      _debounceSave(500);
    });
  });

  // Block remove
  inspectorEl.querySelectorAll(".block-remove").forEach(btn => {
    btn.addEventListener("click", e => {
      const bi = +e.currentTarget.dataset.block;
      pipeline.splice(bi, 1);
      invalidate(bi);
      run();
      renderInspector();
      saveProject();
    });
  });

  // Add block button
  const addBtn = inspectorEl.querySelector("#insp-add-block");
  const picker = inspectorEl.querySelector("#insp-block-picker");
  addBtn?.addEventListener("click", () => {
    picker.style.display = picker.style.display === "none" ? "block" : "none";
  });
  picker?.querySelectorAll(".block-picker-item").forEach(btn => {
    btn.addEventListener("click", () => {
      pipeline.push(makeBlock(btn.dataset.type));
      picker.style.display = "none";
      const newIdx = pipeline.length - 1;
      invalidate(newIdx);
      run();
      renderInspector();
      saveProject();
    });
  });

  // Pipeline reorder via drag handle
  const pipelineEl = inspectorEl.querySelector("#insp-pipeline");
  if (!pipelineEl) return;
  pipelineEl.querySelectorAll(".block-drag").forEach(handle => {
    handle.addEventListener("mousedown", e => {
      e.preventDefault();
      const srcIdx = +handle.dataset.block;
      const srcItem = handle.closest(".block-item");
      srcItem.classList.add("dragging");

      const items = () => [...pipelineEl.querySelectorAll(".block-item")];

      const onMove = (mv) => {
        items().forEach(it => it.classList.remove("drag-over"));
        const over = items().find(it => {
          const rect = it.getBoundingClientRect();
          return mv.clientY >= rect.top && mv.clientY < rect.bottom;
        });
        if (over && +over.dataset.block !== srcIdx) over.classList.add("drag-over");
      };

      const onUp = (up) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        items().forEach(it => it.classList.remove("dragging", "drag-over"));

        const targetEl = items().find(it => {
          const rect = it.getBoundingClientRect();
          return up.clientY >= rect.top && up.clientY < rect.bottom;
        });
        const targetIdx = targetEl ? +targetEl.dataset.block : null;
        if (targetIdx !== null && targetIdx !== srcIdx) {
          const [moved] = pipeline.splice(srcIdx, 1);
          pipeline.splice(targetIdx, 0, moved);
          invalidate(Math.min(srcIdx, targetIdx));
          run();
          renderInspector();
          saveProject();
        }
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });
}

// ── REGION INSPECTOR ─────────────────────────────────────────────────────

/** @param {number} i */
function _renderRegionInspector(i) {
  const r = state.regions[i];
  const color = regionColor(r, i);

  // Variant / parent helpers — must come first, referenced by material vars below
  const parent     = getParentRegion(r);
  const variants   = getVariants(r);
  const isVariant  = !!parent;
  const maxW       = isVariant ? parent.outputW : 1024;
  const maxH       = isVariant ? parent.outputH : 1024;

  // Split variant labels: "region_1_v2" → { base: "region 1", variant: "v2" }
  const parseLabel = (lbl) => {
    const m = lbl.match(/^(.+?)_v(\d+)$/);
    return m ? { base: m[1].replace(/_/g, " "), variant: `v${m[2]}` } : { base: lbl.replace(/_/g, " "), variant: null };
  };
  const { base: displayLabel, variant: variantTag } = parseLabel(r.label);

  // Variants inherit material from parent — no need for independent classification.
  const effectiveMat = r.material ?? (isVariant ? parent.material : null);
  const matInherited = isVariant && !r.material && !!effectiveMat;
  const matCls    = effectiveMat?.materialClass ?? null;
  const matDef    = matCls ? (MATERIAL_CLASSES[matCls] ?? MATERIAL_CLASSES.generic) : null;
  const semDef    = effectiveMat?.semanticClass ? (SEMANTIC_CLASSES[effectiveMat.semanticClass] ?? null) : null;
  const tilDef    = effectiveMat?.tilingClass   ? (TILING_CLASSES[effectiveMat.tilingClass]   ?? null) : null;

  // Pipeline blocks HTML
  const blocksHTML = _buildBlocksHTML(r.pipeline);

  const addBlockHTML = `<div class="block-add-wrap">
    <button class="block-footer-btn" id="insp-add-block">${Lucide.iconHTML('plus')} Add Block</button>
    <div class="block-picker" id="insp-block-picker" style="display:none">
      ${BLOCK_CATEGORIES.map(cat => {
        const items = Object.entries(BLOCK_DEFS).filter(([, def]) => !def.hidden && !def.atlasOnly && def.category === cat.key);
        if (!items.length) return "";
        return `<div class="block-picker-cat">${cat.label}</div>` +
          items.map(([type, def]) => `<button class="block-picker-item" data-type="${type}"><span class="picker-item-icon">${Lucide.iconHTML(def.icon)}</span><span class="picker-item-label">${def.label}${def.isAsync ? ' <span class="chip chip-accent">AI</span>' : ""}</span>${def.desc ? `<span class="picker-item-desc">${def.desc}</span>` : ""}</button>`).join("");
      }).join("")}
    </div>
  </div>`;

  const inheritedHTML = isVariant ? `
    <details class="insp-inherited" id="insp-inherited">
      <summary class="insp-inherited-summary">Inherited from ${parent.label.replace(/_/g, " ")} <span class="chip chip-surface">${parent.pipeline.length} block${parent.pipeline.length === 1 ? "" : "s"}</span></summary>
      <div class="insp-inherited-blocks">
        ${parent.pipeline.map(pb => {
          const pdef = BLOCK_DEFS[pb.type] ?? { label: pb.type, icon: "square" };
          const pDone = !pb._dirty && pb._cache;
          return `<div class="block-item block-item-inherited ${!pb.enabled ? "is-disabled" : ""}">
            <div class="block-drag" style="visibility:hidden">${Lucide.iconHTML('grip-vertical')}</div>
            <span class="block-toggle-btn ${pb.enabled ? "on" : "off"}" style="cursor:default">${Lucide.iconHTML('circle')}</span>
            <div class="block-identity">
              <span class="block-icon">${Lucide.iconHTML(pdef.icon)}</span>
              <span class="block-label">${pdef.label}</span>
              ${pDone ? `<span class="block-done">${Lucide.iconHTML('check')}</span>` : ""}
            </div>
          </div>`;
        }).join("")}
      </div>
    </details>` : "";

  // Variants list (shown on parent)
  const variantsHTML = !isVariant ? `
    <div class="insp-variants-section">
      <h2 class="insp-variants-label">Variants <span class="chip chip-surface">${variants.length}</span></h2>
      ${variants.map(v => {
        const vi = state.regions.indexOf(v);
        const { base, variant } = parseLabel(v.label);
        return `<button class="insp-variant-chip" data-variant-idx="${vi}">${Lucide.iconHTML('corner-down-right')} ${base} <span class="chip chip-accent">${variant}</span> <span class="insp-variant-dims">${v.outputW}×${v.outputH}</span></button>`;
      }).join("")}
      <button class="block-footer-btn" id="insp-add-variant">${Lucide.iconHTML('plus')} Add Variant</button>
    </div>` : "";

  // Crop picker canvas (variant only)
  const cropHTML = isVariant ? `
    <div class="insp-crop-section">
      <h2 class="insp-pipeline-label">Crop window
        <span class="insp-crop-hint">${parent?.extracted ? "drag to reposition" : "run parent first"}</span>
      </h2>
      <canvas class="insp-crop-canvas" id="insp-crop-canvas"></canvas>
    </div>` : "";

  // Material section HTML
  const matSectionHTML = (() => {
    if (r._classifying) return `
      <div class="insp-material-section">
        <div class="insp-mat-classifying">
          <span class="insp-mat-spinner">${Lucide.iconHTML('loader', 14)}</span> Classifying…
        </div>
      </div>`;
    if (matDef) return `
      <div class="insp-material-section">
        ${!matInherited ? `<button class="insp-mat-reset" id="insp-mat-reset" title="Reset classification">${Lucide.iconHTML('x')} Reset</button>` : ""}
        <div class="insp-mat-row">
          <span class="chip chip-muted chip-primary mat-${matCls}">${matDef.emoji} ${matDef.label}</span>
          ${semDef ? `<span class="chip chip-muted">${semDef.emoji} ${semDef.label}</span>` : ""}
          ${tilDef ? `<span class="chip chip-muted">${tilDef.emoji} ${tilDef.label}</span>` : ""}
          ${matInherited ? `<span class="insp-mat-inherited">from parent</span>` : ""}
        </div>
        ${effectiveMat.subtype ? `<div class="insp-mat-subtype">${effectiveMat.subtype}</div>` : ""}
      </div>`;
    // Variants with no parent material yet → nothing to show until parent is classified
    if (isVariant) return `
      <div class="insp-material-section">
        <div class="insp-mat-classifying is-disabled">Classify parent region first</div>
      </div>`;
    return `
      <div class="insp-material-section">
        <button class="dashed small full" id="insp-classify" title="Run AI material classification">
          ${Lucide.iconHTML('search')} Classify Material <span class="chip chip-accent">AI</span>
        </button>
      </div>`;
  })();

  const thumbSrc = r.thumb || (isVariant ? parent.thumb : "") || "";
  inspectorEl.innerHTML = `
    <div class="insp-header" style="border-left:3px solid ${color}">
      ${thumbSrc ? `<img class="insp-thumb" src="${thumbSrc}" alt="">` : ""}
      <div class="insp-meta">
        ${isVariant ? `<div class="insp-variant-parent-link" id="insp-parent-link" data-parent-idx="${state.regions.indexOf(parent)}">${Lucide.iconHTML('corner-down-right')} ${parent.label.replace(/_/g, " ")}</div>` : ""}
        <div class="insp-label" id="insp-label" data-idx="${i}">${displayLabel}${variantTag ? ` <span class="chip chip-accent">${variantTag}</span>` : ""}</div>
        <div class="insp-dims">
          <input type="number" class="dim-input dim-w" id="insp-dim-w" min="${GRID}" max="${maxW}" step="${state.snapGrid}" value="${r.outputW}">
          <span class="dim-sep">×</span>
          <input type="number" class="dim-input dim-h" id="insp-dim-h" min="${GRID}" max="${maxH}" step="${state.snapGrid}" value="${r.outputH}">
        </div>
      </div>
      <div class="insp-head-actions">
        <label class="insp-sel-label" title="Include in atlas">
          <input type="checkbox" id="insp-selected" ${r.selected ? "checked" : ""}>
          In atlas
        </label>
        <button class="insp-rotate${r.noRotate ? "" : " on"}" id="insp-rotate" title="${r.noRotate ? "Rotation off — click to allow packing rotation" : "Rotation on — click to disable"}">${Lucide.iconHTML('rotate-ccw')}</button>
        <button class="insp-dl" id="insp-dl" title="Download" ${r.extracted ? "" : "disabled"}>${Lucide.iconHTML('download')}</button>
        <button class="insp-delete" id="insp-delete" title="Delete region">${Lucide.iconHTML('trash-2')}</button>
      </div>
    </div>
    ${matSectionHTML}
    ${cropHTML}
    ${inheritedHTML}
    <h2 class="insp-pipeline-label">Pipeline${isVariant ? ` <span class="chip chip-accent">variant</span>` : ""}</h2>
    <div class="insp-pipeline" id="insp-pipeline">${blocksHTML || `<div class="empty-state">No blocks — add one below</div>`}</div>
    ${addBlockHTML}
    ${variantsHTML}
  `;

  // Draw per-block preview canvases
  _setupBlockPreviews(inspectorEl, r.pipeline);

  // Init inline curves editors
  r.pipeline.forEach((b, bi) => {
    if (b.type === "curves") initInlineCurvesEditor(r, bi);
  });

  // ── Event wiring ──────────────────────────────────────────────────────────
  // Label double-click to rename
  inspectorEl.querySelector("#insp-label").addEventListener("dblclick", () => {
    const el = inspectorEl.querySelector("#insp-label");
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = r.label.replace(/_/g, " ");
    inp.style.cssText = "background:var(--bg);border:1px solid var(--accent);color:var(--text);font:inherit;font-size:11px;width:100%;padding:1px 4px;border-radius:3px;outline:none;";
    el.replaceWith(inp);
    inp.focus(); inp.select();
    const commit = () => {
      const raw = inp.value.trim().replace(/\s+/g, "_");
      if (raw) { r.label = raw; r._userNamed = true; }
      renderCanvas(); renderInspector(); saveProject();
    };
    inp.addEventListener("blur", commit);
    inp.addEventListener("keydown", e => { if (e.key === "Enter") commit(); if (e.key === "Escape") renderInspector(); });
  });

  // Dim inputs
  inspectorEl.querySelector("#insp-dim-w").addEventListener("change", e => {
    let v = _snapDim(+e.target.value);
    if (parent) v = Math.min(v, parent.outputW);
    r.outputW = v;
    r._rawCrop = null;
    r.extracted = null;
    invalidateCacheFrom(r, 0);
    autoRunCPU(r, 0);
    renderInspector(); updateButtons(); saveProject();
    onboarding?.advance("first-texture", "resize");
  });
  inspectorEl.querySelector("#insp-dim-h").addEventListener("change", e => {
    let v = _snapDim(+e.target.value);
    if (parent) v = Math.min(v, parent.outputH);
    r.outputH = v;
    r._rawCrop = null;
    r.extracted = null;
    invalidateCacheFrom(r, 0);
    autoRunCPU(r, 0);
    renderInspector(); updateButtons(); saveProject();
    onboarding?.advance("first-texture", "resize");
  });

  // Material section
  inspectorEl.querySelector("#insp-mat-reset")?.addEventListener("click", () => {
    r.material = null; renderInspector(); saveProject();
  });
  inspectorEl.querySelector("#insp-classify")?.addEventListener("click", () => {
    classifyRegion(r);
  });

  // Atlas inclusion toggle
  inspectorEl.querySelector("#insp-selected").addEventListener("change", e => {
    r.selected = e.target.checked;
    renderCanvas(); renderPreview(); updateButtons(); saveProject();
  });

  // Rotation toggle
  inspectorEl.querySelector("#insp-rotate").addEventListener("click", () => {
    r.noRotate = !r.noRotate;
    renderInspector();
    renderCanvas(); renderPreview(); updateButtons(); saveProject();
  });

  // Download
  inspectorEl.querySelector("#insp-dl").addEventListener("click", () => {
    if (r.extracted) downloadRegion(r);
  });

  // Delete — with orphan promotion for variants
  inspectorEl.querySelector("#insp-delete").addEventListener("click", () => {
    const idx = state.inspectedIdx;
    // Promote any variants of this region to standalone
    const orphans = getVariants(r);
    orphans.forEach(v => {
      v.parentId = null;
      v.cropX = 0;
      v.cropY = 0;
      // Keep existing extracted if present; otherwise snapshot parent's
      if (!v.extracted && r.extracted) {
        const snap = document.createElement("canvas");
        snap.width = r.extracted.width; snap.height = r.extracted.height;
        snap.getContext("2d").drawImage(r.extracted, 0, 0);
        v.extracted = snap;
      }
    });
    if (orphans.length) showToast(`${orphans.length} variant${orphans.length > 1 ? "s" : ""} promoted to standalone`);
    state.regions.splice(idx, 1);
    state.inspectedIdx = idx >= state.regions.length
      ? (state.regions.length ? state.regions.length - 1 : null)
      : idx;
    if (!state.regions.some(r => r.extracted)) {
      state.atlasCanvas = null;
      state.atlasBaseCanvas = null;
      state.processed = false;
    }
    renderCanvas(); renderInspector(); renderPreview(); updateButtons(); saveProject();
  });

  // Crop canvas (variant only)
  const cropCanvas = inspectorEl.querySelector("#insp-crop-canvas");
  if (cropCanvas) _initCropCanvas(r, parent, cropCanvas);

  // Parent link — navigate to parent inspector
  inspectorEl.querySelector("#insp-parent-link")?.addEventListener("click", e => {
    const pidx = +e.currentTarget.dataset.parentIdx;
    if (!isNaN(pidx) && state.regions[pidx]) selectRegion(pidx);
  });

  // Variant chips — navigate to variant inspector
  inspectorEl.querySelectorAll(".insp-variant-chip").forEach(btn => {
    btn.addEventListener("click", e => {
      const vidx = +e.currentTarget.dataset.variantIdx;
      if (!isNaN(vidx) && state.regions[vidx]) selectRegion(vidx);
    });
  });

  // Add variant
  inspectorEl.querySelector("#insp-add-variant")?.addEventListener("click", () => {
    const siblingCount = getVariants(r).length;
    const newVariant = {
      id: nanoid(),
      label: `${r.label}_v${siblingCount + 2}`,
      box: [...r.box],
      outputW: r.outputW,
      outputH: r.outputH,
      selected: true,
      noRotate: true,
      material: null,
      thumb: r.thumb,
      parentId: r.id,
      cropX: 0,
      cropY: 0,
      pipeline: [],
      extracted: null,
      _rawCrop: null,
      _variantInputCache: null,
      _variantInputDirty: true,
      _classifying: false,
      _runController: null,
    };
    state.regions.push(newVariant);
    selectRegion(state.regions.length - 1);
    autoRunCPU(newVariant, 0);
    renderCanvas(); renderPreview(); updateButtons(); saveProject();
  });


  // Block toggles, params, run, preview, configure, remove
  inspectorEl.querySelectorAll(".block-toggle-btn").forEach(btn => {
    btn.addEventListener("click", async e => {
      const bi = +e.currentTarget.dataset.block;
      r.pipeline[bi].enabled = !r.pipeline[bi].enabled;
      // Always preserve the toggled block's own cache — only downstream blocks
      // need to re-run. Re-enabling restores the cached output instantly instead
      // of re-running the full block computation from scratch.
      invalidateCacheFrom(r, bi + 1);
      renderInspector();
      await autoRunCPU(r, bi + 1);
      renderInspector();
      saveProject();
    });
  });

  // Double-click the value label to reset slider to its block definition default.
  // (dblclick on range inputs is unreliable — attach to the value span instead)
  inspectorEl.querySelectorAll(".block-param-val").forEach(valEl => {
    valEl.style.cursor = "default";
    valEl.title = "Double-click to reset";
    valEl.addEventListener("dblclick", e => {
      const bi = +e.target.dataset.block;
      if (isNaN(bi) || !r.pipeline[bi]) return;
      const key = e.target.dataset.key;
      const defaultVal = BLOCK_DEFS[r.pipeline[bi].type]?.defaultParams?.[key];
      if (defaultVal === undefined) return;
      r.pipeline[bi].params[key] = defaultVal;
      const rangeEl = inspectorEl.querySelector(`.block-range[data-block="${bi}"][data-key="${key}"]`);
      if (rangeEl) rangeEl.value = defaultVal;
      const pDef = BLOCK_DEFS[r.pipeline[bi].type]?.paramsUI?.find(p => p.key === key);
      e.target.textContent = defaultVal + (pDef?.suffix ?? "");
      invalidateCacheFrom(r, bi);
      autoRunCPU(r, bi);
      renderInspector();
      _debounceSave(300);
    });
  });

  inspectorEl.querySelectorAll(".block-range").forEach(inp => {
    // Refresh the full inspector only after the drag ends — mid-drag renderInspector
    // rebuilds the DOM and destroys the active slider element.
    inp.addEventListener("pointerup", () => renderInspector());
    inp.addEventListener("input", e => {
      const bi = +e.target.dataset.block;
      if (isNaN(bi) || !r.pipeline[bi]) return; // belt-and-suspenders: skip any non-block range inputs
      const key = e.target.dataset.key;
      const pDef = BLOCK_DEFS[r.pipeline[bi].type]?.paramsUI?.find(p => p.key === key);
      const val = pDef?.step && pDef.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
      r.pipeline[bi].params[key] = val;
      const valEl = inspectorEl.querySelector(`#bpv-${bi}-${key}`);
      if (valEl) valEl.textContent = val + (pDef?.suffix ?? "");
      // Scale lock: sync scaleY when scaleX changes and vice versa
      if ((key === "scaleX" || key === "scaleY") && r.pipeline[bi].params.scaleLock) {
        const otherKey = key === "scaleX" ? "scaleY" : "scaleX";
        r.pipeline[bi].params[otherKey] = val;
        const otherEl = inspectorEl.querySelector(`.block-range[data-block="${bi}"][data-key="${otherKey}"]`);
        if (otherEl) otherEl.value = val;
        const otherValEl = inspectorEl.querySelector(`#bpv-${bi}-${otherKey}`);
        if (otherValEl) otherValEl.textContent = val + "%";
      }
      invalidateCacheFrom(r, bi);
      autoRunCPU(r, bi);
      _debounceSave(300);
    });
  });

  inspectorEl.querySelectorAll(".block-select").forEach(sel => {
    sel.addEventListener("change", e => {
      const bi = +e.target.dataset.block;
      const key = e.target.dataset.key;
      r.pipeline[bi].params[key] = e.target.value;
      invalidateCacheFrom(r, bi);
      autoRunCPU(r, bi);
      renderInspector();
      saveProject();
    });
  });

  inspectorEl.querySelectorAll(".block-toggle").forEach(cb => {
    cb.addEventListener("change", e => {
      const bi = +e.target.dataset.block;
      const key = e.target.dataset.key;
      r.pipeline[bi].params[key] = e.target.checked;
      invalidateCacheFrom(r, bi);
      autoRunCPU(r, bi);
      renderInspector();
      saveProject();
    });
  });

  inspectorEl.querySelectorAll(".block-textarea").forEach(ta => {
    ta.addEventListener("input", e => {
      const bi = +e.target.dataset.block;
      const key = e.target.dataset.key;
      r.pipeline[bi].params[key] = e.target.value;
      invalidateCacheFrom(r, bi);
      _debounceSave(500);
    });
  });

  inspectorEl.querySelectorAll(".block-debug").forEach(btn => {
    btn.addEventListener("click", e => {
      const bi = +e.currentTarget.dataset.block;
      const b = r.pipeline[bi];
      const def = BLOCK_DEFS[b.type];
      openDebugModal(b._debug, `${r.label.replace(/_/g, " ")} · ${def?.label ?? b.type}`);
    });
  });

  inspectorEl.querySelectorAll(".block-run").forEach(btn => {
    btn.addEventListener("click", e => {
      const bi = +e.currentTarget.dataset.block;
      runFromBlock(r, bi);
    });
  });

  inspectorEl.querySelectorAll(".block-configure").forEach(btn => {
    btn.addEventListener("click", e => {
      const bi = +e.currentTarget.dataset.block;
      if (r.pipeline[bi].type === "perspective") openCornersModal(i);
    });
  });

  inspectorEl.querySelectorAll(".block-remove").forEach(btn => {
    btn.addEventListener("click", e => {
      const bi = +e.currentTarget.dataset.block;
      r.pipeline.splice(bi, 1);
      invalidateCacheFrom(r, bi);
      autoRunCPU(r, bi);
      renderInspector();
      saveProject();
    });
  });

  // Add block button
  const addBtn = inspectorEl.querySelector("#insp-add-block");
  const picker = inspectorEl.querySelector("#insp-block-picker");
  addBtn.addEventListener("click", () => {
    picker.style.display = picker.style.display === "none" ? "block" : "none";
  });
  picker.querySelectorAll(".block-picker-item").forEach(btn => {
    btn.addEventListener("click", () => {
      r.pipeline.push(makeBlock(btn.dataset.type));
      analytics.track("block_added", { block: btn.dataset.type });
      onboarding?.advance("first-texture", "block");
      picker.style.display = "none";
      const newIdx = r.pipeline.length - 1;
      invalidateCacheFrom(r, newIdx);
      autoRunCPU(r, newIdx);
      renderInspector();
      saveProject();
    });
  });

  // Pipeline reorder via mousedown on the handle — no HTML5 DnD (which breaks range inputs)
  const pipelineEl = inspectorEl.querySelector("#insp-pipeline");
  pipelineEl.querySelectorAll(".block-drag").forEach(handle => {
    handle.addEventListener("mousedown", e => {
      e.preventDefault();
      const srcIdx = +handle.dataset.block;
      const srcItem = handle.closest(".block-item");
      srcItem.classList.add("dragging");

      const items = () => [...pipelineEl.querySelectorAll(".block-item")];

      const onMove = (mv) => {
        items().forEach(it => it.classList.remove("drag-over"));
        const over = items().find(it => {
          const rect = it.getBoundingClientRect();
          return mv.clientY >= rect.top && mv.clientY < rect.bottom;
        });
        if (over && +over.dataset.block !== srcIdx) over.classList.add("drag-over");
      };

      const onUp = (up) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        items().forEach(it => it.classList.remove("dragging", "drag-over"));

        const targetEl = items().find(it => {
          const rect = it.getBoundingClientRect();
          return up.clientY >= rect.top && up.clientY < rect.bottom;
        });
        const targetIdx = targetEl ? +targetEl.dataset.block : null;
        if (targetIdx !== null && targetIdx !== srcIdx) {
          const [moved] = r.pipeline.splice(srcIdx, 1);
          r.pipeline.splice(targetIdx, 0, moved);
          invalidateCacheFrom(r, Math.min(srcIdx, targetIdx));
          autoRunCPU(r, Math.min(srcIdx, targetIdx));
          renderInspector();
          saveProject();
        }
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });
}
