// ── Seam offset helpers ────────────────────────────────────────────────────
// Shifts the tile by (W/2, H/2) so the seam moves from the invisible edges
// to the center of the canvas. Applying twice restores the original position.
/** @param {HTMLCanvasElement} canvas @returns {HTMLCanvasElement} */
function _buildSeamOffsetCanvas(canvas) {
  const W = canvas.width, H = canvas.height;
  const hw = Math.floor(W / 2), hh = Math.floor(H / 2);
  const orig = canvas.getContext("2d").getImageData(0, 0, W, H).data;
  const shifted = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = (y + hh) % H;
    for (let x = 0; x < W; x++) {
      const si = (sy * W + (x + hw) % W) * 4;
      const di = (y  * W + x)            * 4;
      shifted[di]   = orig[si];   shifted[di+1] = orig[si+1];
      shifted[di+2] = orig[si+2]; shifted[di+3] = orig[si+3];
    }
  }
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  out.getContext("2d").putImageData(new ImageData(shifted, W, H), 0, 0);
  return out;
}

// ── Seam mask ─────────────────────────────────────────────────────────────
// Returns a Float32Array [0,1] with Gaussian weights centred on the seam
// cross/stripe at (W/2, H/2) — i.e. the seam location after offsetting.
// widthPx controls the half-width (sigma ≈ widthPx/2).
/**
 * @param {number} W
 * @param {number} H
 * @param {string} axes - "x"|"y"|"xy"
 * @param {number} widthPx
 * @returns {Float32Array}
 */
function _buildSeamMask(W, H, axes, widthPx) {
  const mask = new Float32Array(W * H);
  const sigma = Math.max(1, widthPx / 2);
  const inv2s2 = 1 / (2 * sigma * sigma);
  const blendX = axes === "x" || axes === "xy";
  const blendY = axes === "y" || axes === "xy";
  const cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) {
    const gy = blendY ? Math.exp(-Math.pow(y - cy, 2) * inv2s2) : 0;
    for (let x = 0; x < W; x++) {
      const gx = blendX ? Math.exp(-Math.pow(x - cx, 2) * inv2s2) : 0;
      mask[y * W + x] = Math.min(1, (blendX && blendY) ? Math.max(gx, gy) : blendX ? gx : gy);
    }
  }
  return mask;
}

// ── Mask overlay ──────────────────────────────────────────────────────────
// Returns a new canvas with the mask region tinted red so the AI can see
// exactly what to repaint.
/**
 * @param {HTMLCanvasElement} canvas
 * @param {Float32Array} mask
 * @returns {HTMLCanvasElement}
 */
function _paintMaskOverlay(canvas, mask) {
  const W = canvas.width, H = canvas.height;
  const result = document.createElement("canvas");
  result.width = W; result.height = H;
  const ctx = result.getContext("2d");
  ctx.drawImage(canvas, 0, 0);
  const img = ctx.getImageData(0, 0, W, H);
  const D = img.data;
  for (let i = 0; i < W * H; i++) {
    const m = mask[i];
    if (m < 0.01) continue;
    const a = m * 0.65;
    const j = i * 4;
    D[j]   = Math.round(D[j]   * (1 - a) + 255 * a);
    D[j+1] = Math.round(D[j+1] * (1 - a));
    D[j+2] = Math.round(D[j+2] * (1 - a));
  }
  ctx.putImageData(img, 0, 0);
  return result;
}

// ── Masked composite ──────────────────────────────────────────────────────
// Lerps base and inpainted per-pixel using mask weights.
// Pixels outside the mask are preserved exactly from base.
/**
 * @param {HTMLCanvasElement} base
 * @param {HTMLCanvasElement} inpainted
 * @param {Float32Array} mask
 * @returns {HTMLCanvasElement}
 */
