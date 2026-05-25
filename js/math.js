// ── PERSPECTIVE WARP (homography, pure JS) ─────────────────────────────────
// 3×3 matrix inverse
/** @param {number[][]} m @returns {number[][]|null} */
function _inv3(m) {
  const [[a, b, c], [d, e, f], [g, h, k]] = m;
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) return null;
  const t = 1 / det;
  return [
    [(e * k - f * h) * t, (c * h - b * k) * t, (b * f - c * e) * t],
    [(f * g - d * k) * t, (a * k - c * g) * t, (c * d - a * f) * t],
    [(d * h - e * g) * t, (b * g - a * h) * t, (a * e - b * d) * t],
  ];
}

// Apply a forward homography H (src→dst) using inverse-warp + bilinear
/**
 * @param {HTMLCanvasElement} srcCanvas
 * @param {number[][]} H - 3×3 homography matrix
 * @param {number} outW
 * @param {number} outH
 * @returns {HTMLCanvasElement}
 */
function _applyH(srcCanvas, H, outW, outH) {
  const sw = srcCanvas.width,
    sh = srcCanvas.height;
  const Hinv = _inv3(H);
  if (!Hinv) return srcCanvas;
  const src = srcCanvas.getContext("2d").getImageData(0, 0, sw, sh).data;
  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const oc = out.getContext("2d");
  const od = oc.createImageData(outW, outH);
  const d = od.data;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const ww = Hinv[2][0] * x + Hinv[2][1] * y + Hinv[2][2];
      const sx = (Hinv[0][0] * x + Hinv[0][1] * y + Hinv[0][2]) / ww;
      const sy = (Hinv[1][0] * x + Hinv[1][1] * y + Hinv[1][2]) / ww;
      // Clamp to border — avoids black gaps at edges
      const scx = Math.max(0, Math.min(sw - 1, sx));
      const scy = Math.max(0, Math.min(sh - 1, sy));
      const cx0 = Math.floor(scx),
        cy0 = Math.floor(scy);
      const cx1 = Math.min(sw - 1, cx0 + 1),
        cy1 = Math.min(sh - 1, cy0 + 1);
      const tx = scx - cx0,
        ty = scy - cy0;
      const G = (px, py) => {
        const i = (py * sw + px) * 4;
        return [src[i], src[i + 1], src[i + 2], src[i + 3]];
      };
      const [r00, g00, b00, a00] = G(cx0, cy0),
        [r10, g10, b10, a10] = G(cx1, cy0);
      const [r01, g01, b01, a01] = G(cx0, cy1),
        [r11, g11, b11, a11] = G(cx1, cy1);
      const L = (a, b, c, e) =>
        a * (1 - tx) * (1 - ty) +
        b * tx * (1 - ty) +
        c * (1 - tx) * ty +
        e * tx * ty;
      const oi = (y * outW + x) * 4;
      d[oi] = L(r00, r10, r01, r11);
      d[oi + 1] = L(g00, g10, g01, g11);
      d[oi + 2] = L(b00, b10, b01, b11);
      d[oi + 3] = L(a00, a10, a01, a11);
    }
  }
  oc.putImageData(od, 0, 0);
  return out;
}

// ── PERSPECTIVE CORRECTION — ALGORITHM ─────────────────────────────────
// Based on: MIT Vision Book §Homography, OpenCV homography tutorial,
//           github.com/Faiziev/FixPerspective (DLT 4-point homography).
// Strategy:
//   1. Gradient-direction Hough: each edge pixel votes for ONE (θ,r) bin
//      based on its gradient direction — far sharper peaks than standard Hough.
//   2. RANSAC VP estimation per line cluster — robust to outlier lines.
//   3. _cornersFromLines: extreme boundary-line intersections → 4 corners.
//   4. If 4 corners found: 4-point DLT homography (most accurate).
//   5. Else if VPs: projective vanishing-line rectification.

// Gaussian elimination with partial pivoting — solves Ah = b for 8-vector h.
// Returns null if matrix is singular (used for DLT homography system).
/**
 * @param {number[][]} A - 8×8 matrix
 * @param {number[]} b - 8-vector
 * @returns {number[]|null}
 */
