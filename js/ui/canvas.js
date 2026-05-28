// ── CANVAS RENDERING ───────────────────────────────────────────────────────
function renderCanvas() {
  const { panelW: pw, panelH: ph, dpr } = _sizeCanvas(canvas, photoPanel);

  ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = photoSmoothing;
  if (photoSmoothing) ctx.imageSmoothingQuality = "high";

  if (!state.photos.length) return;

  const { zoom, panX, panY } = photoView;

  for (const photo of state.photos) {
    const sx = photo.x * zoom + panX;
    const sy = photo.y * zoom + panY;
    const sw = photo.img.width  * zoom;
    const sh = photo.img.height * zoom;
    // Skip entirely off-screen photos
    if (sx + sw < 0 || sy + sh < 0 || sx > pw || sy > ph) continue;

    // Subtle shadow around each photo
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur  = Math.max(4, 12 * zoom);
    ctx.drawImage(photo.img, sx, sy, sw, sh);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur  = 0;

    drawRegions(photo, sx, sy, sw, sh);
  }

  // Live rubber-band while drawing
  if (state.drawing && state.drawPhoto) {
    const p  = state.drawPhoto;
    const sx = p.x * zoom + panX;
    const sy = p.y * zoom + panY;
    const sw = p.img.width  * zoom;
    const sh = p.img.height * zoom;
    const rx = Math.min(state.drawStart.x, state.drawEnd.x) * sw + sx;
    const ry = Math.min(state.drawStart.y, state.drawEnd.y) * sh + sy;
    const rw = Math.abs(state.drawEnd.x - state.drawStart.x) * sw;
    const rh = Math.abs(state.drawEnd.y - state.drawStart.y) * sh;
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.globalAlpha = 0.85;
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
    ctx.fillStyle   = "rgba(255,255,255,0.05)";
    ctx.fillRect(rx, ry, rw, rh);
    ctx.restore();
  }
}

const COLORS = [
  "#c8f060", // ~80°  yellow-green
  "#60c8f0", // ~200° sky blue
  "#f0a060", // ~30°  orange
  "#f060a0", // ~330° pink
  "#a060f0", // ~270° violet
  "#60f0a0", // ~150° mint
  "#f0e060", // ~55°  yellow
  "#60a0f0", // ~220° cornflower
  "#f07060", // ~10°  coral
  "#e060f0", // ~290° orchid
  "#60f0d0", // ~170° aqua
  "#f0c060", // ~42°  amber
  "#6080f0", // ~235° periwinkle
  "#f06070", // ~355° rose
  "#80f060", // ~110° lime
  "#60d0f0", // ~190° cyan
  "#f090a0", // ~345° light rose
  "#b0f060", // ~95°  yellow-lime
  "#9060f0", // ~255° indigo
  "#60f0b8", // ~160° seafoam
  "#f0b080", // ~25°  peach
  "#60b0f0", // ~210° light blue
  "#f060c8", // ~315° magenta-pink
  "#70f060", // ~125° green
  "#f0d880", // ~48°  gold
  "#6068f0", // ~243° blue
  "#f06090", // ~340° hot pink
  "#50e8a0", // ~155° jade
  "#d060f0", // ~280° purple
  "#60e8f0", // ~185° turquoise
  "#f08060", // ~18°  salmon
  "#a0f060", // ~100° chartreuse
];

/** @param {Region} r @param {number} i @returns {string} */
function regionColor(r, i) {
  if (!r.parentId) return COLORS[i % COLORS.length];
  const pi = state.regions.findIndex(p => p.id === r.parentId);
  return COLORS[(pi >= 0 ? pi : i) % COLORS.length];
}