function _compositeMasked(base, inpainted, mask) {
  const W = base.width, H = base.height;
  const bData = base.getContext("2d").getImageData(0, 0, W, H).data;
  const iData = inpainted.getContext("2d").getImageData(0, 0, W, H).data;
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const ctx = out.getContext("2d");
  const img = ctx.createImageData(W, H);
  const D = img.data;
  for (let i = 0; i < W * H; i++) {
    const m = mask[i], j = i * 4;
    D[j]   = Math.round(bData[j]   * (1 - m) + iData[j]   * m);
    D[j+1] = Math.round(bData[j+1] * (1 - m) + iData[j+1] * m);
    D[j+2] = Math.round(bData[j+2] * (1 - m) + iData[j+2] * m);
    D[j+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

// ── High-pass delight ─────────────────────────────────────────────────────
// Separable box blur (clamp-to-edge) on a packed Float32 RGB array.
/**
 * @param {Float32Array} Tf - Packed RGB array (W*H*3)
 * @param {number} W
 * @param {number} H
 * @param {number} r - Blur radius
 * @returns {Float32Array}
 */
function _boxBlur3Ch(Tf, W, H, r) {
  const N = W * H;
  const diam = 2 * r + 1;
  const tmp = new Float32Array(N * 3);
  const out = new Float32Array(N * 3);

  // Horizontal pass
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let s0 = 0, s1 = 0, s2 = 0;
    for (let k = -r; k <= r; k++) {
      const xi = (row + Math.max(0, Math.min(W - 1, k))) * 3;
      s0 += Tf[xi]; s1 += Tf[xi + 1]; s2 += Tf[xi + 2];
    }
    let ti = row * 3;
    tmp[ti] = s0 / diam; tmp[ti + 1] = s1 / diam; tmp[ti + 2] = s2 / diam;
    for (let x = 1; x < W; x++) {
      const ai = (row + Math.min(W - 1, x + r)) * 3;
      const ri = (row + Math.max(0,     x - r - 1)) * 3;
      s0 += Tf[ai] - Tf[ri]; s1 += Tf[ai+1] - Tf[ri+1]; s2 += Tf[ai+2] - Tf[ri+2];
      ti = (row + x) * 3;
      tmp[ti] = s0 / diam; tmp[ti + 1] = s1 / diam; tmp[ti + 2] = s2 / diam;
    }
  }

  // Vertical pass
  for (let x = 0; x < W; x++) {
    let s0 = 0, s1 = 0, s2 = 0;
    for (let k = -r; k <= r; k++) {
      const yi = (Math.max(0, Math.min(H - 1, k)) * W + x) * 3;
      s0 += tmp[yi]; s1 += tmp[yi + 1]; s2 += tmp[yi + 2];
    }
    let ti = x * 3;
    out[ti] = s0 / diam; out[ti + 1] = s1 / diam; out[ti + 2] = s2 / diam;
    for (let y = 1; y < H; y++) {
      const ay = (Math.min(H - 1, y + r)     * W + x) * 3;
      const ry = (Math.max(0,     y - r - 1) * W + x) * 3;
      s0 += tmp[ay] - tmp[ry]; s1 += tmp[ay+1] - tmp[ry+1]; s2 += tmp[ay+2] - tmp[ry+2];
      ti = (y * W + x) * 3;
      out[ti] = s0 / diam; out[ti + 1] = s1 / diam; out[ti + 2] = s2 / diam;
    }
  }
  return out;
}

// Photoshop "High Pass delight":
//   Base layer  = solid fill of the region's average colour
//   Blend layer = texture copy, High Pass filter applied, Linear Light @ opacity
//
// Linear Light blend: base + 2*blend - 1  (0–1 range)
// High Pass of texture: tex - blur(tex) + 0.5
// At opacity t the blended layer mixes with the base:
//   result = base + t * (2*highPass - 1)
//          = avg  + t * (2*(tex - blur + 0.5) - 1)
//          = avg  + 2t * (tex - blur)
//
// Removing large-scale lighting/AO while keeping surface micro-detail.
// opacity is 0–1 (maps from the 0–100 slider); radiusPx controls blur spread.
//
// softness [0,100]: blends the blur kernel between 1-pass box (sharp, halo-prone)
// and 3-pass box (≈ Gaussian, smooth). Higher = less haloing, softer edge response.
//
// returnBlur: when true, returns the illumination map (the blurred layer) directly
// so the user can preview what large-scale lighting is being removed.
/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} radiusPx
 * @param {number} opacity - [0,1]
 * @param {boolean} [lumaOnly]
 * @param {number} [softness]
 * @param {boolean} [returnBlur]
 * @returns {HTMLCanvasElement}
 */
function _hpDelightCanvas(canvas, radiusPx, opacity, lumaOnly = false, softness = 0, returnBlur = false) {
  const W = canvas.width, H = canvas.height;
  const N = W * H;
  const src = canvas.getContext("2d").getImageData(0, 0, W, H).data;

  const Tf = new Float32Array(N * 3);
  let sumR = 0, sumG = 0, sumB = 0;
  for (let i = 0; i < N; i++) {
    const r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2];
    Tf[i * 3] = r; Tf[i * 3 + 1] = g; Tf[i * 3 + 2] = b;
    sumR += r; sumG += g; sumB += b;
  }
  const avgR = sumR / N, avgG = sumG / N, avgB = sumB / N;

  // Blur kernel: 1 pass = harsh box (current default), 3 passes ≈ Gaussian (no haloing).
  // softness blends the two extremes so the slider gives a smooth, continuous transition.
  const r = Math.max(1, Math.round(radiusPx));
  const blurred1 = _boxBlur3Ch(Tf, W, H, r);
  let blurred;
  if (softness <= 0) {
    blurred = blurred1;
  } else {
    // 2 extra passes on top of the first → 3-pass total (Gaussian approximation)
    const blurred3 = _boxBlur3Ch(_boxBlur3Ch(blurred1, W, H, r), W, H, r);
    if (softness >= 100) {
      blurred = blurred3;
    } else {
      const sf = softness / 100;
      blurred = new Float32Array(N * 3);
      for (let i = 0; i < N * 3; i++)
        blurred[i] = blurred1[i] + sf * (blurred3[i] - blurred1[i]);
    }
  }

  // Preview diffuse: return the illumination map so the user can judge it.
  if (returnBlur) {
    const out = document.createElement("canvas");
    out.width = W; out.height = H;
    const ctx = out.getContext("2d");
    const img = ctx.createImageData(W, H);
    const D = img.data;
    for (let i = 0; i < N; i++) {
      const j = i * 4, k = i * 3;
      D[j]     = Math.max(0, Math.min(255, blurred[k]     + 0.5)) | 0;
      D[j + 1] = Math.max(0, Math.min(255, blurred[k + 1] + 0.5)) | 0;
      D[j + 2] = Math.max(0, Math.min(255, blurred[k + 2] + 0.5)) | 0;
      D[j + 3] = src[j + 3];
    }
    ctx.putImageData(img, 0, 0);
    return out;
  }

  const scale = 2 * opacity;
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const ctx = out.getContext("2d");
  const img = ctx.createImageData(W, H);
  const D = img.data;

  if (lumaOnly) {
    // Correct luminance only — preserves hue when light has a color cast.
    const avgL = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
    for (let i = 0; i < N; i++) {
      const j = i * 4, k = i * 3;
      const r = Tf[k], g = Tf[k + 1], b = Tf[k + 2];
      const L     = 0.299 * r + 0.587 * g + 0.114 * b;
      const Lblur = 0.299 * blurred[k] + 0.587 * blurred[k + 1] + 0.114 * blurred[k + 2];
      const targetL = avgL + scale * (L - Lblur);
      const factor = L > 1 ? targetL / L : 1;
      D[j]     = Math.max(0, Math.min(255, r * factor + 0.5)) | 0;
      D[j + 1] = Math.max(0, Math.min(255, g * factor + 0.5)) | 0;
      D[j + 2] = Math.max(0, Math.min(255, b * factor + 0.5)) | 0;
      D[j + 3] = src[j + 3];
    }
  } else {
    for (let i = 0; i < N; i++) {
      const j = i * 4, k = i * 3;
      D[j]     = Math.max(0, Math.min(255, avgR + scale * (Tf[k]     - blurred[k])     + 0.5)) | 0;
      D[j + 1] = Math.max(0, Math.min(255, avgG + scale * (Tf[k + 1] - blurred[k + 1]) + 0.5)) | 0;
      D[j + 2] = Math.max(0, Math.min(255, avgB + scale * (Tf[k + 2] - blurred[k + 2]) + 0.5)) | 0;
      D[j + 3] = src[j + 3];
    }
  }

  ctx.putImageData(img, 0, 0);
  return out;
}

// ── CURVES ────────────────────────────────────────────────────────────────
// Steffen monotone cubic spline: builds a 256-entry Uint8Array LUT from an
// array of [inputLevel, outputLevel] control points. Guaranteed no overshoot.
// Returns null when the mapping is a straight identity (saves work in runner).
/**
 * @param {number[][]} pts - [[in, out], …]
 * @returns {Uint8Array|null} 256-entry LUT, or null for identity
 */
function _buildCurveLUT(pts) {
  if (!pts || pts.length === 0) return null;

  // Sort by input, deduplicate
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  const u = [sorted[0]];
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i][0] !== sorted[i - 1][0]) u.push(sorted[i]);

  // Clamp y, ensure both endpoints present
  const ys0 = Math.max(0, Math.min(255, u[0][1]));
  const ysN = Math.max(0, Math.min(255, u[u.length - 1][1]));
  if (u[0][0] > 0) u.unshift([0, ys0]);
  if (u[u.length - 1][0] < 255) u.push([255, ysN]);

  const n  = u.length;
  const xs = u.map(p => p[0]);
  const ys = u.map(p => Math.max(0, Math.min(255, p[1])));

  // Fast-exit: identity
  if (n === 2 && xs[0] === 0 && ys[0] === 0 && xs[1] === 255 && ys[1] === 255)
    return null;

  const h = new Float32Array(n - 1);
  const s = new Float32Array(n - 1);
  const m = new Float32Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i+1] - xs[i]; s[i] = (ys[i+1] - ys[i]) / h[i]; }
  m[0] = s[0];
  for (let i = 1; i < n - 1; i++) m[i] = (s[i-1] + s[i]) / 2;
  m[n-1] = s[n-2];
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(s[i]) < 1e-10) { m[i] = m[i+1] = 0; continue; }
    const a = m[i] / s[i], b = m[i+1] / s[i];
    const r2 = a*a + b*b;
    if (r2 > 9) { const tau = 3 / Math.sqrt(r2); m[i] = tau*a*s[i]; m[i+1] = tau*b*s[i]; }
  }

  const lut = new Uint8Array(256);
  let seg = 0;
  for (let x = 0; x < 256; x++) {
    while (seg < n - 2 && x > xs[seg + 1]) seg++;
    const t = (x - xs[seg]) / h[seg];
    const t2 = t * t, t3 = t2 * t;
    const y = ys[seg]   * (2*t3 - 3*t2 + 1) + h[seg] * m[seg]   * (t3 - 2*t2 + t)
            + ys[seg+1] * (-2*t3 + 3*t2)    + h[seg] * m[seg+1] * (t3 - t2);
    lut[x] = Math.max(0, Math.min(255, Math.round(y)));
  }
  return lut;
}

/**
 * @param {HTMLCanvasElement} input
 * @param {{ rgb: number[][], r: number[][]|null, g: number[][]|null, b: number[][]|null }} params
 * @param {PipelineCtx} _ctx
 * @returns {Promise<HTMLCanvasElement>}
 */
