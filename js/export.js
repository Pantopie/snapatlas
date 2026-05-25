// ── EXPORT HELPERS ────────────────────────────────────────────────────────
// Pure logic — no DOM reads, no `state` references.
// All functions are stateless transforms callable from app.js modal handlers.

// ── Canvas scaling ─────────────────────────────────────────────────────────
// Returns a new canvas at targetW × targetH.
/**
 * @param {HTMLCanvasElement} src
 * @param {number} targetW
 * @param {number} targetH
 * @param {"bilinear"|"nearest"} filter
 * @returns {HTMLCanvasElement}
 */
function exportScaleCanvas(src, targetW, targetH, filter) {
  if (targetW === src.width && targetH === src.height) return src;
  const out = document.createElement("canvas");
  out.width = targetW; out.height = targetH;
  const c = out.getContext("2d");
  c.imageSmoothingEnabled = filter !== "nearest";
  if (filter !== "nearest") c.imageSmoothingQuality = "high";
  c.drawImage(src, 0, 0, targetW, targetH);
  return out;
}

// ── Naming convention ─────────────────────────────────────────────────────
/**
 * @param {string} label
 * @param {"snake_case"|"camelCase"|"PascalCase"|"raw"} convention
 * @returns {string}
 */
function exportApplyNaming(label, convention) {
  if (convention === "raw") return label;
  const words = label.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return label;
  if (convention === "camelCase")
    return words.map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
  if (convention === "PascalCase")
    return words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
  // snake_case (default)
  return words.map(w => w.toLowerCase()).join("_");
}

// ── Filename slug ──────────────────────────────────────────────────────────
/** @param {Region[]} regions @returns {string} */
function exportSlug(regions) {
  const raw = regions[0]?.label ?? "atlas";
  return raw.replace(/[^a-z0-9_-]/gi, "_").replace(/_{2,}/g, "_").replace(/^_|_$/g, "") || "atlas";
}

// ── UV data builders ───────────────────────────────────────────────────────
/**
 * @param {"snapatlas"|"unity"|"ue5"|"godot4"|"blender_zenuv"} engine
 * @param {Region[]} regions
 * @param {Placement[]} placements
 * @param {number} atlasSize
 * @param {string} naming
 * @param {string} imageFilename
 * @returns {Object|null}
 */
function exportBuildUVData(engine, regions, placements, atlasSize, naming, imageFilename) {
  const S = atlasSize;

  if (engine === "snapatlas") {
    return {
      version: 1,
      sheet: { width: S, height: S },
      strips: regions.map((r, i) => {
        const p = placements[i];
        const name = exportApplyNaming(r.label, naming);
        return {
          label: name,
          uv: { x_min: p.x / S, x_max: (p.x + p.w) / S, y_min: p.y / S, y_max: (p.y + p.h) / S },
          pixel: { x: p.x, y: p.y, width: p.w, height: p.h },
          rotated: !!p.rotated,
        };
      }),
    };
  }

  // TexturePacker JSON — Unity, UE5 (hash), Godot 4 (array)
  if (engine === "unity" || engine === "ue5" || engine === "godot4") {
    const APP_LABEL = { unity: "SnapAtlas — Unity", ue5: "SnapAtlas — UE5", godot4: "SnapAtlas — Godot 4" };
    const buildEntry = (r, p) => {
      const name = exportApplyNaming(r.label, naming);
      const srcW = p.rotated ? p.h : p.w;
      const srcH = p.rotated ? p.w : p.h;
      return {
        name,
        entry: {
          frame: { x: p.x, y: p.y, w: p.w, h: p.h },
          rotated: !!p.rotated,
          trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: srcW, h: srcH },
          sourceSize: { w: srcW, h: srcH },
        },
      };
    };
    const meta = { app: APP_LABEL[engine], version: "1.0", image: imageFilename, format: "RGBA8888", size: { w: S, h: S }, scale: "1" };
    if (engine === "godot4") {
      const frames = regions.map((r, i) => {
        const { name, entry } = buildEntry(r, placements[i]);
        return { filename: name, ...entry };
      });
      return { frames, meta };
    }
    // unity / ue5 — hash keyed by name
    const frames = {};
    regions.forEach((r, i) => {
      const { name, entry } = buildEntry(r, placements[i]);
      frames[name] = entry;
    });
    return { frames, meta };
  }

  if (engine === "blender_zenuv") {
    // Blender UV space: Y=0 at bottom-left, Y=1 at top-left — flip from image space.
    const tiles = regions.map((r, i) => {
      const p = placements[i];
      const name = exportApplyNaming(r.label, naming);
      const uMin =  p.x         / S;
      const uMax = (p.x + p.w)  / S;
      const vMin = 1 - (p.y + p.h) / S;  // flip Y
      const vMax = 1 -  p.y         / S;
      return { name, uv: [uMin, vMin, uMax, vMax] };
    });
    return {
      name: exportSlug(regions),
      tiles,
    };
  }

  return null; // engine === "none"
}