function _solveLinear8x8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]); // augmented [A|b]
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-10) return null; // singular
    const piv = M[col][col];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = M[row][col] / piv;
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// DLT homography from 4 point correspondences (H&Z §4.1).
// srcPts, dstPts: arrays of 4 {x,y}. Returns 3×3 matrix or null.
/**
 * @param {{x:number,y:number}[]} srcPts
 * @param {{x:number,y:number}[]} dstPts
 * @returns {number[][]|null}
 */
function _computeH4pt(srcPts, dstPts) {
  const A = [],
    b = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = srcPts[i];
    const { x: dx, y: dy } = dstPts[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }
  const h = _solveLinear8x8(A, b);
  if (!h) return null;
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

// Detect 4 boundary corners from extreme Hough line intersections.
// vLines: near-vertical peaks, hLines: near-horizontal peaks (downsampled space).
// Returns {tl,tr,br,bl} or null when detection is unreliable.
/**
 * @param {{t:number,r:number,v:number,c:number,s:number}[]} vLines
 * @param {{t:number,r:number,v:number,c:number,s:number}[]} hLines
 * @param {number} W
 * @param {number} H
 * @returns {{tl:{x:number,y:number},tr:{x:number,y:number},br:{x:number,y:number},bl:{x:number,y:number}}|null}
 */
function _cornersFromLines(vLines, hLines, W, H) {
  if (vLines.length < 2 || hLines.length < 2) return null;
  // Sort by r-intercept to get extremes (left/right/top/bottom boundary lines)
  const vS = [...vLines].sort((a, b) => a.r - b.r);
  const hS = [...hLines].sort((a, b) => a.r - b.r);
  const left = vS[0],
    right = vS[vS.length - 1];
  const top = hS[0],
    bot = hS[hS.length - 1];
  // Require meaningful span in both axes
  if (right.r - left.r < W * 0.2) return null;
  if (bot.r - top.r < H * 0.2) return null;
  const intersect = (l1, l2) => {
    const det = l1.c * l2.s - l2.c * l1.s;
    if (Math.abs(det) < 0.01) return null;
    const x = (l1.r * l2.s - l2.r * l1.s) / det;
    const y = (l2.r * l1.c - l1.r * l2.c) / det;
    return isFinite(x) && isFinite(y) ? { x, y } : null;
  };
  const tl = intersect(left, top),
    tr = intersect(right, top);
  const bl = intersect(left, bot),
    br = intersect(right, bot);
  if (!tl || !tr || !bl || !br) return null;
  // Corners must stay within 60% outside image (perspective pulls them far)
  const mg = Math.max(W, H) * 0.6;
  for (const p of [tl, tr, bl, br])
    if (p.x < -mg || p.x > W + mg || p.y < -mg || p.y > H + mg) return null;
  // Quad area (shoelace) must cover ≥5% of canvas area
  const area =
    0.5 *
    Math.abs(
      tl.x * (tr.y - bl.y) +
        tr.x * (br.y - tl.y) +
        br.x * (bl.y - tr.y) +
        bl.x * (tl.y - br.y),
    );
  if (area < W * H * 0.05) return null;
  return { tl, tr, br, bl };
}

// Detect vanishing points in a canvas.
// Returns { vVP, hVP } — each {x,y} in canvas pixel coords, or null.
// Downsamples to ≤1200px for performance; VPs are scaled back to original size.
/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{ vVP: {x:number,y:number}|null, hVP: {x:number,y:number}|null, corners: ({tl:{x:number,y:number},tr:{x:number,y:number},br:{x:number,y:number},bl:{x:number,y:number}}|null) }}
 */