function curvesRunner(input, params, _ctx) {
  const lutRGB = _buildCurveLUT(params.rgb ?? null);
  const lutR   = _buildCurveLUT(params.r   ?? null);
  const lutG   = _buildCurveLUT(params.g   ?? null);
  const lutB   = _buildCurveLUT(params.b   ?? null);

  if (!lutRGB && !lutR && !lutG && !lutB) return Promise.resolve(input);

  const W = input.width, H = input.height, N = W * H;
  const src = input.getContext("2d").getImageData(0, 0, W, H).data;
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const oc  = out.getContext("2d");
  const img = oc.createImageData(W, H);
  const D   = img.data;

  for (let i = 0; i < N; i++) {
    const j = i * 4;
    let r = src[j], g = src[j+1], b = src[j+2];
    if (lutRGB) { r = lutRGB[r]; g = lutRGB[g]; b = lutRGB[b]; }
    if (lutR)   r = lutR[r];
    if (lutG)   g = lutG[g];
    if (lutB)   b = lutB[b];
    D[j] = r; D[j+1] = g; D[j+2] = b; D[j+3] = src[j+3];
  }
  oc.putImageData(img, 0, 0);
  return Promise.resolve(out);
}

// ── HSL ADJUSTMENT ────────────────────────────────────────────────────────
/** @param {number} p @param {number} q @param {number} t @returns {number} */
function _hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/**
 * @param {HTMLCanvasElement} input
 * @param {{ hue: number, saturation: number, lightness: number }} params
 * @param {PipelineCtx} _ctx
 * @returns {Promise<HTMLCanvasElement>}
 */
function hslRunner(input, params, _ctx) {
  const hueShift = (params.hue        ??   0) / 360;  // normalised to [0,1)
  const satDelta = (params.saturation ??   0) / 100;
  const litDelta = (params.lightness  ??   0) / 100;
  const W = input.width, H = input.height, N = W * H;
  const src = input.getContext("2d").getImageData(0, 0, W, H).data;
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const oc  = out.getContext("2d");
  const img = oc.createImageData(W, H);
  const D   = img.data;

  for (let i = 0; i < N; i++) {
    const j = i * 4;
    const r = src[j] / 255, g = src[j + 1] / 255, b = src[j + 2] / 255;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
      h = 0; s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if      (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else                h = (r - g) / d + 4;
      h /= 6;
    }

    h = (h + hueShift + 1) % 1;
    s = Math.max(0, Math.min(1, s + satDelta));
    l = Math.max(0, Math.min(1, l + litDelta));

    let ro, go, bo;
    if (s === 0) {
      ro = go = bo = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      ro = _hue2rgb(p, q, h + 1 / 3);
      go = _hue2rgb(p, q, h);
      bo = _hue2rgb(p, q, h - 1 / 3);
    }

    D[j]     = (ro * 255 + 0.5) | 0;
    D[j + 1] = (go * 255 + 0.5) | 0;
    D[j + 2] = (bo * 255 + 0.5) | 0;
    D[j + 3] = src[j + 3];
  }

  oc.putImageData(img, 0, 0);
  return Promise.resolve(out);
}

// ── BLOCK RUNNERS ─────────────────────────────────────────────────────────
/**
 * @param {HTMLCanvasElement} input
 * @param {{ strength: number }} params
 * @param {PipelineCtx} _ctx
 * @returns {Promise<HTMLCanvasElement>}
 */
function retinexRunner(input, params, _ctx) {
  return Promise.resolve(_delightCanvas(input, (params.strength ?? 80) / 100));
}

/**
 * @param {HTMLCanvasElement} input
 * @param {{ radius: number, strength: number, softness: number, lumaOnly: boolean, previewDiffuse: boolean }} params
 * @param {PipelineCtx} _ctx
 * @returns {Promise<HTMLCanvasElement>}
 */
function highpassRunner(input, params, _ctx) {
  const radius         = params.radius         ?? 20;
  const strength       = params.strength       ?? 100;
  const softness       = params.softness       ?? 60;
  const lumaOnly       = params.lumaOnly       ?? true;
  const previewDiffuse = params.previewDiffuse ?? false;

  if (!previewDiffuse && (radius <= 0 || strength <= 0)) return Promise.resolve(input);

  const processed = _hpDelightCanvas(input, radius, 0.5, lumaOnly, softness, previewDiffuse);

  if (previewDiffuse || strength >= 100) return Promise.resolve(processed);

  // Blend input and processed result according to strength
  const t = strength / 100;
  const W = input.width, H = input.height, N = W * H;
  const srcA = input.getContext("2d").getImageData(0, 0, W, H).data;
  const srcB = processed.getContext("2d").getImageData(0, 0, W, H).data;
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const oc = out.getContext("2d");
  const img = oc.createImageData(W, H);
  const D = img.data;
  for (let i = 0; i < N * 4; i++) {
    D[i] = (srcA[i] + t * (srcB[i] - srcA[i]) + 0.5) | 0;
  }
  oc.putImageData(img, 0, 0);
  return Promise.resolve(out);
}

/**
 * @param {HTMLCanvasElement} input
 * @param {{ inLo: number, inHi: number, gamma: number }} params
 * @param {PipelineCtx} _ctx
 * @returns {Promise<HTMLCanvasElement>}
 */
function levelsRunner(input, params, _ctx) {
  const { inLo = 0, inHi = 255, gamma = 1.0 } = params;
  const W = input.width, H = input.height, N = W * H;
  const src = input.getContext("2d").getImageData(0, 0, W, H).data;
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const oc = out.getContext("2d");
  const img = oc.createImageData(W, H);
  const D = img.data;
  const range = Math.max(1, inHi - inLo);
  const invGamma = gamma > 0 ? 1 / gamma : 1;
  for (let i = 0; i < N; i++) {
    const j = i * 4;
    for (let c = 0; c < 3; c++) {
      let v = (src[j + c] - inLo) / range;
      v = Math.max(0, Math.min(1, v));
      if (invGamma !== 1) v = Math.pow(v, invGamma);
      D[j + c] = (v * 255 + 0.5) | 0;
    }
    D[j + 3] = src[j + 3];
  }
  oc.putImageData(img, 0, 0);
  return Promise.resolve(out);
}

// ── 2D band noise ─────────────────────────────────────────────────────────
// Deterministic, periodic 2D noise for modulating blend boundaries.
/**
 * @param {number} W
 * @param {number} H
 * @param {number} grain
 * @returns {Float32Array}
 */
function _makeNoise2D(W, H, grain) {
  const freq = Math.max(1, Math.round(grain));
  const noise = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = (y / H) * Math.PI * 2 * freq;
    for (let x = 0; x < W; x++) {
      const fx = (x / W) * Math.PI * 2 * freq;
      noise[y * W + x] = Math.sin(fx) * Math.cos(fy) * 0.5
                       + Math.sin(fx * 2.13) * Math.cos(fy * 1.73) * 0.25
                       + Math.sin(fx * 4.37) * Math.cos(fy * 3.11) * 0.125;
    }
  }
  return noise;
}

// ── Debug overlay — red gradient from blend=1 to transparent ─────────────
/**
 * @param {CanvasRenderingContext2D} oc
 * @param {number} W
 * @param {number} H
 * @param {Uint8Array} blendMask
 */
function _debugBand(oc, W, H, blendMask) {
  const dImg = oc.getImageData(0, 0, W, H);
  const dD = dImg.data;
  for (let i = 0; i < dD.length; i += 4) {
    const b = blendMask[i / 4] / 255;
    if (!b) continue;
    const t = b * 0.5;
    dD[i]     = (dD[i]     * (1 - t) + 255 * t + 0.5) | 0;
    dD[i + 1] = (dD[i + 1] * (1 - t) + 0.5) | 0;
    dD[i + 2] = (dD[i + 2] * (1 - t) + 0.5) | 0;
  }
  oc.putImageData(dImg, 0, 0);
}