// ── Stylize — colour quantisation + saturation ────────────────────────────
// Bayer matrices, row-major, pre-scaled to the [-0.5, +0.5] threshold range
const _BAYER_2 = [0, 2, 3, 1].map(v => v / 4  - 0.5);
const _BAYER_4 = [0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5].map(v => v / 16 - 0.5);

// Snap a channel value to the nearest level for N bits per channel.
/** @param {number} v @param {number} bits @returns {number} */
function _qsnapBits(v, bits) {
  const levels = (1 << bits) - 1; // = 2^bits - 1  (used as divisor for step)
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
  // Commodore 64 (Pepto's palette)
  c64: [
    [0,0,0],[255,255,255],[136,0,0],[170,255,238],
    [204,68,204],[0,204,85],[0,0,170],[238,238,119],
    [221,136,85],[102,68,0],[255,119,119],[51,51,51],
    [119,119,119],[170,255,102],[0,136,255],[187,187,187],
  ],
  // ZX Spectrum — 8 normal + 7 bright (black shared)
  zxspectrum: [
    [0,0,0],
    [0,0,215],[215,0,0],[215,0,215],[0,215,0],[0,215,215],[215,215,0],[215,215,215],
    [0,0,255],[255,0,0],[255,0,255],[0,255,0],[0,255,255],[255,255,0],[255,255,255],
  ],
  // MSX / TMS9918A (15 usable colours; entry 0 = transparent, treated as black)
  msx: [
    [0,0,0],[0,0,0],[33,200,66],[94,220,120],
    [84,85,237],[125,118,252],[212,82,77],[66,235,245],
    [252,85,84],[255,121,120],[212,193,84],[230,206,128],
    [33,176,59],[201,91,186],[204,204,204],[255,255,255],
  ],
  // Amstrad CPC — 27-colour hardware palette
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
  // EGA — full 64-colour DAC (4 levels × 3 channels)
  ega: (() => {
    const L = [0, 85, 170, 255];
    return Array.from({length: 64}, (_, i) => [L[(i >> 4) & 3], L[(i >> 2) & 3], L[i & 3]]);
  })(),
  // NES PPU master palette (64 entries; near-black duplicates are correct)
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
  // Sweetie 16 by Grafxkid
  sweetie16: [
    [26,28,44],[93,39,93],[177,62,83],[239,125,87],
    [255,205,117],[167,240,112],[56,183,100],[37,113,121],
    [41,54,111],[59,93,201],[65,166,246],[115,239,247],
    [244,244,244],[148,176,194],[86,108,134],[51,60,87],
  ],
  // Dawnbringer 16 by Dawnbringer
  dawnbringer16: [
    [20,12,28],[68,36,52],[48,52,109],[78,74,78],
    [133,76,48],[52,101,36],[208,70,72],[117,113,97],
    [89,125,206],[210,125,44],[133,149,161],[109,170,44],
    [210,170,153],[109,194,202],[218,212,94],[222,238,214],
  ],
  // Dawnbringer 32 by Dawnbringer
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
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number[][]} pal
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
//   fixedPalette: "none" | "gameboy" | "gbpocket" | "pico8" | "cga" | "nes"
//                 When set, overrides bitDepth quantisation.
// Order: saturation → quantise+dither.
// Returns src unchanged when all effects are neutral.
/**
 * @param {HTMLCanvasElement} src
 * @param {{ bitDepth?: number, dither?: string, saturation?: number, fixedPalette?: string }} s
 * @returns {HTMLCanvasElement}
 */
