// ── MANUAL CORNER PICKER MODAL ────────────────────────────────────────────
/** @param {number} idx */
function openCornersModal(idx) {
  const r = state.regions[idx];
  const photo = getPhotoForRegion(r);
  if (!r) { showToast("Region not found", "error"); return; }
  if (!photo) { showToast("Source image not loaded", "error"); return; }
  // Hide onboarding UI while the perspective modal is in the foreground
  document.querySelectorAll(".ob-ring").forEach(el => el.classList.add("is-hidden"));
  document.getElementById("ob-card")?.classList.add("is-hidden");

  const perspBlock = r.pipeline.find(b => b.type === "perspective");

  // Use the pipeline output just before the perspective block as the source,
  // so corners are in the same coordinate space the runner will receive.
  const biPersp = r.pipeline.indexOf(perspBlock);
  let raw = _rawCropCanvas(r);
  if (!raw) { showToast("No source image for this region", "error"); return; }
  for (let i = biPersp - 1; i >= 0; i--) {
    const b = r.pipeline[i];
    if (b.enabled && b._cache && !b._dirty) { raw = b._cache; break; }
  }
  const rawW = raw.width,
    rawH = raw.height;
  const DOT_R = 9;

  // Resolve initial corners in raw-image pixel space
  const initialCorners = () => {
    const mc = perspBlock?.params?.manualCorners;
    if (mc) {
      return {
        tl: { x: mc.tl.x * rawW, y: mc.tl.y * rawH },
        tr: { x: mc.tr.x * rawW, y: mc.tr.y * rawH },
        br: { x: mc.br.x * rawW, y: mc.br.y * rawH },
        bl: { x: mc.bl.x * rawW, y: mc.bl.y * rawH },
      };
    }
    // Default inset (20%)
    const ix = rawW * 0.2,
      iy = rawH * 0.2;
    return {
      tl: { x: ix, y: iy },
      tr: { x: rawW - ix, y: iy },
      br: { x: rawW - ix, y: rawH - iy },
      bl: { x: ix, y: rawH - iy },
    };
  };

  // Scale canvas to fit inside the modal (max 72vw × 68vh)
  const maxW = Math.round(Math.min(window.innerWidth * 0.72, 860));
  const maxH = Math.round(Math.min(window.innerHeight * 0.68, 620));
  const scale = Math.min(maxW / rawW, maxH / rawH, 2); // allow up to 2× upscale
  const dispW = Math.round(rawW * scale);
  const dispH = Math.round(rawH * scale);

  const canvas = document.getElementById("perspModalCanvas");
  canvas.width = dispW;
  canvas.height = dispH;

  // Working corners in display space
  const toDisp = (p) => ({ x: p.x * scale, y: p.y * scale });
  const toRaw = (p) => ({ x: p.x / scale, y: p.y / scale });
  const scaleCorners = (c, fn) => ({
    tl: fn(c.tl),
    tr: fn(c.tr),
    br: fn(c.br),
    bl: fn(c.bl),
  });

  let dc = scaleCorners(initialCorners(), toDisp); // display coords

  // ── Draw ───────────────────────────────────────────────────────────────
  const CORNER_COLORS = {
    tl: "#f0c060",
    tr: "#60f0a0",
    br: "#60b4f0",
    bl: "#f06090",
  };
  const CORNER_LABELS = { tl: "TL", tr: "TR", br: "BR", bl: "BL" };

  const LOUPE_R = 58;
  const LOUPE_ZOOM = 4;
  const LOUPE_GAP = 20;

  function drawLoupe(ctx, pos, key) {
    const col = CORNER_COLORS[key];

    // Pick the quadrant (top-right → top-left → bottom-right → bottom-left)
    // that keeps the loupe fully inside the canvas.
    const inBounds = (cx, cy) =>
      cx - LOUPE_R >= 0 && cx + LOUPE_R <= dispW &&
      cy - LOUPE_R >= 0 && cy + LOUPE_R <= dispH;
    const offsets = [
      [LOUPE_R + LOUPE_GAP, -(LOUPE_R + LOUPE_GAP)],
      [-(LOUPE_R + LOUPE_GAP), -(LOUPE_R + LOUPE_GAP)],
      [LOUPE_R + LOUPE_GAP,   LOUPE_R + LOUPE_GAP],
      [-(LOUPE_R + LOUPE_GAP), LOUPE_R + LOUPE_GAP],
    ];
    let lx = pos.x, ly = pos.y;
    for (const [ox, oy] of offsets) {
      if (inBounds(pos.x + ox, pos.y + oy)) { lx = pos.x + ox; ly = pos.y + oy; break; }
    }
    // Fallback: clamp
    lx = Math.max(LOUPE_R, Math.min(dispW - LOUPE_R, lx));
    ly = Math.max(LOUPE_R, Math.min(dispH - LOUPE_R, ly));

    // Sample from raw image around the dragged point
    const rawHalf = LOUPE_R / LOUPE_ZOOM; // half-size in raw pixels
    const rawX = (pos.x / scale) - rawHalf;
    const rawY = (pos.y / scale) - rawHalf;

    ctx.save();
    // Circular clip
    ctx.beginPath();
    ctx.arc(lx, ly, LOUPE_R, 0, Math.PI * 2);
    ctx.clip();

    // Draw checkerboard background (in case source has transparency)
    for (let cy = -LOUPE_R; cy < LOUPE_R; cy += 8)
      for (let cx = -LOUPE_R; cx < LOUPE_R; cx += 8) {
        ctx.fillStyle = ((Math.floor(cy / 8) + Math.floor(cx / 8)) % 2 === 0) ? "#1a1b1e" : "#141518";
        ctx.fillRect(lx + cx, ly + cy, 8, 8);
      }

    // Magnified image
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      raw,
      rawX, rawY, rawHalf * 2, rawHalf * 2,       // source (raw pixels)
      lx - LOUPE_R, ly - LOUPE_R, LOUPE_R * 2, LOUPE_R * 2, // dest
    );
    ctx.restore();

    // Crosshair
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(lx - 10, ly); ctx.lineTo(lx + 10, ly);
    ctx.moveTo(lx, ly - 10); ctx.lineTo(lx, ly + 10);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lx - 10, ly); ctx.lineTo(lx + 10, ly);
    ctx.moveTo(lx, ly - 10); ctx.lineTo(lx, ly + 10);
    ctx.stroke();

    // Ring border
    ctx.beginPath();
    ctx.arc(lx, ly, LOUPE_R, 0, Math.PI * 2);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  function draw(loupePos = null, loupeKey = null) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.drawImage(raw, 0, 0, dispW, dispH);

    // Darken area outside the quad, keep full brightness inside
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, dispW, dispH);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(dc.tl.x, dc.tl.y);
    ctx.lineTo(dc.tr.x, dc.tr.y);
    ctx.lineTo(dc.br.x, dc.br.y);
    ctx.lineTo(dc.bl.x, dc.bl.y);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(raw, 0, 0, dispW, dispH);
    ctx.restore();

    // Quad border
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(dc.tl.x, dc.tl.y);
    ctx.lineTo(dc.tr.x, dc.tr.y);
    ctx.lineTo(dc.br.x, dc.br.y);
    ctx.lineTo(dc.bl.x, dc.bl.y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // Corner dots
    for (const key of ["tl", "tr", "br", "bl"]) {
      const p = dc[key];
      const col = CORNER_COLORS[key];
      ctx.beginPath();
      ctx.arc(p.x, p.y, DOT_R, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#111";
      ctx.font = `bold ${Math.round(DOT_R * 0.9)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(CORNER_LABELS[key], p.x, p.y);
    }

    // Loupe — drawn last so it sits on top of everything
    if (loupePos && loupeKey) drawLoupe(ctx, loupePos, loupeKey);
  }

  // ── Drag handling ──────────────────────────────────────────────────────
  let dragging = null;

  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = dispW / rect.width;
    const scaleY = dispH / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };
  const hitTest = (pos) => {
    for (const key of ["tl", "tr", "br", "bl"]) {
      if (Math.hypot(pos.x - dc[key].x, pos.y - dc[key].y) <= DOT_R + 6)
        return key;
    }
    return null;
  };

  canvas.onmousedown = (e) => {
    e.preventDefault();
    dragging = hitTest(getPos(e));
  };
  canvas.onmousemove = (e) => {
    const pos = getPos(e);
    if (dragging) {
      dc[dragging] = {
        x: Math.max(0, Math.min(dispW, pos.x)),
        y: Math.max(0, Math.min(dispH, pos.y)),
      };
      draw();
    } else {
      canvas.style.cursor = hitTest(pos) ? "grab" : "default";
    }
  };
  canvas.onmouseup = () => {
    dragging = null;
  };
  canvas.onmouseleave = () => {
    dragging = null;
  };

  // Touch support
  const touchPos = (e) => {
    e.preventDefault();
    return getPos(e.touches[0]);
  };
  canvas.ontouchstart = (e) => {
    dragging = hitTest(touchPos(e));
  };
  canvas.ontouchmove = (e) => {
    if (!dragging) return;
    const pos = touchPos(e);
    dc[dragging] = {
      x: Math.max(0, Math.min(dispW, pos.x)),
      y: Math.max(0, Math.min(dispH, pos.y)),
    };
    draw();
  };
  canvas.ontouchend = () => {
    dragging = null;
  };

  // ── Buttons ────────────────────────────────────────────────────────────
  const closeModal = () => {
    document.getElementById("perspModalBackdrop").classList.remove("open");
    // Restore onboarding UI and advance
    document.querySelectorAll(".ob-ring").forEach(el => el.classList.remove("is-hidden"));
    document.getElementById("ob-card")?.classList.remove("is-hidden");
    onboarding?.advance("first-texture", "corners");
    canvas.onmousedown =
      canvas.onmousemove =
      canvas.onmouseup =
      canvas.onmouseleave =
        null;
    canvas.ontouchstart = canvas.ontouchmove = canvas.ontouchend = null;
  };

  document.getElementById("perspModalClose").onclick = closeModal;
  document.getElementById("perspModalCancel").onclick = closeModal;

  document.getElementById("perspModalReset").onclick = () => {
    dc = scaleCorners(initialCorners(), toDisp);
    if (!perspBlock?.params?.manualCorners) {
      const { corners: ac } = _detectVPs(raw);
      if (ac) {
        const clamp = (p) => ({ x: Math.max(0, Math.min(rawW, p.x)), y: Math.max(0, Math.min(rawH, p.y)) });
        dc = scaleCorners({ tl: clamp(ac.tl), tr: clamp(ac.tr), br: clamp(ac.br), bl: clamp(ac.bl) }, toDisp);
      }
    }
    draw();
  };

  document.getElementById("perspModalApply").onclick = () => {
    const rawCorners = scaleCorners(dc, toRaw);
    const mc = {
      tl: { x: rawCorners.tl.x / rawW, y: rawCorners.tl.y / rawH },
      tr: { x: rawCorners.tr.x / rawW, y: rawCorners.tr.y / rawH },
      br: { x: rawCorners.br.x / rawW, y: rawCorners.br.y / rawH },
      bl: { x: rawCorners.bl.x / rawW, y: rawCorners.bl.y / rawH },
    };
    if (perspBlock) {
      perspBlock.params.manualCorners = mc;
      perspBlock.enabled = true;
      const biPerspective = r.pipeline.indexOf(perspBlock);
      invalidateCacheFrom(r, biPerspective);
    }
    closeModal();
    autoRunCPU(r, 0);
    renderInspector();
    saveProject();
  };

  // Backdrop click to close
  document.getElementById("perspModalBackdrop").onclick = (e) => {
    if (e.target === document.getElementById("perspModalBackdrop"))
      closeModal();
  };

  // Show
  document.getElementById("perspModalBackdrop").classList.add("open");
  draw();
}

// ── CURVES MODAL ─────────────────────────────────────────────────────────
/** @param {Region} region @param {number} bi */
function initInlineCurvesEditor(region, bi, onCommit = null) {
  const canvas = document.getElementById(`curves-cv-${bi}`);
  if (!canvas) return;
  const b   = region.pipeline[bi];
  const iCtx = canvas.getContext("2d");
  const DOT_R = 4;
  const HIT_R = 12; // hit radius in canvas-buffer pixels
  const W = () => canvas.width;
  const H = () => canvas.height;

  function syncSize() {
    const w = canvas.offsetWidth;
    if (!w) return;
    canvas.width  = w;
    canvas.height = Math.round(w * 0.75);
  }

  const CH_COLOR = { rgb: "#d4a843", r: "#f06060", g: "#4caf78", b: "#6090f0" };
  const IDENTITY = [[0, 0], [255, 255]];

  if (!b._activeCh) b._activeCh = "rgb";

  const getPts = ()    => b.params[b._activeCh] ?? IDENTITY.map(p => [...p]);
  const setPts = pts   => { b.params[b._activeCh] = pts; };
  const isIdentity = p => p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 255 && p[1][1] === 255;

  function pointerToData(e) {
    const rect = canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(255, Math.round((e.clientX - rect.left) / rect.width  * 255))),
      Math.max(0, Math.min(255, Math.round(255 - (e.clientY - rect.top)  / rect.height * 255))),
    ];
  }

  function nearestPoint(dx, dy) {
    const pts = getPts();
    // Scale hit radius from buffer pixels to data space
    const hrx = HIT_R / W() * 255;
    const hry = HIT_R / H() * 255;
    let best = -1, bestD = 1;
    for (let i = 0; i < pts.length; i++) {
      const nx = (pts[i][0] - dx) / hrx;
      const ny = (pts[i][1] - dy) / hry;
      const d  = Math.sqrt(nx * nx + ny * ny);
      if (d < 1 && d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function drawCurveFromPts(pts, color, alpha, width) {
    const lut = _buildCurveLUT(pts);
    iCtx.beginPath();
    for (let x = 0; x < 256; x++) {
      const y  = lut ? lut[x] : x;
      const cx = x / 255 * W();
      const cy = (1 - y / 255) * H();
      x === 0 ? iCtx.moveTo(cx, cy) : iCtx.lineTo(cx, cy);
    }
    iCtx.globalAlpha = alpha;
    iCtx.strokeStyle = color;
    iCtx.lineWidth   = width;
    iCtx.stroke();
    iCtx.globalAlpha = 1;
  }

  function draw() {
    iCtx.clearRect(0, 0, W(), H());
    iCtx.fillStyle = "#0d0f12";
    iCtx.fillRect(0, 0, W(), H());

    // Grid (quarters)
    iCtx.strokeStyle = "#1c1f26";
    iCtx.lineWidth   = 1;
    for (let i = 1; i < 4; i++) {
      iCtx.beginPath(); iCtx.moveTo(i / 4 * W(), 0); iCtx.lineTo(i / 4 * W(), H()); iCtx.stroke();
      iCtx.beginPath(); iCtx.moveTo(0, i / 4 * H()); iCtx.lineTo(W(), i / 4 * H()); iCtx.stroke();
    }

    // Identity diagonal
    iCtx.strokeStyle = "#252830";
    iCtx.lineWidth   = 1;
    iCtx.setLineDash([3, 5]);
    iCtx.beginPath(); iCtx.moveTo(0, H()); iCtx.lineTo(W(), 0); iCtx.stroke();
    iCtx.setLineDash([]);

    // Ghost curves (inactive channels)
    for (const ch of ["rgb", "r", "g", "b"]) {
      if (ch === b._activeCh || !b.params[ch]) continue;
      drawCurveFromPts(b.params[ch], CH_COLOR[ch], 0.25, 1);
    }

    // Active channel curve
    const pts = getPts();
    drawCurveFromPts(pts, CH_COLOR[b._activeCh], 1, 1.5);

    // Control points
    for (const [x, y] of pts) {
      iCtx.beginPath();
      iCtx.arc(x / 255 * W(), (1 - y / 255) * H(), DOT_R, 0, Math.PI * 2);
      iCtx.fillStyle   = CH_COLOR[b._activeCh];
      iCtx.fill();
      iCtx.strokeStyle = "#fff";
      iCtx.lineWidth   = 1.5;
      iCtx.stroke();
    }
  }

  function commit() {
    ["r", "g", "b"].forEach(ch => {
      if (b.params[ch] && isIdentity(b.params[ch])) b.params[ch] = null;
    });
    if (onCommit) {
      onCommit();
    } else {
      invalidateCacheFrom(region, bi);
      autoRunCPU(region, bi);
      saveProject();
    }
  }

  let dragging = null;

  canvas.onpointerdown = e => {
    if (e.button !== 0) return;
    const [dx, dy] = pointerToData(e);
    const hit = nearestPoint(dx, dy);
    if (hit >= 0) {
      dragging = { idx: hit };
    } else {
      const pts = getPts().slice();
      pts.push([dx, dy]);
      pts.sort((a, b) => a[0] - b[0]);
      setPts(pts);
      dragging = { idx: pts.findIndex(p => p[0] === dx && p[1] === dy) };
      draw();
    }
    canvas.setPointerCapture(e.pointerId);
  };

  canvas.onpointermove = e => {
    if (!dragging) return;
    const [dx, dy] = pointerToData(e);
    const pts = getPts().slice();
    const lo  = dragging.idx > 0              ? pts[dragging.idx - 1][0] + 1 : 0;
    const hi  = dragging.idx < pts.length - 1 ? pts[dragging.idx + 1][0] - 1 : 255;
    pts[dragging.idx] = [Math.max(lo, Math.min(hi, dx)), dy];
    setPts(pts);
    draw();
    if (onCommit) {
      onCommit();
    } else {
      invalidateCacheFrom(region, bi);
      autoRunCPU(region, bi);
    }
  };

  canvas.onpointerup = () => { if (dragging) { commit(); dragging = null; } };

  canvas.ondblclick = e => {
    const [dx, dy] = pointerToData(e);
    const hit = nearestPoint(dx, dy);
    if (hit < 0 || getPts().length <= 2) return;
    const pts = getPts().slice();
    pts.splice(hit, 1);
    setPts(pts);
    draw();
    commit();
  };

  // Tab switching
  const tabsEl = canvas.previousElementSibling;
  tabsEl.querySelectorAll("[data-ch]").forEach(btn => {
    btn.addEventListener("click", () => {
      b._activeCh = btn.dataset.ch;
      if (!b.params[b._activeCh]) b.params[b._activeCh] = IDENTITY.map(p => [...p]);
      tabsEl.querySelectorAll("[data-ch]").forEach(t => t.classList.toggle("active", t.dataset.ch === b._activeCh));
      draw();
    });
  });

  // Reset active channel
  tabsEl.querySelector(".curves-ireset")?.addEventListener("click", () => {
    b.params[b._activeCh] = IDENTITY.map(p => [...p]);
    draw();
    commit();
  });

  const ro = new ResizeObserver(() => { syncSize(); draw(); });
  ro.observe(canvas);
  syncSize();
  draw();
}

// ── AI DEBUG MODAL ─────────────────────────────────────────────────────────
/** @param {Object} blockDebug @param {string} title */
function openDebugModal(blockDebug, title) {
  if (!blockDebug) return;

  const bd = document.getElementById("dbgBackdrop");

  const b64Size = (b64) => {
    if (!b64) return "—";
    const bytes = Math.round(b64.length * 0.75);
    return bytes > 1024 * 1024
      ? (bytes / 1024 / 1024).toFixed(1) + " MB"
      : (bytes / 1024).toFixed(0) + " KB";
  };

  bd.querySelector(".dbg-title").textContent = `AI Debug — ${title}`;

  // Populate one pass block (pass = flat block debug object)
  const fillPass = (pass, ids) => {
    const {
      sentId,
      sentMetaId,
      dlSentId,
      recvId,
      recvMetaId,
      dlRecvId,
      promptId,
      rtId,
      copyId,
    } = ids;
    if (!pass) {
      bd.querySelector(`#${sentId}`).src = "";
      bd.querySelector(`#${recvId}`).src = "";
      bd.querySelector(`#${sentMetaId}`).textContent = "—";
      bd.querySelector(`#${recvMetaId}`).textContent = "not run";
      bd.querySelector(`#${promptId}`).textContent = "";
      const rtEl = bd.querySelector(`#${rtId}`);
      rtEl.textContent = "";
      rtEl.classList.remove("has-text");
      bd.querySelector(`#${dlSentId}`).style.display = "none";
      bd.querySelector(`#${dlRecvId}`).style.display = "none";
      return;
    }
    // Sent
    const sentSrc = pass.sentB64
      ? `data:${pass.sentMime};base64,${pass.sentB64}`
      : null;
    bd.querySelector(`#${sentId}`).src = sentSrc || "";
    bd.querySelector(`#${sentMetaId}`).textContent = sentSrc
      ? `${pass.sentMime} · ${b64Size(pass.sentB64)}`
      : "—";
    const dlS = bd.querySelector(`#${dlSentId}`);
    dlS.style.display = sentSrc ? "" : "none";
    dlS.onclick = sentSrc
      ? () => {
          const a = document.createElement("a");
          a.href = sentSrc;
          a.download = `${r.label}_${ids.label}_sent.jpg`;
          a.click();
        }
      : null;

    // Received
    const recvSrc = pass.receivedB64
      ? `data:${pass.receivedMime};base64,${pass.receivedB64}`
      : null;
    bd.querySelector(`#${recvId}`).src = recvSrc || "";
    bd.querySelector(`#${recvMetaId}`).textContent = recvSrc
      ? `${pass.receivedMime} · ${b64Size(pass.receivedB64)}`
      : "No image returned";
    const dlR = bd.querySelector(`#${dlRecvId}`);
    dlR.style.display = recvSrc ? "" : "none";
    dlR.onclick = recvSrc
      ? () => {
          const a = document.createElement("a");
          a.href = recvSrc;
          a.download = `${r.label}_${ids.label}_recv.${pass.receivedMime?.split("/")[1] || "png"}`;
          a.click();
        }
      : null;

    // Prompt
    bd.querySelector(`#${promptId}`).textContent = pass.prompt || "";

    // Response text
    const rt = (pass.textParts || []).join("\n").trim();
    const rtEl = bd.querySelector(`#${rtId}`);
    rtEl.textContent = rt;
    rtEl.classList.toggle("has-text", rt.length > 0);

    // Copy prompt
    bd.querySelector(`#${copyId}`).onclick = () => {
      navigator.clipboard.writeText(pass.prompt || "").then(() => {
        const btn = bd.querySelector(`#${copyId}`);
        btn.innerHTML = Lucide.iconHTML('check') + " Copied";
        setTimeout(() => {
          btn.innerHTML = Lucide.iconHTML('copy') + " Copy";
        }, 1500);
      });
    };
  };

  fillPass(blockDebug, {
    label: "block",
    sentId: "dbgP1SentImg",
    sentMetaId: "dbgP1SentMeta",
    dlSentId: "dbgP1DlSent",
    recvId: "dbgP1RecvImg",
    recvMetaId: "dbgP1RecvMeta",
    dlRecvId: "dbgP1DlRecv",
    promptId: "dbgP1Prompt",
    rtId: "dbgP1RT",
    copyId: "dbgP1Copy",
  });

  // Each block is one pass — always hide the second section
  bd.querySelector("#dbgPass2Section").style.display = "none";

  bd.classList.add("open");
}

document.getElementById("dbgClose").addEventListener("click", () => {
  document.getElementById("dbgBackdrop").classList.remove("open");
});
document.getElementById("dbgBackdrop").addEventListener("click", (e) => {
  if (e.target === document.getElementById("dbgBackdrop"))
    document.getElementById("dbgBackdrop").classList.remove("open");
});


/** @param {Blob} blob @param {string} name */
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** @param {Region} r @returns {string} */
function _regionFilename(r) {
  const snake = (s) =>
    s
      .toLowerCase()
      .replace(/[\s\-/]+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
  const parts = [];
  if (r.material?.materialClass) parts.push(r.material.materialClass);
  const sem = r.material?.semanticClass;
  if (sem && sem !== "flat_surface") parts.push(sem);
  if (r.material?.subtype) parts.push(snake(r.material.subtype));
  if (!parts.length) parts.push(snake(r.label) || "region");
  parts.push(`${r.outputW}x${r.outputH}`);
  return parts.join("_") + ".png";
}

/** @param {Region} r */
function downloadRegion(r) {
  const canvas = r.extracted;
  if (!canvas) return;
  canvas.toBlob((blob) => downloadBlob(blob, _regionFilename(r)), "image/png");
}