// ── Shared edge-band helpers ─────────────────────────────────────────────
/** @param {number} t @returns {number} */
function _smooth(t) {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}
/**
 * @param {number} coord
 * @param {number} size
 * @param {number} bandW
 * @param {number} blendW
 * @returns {number}
 */
function _edgeBand(coord, size, bandW, blendW) {
  if (coord < 0) return 0;
  const d = Math.min(coord, size - 1 - coord);
  if (d >= bandW) return 0;
  const inner = bandW - blendW;
  if (d <= inner) return 1;
  return 1 - _smooth((d - inner) / blendW);
}

// ── Shared per-axis sharpen ──────────────────────────────────────────────
/**
 * @param {CanvasRenderingContext2D} oc
 * @param {number} W
 * @param {number} H
 * @param {Uint8Array} blendMask
 * @param {number} bWX
 * @param {number} bWY
 * @param {number} spX
 * @param {number} spY
 */
function _bandSharpen(oc, W, H, blendMask, bWX, bWY, spX, spY) {
  if (!spX && !spY) return;
  const blur = document.createElement("canvas");
  blur.width = W; blur.height = H;
  const bc = blur.getContext("2d");
  bc.filter = "blur(2px)";
  bc.drawImage(oc.canvas, 0, 0);
  const sImg = oc.getImageData(0, 0, W, H);
  const sData = sImg.data;
  const bData = bc.getImageData(0, 0, W, H).data;
  for (let y = 0; y < H; y++) {
    const dy = Math.min(y, H - 1 - y);
    for (let x = 0; x < W; x++) {
      const dx = Math.min(x, W - 1 - x);
      const mask = blendMask[y * W + x] / 255;
      if (!mask) continue;
      const s = (dx < bWX ? spX : 0) + (dy < bWY ? spY : 0);
      if (!s) continue;
      const i = (y * W + x) * 4;
      const t = mask * s;
      sData[i]     = Math.max(0, Math.min(255, sData[i]     + (sData[i]     - bData[i])     * t + 0.5)) | 0;
      sData[i + 1] = Math.max(0, Math.min(255, sData[i + 1] + (sData[i + 1] - bData[i + 1]) * t + 0.5)) | 0;
      sData[i + 2] = Math.max(0, Math.min(255, sData[i + 2] + (sData[i + 2] - bData[i + 2]) * t + 0.5)) | 0;
    }
  }
  oc.putImageData(sImg, 0, 0);
}

// ── SEAMLESS OFFSET RUNNER ─────────────────────────────────────────────────
// Four-quadrant periodic blend over four half-offset copies.
/**
 * @param {HTMLCanvasElement} input
 * @param {{ axes: string, shiftX: number, shiftY: number, widthX: number, widthY: number, blendX: number, blendY: number, sharpenX: number, sharpenY: number, noiseIntX: number, noiseIntY: number, noiseScaleX: number, noiseScaleY: number, debugTile: boolean }} params
 * @param {PipelineCtx} _ctx
 * @returns {Promise<HTMLCanvasElement>}
 */
function seamlessOffsetRunner(input, params, _ctx) {
  const axes  = params.axes ?? "xy";
  const doX   = axes === "x" || axes === "xy";
  const doY   = axes === "y" || axes === "xy";
  const W = input.width, H = input.height;
  const src  = input.getContext("2d").getImageData(0, 0, W, H).data;
  const hw   = Math.floor(W / 2);
  const hh   = Math.floor(H / 2);
  const sX   = doX ? ((params.shiftX ?? 0) % W + W) % W : 0;
  const sY   = doY ? ((params.shiftY ?? 0) % H + H) % H : 0;

  const bWX  = doX ? Math.min(W, Math.max(0, Math.round(params.widthX  ?? 16))) : 0;
  const bWY  = doY ? Math.min(H, Math.max(0, Math.round(params.widthY  ?? 16))) : 0;
  const bLX  = doX ? Math.min(bWX, Math.max(0, Math.round(params.blendX ?? 6))) : 0;
  const bLY  = doY ? Math.min(bWY, Math.max(0, Math.round(params.blendY ?? 6))) : 0;
  const spX  = doX ? (params.sharpenX    ?? 0) / 100 : 0;
  const spY  = doY ? (params.sharpenY    ?? 0) / 100 : 0;
  const niX  = doX ? (params.noiseIntX   ?? 50) / 100 : 0;
  const niY  = doY ? (params.noiseIntY   ?? 50) / 100 : 0;
  const nsX  = doX ? (params.noiseScaleX ?? 5) : 5;
  const nsY  = doY ? (params.noiseScaleY ?? 5) : 5;
  const debug = !!params.debugTile;

  const noiseX = niX ? _makeNoise2D(W, H, nsX) : null;
  const noiseY = niY ? _makeNoise2D(W, H, nsY) : null;
  const blendMask = new Uint8Array(W * H);

  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const oc  = out.getContext("2d");
  const img = oc.createImageData(W, H);
  const D   = img.data;

  for (let y = 0; y < H; y++) {
    const oy = (y + hh + sY) % H;
    const dy = Math.min(y, H - 1 - y);
    for (let x = 0; x < W; x++) {
      const ox = (x + hw + sX) % W;
      const dx = Math.min(x, W - 1 - x);

      const nX = noiseX ? noiseX[y * W + x] * niX * bLX : 0;
      const nY = noiseY ? noiseY[y * W + x] * niY * bLY : 0;
      const effBWX = doX ? Math.max(bLX, bWX + nX) : 0;
      const effBWY = doY ? Math.max(bLY, bWY + nY) : 0;
      const wX = doX ? _edgeBand(dx, W, effBWX, bLX) : 0;
      const wY = doY ? _edgeBand(dy, H, effBWY, bLY) : 0;

      const wA = (1 - wX) * (1 - wY);
      const wB =      wX  * (1 - wY);
      const wC = (1 - wX) *      wY;
      const wD =      wX  *      wY;

      const di = (y  * W + x)  * 4;
      const ib = (y  * W + ox) * 4;
      const ic = (oy * W + x)  * 4;
      const id = (oy * W + ox) * 4;

      D[di]     = (src[di]     * wA + src[ib]     * wB + src[ic]     * wC + src[id]     * wD + 0.5) | 0;
      D[di + 1] = (src[di + 1] * wA + src[ib + 1] * wB + src[ic + 1] * wC + src[id + 1] * wD + 0.5) | 0;
      D[di + 2] = (src[di + 2] * wA + src[ib + 2] * wB + src[ic + 2] * wC + src[id + 2] * wD + 0.5) | 0;
      D[di + 3] = 255;
      blendMask[y * W + x] = Math.round((1 - wA) * 255);
    }
  }

  oc.putImageData(img, 0, 0);
  _bandSharpen(oc, W, H, blendMask, bWX, bWY, spX, spY);
  if (debug) _debugBand(oc, W, H, blendMask);
  return Promise.resolve(out);
}

// ── MIRROR TILE RUNNER ────────────────────────────────────────────────────
// Blend using four mirror copies (flipH, flipV, flipHV) at tile edges with
// the same band model, 2D noise, and per-axis sharpen as the offset runner.
/**
 * @param {HTMLCanvasElement} input
 * @param {{ axes: string, shiftX: number, shiftY: number, widthX: number, widthY: number, blendX: number, blendY: number, sharpenX: number, sharpenY: number, noiseIntX: number, noiseIntY: number, noiseScaleX: number, noiseScaleY: number, debugTile: boolean }} params
 * @param {PipelineCtx} _ctx
 * @returns {Promise<HTMLCanvasElement>}
 */