function _detectVPs(canvas) {
  const MAX = 1200;
  const scale = Math.min(1, MAX / canvas.width, MAX / canvas.height);
  let src = canvas;
  if (scale < 1) {
    src = document.createElement("canvas");
    src.width = Math.round(canvas.width * scale);
    src.height = Math.round(canvas.height * scale);
    src.getContext("2d").drawImage(canvas, 0, 0, src.width, src.height);
  }
  const W = src.width,
    H = src.height;

  // 1. Sobel gradient (magnitude + direction)
  const pix = src.getContext("2d").getImageData(0, 0, W, H).data;
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++)
    gray[i] =
      0.299 * pix[i * 4] + 0.587 * pix[i * 4 + 1] + 0.114 * pix[i * 4 + 2];
  const GX = new Float32Array(W * H),
    GY = new Float32Array(W * H),
    MAG = new Float32Array(W * H);
  let maxMag = 1e-6;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const gx =
        -gray[(y - 1) * W + x - 1] -
        2 * gray[y * W + x - 1] -
        gray[(y + 1) * W + x - 1] +
        gray[(y - 1) * W + x + 1] +
        2 * gray[y * W + x + 1] +
        gray[(y + 1) * W + x + 1];
      const gy =
        -gray[(y - 1) * W + x - 1] -
        2 * gray[(y - 1) * W + x] -
        gray[(y - 1) * W + x + 1] +
        gray[(y + 1) * W + x - 1] +
        2 * gray[(y + 1) * W + x] +
        gray[(y + 1) * W + x + 1];
      GX[y * W + x] = gx;
      GY[y * W + x] = gy;
      const m = Math.hypot(gx, gy);
      MAG[y * W + x] = m;
      if (m > maxMag) maxMag = m;
    }

  // 2. Gradient-direction Hough
  // Key insight: gradient at an edge pixel IS the line's normal direction.
  // → each pixel votes for ONE (θ,r) bin — O(N_edge) instead of O(N_edge × NT),
  //   producing much sharper, more accurate peaks.
  const NT = 256,
    diag = Math.ceil(Math.hypot(W, H)),
    NR = 2 * diag + 1;
  const acc = new Float32Array(NT * NR); // weighted by gradient magnitude
  const step = Math.max(1, Math.floor(Math.min(W, H) / 300));
  const edgeThr = maxMag * 0.12;
  for (let y = step; y < H - step; y += step)
    for (let x = step; x < W - step; x += step) {
      const m = MAG[y * W + x];
      if (m < edgeThr) continue;
      let th = Math.atan2(GY[y * W + x], GX[y * W + x]); // gradient angle in (−π,π]
      if (th < 0) th += Math.PI;
      if (th >= Math.PI) th = 0; // fold to [0,π)
      const ti = Math.min(NT - 1, ((th / Math.PI) * NT) | 0);
      const ct = Math.cos((ti * Math.PI) / NT),
        st = Math.sin((ti * Math.PI) / NT);
      const ri = Math.round(x * ct + y * st) + diag;
      if (ri >= 0 && ri < NR) acc[ti * NR + ri] += m / maxMag;
    }

  // 3. Non-maximum suppression — strict > so tied adjacent cells don't cancel
  const WIN = 10,
    minPeak = 1.0;
  const cosL = new Float32Array(NT),
    sinL = new Float32Array(NT);
  for (let t = 0; t < NT; t++) {
    cosL[t] = Math.cos((t * Math.PI) / NT);
    sinL[t] = Math.sin((t * Math.PI) / NT);
  }
  const peaks = [];
  for (let t = 0; t < NT; t++)
    for (let ri = WIN; ri < NR - WIN; ri++) {
      const v = acc[t * NR + ri];
      if (v < minPeak) continue;
      let ok = true;
      outer: for (let dt = -WIN; dt <= WIN; dt++)
        for (let dr = -WIN; dr <= WIN; dr++) {
          if (!dt && !dr) continue;
          if (acc[((t + dt + NT) % NT) * NR + (ri + dr)] > v) {
            ok = false;
            break outer;
          }
        }
      if (ok) peaks.push({ t, r: ri - diag, v, c: cosL[t], s: sinL[t] });
    }
  peaks.sort((a, b) => b.v - a.v);

  // 4. Classify lines by normal angle
  //    θ≈0°  → normal horizontal → line is VERTICAL   (walls, door frames)
  //    θ≈90° → normal vertical   → line is HORIZONTAL (floors, sills)
  const ANG = (35 / 180) * NT;
  const vLines = peaks.filter((p) => p.t < ANG || p.t > NT - ANG).slice(0, 30);
  const hLines = peaks.filter((p) => Math.abs(p.t - NT / 2) < ANG).slice(0, 30);

  // 5. RANSAC VP: find point minimising distance to the set of detected lines.
  //    Line (c,s,r): distance from point (px,py) = |c·px + s·py − r|
  /**
   * @param {{t:number,r:number,v:number,c:number,s:number}[]} lines
   * @returns {{x:number,y:number}|null}
   */
  function ransacVP(lines) {
    if (lines.length < 2) return null;
    const D = Math.max(3, Math.min(W, H) * 0.025); // inlier threshold (≈2.5% of shorter dim)
    let best = null,
      bestScore = -1;
    const ITERS = Math.min(800, lines.length * (lines.length - 1) * 3);
    for (let it = 0; it < ITERS; it++) {
      const i = (Math.random() * lines.length) | 0;
      let j = (Math.random() * lines.length) | 0;
      while (j === i) j = (Math.random() * lines.length) | 0;
      const { c: c1, s: s1, r: r1 } = lines[i],
        { c: c2, s: s2, r: r2 } = lines[j];
      const det = c1 * s2 - c2 * s1;
      if (Math.abs(det) < 0.02) continue;
      const vx = (r1 * s2 - r2 * s1) / det,
        vy = (r2 * c1 - r1 * c2) / det;
      if (
        !isFinite(vx) ||
        !isFinite(vy) ||
        Math.abs(vx) > W * 30 ||
        Math.abs(vy) > H * 30
      )
        continue;
      let score = 0;
      for (const l of lines)
        if (Math.abs(l.c * vx + l.s * vy - l.r) < D) score += l.v;
      if (score > bestScore) {
        bestScore = score;
        best = { x: vx, y: vy };
      }
    }
    if (!best) return null;
    // Refine: weighted mean of all inlier pairwise intersections
    const D2 = D * 1.5;
    const ins = lines.filter(
      (l) => Math.abs(l.c * best.x + l.s * best.y - l.r) < D2,
    );
    if (ins.length < 2) return best;
    let sx = 0,
      sy = 0,
      sw = 0;
    for (let i = 0; i < ins.length; i++)
      for (let j = i + 1; j < ins.length; j++) {
        const { c: c1, s: s1, r: r1, v: w1 } = ins[i],
          { c: c2, s: s2, r: r2, v: w2 } = ins[j];
        const det = c1 * s2 - c2 * s1;
        if (Math.abs(det) < 0.02) continue;
        const x = (r1 * s2 - r2 * s1) / det,
          y = (r2 * c1 - r1 * c2) / det;
        if (
          !isFinite(x) ||
          !isFinite(y) ||
          Math.abs(x) > W * 30 ||
          Math.abs(y) > H * 30
        )
          continue;
        const w = w1 + w2;
        sx += x * w;
        sy += y * w;
        sw += w;
      }
    return sw > 0 ? { x: sx / sw, y: sy / sw } : best;
  }

  const vVP_s = ransacVP(vLines),
    hVP_s = ransacVP(hLines);
  // Scale VP coords from downsampled space back to original canvas space
  const vVP = vVP_s ? { x: vVP_s.x / scale, y: vVP_s.y / scale } : null;
  const hVP = hVP_s ? { x: hVP_s.x / scale, y: hVP_s.y / scale } : null;
  // Attempt 4-corner detection from extreme boundary line intersections
  const corners_s = _cornersFromLines(vLines, hLines, W, H);
  const corners = corners_s
    ? {
        tl: { x: corners_s.tl.x / scale, y: corners_s.tl.y / scale },
        tr: { x: corners_s.tr.x / scale, y: corners_s.tr.y / scale },
        br: { x: corners_s.br.x / scale, y: corners_s.br.y / scale },
        bl: { x: corners_s.bl.x / scale, y: corners_s.bl.y / scale },
      }
    : null;
  console.log(
    "[SnapAtlas] _detectVPs →",
    { vVP, hVP, corners },
    "(src",
    canvas.width + "×" + canvas.height + ")",
  );
  return { vVP, hVP, corners };
}

