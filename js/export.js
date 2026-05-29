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