/** @param {Photo} photo @param {number} sx @param {number} sy @param {number} sw @param {number} sh */
function drawRegions(photo, sx, sy, sw, sh) {
  state.regions.forEach((r, i) => {
    if (r.photoId !== photo.id) return;
    const [x1, y1, x2, y2] = r.box;
    const rx = x1 * sw + sx;
    const ry = y1 * sh + sy;
    const rw = (x2 - x1) * sw;
    const rh = (y2 - y1) * sh;
    const color = regionColor(r, i);
    const isVariant = !!r.parentId;
    const isHov = i === state.hoveredIdx;
    const isInspected = i === state.inspectedIdx;
    const isSel = r.selected;

    if (!isSel && !isHov && !isInspected) {
      ctx.fillStyle = "rgba(0,0,0,.5)";
      ctx.fillRect(rx, ry, rw, rh);
    }

    ctx.strokeStyle = isInspected ? "#fff" : color;
    ctx.lineWidth = isInspected ? 2.5 : isSel || isHov ? 2 : 1;
    ctx.globalAlpha = isInspected ? 1 : isSel ? 1 : isHov ? 0.85 : 0.45;
    if (isVariant) ctx.setLineDash([4, 3]);
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
    ctx.setLineDash([]);
    if (isInspected) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      if (isVariant) ctx.setLineDash([4, 3]);
      ctx.strokeRect(rx + 2.5, ry + 2.5, rw - 5, rh - 5);
      ctx.setLineDash([]);
    }

    if (isSel || isHov) {
      ctx.globalAlpha = 1;
      ctx.font = "500 10px DM Mono, monospace";
      const lbl = r.label.replace(/_/g, " ");
      const lblW = chip(ctx, color, rx + 6, ry + 6, lbl);
      if (isVariant) chipOutline(ctx, color, rx + 6 + lblW + 4, ry + 6, "Variant");
      if (state.tool === "select") {
        chip(ctx, color, rx + 6, ry + 28, `${r.outputW}×${r.outputH}`);
      }
      if (state.tool !== "select") { ctx.globalAlpha = 1; return; }
      // Resize handles
      const handles = [
        [x1, y1], [x1 + (x2-x1)/2, y1], [x2, y1],
        [x1, y1 + (y2-y1)/2],             [x2, y1 + (y2-y1)/2],
        [x1, y2], [x1 + (x2-x1)/2, y2],  [x2, y2],
      ].map(([hx, hy]) => [hx * sw + sx, hy * sh + sy]);
      ctx.fillStyle = color;
      handles.forEach(([hx, hy]) => ctx.fillRect(hx - 3, hy - 3, 6, 6));
    }
    ctx.globalAlpha = 1;
  });
}

/** @param {CanvasRenderingContext2D} ctx @param {string} color @param {number} x @param {number} y @param {string} text @returns {number} */
function chip(ctx, color, x, y, text) {
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, 18, 3);
  ctx.fill();
  ctx.fillStyle = "#0b0c0e";
  ctx.fillText(text, x + 6, y + 13);
  return w;
}

/** @param {CanvasRenderingContext2D} ctx @param {string} color @param {number} x @param {number} y @param {string} text @returns {number} */
function chipOutline(ctx, color, x, y, text) {
  const w = ctx.measureText(text).width + 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.75;
  roundRect(ctx, x, y, w, 18, 3);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.fillText(text, x + 6, y + 13);
  ctx.globalAlpha = 1;
  return w;
}

/** @param {CanvasRenderingContext2D} c @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r */
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

// ── Touch gesture handler (trackpad pinch/pan via Touch Events) ───────────────
// Both touch and wheel events fire for trackpad gestures on Chrome/Safari. We
// must prevent wheel handler from processing during an active touch gesture,
// otherwise view state gets double-bounced and performance tanks.
/** @type {boolean} */
let _touchInProgress = false;
let _touchEndTimer = null;

/**
 * @param {() => HTMLElement} getEl
 * @param {() => { zoom: number, panX: number, panY: number }} getView
 * @param {() => void} render
 * @param {number} [minZoom]
 * @param {number} [maxZoom]
 * @returns {{ onTouchStart: Function, onTouchMove: Function, onTouchEnd: Function }}
 */