// Apply projective perspective correction given vanishing points in srcCanvas coords.
/**
 * @param {HTMLCanvasElement} srcCanvas
 * @param {number} outW
 * @param {number} outH
 * @param {{x:number,y:number}|null} vVP
 * @param {{x:number,y:number}|null} hVP
 * @returns {HTMLCanvasElement}
 */
function _rectifyWithVPs(srcCanvas, outW, outH, vVP, hVP) {
  const W = srcCanvas.width,
    H = srcCanvas.height;
  const cx = W / 2,
    cy = H / 2;

  // Build H from a vanishing line l. Normalise so image centre → w=1.
  const makeH = (l) => {
    const n = l[0] * cx + l[1] * cy + l[2];
    if (Math.abs(n) < 0.15 * Math.max(W, H)) return null;
    const ln = l.map((v) => v / n);
    return [
      [1, 0, 0],
      [0, 1, 0],
      [ln[0], ln[1], ln[2]],
    ];
  };

  let Hr = null;
  if (vVP && hVP) {
    const l = [vVP.y - hVP.y, hVP.x - vVP.x, vVP.x * hVP.y - vVP.y * hVP.x];
    Hr = makeH(l);
    if (!Hr) Hr = makeH([0, 1, -vVP.y]) || makeH([1, 0, -hVP.x]);
  } else if (vVP) {
    Hr = makeH([0, 1, -vVP.y]);
  } else if (hVP) {
    Hr = makeH([1, 0, -hVP.x]);
  }

  if (!Hr) {
    const o = document.createElement("canvas");
    o.width = outW;
    o.height = outH;
    o.getContext("2d").drawImage(srcCanvas, 0, 0, outW, outH);
    return o;
  }

  // Sanity check: forward-map the four src corners.
  for (const [px, py] of [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
  ]) {
    const ww = Hr[2][0] * px + Hr[2][1] * py + Hr[2][2];
    const ox = (Hr[0][0] * px + Hr[0][1] * py + Hr[0][2]) / ww;
    const oy = (Hr[1][0] * px + Hr[1][1] * py + Hr[1][2]) / ww;
    if (
      ww <= 0 ||
      !isFinite(ox) ||
      !isFinite(oy) ||
      Math.abs(ox) > W * 8 ||
      Math.abs(oy) > H * 8
    ) {
      const o = document.createElement("canvas");
      o.width = outW;
      o.height = outH;
      o.getContext("2d").drawImage(srcCanvas, 0, 0, outW, outH);
      return o;
    }
  }
  return _applyH(srcCanvas, Hr, outW, outH);
}