function mirrorTileRunner(input, params, _ctx) {
  const axes  = params.axes ?? "xy";
  const doX   = axes === "x" || axes === "xy";
  const doY   = axes === "y" || axes === "xy";
  const W = input.width, H = input.height;

  const ox = doX ? ((params.shiftX ?? 0) % W + W) % W : 0;
  const oy = doY ? ((params.shiftY ?? 0) % H + H) % H : 0;

  const rolled = document.createElement("canvas");
  rolled.width = W; rolled.height = H;
  const rctx = rolled.getContext("2d");
  rctx.drawImage(input,  -ox,      -oy);
  if (ox)       rctx.drawImage(input, W - ox,      -oy);
  if (oy)       rctx.drawImage(input,  -ox, H - oy);
  if (ox && oy) rctx.drawImage(input, W - ox, H - oy);

  const bWX  = doX ? Math.min(W, Math.max(0, Math.round(params.widthX  ?? 16))) : 0;
  const bWY  = doY ? Math.min(H, Math.max(0, Math.round(params.widthY  ?? 16))) : 0;
  const bLX  = doX ? Math.min(bWX, Math.max(0, Math.round(params.blendX ?? 6))) : 0;
  const bLY  = doY ? Math.min(bWY, Math.max(0, Math.round(params.blendY ?? 6))) : 0;
  const spX  = doX ? (params.sharpenX    ?? 0) / 100 : 0;
  const spY  = doY ? (params.sharpenY    ?? 0) / 100 : 0;
  const niX  = doX ? (params.noiseIntX   ?? 50) / 100 : 0;
  const niY  = doY ? (params.noiseIntY   ?? 50) / 100 : 0;
  const nsX  = doX ? (params.noiseScaleX ?? 5) : 5;
  const nsY  = doY ? (params.noiseScaleY ?? 5) : 5;
  const debug = !!params.debugTile;

  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const oc  = out.getContext("2d");

  if (!bWX && !bWY) {
    oc.drawImage(rolled, 0, 0);
    return Promise.resolve(out);
  }

  const src = rolled.getContext("2d").getImageData(0, 0, W, H).data;
  const img = oc.createImageData(W, H);
  const D   = img.data;

  const noiseX = niX ? _makeNoise2D(W, H, nsX) : null;
  const noiseY = niY ? _makeNoise2D(W, H, nsY) : null;
  const blendMask = new Uint8Array(W * H);

  for (let y = 0; y < H; y++) {
    const dy = Math.min(y, H - 1 - y);
    const mY = H - 1 - y;
    for (let x = 0; x < W; x++) {
      const dx = Math.min(x, W - 1 - x);
      const mX = W - 1 - x;

      const nX = noiseX ? noiseX[y * W + x] * niX * bLX : 0;
      const nY = noiseY ? noiseY[y * W + x] * niY * bLY : 0;
      const effBWX = doX ? Math.max(bLX, bWX + nX) : 0;
      const effBWY = doY ? Math.max(bLY, bWY + nY) : 0;
      const wX = doX ? _edgeBand(dx, W, effBWX, bLX) : 0;
      const wY = doY ? _edgeBand(dy, H, effBWY, bLY) : 0;

      const wA = (1 - wX / 2) * (1 - wY / 2);
      const wB =      wX / 2  * (1 - wY / 2);
      const wC = (1 - wX / 2) *      wY / 2;
      const wD =      wX / 2  *      wY / 2;

      const iA  = (y  * W + x ) * 4;
      const iB  = (y  * W + mX) * 4;
      const iC  = (mY * W + x ) * 4;
      const iD  = (mY * W + mX) * 4;

      D[iA]     = (src[iA]     * wA + src[iB]     * wB + src[iC]     * wC + src[iD]     * wD + 0.5) | 0;
      D[iA + 1] = (src[iA + 1] * wA + src[iB + 1] * wB + src[iC + 1] * wC + src[iD + 1] * wD + 0.5) | 0;
      D[iA + 2] = (src[iA + 2] * wA + src[iB + 2] * wB + src[iC + 2] * wC + src[iD + 2] * wD + 0.5) | 0;
      D[iA + 3] = 255;
      blendMask[y * W + x] = Math.round((1 - wA) * 255);
    }
  }

  oc.putImageData(img, 0, 0);
  _bandSharpen(oc, W, H, blendMask, bWX, bWY, spX, spY);
  if (debug) _debugBand(oc, W, H, blendMask);
  return Promise.resolve(out);
}

// ── Seamless tile builder ─────────────────────────────────────────────────
// Tiles src at uvScale across an outW×outH canvas.
// featherPx > 0 applies a soft-edge blend in the seam zones.
/**
 * @param {HTMLCanvasElement} src
 * @param {number} uvScale
 * @param {number} featherPx
 * @param {number} [outW]
 * @param {number} [outH]
 * @returns {HTMLCanvasElement}
 */
function _buildTiledInput(src, uvScale, featherPx, outW, outH) {
  outW = outW || src.width;
  outH = outH || src.height;
  uvScale = Math.max(0.05, Math.min(1, uvScale));
  const tw = Math.max(4, Math.round(outW * uvScale));
  const th = Math.max(4, Math.round(outH * uvScale));

  // Rasterise source at tile size
  const tileC = document.createElement("canvas");
  tileC.width = tw;
  tileC.height = th;
  tileC.getContext("2d").drawImage(src, 0, 0, tw, th);
  const T = tileC.getContext("2d").getImageData(0, 0, tw, th).data;

  const fp = Math.min(
    Math.round(featherPx || 0),
    (tw * 0.45) | 0,
    (th * 0.45) | 0,
  );

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const octx = out.getContext("2d");

  if (fp <= 0) {
    for (let oy = 0; oy < outH; oy += th)
      for (let ox = 0; ox < outW; ox += tw) octx.drawImage(tileC, ox, oy);
    return out;
  }

  // ── Periodic separable box-blur of the tile (low-freq envelope) ─────────
  const blurR = Math.max(2, fp >> 1);
  const diam = 2 * blurR + 1;
  const N = tw * th;

  const Tf = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    Tf[i * 3] = T[i * 4];
    Tf[i * 3 + 1] = T[i * 4 + 1];
    Tf[i * 3 + 2] = T[i * 4 + 2];
  }

  const tmp = new Float32Array(N * 3);
  const Tb = new Float32Array(N * 3);

  for (let y = 0; y < th; y++) {
    const row = y * tw;
    let s0 = 0, s1 = 0, s2 = 0;
    for (let k = -blurR; k <= blurR; k++) {
      const kw = ((k % tw) + tw) % tw;
      const ki = (row + kw) * 3;
      s0 += Tf[ki]; s1 += Tf[ki + 1]; s2 += Tf[ki + 2];
    }
    let ti = row * 3;
    tmp[ti] = s0 / diam; tmp[ti + 1] = s1 / diam; tmp[ti + 2] = s2 / diam;
    for (let x = 1; x < tw; x++) {
      const ai = (row + ((x + blurR) % tw)) * 3;
      const ri = (row + ((x - blurR - 1 + tw) % tw)) * 3;
      s0 += Tf[ai] - Tf[ri]; s1 += Tf[ai+1] - Tf[ri+1]; s2 += Tf[ai+2] - Tf[ri+2];
      ti = (row + x) * 3;
      tmp[ti] = s0 / diam; tmp[ti+1] = s1 / diam; tmp[ti+2] = s2 / diam;
    }
  }

  for (let x = 0; x < tw; x++) {
    let s0 = 0, s1 = 0, s2 = 0;
    for (let k = -blurR; k <= blurR; k++) {
      const ky = ((k % th) + th) % th;
      const ki = (ky * tw + x) * 3;
      s0 += tmp[ki]; s1 += tmp[ki+1]; s2 += tmp[ki+2];
    }
    let ti = x * 3;
    Tb[ti] = s0 / diam; Tb[ti+1] = s1 / diam; Tb[ti+2] = s2 / diam;
    for (let y = 1; y < th; y++) {
      const ay = (y + blurR) % th, ry = (y - blurR - 1 + th) % th;
      const ai = (ay * tw + x) * 3, ri = (ry * tw + x) * 3;
      s0 += tmp[ai] - tmp[ri]; s1 += tmp[ai+1] - tmp[ri+1]; s2 += tmp[ai+2] - tmp[ri+2];
      ti = (y * tw + x) * 3;
      Tb[ti] = s0 / diam; Tb[ti+1] = s1 / diam; Tb[ti+2] = s2 / diam;
    }
  }

  const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const shiftX = Math.round(tw / 2), shiftY = Math.round(th / 2);
  const img = octx.createImageData(outW, outH);
  const D = img.data;

  for (let y = 0; y < outH; y++) {
    const ty = y % th;
    const dY = Math.min(ty, th - ty);
    const inY = dY < fp;
    const wY = inY ? smooth(dY / fp) : 1.0;
    const byB = (ty + shiftY) % th;
    for (let x = 0; x < outW; x++) {
      const tx = x % tw;
      const dX = Math.min(tx, tw - tx);
      const inX = dX < fp;
      const wX = inX ? smooth(dX / fp) : 1.0;
      const oi = (y * outW + x) * 4;
      const ai = (ty * tw + tx) * 4;
      const ti = (ty * tw + tx) * 3;
      if (!inX && !inY) {
        D[oi] = T[ai]; D[oi+1] = T[ai+1]; D[oi+2] = T[ai+2]; D[oi+3] = 255;
        continue;
      }
      const wA = wX * wY, corr = 1.0 - wA;
      const bx = (tx + shiftX) % tw;
      const tbi = (byB * tw + bx) * 3;
      D[oi]   = Math.max(0, Math.min(255, T[ai]   + corr * (Tb[tbi]   - Tb[ti])   + 0.5)) | 0;
      D[oi+1] = Math.max(0, Math.min(255, T[ai+1] + corr * (Tb[tbi+1] - Tb[ti+1]) + 0.5)) | 0;
      D[oi+2] = Math.max(0, Math.min(255, T[ai+2] + corr * (Tb[tbi+2] - Tb[ti+2]) + 0.5)) | 0;
      D[oi+3] = 255;
    }
  }

  octx.putImageData(img, 0, 0);
  return out;
}

