// ── Preview panel ──────────────────────────────────────────────────────────
const pvPanel = document.getElementById("preview-panel");

/** @returns {void} */
function fitPvView() {
  const pw = pvPanel.clientWidth, ph = pvPanel.clientHeight;
  if (!state.pvAtlasSize) {
    pvView.zoom = 1; pvView.panX = pw / 2; pvView.panY = ph / 2;
    renderPreview(); return;
  }
  _fitViewToContent(pvView, state.pvAtlasSize, state.pvAtlasSize, pw, ph, 24);
  renderPreview();
}

/** @param {number} factor @param {MouseEvent} e */
function zoomPvView(factor, e) {
  const [sx, sy] = _eventScreenPos(e, pvCanvas);
  _zoomViewAtPoint(pvView, factor, sx, sy);
}

pvPanel.addEventListener("wheel", _makeCanvasWheelHandler(
  () => state.previewMode === "tile" ? tileView : pvView,
  renderPreview,
  (e) => {
    if (state.previewMode === "tile") {
      const [sx, sy] = _eventScreenPos(e, pvCanvas);
      _zoomViewAtPoint(tileView, 1 - e.deltaY * 0.03, sx, sy, 0.25, 16);
    } else {
      zoomPvView(1 - e.deltaY * 0.03, e);
    }
  },
  (factor, e) => {
    if (state.previewMode === "tile") {
      tileView.zoom = Math.max(0.25, Math.min(16, tileView.zoom * factor));
    } else {
      zoomPvView(factor, e);
    }
  },
), { passive: false });

pvPanel.addEventListener("dblclick", () => {
  if (state.previewMode === "tile") {
    tileView.zoom = 1; tileView.panX = 0; tileView.panY = 0;
    renderPreview();
  } else {
    fitPvView();
  }
});

const _pvPan   = _makePanHandler(() => pvCanvas, () => pvView,   renderPreview);
const _tilePan = _makePanHandler(() => pvCanvas, () => tileView, renderPreview, e => e.button === 0);
pvPanel.addEventListener("mousedown", (e) => {
  if (state.previewMode === "tile") _tilePan.onPanelMousedown(e);
  else _pvPan.onPanelMousedown(e);
});

const _pvTouch   = _makeTouchHandler(() => pvCanvas, () => pvView,   renderPreview);
const _tileTouch = _makeTouchHandler(() => pvCanvas, () => tileView, renderPreview, 0.25, 16);
pvPanel.addEventListener("touchstart", (e) => {
  if (state.previewMode === "tile") _tileTouch.onTouchStart(e);
  else _pvTouch.onTouchStart(e);
}, { passive: false });
pvPanel.addEventListener("touchmove", (e) => {
  if (state.previewMode === "tile") _tileTouch.onTouchMove(e);
  else _pvTouch.onTouchMove(e);
}, { passive: false });
pvPanel.addEventListener("touchend", (e) => {
  if (state.previewMode === "tile") _tileTouch.onTouchEnd(e);
  else _pvTouch.onTouchEnd(e);
});

document.getElementById("btn-reset-pv").addEventListener("click", (e) => {
  e.stopPropagation();
  fitPvView();
});

const btnAtlasSmooth = document.getElementById("btn-atlas-smooth");
btnAtlasSmooth.addEventListener("click", () => {
  atlasSmoothing = !atlasSmoothing;
  btnAtlasSmooth.classList.toggle("active", atlasSmoothing);
  renderPreview();
});

// Window-level pan move/up — shared for both panels
window.addEventListener("mousemove", (e) => { _photoPan.onWindowMousemove(e); _pvPan.onWindowMousemove(e); _tilePan.onWindowMousemove(e); });
window.addEventListener("mouseup",   ()  => { _photoPan.onWindowMouseup();    _pvPan.onWindowMouseup();   _tilePan.onWindowMouseup(); });

// ── Preview mode tabs ──────────────────────────────────────────────────────
pvToggleBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    _switchToTab(btn.dataset.mode);
    renderPreview();
  });
});