// ── BLOCK RUNNERS ─────────────────────────────────────────────────────────
/**
 * @param {HTMLCanvasElement} input
 * @param {{ manualCorners: {tl:{x:number,y:number},tr:{x:number,y:number},br:{x:number,y:number},bl:{x:number,y:number}}|null, autoDetect: boolean }} params
 * @param {PipelineCtx} ctx
 * @returns {Promise<HTMLCanvasElement>}
 */
function perspectiveRunner(input, params, ctx) {
  const r = ctx.region;
  const outW = r.outputW, outH = r.outputH;
  const { manualCorners, autoDetect } = params;

  if (manualCorners) {
    const W = input.width, H = input.height;
    const mc = manualCorners;
    const srcPts = [
      { x: mc.tl.x * W, y: mc.tl.y * H },
      { x: mc.tr.x * W, y: mc.tr.y * H },
      { x: mc.br.x * W, y: mc.br.y * H },
      { x: mc.bl.x * W, y: mc.bl.y * H },
    ];
    const H4 = _computeH4pt(srcPts, [
      { x: 0, y: 0 }, { x: outW, y: 0 },
      { x: outW, y: outH }, { x: 0, y: outH },
    ]);
    if (H4) {
      let ok = true;
      for (const p of srcPts) {
        const ww = H4[2][0] * p.x + H4[2][1] * p.y + H4[2][2];
        if (ww <= 0 || !isFinite(ww)) { ok = false; break; }
      }
      if (ok) return Promise.resolve(_applyH(input, H4, outW, outH));
    }
  }

  if (autoDetect) {
    return Promise.resolve(_autoPerspectiveWarp(input, outW, outH));
  }

  // No correction — just resize to output dims
  const out = document.createElement("canvas");
  out.width = outW; out.height = outH;
  out.getContext("2d").drawImage(input, 0, 0, outW, outH);
  return Promise.resolve(out);
}