// ── STYLIZE — colour quantisation + dithering ────────────────────────────────
// Bayer matrices, row-major, pre-scaled to the [-0.5, +0.5] threshold range
const _BAYER_2 = [0, 2, 3, 1].map(v => v / 4  - 0.5);
const _BAYER_4 = [0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5].map(v => v / 16 - 0.5);

// Snap a channel value to the nearest level for N bits per channel.
/** @param {number} v @param {number} bits @returns {number} */
function _qsnapBits(v, bits) {
  const levels = (1 << bits) - 1;
  const step = 255 / levels;
  return Math.min(255, Math.max(0, Math.round(v / step) * step));
}

// ── Fixed palettes ─────────────────────────────────────────────────────────
// Each entry is [R, G, B] (0–255).
/** @type {Object<string, number[][]>} */
const _PALETTES = {
  // ── Handhelds ────────────────────────────────────────────────────────────
  gameboy: [
    [15,56,15],[48,98,48],[139,172,15],[155,188,15],
  ],
  gbpocket: [
    [0,0,0],[85,85,85],[170,170,170],[255,255,255],
  ],
  virtualboy: [
    [0,0,0],[85,0,0],[170,0,0],[255,0,0],
  ],

  // ── Home computers ───────────────────────────────────────────────────────
  c64: [
    [0,0,0],[255,255,255],[136,0,0],[170,255,238],
    [204,68,204],[0,204,85],[0,0,170],[238,238,119],
    [221,136,85],[102,68,0],[255,119,119],[51,51,51],
    [119,119,119],[170,255,102],[0,136,255],[187,187,187],
  ],
  zxspectrum: [
    [0,0,0],
    [0,0,215],[215,0,0],[215,0,215],[0,215,0],[0,215,215],[215,215,0],[215,215,215],
    [0,0,255],[255,0,0],[255,0,255],[0,255,0],[0,255,255],[255,255,0],[255,255,255],
  ],
  msx: [
    [0,0,0],[0,0,0],[33,200,66],[94,220,120],
    [84,85,237],[125,118,252],[212,82,77],[66,235,245],
    [252,85,84],[255,121,120],[212,193,84],[230,206,128],
    [33,176,59],[201,91,186],[204,204,204],[255,255,255],
  ],
  cpc: [
    [0,0,0],[0,0,128],[0,0,255],
    [128,0,0],[128,0,128],[128,0,255],
    [255,0,0],[255,0,128],[255,0,255],
    [0,128,0],[0,128,128],[0,128,255],
    [128,128,0],[128,128,128],[128,128,255],
    [255,128,0],[255,128,128],[255,128,255],
    [0,255,0],[0,255,128],[0,255,255],
    [128,255,0],[128,255,128],[128,255,255],
    [255,255,0],[255,255,128],[255,255,255],
  ],

  // ── PC / arcade ──────────────────────────────────────────────────────────
  cga: [
    [0,0,0],[0,0,170],[0,170,0],[0,170,170],
    [170,0,0],[170,0,170],[170,85,0],[170,170,170],
    [85,85,85],[85,85,255],[85,255,85],[85,255,255],
    [255,85,85],[255,85,255],[255,255,85],[255,255,255],
  ],
  ega: (() => {
    const L = [0, 85, 170, 255];
    return Array.from({length: 64}, (_, i) => [L[(i >> 4) & 3], L[(i >> 2) & 3], L[i & 3]]);
  })(),
  nes: [
    [84,84,84],[0,30,116],[8,16,144],[48,0,136],[68,0,100],[92,0,48],[84,4,0],[60,24,0],
    [32,42,0],[8,58,0],[0,64,0],[0,60,0],[0,50,60],[0,0,0],[0,0,0],[0,0,0],
    [152,150,152],[8,76,196],[48,50,236],[92,30,228],[136,20,176],[160,20,100],[152,34,32],[120,60,0],
    [84,90,0],[40,114,0],[8,124,0],[0,118,40],[0,102,120],[0,0,0],[0,0,0],[0,0,0],
    [236,238,236],[76,154,236],[120,124,236],[176,98,236],[228,84,236],[236,88,180],[236,106,100],[212,136,32],
    [160,170,0],[116,196,0],[76,208,32],[56,204,108],[56,180,204],[60,60,60],[0,0,0],[0,0,0],
    [236,238,236],[168,204,236],[188,188,236],[212,178,236],[236,174,236],[236,174,212],[236,180,176],[228,196,144],
    [204,210,120],[180,222,120],[168,226,144],[152,226,180],[160,214,228],[160,162,160],[0,0,0],[0,0,0],
  ],

  // ── Community / fantasy consoles ─────────────────────────────────────────
  pico8: [
    [0,0,0],[29,43,83],[126,37,83],[0,135,81],
    [171,82,54],[95,87,79],[194,195,199],[255,241,232],
    [255,0,77],[255,163,0],[255,236,39],[0,228,54],
    [41,173,255],[131,118,156],[255,119,168],[255,204,170],
  ],
  sweetie16: [
    [26,28,44],[93,39,93],[177,62,83],[239,125,87],
    [255,205,117],[167,240,112],[56,183,100],[37,113,121],
    [41,54,111],[59,93,201],[65,166,246],[115,239,247],
    [244,244,244],[148,176,194],[86,108,134],[51,60,87],
  ],
  dawnbringer16: [
    [20,12,28],[68,36,52],[48,52,109],[78,74,78],
    [133,76,48],[52,101,36],[208,70,72],[117,113,97],
    [89,125,206],[210,125,44],[133,149,161],[109,170,44],
    [210,170,153],[109,194,202],[218,212,94],[222,238,214],
  ],
  dawnbringer32: [
    [0,0,0],[34,32,52],[69,40,60],[102,57,49],
    [143,86,59],[223,113,38],[217,160,102],[238,195,154],
    [251,242,54],[153,229,80],[106,190,48],[55,148,110],
    [75,105,47],[82,75,36],[50,60,57],[63,63,116],
    [48,96,130],[91,110,225],[99,155,255],[95,205,228],
    [203,219,252],[255,255,255],[155,173,183],[132,126,135],
    [105,106,106],[89,86,82],[118,66,138],[172,50,50],
    [217,87,99],[215,123,186],[143,151,74],[138,111,48],
  ],
};