function _makeTouchHandler(getEl, getView, render, minZoom = 0.05, maxZoom = 20) {
  let _t = null;

  return {
    onTouchStart(e) {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      clearTimeout(_touchEndTimer);
      _touchInProgress = true;
      const t = e.touches;
      const rect = getEl().getBoundingClientRect();
      const v  = getView();
      _t = {
        dist: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY),
        midX: (t[0].clientX + t[1].clientX) / 2 - rect.left,
        midY: (t[0].clientY + t[1].clientY) / 2 - rect.top,
        zoom: v.zoom,
        panX: v.panX,
        panY: v.panY,
      };
    },
    onTouchMove(e) {
      if (!_t || e.touches.length !== 2) return;
      e.preventDefault();
      const t = e.touches;
      const rect = getEl().getBoundingClientRect();
      const curDist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      const curMidX = (t[0].clientX + t[1].clientX) / 2 - rect.left;
      const curMidY = (t[0].clientY + t[1].clientY) / 2 - rect.top;

      const v = getView();
      const factor = curDist / Math.max(1, _t.dist);
      v.zoom = Math.max(minZoom, Math.min(maxZoom, _t.zoom * factor));
      const af = v.zoom / _t.zoom;
      v.panX = curMidX - (_t.midX - _t.panX) * af;
      v.panY = curMidY - (_t.midY - _t.panY) * af;
      render();
    },
    onTouchEnd(e) {
      if (e.touches.length < 2) {
        clearTimeout(_touchEndTimer);
        _touchEndTimer = setTimeout(() => { _touchInProgress = false; }, 200);
      }
      _t = null;
    },
  };
}

// ── PAN / ZOOM ─────────────────────────────────────────────────────────────
// Both canvases use the same model: full-panel, world-space transform in JS.
//   view.panX/Y = content-origin offset from canvas top-left (CSS px)
//   screen = world * zoom + pan
/** @type {{ zoom: number, panX: number, panY: number }} */
const photoView = { zoom: 1, panX: 0, panY: 0 };
/** @type {{ zoom: number, panX: number, panY: number }} */
const pvView    = { zoom: 1, panX: 0, panY: 0 };
/** @type {{ zoom: number, panX: number, panY: number }} */
const tileView  = { zoom: 1, panX: 0, panY: 0 };
/** @type {boolean} */
let photoSmoothing = false;
/** @type {boolean} */
let atlasSmoothing = false;

// ── Shared canvas/view helpers ─────────────────────────────────────────────

/** @param {HTMLCanvasElement} canvasEl @param {HTMLElement} panel @returns {{ panelW: number, panelH: number, dpr: number }} */
function _sizeCanvas(canvasEl, panel) {
  const dpr    = window.devicePixelRatio || 1;
  const panelW = panel.clientWidth;
  const panelH = panel.clientHeight;
  const pw = Math.round(panelW * dpr), ph = Math.round(panelH * dpr);
  if (canvasEl.width  !== pw) canvasEl.width  = pw;
  if (canvasEl.height !== ph) canvasEl.height = ph;
  const wPx = panelW + "px", hPx = panelH + "px";
  if (canvasEl.style.width  !== wPx) canvasEl.style.width  = wPx;
  if (canvasEl.style.height !== hPx) canvasEl.style.height = hPx;
  return { panelW, panelH, dpr };
}

/** @param {{ zoom: number, panX: number, panY: number }} view @param {number} contentW @param {number} contentH @param {number} panelW @param {number} panelH @param {number} [pad] */
function _fitViewToContent(view, contentW, contentH, panelW, panelH, pad = 24) {
  view.zoom = Math.min((panelW - pad * 2) / contentW, (panelH - pad * 2) / contentH);
  view.panX = (panelW - contentW * view.zoom) / 2;
  view.panY = (panelH - contentH * view.zoom) / 2;
}

/** @param {{ zoom: number, panX: number, panY: number }} view @param {number} factor @param {number} sx @param {number} sy @param {number} [minZoom] @param {number} [maxZoom] */
function _zoomViewAtPoint(view, factor, sx, sy, minZoom = 0.05, maxZoom = 20) {
  const prev = view.zoom;
  view.zoom = Math.max(minZoom, Math.min(maxZoom, view.zoom * factor));
  const dz = view.zoom / prev;
  view.panX = sx - dz * (sx - view.panX);
  view.panY = sy - dz * (sy - view.panY);
}