// ── UV scale slider (Cube only) ───────────────────────────────────────────
cubeUvSlider.addEventListener("input", () => {
  cubeUvVal.textContent = cubeUvSlider.value + "%";
  if (state.previewMode === "cube") _cube.setScale(+cubeUvSlider.value);
});

// ── Cube auto-rotate toggle ───────────────────────────────────────────────
const btnCubeAutoRotate = document.getElementById("btn-cube-auto-rotate");
btnCubeAutoRotate.addEventListener("click", () => {
  const enabled = !btnCubeAutoRotate.classList.contains("active");
  btnCubeAutoRotate.classList.toggle("active", enabled);
  _cube.setAutoRotate(enabled);
});

// ── Preview canvas resize ──────────────────────────────────────────────────
pvCanvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.altKey || !state.packedLayout) return;
  if (state.previewMode === "tile") return; // tile mode uses _tilePan only
  if (state.previewMode !== "extracted") return;
  const [ax, ay] = pvAtlasPos(e);
  const hit = _getPvResizeEdge(ax, ay);
  if (!hit) return;
  e.stopPropagation(); // prevent pan
  const region = state.pvSelected[hit.selIdx];
  const p = state.packedLayout.placements[hit.selIdx];
  if (!region || !p) return;
  state.pvResizing = {
    region,
    edge: hit.edge,
    startAx: ax,
    startAy: ay,
    startW: p.rotated ? region.outputH : region.outputW,
    startH: p.rotated ? region.outputW : region.outputH,
    rotated: p.rotated,
  };
});

pvCanvas.addEventListener("mousemove", (e) => {
  if (state.pvResizing) return; // handled by window listener
  if (state.previewMode === "tile") {
    if (!pvCanvas.classList.contains("panning")) pvCanvas.style.cursor = "grab";
    return;
  }
  const [ax, ay] = pvAtlasPos(e);
  const inExtracted = state.previewMode === "extracted";
  const hit = inExtracted ? _getPvResizeEdge(ax, ay) : null;
  pvCanvas.style.cursor = hit ? EDGE_CURSORS[hit.edge] : "default";

  const prev = state.pvHovered;
  if (hit) {
    state.pvHovered = hit.selIdx;
  } else if (inExtracted && state.packedLayout) {
    const { placements } = state.packedLayout;
    state.pvHovered = placements.findLastIndex(
      (p) => ax >= p.x && ax <= p.x + p.w && ay >= p.y && ay <= p.y + p.h,
    );
  } else {
    state.pvHovered = -1;
  }
  if (state.pvHovered !== prev) renderPreview();
});

pvCanvas.addEventListener("mouseleave", () => {
  if (state.pvResizing) return;
  state.pvHovered = -1;
  pvCanvas.style.cursor = "default";
  renderPreview();
});

// Click on atlas → select that region for inspector
pvCanvas.addEventListener("click", (e) => {
  if (e.altKey || state.pvResizing || state.previewMode === "tile") return;
  if (!state.packedLayout || !state.pvSelected) return;
  const [ax, ay] = pvAtlasPos(e);
  const { placements } = state.packedLayout;
  const selIdx = placements.findLastIndex(
    p => ax >= p.x && ax <= p.x + p.w && ay >= p.y && ay <= p.y + p.h
  );
  if (selIdx === -1) return;
  const region = state.pvSelected[selIdx];
  const regionIdx = state.regions.indexOf(region);
  if (regionIdx !== -1) selectRegion(regionIdx);
});