// Nearest-colour match in RGB space. Returns the closest [R,G,B] from pal.
/**
 * @param {number} r @param {number} g @param {number} b @param {number[][]} pal
 * @returns {number[]}
 */
function _nearestPalColor(r, g, b, pal) {
  let best = pal[0], bestD = Infinity;
  for (const c of pal) {
    const dr = r - c[0], dg = g - c[1], db = b - c[2];
    const d = dr*dr + dg*dg + db*db;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// Apply stylize effects to a canvas.
// s: { bitDepth, dither, saturation, fixedPalette }
//   bitDepth:     1–8 (8 = no quantisation)
//   dither:       "none" | "bayer2" | "bayer4" | "fs"
//   saturation:   0–200 (100 = unchanged)
//   fixedPalette: "none" | <palette key>
//                 When set, overrides bitDepth quantisation.
// Order: saturation → quantise+dither.
// Returns src unchanged when all effects are neutral.
/** Yield to the event loop to avoid script-timeout watchdog on large canvases. */
function _yieldToEventLoop() { return new Promise(r => setTimeout(r, 0)); }

/**
 * @param {HTMLCanvasElement} src
 * @param {{ bitDepth?: number, dither?: string, saturation?: number, fixedPalette?: string }} s
 * @param {AbortSignal} [signal]
 * @returns {Promise<HTMLCanvasElement|null>} null if aborted
 */
async function exportApplyStylize(src, s, signal) {
  if (signal?.aborted) return null;
  const { bitDepth = 8, dither = "none", saturation = 100, fixedPalette = "none" } = s;
  const pal       = fixedPalette !== "none" ? _PALETTES[fixedPalette] : null;
  const doQuant   = pal != null || bitDepth < 8;
  const doSat     = saturation !== 100;
  if (!doQuant && !doSat) return src;

  const out = document.createElement("canvas");
  out.width = src.width; out.height = src.height;
  const ctx = out.getContext("2d");
  ctx.drawImage(src, 0, 0);
  const W = src.width, H = src.height;
  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;

  // How many rows to process before yielding to avoid script-timeout watchdog.
  // Smaller = more responsive but higher overhead. 64 rows is a good trade-off.
  const CHUNK = 64;

  // ── 1. Saturation ─────────────────────────────────────────────────────────
  if (doSat) {
    const f = saturation / 100;
    for (let y = 0; y < H; y++) {
      if (y % CHUNK === 0 && y > 0) await _yieldToEventLoop();
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
        d[i]   = Math.min(255, Math.max(0, Math.round(gray + (d[i]   - gray) * f)));
        d[i+1] = Math.min(255, Math.max(0, Math.round(gray + (d[i+1] - gray) * f)));
        d[i+2] = Math.min(255, Math.max(0, Math.round(gray + (d[i+2] - gray) * f)));
      }
    }
  }

  // ── 2. Colour quantisation + dithering ────────────────────────────────────
  if (doQuant) {
    if (pal) {
      const spread = 48;
      if (dither === "bayer2" || dither === "bayer4") {
        const mat = dither === "bayer4" ? _BAYER_4 : _BAYER_2;
        const N   = dither === "bayer4" ? 4 : 2;
        for (let y = 0; y < H; y++) {
          if (y % CHUNK === 0 && y > 0) { await _yieldToEventLoop(); if (signal?.aborted) return null; }
          for (let x = 0; x < W; x++) {
            const pi = (y * W + x) * 4;
            const t  = mat[(y % N) * N + (x % N)] * spread;
            const [qr, qg, qb] = _nearestPalColor(
              Math.min(255, Math.max(0, d[pi]   + t)),
              Math.min(255, Math.max(0, d[pi+1] + t)),
              Math.min(255, Math.max(0, d[pi+2] + t)),
              pal);
            d[pi] = qr; d[pi+1] = qg; d[pi+2] = qb;
          }
        }
      } else if (dither === "fs") {
        const n = W * H;
        const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
        for (let i = 0; i < n; i++) { R[i] = d[i*4]; G[i] = d[i*4+1]; B[i] = d[i*4+2]; }
        for (let y = 0; y < H; y++) {
          if (y % CHUNK === 0 && y > 0) { await _yieldToEventLoop(); if (signal?.aborted) return null; }
          for (let x = 0; x < W; x++) {
            const i  = y * W + x;
            const [qr, qg, qb] = _nearestPalColor(R[i], G[i], B[i], pal);
            d[i*4] = qr; d[i*4+1] = qg; d[i*4+2] = qb;
            const er = R[i] - qr, eg = G[i] - qg, eb = B[i] - qb;
            if (x+1 < W)             { R[i+1]   += er*7/16; G[i+1]   += eg*7/16; B[i+1]   += eb*7/16; }
            if (y+1 < H && x > 0)   { R[i+W-1] += er*3/16; G[i+W-1] += eg*3/16; B[i+W-1] += eb*3/16; }
            if (y+1 < H)             { R[i+W]   += er*5/16; G[i+W]   += eg*5/16; B[i+W]   += eb*5/16; }
            if (y+1 < H && x+1 < W) { R[i+W+1] += er*1/16; G[i+W+1] += eg*1/16; B[i+W+1] += eb*1/16; }
          }
        }
      } else {
        for (let y = 0; y < H; y++) {
          if (y % CHUNK === 0 && y > 0) { await _yieldToEventLoop(); if (signal?.aborted) return null; }
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const [qr, qg, qb] = _nearestPalColor(d[i], d[i+1], d[i+2], pal);
            d[i] = qr; d[i+1] = qg; d[i+2] = qb;
          }
        }
      }
    } else {
      const step = 255 / ((1 << bitDepth) - 1);
      if (dither === "bayer2" || dither === "bayer4") {
        const mat = dither === "bayer4" ? _BAYER_4 : _BAYER_2;
        const N   = dither === "bayer4" ? 4 : 2;
        for (let y = 0; y < H; y++) {
          if (y % CHUNK === 0 && y > 0) { await _yieldToEventLoop(); if (signal?.aborted) return null; }
          for (let x = 0; x < W; x++) {
            const pi = (y * W + x) * 4;
            const t  = mat[(y % N) * N + (x % N)] * step;
            d[pi]   = _qsnapBits(d[pi]   + t, bitDepth);
            d[pi+1] = _qsnapBits(d[pi+1] + t, bitDepth);
            d[pi+2] = _qsnapBits(d[pi+2] + t, bitDepth);
          }
        }
      } else if (dither === "fs") {
        const n = W * H;
        const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
        for (let i = 0; i < n; i++) { R[i] = d[i*4]; G[i] = d[i*4+1]; B[i] = d[i*4+2]; }
        for (let y = 0; y < H; y++) {
          if (y % CHUNK === 0 && y > 0) { await _yieldToEventLoop(); if (signal?.aborted) return null; }
          for (let x = 0; x < W; x++) {
            const i  = y * W + x;
            const qr = _qsnapBits(R[i], bitDepth), qg = _qsnapBits(G[i], bitDepth), qb = _qsnapBits(B[i], bitDepth);
            d[i*4] = qr; d[i*4+1] = qg; d[i*4+2] = qb;
            const er = R[i] - qr, eg = G[i] - qg, eb = B[i] - qb;
            if (x+1 < W)             { R[i+1]   += er*7/16; G[i+1]   += eg*7/16; B[i+1]   += eb*7/16; }
            if (y+1 < H && x > 0)   { R[i+W-1] += er*3/16; G[i+W-1] += eg*3/16; B[i+W-1] += eb*3/16; }
            if (y+1 < H)             { R[i+W]   += er*5/16; G[i+W]   += eg*5/16; B[i+W]   += eb*5/16; }
            if (y+1 < H && x+1 < W) { R[i+W+1] += er*1/16; G[i+W+1] += eg*1/16; B[i+W+1] += eb*1/16; }
          }
        }
      } else {
        for (let y = 0; y < H; y++) {
          if (y % CHUNK === 0 && y > 0) { await _yieldToEventLoop(); if (signal?.aborted) return null; }
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            d[i]   = _qsnapBits(d[i],   bitDepth);
            d[i+1] = _qsnapBits(d[i+1], bitDepth);
            d[i+2] = _qsnapBits(d[i+2], bitDepth);
          }
        }
      }
    }
  }

  ctx.putImageData(id, 0, 0);
  return out;
}