/** @param {() => HTMLCanvasElement} getCanvas @param {() => { zoom: number, panX: number, panY: number }} getView @param {() => void} render @param {((e: MouseEvent) => boolean) | null} [extraTrigger] @returns {{ onPanelMousedown: Function, onWindowMousemove: Function, onWindowMouseup: Function }} */
function _makePanHandler(getCanvas, getView, render, extraTrigger = null) {
  let panning = false, panStart = { x: 0, y: 0 }, panOrigin = { x: 0, y: 0 };
  return {
    onPanelMousedown(e) {
      if (e.button !== 1 && !(e.button === 0 && e.altKey) && !(extraTrigger?.(e))) return;
      e.preventDefault();
      panning   = true;
      panStart  = { x: e.clientX, y: e.clientY };
      panOrigin = { x: getView().panX, y: getView().panY };
      getCanvas().classList.add("panning");
    },
    onWindowMousemove(e) {
      if (!panning) return;
      getView().panX = panOrigin.x + e.clientX - panStart.x;
      getView().panY = panOrigin.y + e.clientY - panStart.y;
      render();
    },
    onWindowMouseup() {
      if (!panning) return;
      panning = false;
      getCanvas().classList.remove("panning");
    },
  };
}

/**
 * Shared wheel handler for 2D canvases.
 * Guards against _touchInProgress, dispatches pinch/diagonal-pan/mouse-zoom.
 * @param {() => { zoom: number, panX: number, panY: number }} getView
 * @param {() => void} render
 * @param {(e: WheelEvent) => void} onPinchZoom
 * @param {(factor: number, e: WheelEvent) => void} onMouseZoom
 * @returns {(e: WheelEvent) => void}
 */
function _makeCanvasWheelHandler(getView, render, onPinchZoom, onMouseZoom) {
  let _raf = null;
  let _panActive = false;
  let _panTimer = null;
  const _scheduleRender = () => {
    if (!_raf) _raf = requestAnimationFrame(() => { _raf = null; render(); });
  };
  const _resetPan = () => { _panActive = false; _panTimer = null; };
  return function(e) {
    e.preventDefault();
    if (_touchInProgress) return;
    if (e.ctrlKey) {
      _resetPan();
      onPinchZoom(e);
    } else if (e.deltaX !== 0 && e.deltaY !== 0) {
      _panActive = true;
      clearTimeout(_panTimer);
      _panTimer = setTimeout(_resetPan, 120);
      const v = getView();
      v.panX -= e.deltaX;
      v.panY -= e.deltaY;
    } else if (_panActive && (e.deltaX !== 0 || e.deltaY !== 0)) {
      clearTimeout(_panTimer);
      _panTimer = setTimeout(_resetPan, 120);
      const v = getView();
      if (e.deltaX !== 0) v.panX -= e.deltaX;
      if (e.deltaY !== 0) v.panY -= e.deltaY;
    } else if (e.deltaX !== 0) {
      _resetPan();
      const v = getView();
      v.panX -= e.deltaX;
    } else {
      _resetPan();
      const px = e.deltaMode === 1 ? e.deltaY * 10 : e.deltaY;
      onMouseZoom(px < 0 ? 1 + Math.abs(px) * 0.012 : 1 / (1 + px * 0.012), e);
    }
    _scheduleRender();
  };
}

// ── Photo panel ────────────────────────────────────────────────────────────

/** @returns {void} */
function fitPhotoView() {
  if (!state.photos.length) {
    photoView.zoom = 1; photoView.panX = 0; photoView.panY = 0;
    renderCanvas(); return;
  }
  const pw  = photoPanel.clientWidth;
  const ph  = photoPanel.clientHeight;
  const minX = Math.min(...state.photos.map(p => p.x));
  const minY = Math.min(...state.photos.map(p => p.y));
  const maxX = Math.max(...state.photos.map(p => p.x + p.img.width));
  const maxY = Math.max(...state.photos.map(p => p.y + p.img.height));
  const worldW = maxX - minX || 1;
  const worldH = maxY - minY || 1;
  // Cap at 1:1 so single small photos aren't blown up to fill the panel
  const zoom = Math.min((pw - 80) / worldW, (ph - 80) / worldH, 1);
  photoView.zoom = zoom;
  photoView.panX = (pw - worldW * zoom) / 2 - minX * zoom;
  photoView.panY = (ph - worldH * zoom) / 2 - minY * zoom;
  renderCanvas();
}

/** @param {number} factor @param {MouseEvent} e */
function zoomPhotoView(factor, e) {
  const [sx, sy] = _eventScreenPos(e);
  _zoomViewAtPoint(photoView, factor, sx, sy);
}