// Window-level handlers for pvResizing (so drag stays tracked outside canvas)
window.addEventListener("mousemove", (e) => {
  if (!state.pvResizing) return;
  const { region, edge, startAx, startAy, startW, startH, rotated } =
    state.pvResizing;
  const [ax, ay] = pvAtlasPos(e);
  const snap = (v) =>
    Math.max(GRID, Math.min(1024, Math.round(v / state.snapGrid) * state.snapGrid));
  const dx = ax - startAx, dy = ay - startAy;
  let newW = startW, newH = startH;
  if (edge === "e" || edge === "ne" || edge === "se") newW = snap(startW + dx);
  if (edge === "w" || edge === "nw" || edge === "sw") newW = snap(startW - dx);
  if (edge === "s" || edge === "sw" || edge === "se") newH = snap(startH + dy);
  if (edge === "n" || edge === "nw" || edge === "ne") newH = snap(startH - dy);
  const _resPar = getParentRegion(region);
  if (_resPar) { newW = Math.min(newW, _resPar.outputW); newH = Math.min(newH, _resPar.outputH); }
  if (rotated) { region.outputH = newW; region.outputW = newH; }
  else          { region.outputW = newW; region.outputH = newH; }

  // Patch the placement for the resized region so renderPreview shows the live
  // size without re-running packAtlas.
  if (state.packedLayout) {
    const selIdx = state.pvSelected.indexOf(region);
    if (selIdx !== -1) {
      const p = state.packedLayout.placements[selIdx];
      p.w = rotated ? region.outputH : region.outputW;
      p.h = rotated ? region.outputW : region.outputH;
    }
  }
  renderPreview();

  // Update dim inputs in inspector if it's showing this region
  if (state.inspectedIdx !== null && state.regions[state.inspectedIdx] === region) {
    const wInp = inspectorEl.querySelector("#insp-dim-w");
    const hInp = inspectorEl.querySelector("#insp-dim-h");
    if (wInp) wInp.value = region.outputW;
    if (hInp) hInp.value = region.outputH;
  }
});

window.addEventListener("mouseup", () => {
  if (!state.pvResizing) return;
  state.pvResizing = null;
  pvCanvas.style.cursor = "default";
  rebuildAtlas();
  renderPreview();
  renderInspector();
  saveProject();
  onboarding?.advance("first-texture", "resize");
});

// ── TRIM SHEET PREVIEW ─────────────────────────────────────────────────────
/** @param {Region} r @returns {HTMLCanvasElement | null} */
function _rawCropScaled(r) {
  const photo = getPhotoForRegion(r);
  if (!photo || !r.box) return null;
  if (r._rawCrop && r._rawCrop.width === r.outputW && r._rawCrop.height === r.outputH) {
    return r._rawCrop;
  }
  const img = photo.img;
  const [x1, y1, x2, y2] = r.box;
  const tmp = document.createElement("canvas");
  tmp.width = r.outputW; tmp.height = r.outputH;
  tmp.getContext("2d").drawImage(
    img,
    x1 * img.width, y1 * img.height,
    (x2 - x1) * img.width, (y2 - y1) * img.height,
    0, 0, r.outputW, r.outputH,
  );
  r._rawCrop = tmp;
  return tmp;
}

// ── ANIMATION LOOP ────────────────────────────────────────────────────────
/** @type {number | null} */
let _animRAF = null;
/** @returns {void} */
function _startAnimLoop() {
  if (_animRAF) return;
  function tick() {
    try { renderPreview(); } catch (e) { console.error("[Preview]", e); }
    _animRAF = state.regions.some(r => r._runController) ? requestAnimationFrame(tick) : null;
  }
  _animRAF = requestAnimationFrame(tick);
}

/** @param {Region} r @returns {HTMLCanvasElement | null} */
function _previewSourceFor(r) {
  for (let i = r.pipeline.length - 1; i >= 0; i--) {
    const b = r.pipeline[i];
    if (b.enabled && b._cache && !b._dirty) return b._cache;
  }
  if (r.extracted) return r.extracted;
  // Variants: use the parent crop. Returns null if parent hasn't been run yet —
  // the preview draws a placeholder. Never fall back to _rawCropScaled (wrong box).
  if (r.parentId) return _variantInputCanvas(r);
  return _rawCropScaled(r);
}
/** @param {Region} r @returns {HTMLCanvasElement | null} */
function _tileSourceFor(r) { return _previewSourceFor(r); }
/** @param {Region} r @returns {HTMLCanvasElement | null} */
function _cubeTextureFor(r) { return _previewSourceFor(r); }