function exportApplyStylize(src, s) {
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

  // ── 1. Saturation ─────────────────────────────────────────────────────────
  if (doSat) {
    const f = saturation / 100;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      d[i]   = Math.min(255, Math.max(0, Math.round(gray + (d[i]   - gray) * f)));
      d[i+1] = Math.min(255, Math.max(0, Math.round(gray + (d[i+1] - gray) * f)));
      d[i+2] = Math.min(255, Math.max(0, Math.round(gray + (d[i+2] - gray) * f)));
    }
  }

  // ── 2. Colour quantisation + dithering ────────────────────────────────────
  if (doQuant) {
    if (pal) {
      // Fixed palette — nearest-colour matching
      // Dither spread: empirically ~48 works well for 4–64 colour palettes
      const spread = 48;
      if (dither === "bayer2" || dither === "bayer4") {
        const mat = dither === "bayer4" ? _BAYER_4 : _BAYER_2;
        const N   = dither === "bayer4" ? 4 : 2;
        for (let y = 0; y < H; y++) {
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
        for (let i = 0; i < d.length; i += 4) {
          const [qr, qg, qb] = _nearestPalColor(d[i], d[i+1], d[i+2], pal);
          d[i] = qr; d[i+1] = qg; d[i+2] = qb;
        }
      }
    } else {
      // Per-channel bit-depth quantisation
      const step = 255 / ((1 << bitDepth) - 1);
      if (dither === "bayer2" || dither === "bayer4") {
        const mat = dither === "bayer4" ? _BAYER_4 : _BAYER_2;
        const N   = dither === "bayer4" ? 4 : 2;
        for (let y = 0; y < H; y++) {
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
        for (let i = 0; i < d.length; i += 4) {
          d[i]   = _qsnapBits(d[i],   bitDepth);
          d[i+1] = _qsnapBits(d[i+1], bitDepth);
          d[i+2] = _qsnapBits(d[i+2], bitDepth);
        }
      }
    }
  }

  ctx.putImageData(id, 0, 0);
  return out;
}

// ── ZenUV SVG export ──────────────────────────────────────────────────────
// Builds a standalone SVG document embedding the atlas image and UV rects
// in the ZenUV trimsheet format.
// https://zenmastersteam.github.io/Zen-UV/latest/trimsheet/
/** @returns {string} */
function _uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/** @param {string} s @returns {string} */
function _escXmlAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** @param {string} s @returns {string} */
function _escXmlText(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * @param {Region[]} regions
 * @param {Placement[]} placements
 * @param {number} atlasSize
 * @param {string} naming
 * @param {HTMLCanvasElement|null} atlasCanvas
 * @returns {string}
 */
function exportBuildZenUVSVG(regions, placements, atlasSize, naming, atlasCanvas) {
  const S = atlasSize;
  if (!atlasCanvas) return "";
  const dataUrl = atlasCanvas.toDataURL("image/png");

  const n = regions.length;
  const hueStep = n > 0 ? 360 / n : 0;
  function trimColor(i) {
    const h = n > 1 ? (i * hueStep + 10) % 360 : 200;
    return { stroke: `hsl(${h.toFixed(0)}, 55%, 45%)` };
  }

  function pct(v) {
    return (v / S) * 100;
  }

  let xml = `<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"
  "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns:trim="https://zenmastersteam.github.io/Zen-UV/latest/"
     xmlns="http://www.w3.org/2000/svg" version="1.1">
<desc>SnapAtlas</desc>
  <image x="0" y="0"
    width="${S}"
    height="${S}"
    id="atlas"
    xlink:href="${dataUrl}"
  />
`;

  for (let i = 0; i < n; i++) {
    const r = regions[i];
    const p = placements[i];
    const name = exportApplyNaming(r.label, naming);
    const col = trimColor(i);
    const idAttr = _escXmlAttr(name);
    const idText = _escXmlText(name);

    const rx = pct(p.x);
    const ry = pct(p.y);
    const rw = pct(p.w);
    const rh = pct(p.h);
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    const fontSize = Math.max(4, Math.min(12, rw * 0.14));

    const json = JSON.stringify({
      inset: 0.0,
      keep_proportion: true,
      align_to: "cen",
      fit_axis: "AUTO",
      normal: [0.0, 0.0, 0.0],
      world_position: [0.0, 0.0, 0.0],
      world_size: [0.0, 0.0],
      world_size_units: "m",
      text_align: "cen",
      text_offset: [0.0, 0.0],
      text_offset_mode: "POINT",
      uuid: _uuid(),
      match_rotation: false,
      tags: [],
      tag_index: -1,
      hide: false,
    }, null, 4);

    // Strip trailing newline so </trim:trim> sits on the same line as `}`
    const jsonBody = _escXmlText(json).replace(/\n\s*$/, "");

    xml += `<g id="Group: ${idAttr}"> <rect
  stroke="${col.stroke}" stroke-width="1.0" stroke-opacity="1"
  fill="${col.stroke}" fill-opacity="0.09"
  id="Rect: ${idAttr}"
  x="${rx}%"
  y="${ry}%"
  width="${rw}%"
  height="${rh}%"
 />
    <trim:trim>${jsonBody}    </trim:trim>  <text id="Text: ${idAttr}" font-size="${fontSize}" fill="${col.stroke}" x="${cx}%" y="${cy}%" dominant-baseline="middle" text-anchor="middle">${idText}</text>
</g>
`;
  }

  xml += `\n</svg>\n`;
  return xml;
}

// ── CRC-32 table (module-level, built once) ────────────────────────────────
const _ZIP_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

// ── Minimal store-only ZIP builder ─────────────────────────────────────────
// files: [{ name: string, data: Uint8Array }]
// Returns a Blob of type "application/zip".
// Uses STORE method (no compression) — images are already compressed.
/**
 * @param {{ name: string, data: Uint8Array }[]} files
 * @returns {Blob}
 */
function exportBuildZip(files) {
  function crc32(data) {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = _ZIP_CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(n) { return [n & 0xff, (n >> 8) & 0xff]; }
  function u32(n) { return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]; }

  const enc = new TextEncoder();
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;

    // Local file header (30 bytes + name + data)
    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,  // signature
      ...u16(20),              // version needed: 2.0
      ...u16(0),               // flags
      ...u16(0),               // method: STORE
      ...u16(0), ...u16(0),    // mod time, mod date
      ...u32(crc),
      ...u32(size),            // compressed size
      ...u32(size),            // uncompressed size
      ...u16(nameBytes.length),
      ...u16(0),               // extra field length
      ...nameBytes,
    ]);
    localHeaders.push({ local, data: file.data, crc, size, nameBytes, offset });
    offset += local.length + size;
  }

  for (const f of localHeaders) {
    // Central directory entry (46 bytes + name)
    const central = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02,  // signature
      ...u16(20),              // version made by
      ...u16(20),              // version needed
      ...u16(0),               // flags
      ...u16(0),               // method: STORE
      ...u16(0), ...u16(0),    // mod time, mod date
      ...u32(f.crc),
      ...u32(f.size),
      ...u32(f.size),
      ...u16(f.nameBytes.length),
      ...u16(0),               // extra field length
      ...u16(0),               // comment length
      ...u16(0),               // disk start
      ...u16(0),               // internal attributes
      ...u32(0),               // external attributes
      ...u32(f.offset),        // local header offset
      ...f.nameBytes,
    ]);
    centralHeaders.push(central);
  }

  const cdSize   = centralHeaders.reduce((s, c) => s + c.length, 0);
  const cdOffset = offset;

  const eocd = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,  // end of central directory signature
    ...u16(0), ...u16(0),    // disk numbers
    ...u16(files.length),
    ...u16(files.length),
    ...u32(cdSize),
    ...u32(cdOffset),
    ...u16(0),               // comment length
  ]);

  const parts = [];
  for (const f of localHeaders) { parts.push(f.local); parts.push(f.data); }
  for (const c of centralHeaders) parts.push(c);
  parts.push(eocd);

  return new Blob(parts, { type: "application/zip" });
}