photoPanel.addEventListener("wheel", _makeCanvasWheelHandler(
  () => photoView, renderCanvas,
  (e) => zoomPhotoView(1 - e.deltaY * 0.03, e),
  (factor, e) => zoomPhotoView(factor, e),
), { passive: false });

photoPanel.addEventListener("dblclick", () => fitPhotoView());

const _photoPan = _makePanHandler(() => canvas, () => photoView, renderCanvas);
photoPanel.addEventListener("mousedown", (e) => _photoPan.onPanelMousedown(e));

const _photoTouch = _makeTouchHandler(() => canvas, () => photoView, renderCanvas);
photoPanel.addEventListener("touchstart", (e) => _photoTouch.onTouchStart(e), { passive: false });
photoPanel.addEventListener("touchmove",  (e) => _photoTouch.onTouchMove(e),  { passive: false });
photoPanel.addEventListener("touchend",   (e) => _photoTouch.onTouchEnd(e));

document.getElementById("btn-reset-photo").addEventListener("click", (e) => {
  e.stopPropagation();
  fitPhotoView();
});

// ── Photo tool mode (create / select) ─────────────────────────────────────
const photoToolGroup = document.getElementById("photo-tool-group");
const toolSelectBtn = document.getElementById("tool-select");
const toolCreateBtn = document.getElementById("tool-create");

/** @param {string} mode */
function setTool(mode) {
  state.tool = mode;
  toolSelectBtn.classList.toggle("active", mode === "select");
  toolCreateBtn.classList.toggle("active", mode === "create");
  canvas.style.cursor = mode === "create" ? "crosshair" : "default";
}

toolSelectBtn.addEventListener("click", () => setTool("select"));
toolCreateBtn.addEventListener("click", () => setTool("create"));

const btnPhotoSmooth = document.getElementById("btn-photo-smooth");
btnPhotoSmooth.addEventListener("click", () => {
  photoSmoothing = !photoSmoothing;
  btnPhotoSmooth.classList.toggle("active", photoSmoothing);
  renderCanvas();
});

// ── CANVAS INTERACTION — draw to add regions ───────────────────────────────

// ── Coordinate helpers ────────────────────────────────────────────────────
/** @param {number} sx @param {number} sy @returns {[number, number]} */
function _screenToWorld(sx, sy) {
  return [(sx - photoView.panX) / photoView.zoom, (sy - photoView.panY) / photoView.zoom];
}

/** @param {MouseEvent} e @param {HTMLCanvasElement} [el] @returns {[number, number]} */
function _eventScreenPos(e, el = canvas) {
  const cr = el.getBoundingClientRect();
  return [e.clientX - cr.left, e.clientY - cr.top];
}

/** @param {MouseEvent} e @returns {{ photo: Photo, nx: number, ny: number, wx: number, wy: number } | null} */
function _mouseToPhoto(e) {
  const [sx, sy] = _eventScreenPos(e);
  const [wx, wy] = _screenToWorld(sx, sy);
  let photo = null;
  for (let i = state.photos.length - 1; i >= 0; i--) {
    const p = state.photos[i];
    if (wx >= p.x && wx <= p.x + p.img.width && wy >= p.y && wy <= p.y + p.img.height) {
      photo = p; break;
    }
  }
  if (!photo) return null;
  return { photo, nx: (wx - photo.x) / photo.img.width, ny: (wy - photo.y) / photo.img.height, wx, wy };
}

/** @param {MouseEvent} e @param {Photo} photo @returns {[number, number]} */
function _screenPosInPhoto(e, photo) {
  const [sx, sy] = _eventScreenPos(e);
  const [wx, wy] = _screenToWorld(sx, sy);
  return [(wx - photo.x) / photo.img.width, (wy - photo.y) / photo.img.height];
}

/** @param {number} photoId @param {number} nx @param {number} ny @returns {number} */
function _regionHitAt(photoId, nx, ny) {
  return state.regions.findLastIndex(r =>
    r.photoId === photoId && nx >= r.box[0] && nx <= r.box[2] && ny >= r.box[1] && ny <= r.box[3]
  );
}