/** @returns {void} */
function renderPreview() {
  // ── Tile mode ────────────────────────────────────────────────────────────
  if (state.previewMode === "tile") {
    _cube.stop();
    cubeCanvas.style.display = "none";
    cubeControls.style.display = "none"; // UV slider not needed — scroll to zoom

    const r =
      state.regions[state.inspectedIdx] ?? state.regions.find((r) => r.selected);

    if (!r) {
      pvCanvas.style.display = "none";
      pvHint.style.display = "block";
      pvHint.innerHTML = "Click a region to preview tiling";
      pvSize.textContent = "";
      return;
    }
    const tex = _tileSourceFor(r);
    if (!tex) {
      pvCanvas.style.display = "none";
      pvHint.style.display = "block";
      pvHint.innerHTML = "No texture yet — run Pass 1 first";
      pvSize.textContent = "";
      return;
    }

    pvHint.style.display = "none";
    pvCanvas.style.display = "block";

    const { panelW: availW, panelH: availH, dpr } = _sizeCanvas(pvCanvas, pvPanel);
    const pc = pvCanvas.getContext("2d");
    pc.setTransform(dpr, 0, 0, dpr, 0, 0);

    const uvScale = +cubeUvSlider.value / 100;
    const tilesAcross = Math.max(1, 3 * (0.5 / uvScale));
    const tileDispW = (availW / tilesAcross) * tileView.zoom;
    const tileDispH = tileDispW * (tex.height / tex.width);

    // Wrap pan offset so the tile grid always fills the canvas seamlessly
    const offX = ((tileView.panX % tileDispW) + tileDispW) % tileDispW - tileDispW;
    const offY = ((tileView.panY % tileDispH) + tileDispH) % tileDispH - tileDispH;
    const tilesX = Math.ceil((availW - offX) / tileDispW) + 1;
    const tilesY = Math.ceil((availH - offY) / tileDispH) + 1;

    // Checkerboard background
    const sq = Math.max(4, Math.round(16 * (availW / 512)));
    for (let cy = 0; cy < availH; cy += sq)
      for (let cx = 0; cx < availW; cx += sq) {
        pc.fillStyle = (cx / sq + cy / sq) % 2 === 0 ? "#141518" : "#0e0f11";
        pc.fillRect(cx, cy, sq, sq);
      }

    pc.imageSmoothingEnabled = atlasSmoothing;
    if (atlasSmoothing) pc.imageSmoothingQuality = "high";
    for (let ty = 0; ty < tilesY; ty++)
      for (let tx = 0; tx < tilesX; tx++)
        pc.drawImage(tex, offX + tx * tileDispW, offY + ty * tileDispH, tileDispW, tileDispH);

    pvSize.textContent = `${tex.width} × ${tex.height}`;
    return;
  }

  // ── Cube mode ────────────────────────────────────────────────────────────
  if (state.previewMode === "cube") {
    pvCanvas.style.display = "none";
    pvHint.style.display = "none";
    pvSize.textContent = "";
    cubeCanvas.style.display = "block";
    cubeControls.style.display = "flex";

    // Use explicitly targeted region, else first selected
    const r =
      state.regions[state.inspectedIdx] ?? state.regions.find((r) => r.selected);
    if (!r) {
      _cube.stop();
      cubeCanvas.style.display = "none";
      pvHint.style.display = "block";
      pvHint.innerHTML = "Click a region to preview on the cube";
      return;
    }
    const texCanvas = _cubeTextureFor(r);
    _cube.start(texCanvas, +cubeUvSlider.value);
    btnCubeAutoRotate.classList.add("active"); // reset to on whenever cube starts
    return;
  }

  // Stop cube if it was running
  _cube.stop();
  cubeCanvas.style.display = "none";
  cubeControls.style.display = "none";

  const selected = state.regions.filter((r) => r.selected);
  if (!selected.length) {
    pvCanvas.style.display = "none";
    pvHint.style.display = "block";
    pvHint.innerHTML =
      "Draw regions on the photo<br>to build your texture atlas";
    pvSize.textContent = "";
    state.packedLayout = null;
    return;
  }

  // During an active resize we freeze the layout so the atlas isn't re-packed
  // on every mouse-move frame. The caller patches the affected placement first.
  const layout = state.pvResizing ? state.packedLayout : packAtlas(selected);
  if (!layout) {
    pvCanvas.style.display = "none";
    pvHint.style.display = "block";
    return;
  }
  if (!state.pvResizing) state.packedLayout = layout;
  const { atlasSize, placements } = layout;

  pvHint.style.display = "none";
  pvCanvas.style.display = "block";
  pvSize.textContent = `${atlasSize} × ${atlasSize}`;

  // Auto-fit whenever the atlas size changes (new layout, first render, etc.)
  if (atlasSize !== state.pvAtlasSize) {
    _fitViewToContent(pvView, atlasSize, atlasSize, pvPanel.clientWidth, pvPanel.clientHeight, 24);
  }
  state.pvAtlasSize = atlasSize;
  state.pvSelected  = selected;

  const { panelW, panelH, dpr } = _sizeCanvas(pvCanvas, pvPanel);
  const pc = pvCanvas.getContext("2d");
  pc.setTransform(dpr, 0, 0, dpr, 0, 0);

  const mode = state.previewMode;
  const { panX, panY, zoom } = pvView;
  const atlasDisp = atlasSize * zoom; // displayed atlas size in CSS px

  // Dark fill for the area outside the atlas
  pc.fillStyle = "#07080a";
  pc.fillRect(0, 0, panelW, panelH);

  // Background inside atlas bounds
  if (mode === "wireframe") {
    pc.fillStyle = "#0b0c0e";
    pc.fillRect(panX, panY, atlasDisp, atlasDisp);
  } else {
    const sq = Math.max(4, Math.round(16 * zoom));
    // Start at the grid cell covering panX/panY; clip rect handles drawing bounds.
    const x0 = Math.floor(panX / sq) * sq;
    const y0 = Math.floor(panY / sq) * sq;
    pc.save();
    pc.beginPath(); pc.rect(panX, panY, atlasDisp, atlasDisp); pc.clip();
    for (let row = 0, cy = y0; cy < panY + atlasDisp; row++, cy += sq)
      for (let col = 0, cx = x0; cx < panX + atlasDisp; col++, cx += sq) {
        pc.fillStyle = (row + col) % 2 === 0 ? "#141518" : "#0e0f11";
        pc.fillRect(cx, cy, sq, sq);
      }
    pc.restore();
  }

  pc.imageSmoothingEnabled = atlasSmoothing;
  if (atlasSmoothing) pc.imageSmoothingQuality = "high";

  const regionIdx = new Map(state.regions.map((r, i) => [r, i]));
  const inspectedRegion = state.regions[state.inspectedIdx];
  const inspectedI = inspectedRegion !== undefined ? selected.indexOf(inspectedRegion) : -1;

  selected.forEach((r, i) => {
    const p = placements[i];
    const px = panX + p.x * zoom,
      py = panY + p.y * zoom,
      pw = p.w * zoom,
      ph = p.h * zoom;
    const color = regionColor(r, regionIdx.get(r));
    const isInspected = i === inspectedI;

    if (mode === "wireframe") {
      pc.fillStyle = color + (isInspected ? "30" : "18");
      pc.fillRect(px, py, pw, ph);
    } else {
      // 'extracted' — show pipeline output (or raw crop fallback)
      const srcCanvas = _previewSourceFor(r);
      if (srcCanvas) {
        _drawOnAtlas(pc, srcCanvas, p, panX, panY, zoom);
      } else {
        pc.fillStyle = color + "1a";
        pc.fillRect(px, py, pw, ph);
      }
    }

    // Outer border — white for inspected, dim color otherwise
    pc.strokeStyle = isInspected ? "#ffffff" : color + (mode === "wireframe" ? "dd" : "99");
    pc.lineWidth = isInspected ? 2.5 : mode === "wireframe" ? 1.5 : 1;
    if (r.parentId) pc.setLineDash([4, 3]);
    pc.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
    pc.setLineDash([]);

    // Inner color accent for inspected region (mirrors photo canvas)
    if (isInspected) {
      pc.strokeStyle = color + "cc";
      pc.lineWidth = 1;
      if (r.parentId) pc.setLineDash([4, 3]);
      pc.strokeRect(px + 3, py + 3, pw - 6, ph - 6);
      pc.setLineDash([]);
    }

    // Label chip
    {
      pc.save();
      pc.font = "500 9px DM Mono, monospace";
      const isVar = !!r.parentId;
      const lbl = r.label.replace(/_/g, " ");
      const tw = pc.measureText(lbl).width;
      const chipH = 14, chipPad = 8;
      pc.fillStyle = color + (isInspected || mode === "wireframe" ? "ff" : "cc");
      pc.fillRect(px + 4, py + 4, tw + chipPad, chipH);
      pc.fillStyle = "#0b0c0e";
      pc.fillText(lbl, px + 8, py + 14);
      // Outline tag for variants
      if (isVar) {
        const tagX = px + 4 + tw + chipPad + 3;
        const tagW = pc.measureText("Variant").width + chipPad;
        pc.strokeStyle = color + "cc";
        pc.lineWidth = 1;
        pc.strokeRect(tagX + 0.5, py + 4.5, tagW - 1, chipH - 1);
        pc.fillStyle = color + "cc";
        pc.fillText("Variant", tagX + 4, py + 14);
      }
      if (mode === "wireframe") {
        const dim = `${p.w}×${p.h}${p.rotated ? " ↺" : ""}`;
        const dw = pc.measureText(dim).width;
        pc.fillStyle = color + "55";
        pc.fillRect(px + 4, py + 22, dw + chipPad, chipH);
        pc.fillStyle = p.rotated ? color + "ff" : color + "cc";
        pc.fillText(dim, px + 8, py + 32);
      }
      pc.restore();
    }
  });

  // Processing animation — pulse over any running region
  selected.forEach((r, i) => {
    if (!r._runController) return;
    const p = placements[i];
    if (!p) return;
    const px = panX + p.x * zoom, py = panY + p.y * zoom,
          pw = p.w * zoom,         ph = p.h * zoom;
    const t = Date.now() / 1000;
    pc.save();
    pc.beginPath(); pc.rect(px, py, pw, ph); pc.clip();
    pc.fillStyle = `rgba(200,240,96,${0.07 + 0.06 * Math.sin(t * Math.PI * 2.5)})`;
    pc.fillRect(px, py, pw, ph);
    const scanY = py + ((t * 0.55) % 1) * ph;
    const grad = pc.createLinearGradient(0, scanY - 24, 0, scanY + 24);
    grad.addColorStop(0, "rgba(200,240,96,0)");
    grad.addColorStop(0.5, "rgba(200,240,96,0.45)");
    grad.addColorStop(1, "rgba(200,240,96,0)");
    pc.fillStyle = grad; pc.fillRect(px, scanY - 24, pw, 48);
    pc.strokeStyle = `rgba(200,240,96,${0.5 + 0.5 * Math.sin(t * Math.PI * 2.5)})`;
    pc.lineWidth = 2; pc.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
    pc.restore();
  });

  // Resize handles only in Extracted mode
  if (mode === "extracted" && state.pvHovered >= 0 && placements[state.pvHovered]) {
    const hp  = placements[state.pvHovered];
    const hpx = panX + hp.x * zoom, hpy = panY + hp.y * zoom;
    const hpw = hp.w * zoom,        hph = hp.h * zoom;
    const hr  = state.pvSelected[state.pvHovered];
    const hcolor = hr ? regionColor(hr, state.regions.indexOf(hr)) : "#fff";
    pc.fillStyle = hcolor;
    [
      [hpx,           hpy],
      [hpx + hpw / 2, hpy],
      [hpx + hpw,     hpy],
      [hpx,           hpy + hph / 2],
      [hpx + hpw,     hpy + hph / 2],
      [hpx,           hpy + hph],
      [hpx + hpw / 2, hpy + hph],
      [hpx + hpw,     hpy + hph],
    ].forEach(([hx, hy]) => pc.fillRect(hx - 3, hy - 3, 6, 6));
  }
}

/** @returns {void} */
function updateButtons() {
  const hasRegions = state.regions.length > 0;
  btnDownloadAtlas.classList.toggle("is-hidden", !hasRegions);
  btnDownloadAtlas.disabled = false;
}

/** @param {string} mode */
function _switchToTab(mode) {
  state.previewMode = mode;
  pvToggleBtns.forEach((b) => {
    const isActive = b.dataset.mode === mode;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}
