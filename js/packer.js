// Cover-crop src (canvas or image) into a new outW×outH canvas.
// Scales to fill, then center-crops — never stretches.
/**
 * @param {HTMLCanvasElement|HTMLImageElement} src
 * @param {number} outW
 * @param {number} outH
 * @returns {HTMLCanvasElement}
 */
function _coverCrop(src, outW, outH) {
  const srcA = src.width / src.height;
  const dstA = outW / outH;
  let sx, sy, sw, sh;
  if (srcA > dstA) {
    sh = src.height;
    sw = sh * dstA;
    sx = (src.width - sw) / 2;
    sy = 0;
  } else {
    sw = src.width;
    sh = sw / dstA;
    sx = 0;
    sy = (src.height - sh) / 2;
  }
  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  out.getContext("2d").drawImage(src, sx, sy, sw, sh, 0, 0, outW, outH);
  return out;
}

// ── ATLAS PACKING ──────────────────────────────────────────────────────────
/** @param {number} n @returns {number} */
function ceilPow2(n) {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(n, 1))));
}

/**
 * MaxRects bin packing (Jukka Jylänki, 2010).
 * @typedef {{ w: number, h: number, canRotate: boolean, idx: number, parentIdx: number }} PackItem
 * @typedef {{ x: number, y: number, w: number, h: number, rotated: boolean }} Placement
 * @param {PackItem[]} items
 * @param {number} W - Atlas width
 * @param {number} H - Atlas height
 * @returns {Placement[]|null} Array indexed by idx, or null if any item doesn't fit.
 */
function maxRectsPack(items, W, H) {
  // Group items so each parent is immediately followed by its variants.
  // Within each group, sort by longest side descending (standard MaxRects heuristic).
  const byParent = new Map();
  const roots = [];
  for (const item of items) {
    if (item.parentIdx >= 0) continue;
    roots.push(item);
    byParent.set(item.idx, []);
  }
  for (const item of items) {
    if (item.parentIdx < 0) continue;
    const list = byParent.get(item.parentIdx);
    if (list) list.push(item);
  }
  roots.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
  for (const list of byParent.values()) {
    list.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
  }
  const sorted = roots.flatMap(r => [r, ...(byParent.get(r.idx) || [])]);

  let free = [{ x: 0, y: 0, w: W, h: H }];
  /** @type {Placement[]} */
  const result = new Array(items.length);

  const overlaps = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  const contains = (big, sm) =>
    sm.x >= big.x &&
    sm.y >= big.y &&
    sm.x + sm.w <= big.x + big.w &&
    sm.y + sm.h <= big.y + big.h;

  for (const item of sorted) {
    let best = null,
      bestScore = Infinity;

    // Try original orientation and, if allowed, 90° rotation
    const variants = [[item.w, item.h, false]];
    if (item.canRotate && item.w !== item.h)
      variants.push([item.h, item.w, true]);

    for (const fr of free) {
      for (const [iw, ih, rot] of variants) {
        if (iw > fr.w || ih > fr.h) continue;
        // Top-left fit: prefer placements closest to origin
        const score = fr.y + fr.x * 0.0001;
        if (score < bestScore) {
          bestScore = score;
          best = { x: fr.x, y: fr.y, w: iw, h: ih, rotated: rot };
        }
      }
    }

    if (!best) return null; // item doesn't fit → need larger atlas
    result[item.idx] = best;

    // Split every free rect that overlaps the placed item (guillotine)
    const nextFree = [];
    for (const fr of free) {
      if (!overlaps(fr, best)) {
        nextFree.push(fr);
        continue;
      }
      if (best.x > fr.x)
        nextFree.push({ x: fr.x, y: fr.y, w: best.x - fr.x, h: fr.h });
      if (best.x + best.w < fr.x + fr.w)
        nextFree.push({
          x: best.x + best.w,
          y: fr.y,
          w: fr.x + fr.w - best.x - best.w,
          h: fr.h,
        });
      if (best.y > fr.y)
        nextFree.push({ x: fr.x, y: fr.y, w: fr.w, h: best.y - fr.y });
      if (best.y + best.h < fr.y + fr.h)
        nextFree.push({
          x: fr.x,
          y: best.y + best.h,
          w: fr.w,
          h: fr.y + fr.h - best.y - best.h,
        });
    }

    // Prune free rects fully contained in another
    free = nextFree.filter(
      (r, i) => !nextFree.some((s, j) => j !== i && contains(s, r)),
    );
  }
  return result;
}

/**
 * @param {Region[]} regions
 * @returns {{ atlasSize: number, placements: Placement[] }|null}
 */
function packAtlas(regions) {
  if (!regions.length) return null;
  const maxDim = Math.max(
    ...regions.map((r) => Math.max(r.outputW, r.outputH)),
  );
  const totalArea = regions.reduce((s, r) => s + r.outputW * r.outputH, 0);
  const items = regions.map((r, i) => ({
    w: r.outputW,
    h: r.outputH,
    canRotate: !r.noRotate,
    idx: i,
    parentIdx: r.parentId ? regions.findIndex(p => p.id === r.parentId) : -1,
  }));
  // Start from smallest power-of-2 square that could hold all content
  let size = ceilPow2(Math.max(Math.ceil(Math.sqrt(totalArea)), maxDim));
  for (let attempt = 0; attempt < 5; attempt++, size *= 2) {
    const placements = maxRectsPack(items, size, size);
    if (placements) return { atlasSize: size, placements };
  }
  return null;
}

// Draw src (canvas or image) into placement p on ctx, respecting 90° rotation.
// When rotated: p.w = original height, p.h = original width (dims are swapped).
/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement|HTMLImageElement} src
 * @param {Placement} p
 * @param {number} [offsetX]
 * @param {number} [offsetY]
 * @param {number} [scaleF]
 */
function _drawOnAtlas(ctx, src, p, offsetX = 0, offsetY = 0, scaleF = 1) {
  const px = offsetX + p.x * scaleF,
    py = offsetY + p.y * scaleF;
  const pw = p.w * scaleF,
    ph = p.h * scaleF;
  if (p.rotated) {
    ctx.save();
    ctx.translate(px + pw, py);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, 0, 0, ph, pw); // draw original dims (swapped back)
    ctx.restore();
  } else {
    ctx.drawImage(src, px, py, pw, ph);
  }
}

function rebuildAtlas() {
  const strips = state.regions.filter(
    (r) => r.selected && (r.extracted || r.perspCanvas),
  );
  if (!strips.length) {
    state.atlasCanvas = null;
    state.packedStrips = [];
    return;
  }
  const layout = packAtlas(strips);
  if (!layout) return;
  const { atlasSize, placements } = layout;
  const ac = document.createElement("canvas");
  ac.width = atlasSize;
  ac.height = atlasSize;
  const actx = ac.getContext("2d");
  strips.forEach((r, i) => {
    const p = placements[i];
    _drawOnAtlas(actx, r.extracted || r.perspCanvas, p);
  });
  state.atlasCanvas = ac;
  state.packedLayout = layout;
  state.packedStrips = strips;
}