/**
 * @param {HTMLCanvasElement} input
 * @param {{ fixedPalette: string, bitDepth: number, dither: string, saturation: number }} params
 * @param {PipelineCtx} _ctx
 * @returns {Promise<HTMLCanvasElement>}
 */
function stylizeRunner(input, params, ctx) {
  return exportApplyStylize(input, params, ctx?.signal);
}

// ── Albedo Compress ──────────────────────────────────────────────────────────
// Remaps luminance and saturation into physically-based albedo ranges.
// Two-pass algorithm:
//   Pass 1 — compute luminance p2/p98 percentiles + mean chroma of the image
//   Pass 2 — remap [p2,p98] → [targetLo,targetHi] per pixel, then normalize chroma
// Ranges are sourced from PBR reference charts (Allegorithmic / UE4 docs).
/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ mode: string, strength: number }} params
 * @param {PipelineCtx} ctx
 * @returns {HTMLCanvasElement}
 */
function albedoCompressRunner(canvas, params, ctx) {
  // Albedo ranges in sRGB [0,255] from PBR reference (Allegorithmic/UE4/Marmoset docs).
  // sat = maximum tolerated mean chroma (max-min of RGB); excess is scaled down.
  // Metal: near-black diffuse is correct for metallic/roughness PBR — conductors
  //   have no diffuse reflection. "metal" here targets non-metallic metal appearance
  //   (corroded, oxidized, galvanized). Clean polished metal should use metalness=1
  //   in-engine and would not need albedo compress.
  const RANGES = {
    masonry:  { lo: 45,  hi: 185, sat: 0.55 },  // dark brick → light sandstone
    wood:     { lo: 40,  hi: 170, sat: 0.50 },  // dark bark → light pine
    metal:    { lo: 5,   hi: 55,  sat: 0.20 },  // near-black diffuse (metallic/roughness)
    concrete: { lo: 50,  hi: 175, sat: 0.18 },  // near-gray; strong desat
    plaster:  { lo: 70,  hi: 220, sat: 0.22 },  // rough plaster → white smooth
    tile:     { lo: 55,  hi: 210, sat: 0.55 },  // dark mosaic → white ceramic
    asphalt:  { lo: 8,   hi: 58,  sat: 0.15 },  // very dark; strong desat
    fabric:   { lo: 50,  hi: 195, sat: 0.65 },  // dark denim → light canvas
    painted:  { lo: 45,  hi: 200, sat: 0.60 },  // typical architectural paint range
    organic:  { lo: 28,  hi: 155, sat: 0.52 },  // dark soil → bright foliage
    generic:  { lo: 50,  hi: 190, sat: 0.55 },
  };

  const key = params.mode === "auto"
    ? (ctx.region?.material?.materialClass ?? "generic")
    : params.mode;
  const range  = RANGES[key] ?? RANGES.generic;
  const tLo    = range.lo / 255;
  const tHi    = range.hi / 255;
  const tSat   = range.sat;
  const str    = params.strength / 100;

  const W = canvas.width, H = canvas.height, N = W * H;
  const sCtx   = canvas.getContext("2d");
  const iData  = sCtx.getImageData(0, 0, W, H);
  const d      = iData.data;

  // Pass 1: luminance percentiles + mean chroma
  const lums  = new Float32Array(N);
  let chromaSum = 0;
  for (let i = 0; i < N; i++) {
    const r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255;
    lums[i]    = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    chromaSum += Math.max(r, g, b) - Math.min(r, g, b);
  }
  const sorted     = lums.slice().sort();
  const p2         = sorted[Math.floor(N * 0.02)];
  const p98        = sorted[Math.floor(N * 0.98)];
  const srcSpan    = Math.max(p98 - p2, 0.001);
  const tgtSpan    = tHi - tLo;
  const meanChroma = chromaSum / N;
  // Only reduce saturation toward target — never boosts (avoids unnatural over-saturation)
  const satScale   = meanChroma > 0.001 ? Math.min(1, tSat / meanChroma) : 1;

  // Luminance remap: compress only if the source range is wider than the target range;
  // never stretch (that would artificially inflate contrast on already-normalized images).
  // After optional scale, shift the minimum amount needed to fit within [tLo, tHi].
  // If the image already sits within the target range, lumaScale=1 and offset=0 → no luma change.
  const lumaScale  = Math.min(1, tgtSpan / srcSpan);
  const scaledP2   = p2  * lumaScale;
  const scaledP98  = p98 * lumaScale;
  let   lumaOffset = 0;
  if      (scaledP2  < tLo) lumaOffset = tLo - scaledP2;   // lift floor
  else if (scaledP98 > tHi) lumaOffset = tHi - scaledP98;  // cap ceiling

  // Pass 2: apply remap
  const out  = document.createElement("canvas");
  out.width  = W; out.height = H;
  const oCtx = out.getContext("2d");
  const res  = oCtx.createImageData(W, H);
  const rd   = res.data;

  for (let i = 0; i < N; i++) {
    const io = i * 4;
    const ro = d[io] / 255, go = d[io + 1] / 255, bo = d[io + 2] / 255;
    const lum = lums[i];

    // Luma remap: linear scale + shift, clamped to [tLo, tHi].
    // new_channel = new_luma + (old_channel − old_luma) × satScale
    // This preserves hue angle and sidesteps near-black ratio explosions.
    const newLum = Math.max(tLo, Math.min(tHi, lum * lumaScale + lumaOffset));
    const rn = Math.max(0, Math.min(1, newLum + (ro - lum) * satScale));
    const gn = Math.max(0, Math.min(1, newLum + (go - lum) * satScale));
    const bn = Math.max(0, Math.min(1, newLum + (bo - lum) * satScale));

    // Blend original / processed by strength
    rd[io]     = Math.round((ro + (rn - ro) * str) * 255);
    rd[io + 1] = Math.round((go + (gn - go) * str) * 255);
    rd[io + 2] = Math.round((bo + (bn - bo) * str) * 255);
    rd[io + 3] = d[io + 3];
  }

  oCtx.putImageData(res, 0, 0);
  return out;
}