/** @type {number} */
const EDGE_PX = 7;
/** @param {MouseEvent} e @returns {{ idx: number, edge: string } | null} */
function _getResizeEdge(e) {
  const [mx, my] = _eventScreenPos(e);
  const { zoom, panX, panY } = photoView;
  for (let i = state.regions.length - 1; i >= 0; i--) {
    const r = state.regions[i];
    const photo = getPhotoForRegion(r);
    if (!photo) continue;
    const [x1, y1, x2, y2] = r.box;
    const pw = photo.img.width  * zoom;
    const ph = photo.img.height * zoom;
    const ox = photo.x * zoom + panX;
    const oy = photo.y * zoom + panY;
    const px1 = x1 * pw + ox, py1 = y1 * ph + oy;
    const px2 = x2 * pw + ox, py2 = y2 * ph + oy;
    const onL = Math.abs(mx - px1) <= EDGE_PX, onR = Math.abs(mx - px2) <= EDGE_PX;
    const onT = Math.abs(my - py1) <= EDGE_PX, onB = Math.abs(my - py2) <= EDGE_PX;
    const inX = mx >= px1 - EDGE_PX && mx <= px2 + EDGE_PX;
    const inY = my >= py1 - EDGE_PX && my <= py2 + EDGE_PX;
    if (onL && onT) return { idx: i, edge: "nw" };
    if (onR && onT) return { idx: i, edge: "ne" };
    if (onL && onB) return { idx: i, edge: "sw" };
    if (onR && onB) return { idx: i, edge: "se" };
    if (onL && inY) return { idx: i, edge: "w" };
    if (onR && inY) return { idx: i, edge: "e" };
    if (onT && inX) return { idx: i, edge: "n" };
    if (onB && inX) return { idx: i, edge: "s" };
  }
  return null;
}

const EDGE_CURSORS = {
  n: "n-resize",
  s: "s-resize",
  e: "e-resize",
  w: "w-resize",
  nw: "nw-resize",
  ne: "ne-resize",
  sw: "sw-resize",
  se: "se-resize",
};

/** @param {MouseEvent} e @returns {[number, number]} */
function pvAtlasPos(e) {
  const [sx, sy] = _eventScreenPos(e, pvCanvas);
  return [(sx - pvView.panX) / pvView.zoom, (sy - pvView.panY) / pvView.zoom];
}

/** @param {number} ax @param {number} ay @returns {{ selIdx: number, edge: string } | null} */
function _getPvResizeEdge(ax, ay) {
  if (!state.packedLayout || !state.pvSelected.length) return null;
  const { placements } = state.packedLayout;
  if (!pvView.zoom) return null;
  const EDGE = 7 / pvView.zoom; // 7 screen px → atlas units

  // Build check order: hovered region first, then others top-to-bottom
  const n = placements.length;
  const order =
    state.pvHovered >= 0
      ? [
          state.pvHovered,
          ...[...Array(n).keys()]
            .filter((i) => i !== state.pvHovered)
            .reverse(),
        ]
      : [...Array(n).keys()].reverse();

  function edgeHit(p) {
    const onL = Math.abs(ax - p.x) <= EDGE;
    const onR = Math.abs(ax - (p.x + p.w)) <= EDGE;
    const onT = Math.abs(ay - p.y) <= EDGE;
    const onB = Math.abs(ay - (p.y + p.h)) <= EDGE;
    const inX = ax >= p.x - EDGE && ax <= p.x + p.w + EDGE;
    const inY = ay >= p.y - EDGE && ay <= p.y + p.h + EDGE;
    if (onL && onT) return "nw";
    if (onR && onT) return "ne";
    if (onL && onB) return "sw";
    if (onR && onB) return "se";
    if (onL && inY) return "w";
    if (onR && inY) return "e";
    if (onT && inX) return "n";
    if (onB && inX) return "s";
    return null;
  }

  for (const i of order) {
    const edge = edgeHit(placements[i]);
    if (edge) return { selIdx: i, edge };
  }
  return null;
}