/**
 * @param {HTMLCanvasElement} input
 * @param {{ offsetX: number, offsetY: number, scaleX: number, scaleY: number, scaleLock: boolean, rotation: number, flipH: boolean, wrapMode: string }} params
 * @param {PipelineCtx} _ctx
 * @returns {Promise<HTMLCanvasElement>}
 */
function transformRunner(input, params, _ctx) {
  const W = input.width, H = input.height;
  const offsetXPct = params.offsetX ?? 0;
  const offsetYPct = params.offsetY ?? 0;
  const offsetX = offsetXPct / 100 * W;
  const offsetY = offsetYPct / 100 * H;
  let   scaleX  = (params.scaleX ?? 100) / 100;
  let   scaleY  = (params.scaleY ?? 100) / 100;
  if (params.scaleLock) scaleY = scaleX;
  const rotation = params.rotation ?? 0;
  const flipH   = params.flipH ?? false;
  const wrapMode = params.wrapMode ?? "wrap";
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const oc = out.getContext("2d");

  // Fast path: simple offset only — use GPU-accelerated canvas drawImage
  if (scaleX === 1 && scaleY === 1 && rotation === 0 && !flipH) {
    if (wrapMode === "wrap") {
      const ox = ((offsetX % W) + W) % W;
      const oy = ((offsetY % H) + H) % H;
      oc.drawImage(input, ox - W, oy - H);
      oc.drawImage(input, ox,     oy - H);
      oc.drawImage(input, ox - W, oy);
      oc.drawImage(input, ox,     oy);
    } else if (wrapMode === "clamp") {
      const id = oc.getImageData(0, 0, W, H);
      const src = input.getContext("2d").getImageData(0, 0, W, H).data;
      const d = id.data;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let sx = x - offsetX;
          let sy = y - offsetY;
          sx = Math.max(0, Math.min(W - 1, sx));
          sy = Math.max(0, Math.min(H - 1, sy));
          const si = (sy * W + sx) * 4;
          const di = (y * W + x) * 4;
          d[di]     = src[si];
          d[di + 1] = src[si + 1];
          d[di + 2] = src[si + 2];
          d[di + 3] = src[si + 3];
        }
      }
      oc.putImageData(id, 0, 0);
    } else {
      oc.drawImage(input, offsetX, offsetY);
    }
    return Promise.resolve(out);
  }

  // General case — per-pixel inverse mapping
  const id = oc.getImageData(0, 0, W, H);
  const src = input.getContext("2d").getImageData(0, 0, W, H).data;
  const d = id.data;
  const cx = W / 2, cy = H / 2;
  const rad = rotation * Math.PI / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sx = x - cx;
      let sy = y - cy;

      // Inverse translate
      sx -= offsetX;
      sy -= offsetY;

      // Inverse rotate
      const rx = sx * cosA + sy * sinA;
      const ry = -sx * sinA + sy * cosA;
      sx = rx; sy = ry;

      // Inverse scale
      sx /= scaleX;
      sy /= scaleY;

      // Inverse flipH
      if (flipH) sx = -sx;

      // Restore origin
      sx += cx;
      sy += cy;

      if (wrapMode === "wrap") {
        sx = ((sx % W) + W) % W;
        sy = ((sy % H) + H) % H;
      } else if (wrapMode === "clamp") {
        sx = Math.max(0, Math.min(W - 1, sx));
        sy = Math.max(0, Math.min(H - 1, sy));
      } else if (sx < 0 || sx >= W || sy < 0 || sy >= H) {
        continue;
      }

      const si = (Math.round(sy) * W + Math.round(sx)) * 4;
      const di = (y * W + x) * 4;
      d[di]     = src[si];
      d[di + 1] = src[si + 1];
      d[di + 2] = src[si + 2];
      d[di + 3] = src[si + 3];
    }
  }
  oc.putImageData(id, 0, 0);

  return Promise.resolve(out);
}

// Detect VPs + corners from srcCanvas itself and rectify.
/**
 * @param {HTMLCanvasElement} srcCanvas
 * @param {number} outW
 * @param {number} outH
 * @returns {HTMLCanvasElement}
 */