canvas.addEventListener("mousedown", (e) => {
  if (!state.photos.length || e.button !== 0 || e.altKey) return;

  if (state.tool === "select") {
    // 1. Resize edge takes priority
    const hit = _getResizeEdge(e);
    if (hit) {
      state.resizing = { idx: hit.idx, edge: hit.edge, origBox: [...state.regions[hit.idx].box] };
      return;
    }
    const hitPhoto = _mouseToPhoto(e);
    if (hitPhoto) {
      const { photo, nx, ny, wx, wy } = hitPhoto;
      // 2. Region interior → move
      const idx = _regionHitAt(photo.id, nx, ny);
      if (idx !== -1) {
        state.moving = { idx, photo, startNx: nx, startNy: ny, startBox: [...state.regions[idx].box], moved: false };
        canvas.style.cursor = "grabbing";
        return;
      }
      // 3. Photo background drag — wx/wy already computed by _mouseToPhoto
      state.movingPhoto = { photo, startWx: wx, startWy: wy, origX: photo.x, origY: photo.y };
      canvas.style.cursor = "grabbing";
    } else {
      // 4. Clicked canvas background (no photo) → deselect to atlas inspector
      selectRegion(null);
    }
  } else {
    // create mode: draw new region
    const hitPhoto = _mouseToPhoto(e);
    if (!hitPhoto) return;
    state.drawing = true;
    state.drawPhoto = hitPhoto.photo;
    state.drawStart = { x: hitPhoto.nx, y: hitPhoto.ny };
    state.drawEnd   = { x: hitPhoto.nx, y: hitPhoto.ny };
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (!state.photos.length) return;

  // ── Move drag ────────────────────────────────────────────────────────────
  if (state.moving) {
    const { idx, photo, startNx, startNy, startBox } = state.moving;
    const [nx, ny] = _screenPosInPhoto(e, photo);
    const dx = nx - startNx, dy = ny - startNy;
    const [bx1, by1, bx2, by2] = startBox;
    const w = bx2 - bx1, h = by2 - by1;
    const nx1 = Math.max(0, Math.min(1 - w, bx1 + dx));
    const ny1 = Math.max(0, Math.min(1 - h, by1 + dy));
    const mr = state.regions[idx];
    mr.box = [nx1, ny1, nx1 + w, ny1 + h];
    mr._rawCrop = null;
    if (Math.abs(dx) > 0.004 || Math.abs(dy) > 0.004) state.moving.moved = true;
    renderCanvas();
    return;
  }

  // ── Resize drag ──────────────────────────────────────────────────────────
  if (state.resizing) {
    const { idx, edge } = state.resizing;
    const r = state.regions[idx];
    const photo = getPhotoForRegion(r);
    if (!photo) return;
    const [nx, ny] = _screenPosInPhoto(e, photo);
    const minNx = 8 / photo.img.width, minNy = 8 / photo.img.height;
    let [x1, y1, x2, y2] = r.box;
    if (edge === "w" || edge === "nw" || edge === "sw") x1 = Math.min(nx, x2 - minNx);
    if (edge === "e" || edge === "ne" || edge === "se") x2 = Math.max(nx, x1 + minNx);
    if (edge === "n" || edge === "nw" || edge === "ne") y1 = Math.min(ny, y2 - minNy);
    if (edge === "s" || edge === "sw" || edge === "se") y2 = Math.max(ny, y1 + minNy);
    x1 = Math.max(0, x1); y1 = Math.max(0, y1);
    x2 = Math.min(1, x2); y2 = Math.min(1, y2);
    r.box = [x1, y1, x2, y2];
    r._rawCrop = null;
    renderCanvas();
    return;
  }

  // ── Photo drag ───────────────────────────────────────────────────────────
  if (state.movingPhoto) {
    const [sx, sy] = _eventScreenPos(e);
    const [wx, wy] = _screenToWorld(sx, sy);
    const { photo, startWx, startWy, origX, origY } = state.movingPhoto;
    photo.x = origX + wx - startWx;
    photo.y = origY + wy - startWy;
    renderCanvas();
    return;
  }

  if (state.drawing) {
    const [nx, ny] = _screenPosInPhoto(e, state.drawPhoto);
    state.drawEnd = { x: Math.max(0, Math.min(1, nx)), y: Math.max(0, Math.min(1, ny)) };
    renderCanvas();
    return;
  }

  // ── Cursor + hover detection ──────────────────────────────────────────────
  // Single _mouseToPhoto call reused for both cursor and hover.
  const hp = _mouseToPhoto(e);
  if (state.tool === "select") {
    const hit = _getResizeEdge(e);
    canvas.style.cursor = hit ? EDGE_CURSORS[hit.edge] : hp ? "grab" : "default";
  } else {
    canvas.style.cursor = "crosshair";
  }

  const prev = state.hoveredIdx;
  state.hoveredIdx = hp ? _regionHitAt(hp.photo.id, hp.nx, hp.ny) : -1;
  if (state.hoveredIdx !== prev) renderCanvas();
});

canvas.addEventListener("mouseleave", () => {
  state.hoveredIdx = -1;
  canvas.style.cursor = state.tool === "create" ? "crosshair" : "default";
  if (!state.drawing && !state.resizing && !state.moving && !state.movingPhoto) renderCanvas();
});

canvas.addEventListener("mouseup", (e) => {
  // ── Finalize move ──────────────────────────────────────────────────────
  if (state.moving) {
    const { idx, photo, moved } = state.moving;
    const r = state.regions[idx];
    if (!moved) {
      selectRegion(idx);
    } else {
      const [x1, y1, x2, y2] = r.box;
      r.thumb = thumbCrop(photo.img, x1, y1, x2, y2);
      r.extracted = null;
      r.material = null;
      invalidateCacheFrom(r, 0);
    }
    state.moving = null;
    canvas.style.cursor = state.tool === "create" ? "crosshair" : "default";
    renderCanvas();
    renderInspector();
    renderPreview();
    if (moved) saveProject();
    return;
  }

  // ── Finalize resize ────────────────────────────────────────────────────
  if (state.resizing) {
    const { idx } = state.resizing;
    const r = state.regions[idx];
    const photo = getPhotoForRegion(r);
    if (photo) {
      const [x1, y1, x2, y2] = r.box;
      r.thumb = thumbCrop(photo.img, x1, y1, x2, y2);
    }
    r.extracted = null;
    r.material = null;
    invalidateCacheFrom(r, 0);
    state.resizing = null;
    canvas.style.cursor = state.tool === "create" ? "crosshair" : "default";
    renderCanvas();
    renderInspector();
    renderPreview();
    updateButtons();
    saveProject();
    return;
  }

  // ── Finalize photo drag ────────────────────────────────────────────────
  if (state.movingPhoto) {
    state.movingPhoto = null;
    canvas.style.cursor = state.tool === "create" ? "crosshair" : "default";
    saveProject();
    return;
  }

  if (!state.drawing) return;
  state.drawing = false;
  const photo = state.drawPhoto;
  state.drawPhoto = null;
  if (!photo) return;

  const [nx, ny] = _screenPosInPhoto(e, photo);
  const cx = Math.max(0, Math.min(1, nx)), cy = Math.max(0, Math.min(1, ny));
  const x1 = Math.min(state.drawStart.x, cx), y1 = Math.min(state.drawStart.y, cy);
  const x2 = Math.max(state.drawStart.x, cx), y2 = Math.max(state.drawStart.y, cy);

  if (x2 - x1 < 0.015 || y2 - y1 < 0.015) {
    // Too small — treat as click: open a region if hit, otherwise do nothing
    // (don't deselect — user is in create mode and just clicked too lightly)
    const hp = _mouseToPhoto(e);
    if (hp) {
      const idx = _regionHitAt(hp.photo.id, hp.nx, hp.ny);
      if (idx !== -1) selectRegion(idx);
    }
    renderCanvas();
    return;
  }
  addRegion(photo, x1, y1, x2, y2);
  setTool("select");
});

window.addEventListener("resize", () => renderCanvas());

// Escape → deselect region, show atlas inspector
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (e.target.matches("input, textarea, select, [contenteditable]")) return;
  if (document.querySelector(".modal-backdrop.open")) return;
  selectRegion(null);
});

// ── INSPECTOR RESIZE HANDLE ───────────────────────────────────────────────
{
  const handle = document.getElementById("inspector-resize");
  const mainEl = document.querySelector("main");
  let _startX, _startW;
  handle.addEventListener("pointerdown", e => {
    e.preventDefault();
    _startX = e.clientX;
    _startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--inspector-w"), 10);
    handle.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", e => {
    if (!handle.classList.contains("dragging")) return;
    const delta = _startX - e.clientX;          // drag left = wider
    const w = Math.max(240, Math.min(520, _startW + delta));
    document.documentElement.style.setProperty("--inspector-w", w + "px");
    renderCanvas();
  });
  handle.addEventListener("pointerup", () => handle.classList.remove("dragging"));
}