function _autoPerspectiveWarp(srcCanvas, outW, outH) {
  const { vVP, hVP, corners } = _detectVPs(srcCanvas);
  if (corners) {
    const H4 = _computeH4pt(
      [corners.tl, corners.tr, corners.br, corners.bl],
      [
        { x: 0, y: 0 },
        { x: outW, y: 0 },
        { x: outW, y: outH },
        { x: 0, y: outH },
      ],
    );
    if (H4) {
      let ok = true;
      for (const p of [corners.tl, corners.tr, corners.br, corners.bl]) {
        const ww = H4[2][0] * p.x + H4[2][1] * p.y + H4[2][2];
        if (ww <= 0 || !isFinite(ww)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        console.log("[SnapAtlas] _autoPerspectiveWarp → 4-pt DLT");
        return _applyH(srcCanvas, H4, outW, outH);
      }
    }
  }
  return _rectifyWithVPs(srcCanvas, outW, outH, vVP, hVP);
}

// ── REGION LOOKUP HELPERS ─────────────────────────────────────────────────
/** @param {Region} r @returns {Region|null} */
function getParentRegion(r) {
  return r.parentId ? state.regions.find(p => p.id === r.parentId) : null;
}
/** @param {Region} region @returns {Region[]} */
function getVariants(region) {
  return state.regions.filter(v => v.parentId === region.id);
}

// ── VARIANT INPUT ─────────────────────────────────────────────────────────
// Returns the canvas that feeds into the variant's own pipeline.
//
// IMPORTANT: parent.extracted.width may differ from parent.outputW when the
// perspective block is disabled (raw crop size ≠ intended output size).
// We must NOT crop by pixel count relative to parent.outputW — that would
// silently take only a corner of the texture.
//
// Rule:
//   • Variant outputW >= parent.outputW → no sub-region crop intended.
//     Return parent.extracted directly so the atlas scales it identically
//     to the parent's own slot.
//   • Variant outputW < parent.outputW  → user explicitly made it smaller.
//     Crop the proportional region from parent.extracted and return it.
//
// Result is cached; invalidated by invalidateCacheFrom(v, 0) whenever
// cropX/cropY change or the parent re-runs.
/** @param {Region} r @returns {HTMLCanvasElement|null} */
function _variantInputCanvas(r) {
  if (!r._variantInputDirty && r._variantInputCache) return r._variantInputCache;
  const parent = getParentRegion(r);
  if (!parent?.extracted) return null;
  const src = parent.extracted;

  // No sub-region crop: variant covers the full parent output.
  // Return the extracted canvas directly — atlas will scale both identically.
  if (r.outputW >= parent.outputW && r.outputH >= parent.outputH) {
    r._variantInputCache = src;
    r._variantInputDirty = false;
    return src;
  }

  // Sub-region crop: variant is smaller than parent's intended output.
  // Map variant pixel dims through the parent scale to crop correctly even
  // when parent.extracted has different actual dimensions than parent.outputW.
  const scaleX = src.width  / parent.outputW;
  const scaleY = src.height / parent.outputH;
  const cropW = Math.round(Math.min(r.outputW * scaleX, src.width));
  const cropH = Math.round(Math.min(r.outputH * scaleY, src.height));
  const maxOx = Math.max(0, src.width  - cropW);
  const maxOy = Math.max(0, src.height - cropH);
  const ox = Math.round(r.cropX * maxOx);
  const oy = Math.round(r.cropY * maxOy);
  const c = document.createElement("canvas");
  c.width = cropW; c.height = cropH;
  c.getContext("2d").drawImage(src, ox, oy, cropW, cropH, 0, 0, cropW, cropH);
  r._variantInputCache = c;
  r._variantInputDirty = false;
  return c;
}

// ── PERSPECTIVE CORRECTION (manual, pre-AI) ─────────────────────────────
/** @param {Region} region @returns {HTMLCanvasElement|null} */
function _rawCropCanvas(region) {
  const img = getPhotoForRegion(region)?.img;
  if (!img) return null;
  const [x1, y1, x2, y2] = region.box;
  const cw = Math.max(1, Math.round((x2 - x1) * img.width));
  const ch = Math.max(1, Math.round((y2 - y1) * img.height));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  c.getContext("2d").drawImage(
    img,
    x1 * img.width,
    y1 * img.height,
    cw,
    ch,
    0,
    0,
    cw,
    ch,
  );
  return c;
}
