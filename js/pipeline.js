// ── TYPES ───────────────────────────────────────────────────────────────────

/**
 * @typedef {'geometry'|'lighting'|'color'|'tiling'} BlockCategory
 */

/**
 * @typedef {Object} ParamUIEntry
 * @property {string}  key
 * @property {string}  [group]
 * @property {'range'|'toggle'|'select'|'textarea'} type
 * @property {string}  [label]
 * @property {number}  [min]
 * @property {number}  [max]
 * @property {number}  [step]
 * @property {string}  [suffix]
 * @property {string}  [placeholder]
 * @property {Array<{value:string,label:string}>} [options]
 * @property {Object}  [showIf]
 */

/**
 * @typedef {Object} BlockDef
 * @property {string}        label
 * @property {string}        icon
 * @property {string}        [desc]
 * @property {BlockCategory} category
 * @property {boolean}       isAsync
 * @property {boolean}       hasConfigure
 * @property {boolean}       [hidden]
 * @property {Object}        defaultParams
 * @property {ParamUIEntry[]} paramsUI
 */

/**
 * @typedef {Object} PipelineCtx
 * @property {Region}                  region
 * @property {typeof state}            state
 * @property {Block|null}              block    - Set per iteration by runPipelineUpTo
 * @property {GoogleGenAI|null}        ai
 * @property {AbortSignal|null}        signal
 */

/**
 * @callback BlockRunner
 * @param {HTMLCanvasElement} input
 * @param {Object}            params
 * @param {PipelineCtx}       ctx
 * @returns {Promise<HTMLCanvasElement|null>|HTMLCanvasElement|null}
 */

// ── BLOCK DEFINITIONS ─────────────────────────────────────────────────────
/** @type {Object<string, BlockDef>} */
const BLOCK_DEFS = {
  perspective: {
    label: "Perspective Fix",
    icon: "ruler",
    desc: "Correct perspective distortion",
    category: "geometry",
    isAsync: false,
    hasConfigure: true,
    defaultParams: { manualCorners: null, autoDetect: false },
    paramsUI: [],
  },
  transform: {
    label: "Transform",
    icon: "move",
    desc: "Offset, scale, rotate, or flip the texture",
    category: "geometry",
    isAsync: false,
    hasConfigure: false,
    defaultParams: { offsetX: 0, offsetY: 0, scaleX: 100, scaleY: 100, scaleLock: true, rotation: 0, flipH: false, wrapMode: "wrap" },
    paramsUI: [
      { key: "offsetX",  group: "offset",  type: "range",  label: "X",   min: -100,  max: 100,  step: 1,  suffix: "%" },
      { key: "offsetY",  group: "offset",  type: "range",  label: "Y",   min: -100,  max: 100,  step: 1,  suffix: "%" },
      { key: "scaleX",   group: "scale",   type: "range",  label: "X",   min: 1,     max: 500,  step: 1,  suffix: "%" },
      { key: "scaleY",   group: "scale",   type: "range",  label: "Y",   min: 1,     max: 500,  step: 1,  suffix: "%" },
      { key: "scaleLock", group: "scale",  type: "toggle", label: "Lock ratio" },
      { key: "rotation", group: "rotate",  type: "range",  label: "Angle", min: -180,  max: 180,  step: 1,  suffix: "°" },
      { key: "flipH",    group: "rotate",  type: "toggle", label: "Mirror" },
      { key: "wrapMode", type: "select", label: "Edges", options: [
        { value: "wrap",        label: "Wrap" },
        { value: "clamp",       label: "Extend" },
        { value: "transparent", label: "Transparent" },
      ]},
    ],
  },
  retinex: {
    label: "Even Lighting",
    icon: "sun",
    desc: "Remove uneven lighting",
    category: "lighting",
    isAsync: false,
    hasConfigure: false,
    defaultParams: { strength: 80 },
    paramsUI: [
      { key: "strength", type: "range", label: "Intensity", min: 0, max: 100, step: 1, suffix: "%" },
    ],
  },
  highpass: {
    label: "Flatten Shading",
    icon: "diamond",
    desc: "Flatten surface shading",
    category: "lighting",
    isAsync: false,
    hasConfigure: false,
    defaultParams: { radius: 20, strength: 100, softness: 60, lumaOnly: true, previewDiffuse: false },
    paramsUI: [
      { key: "radius",        type: "range",  label: "Blur Area", min: 0, max: 120, step: 1,  suffix: "px" },
      { key: "softness",      type: "range",  label: "Softness",  min: 0, max: 100, step: 5,  suffix: "%" },
      { key: "strength",      type: "range",  label: "Opacity",   min: 0, max: 100, step: 5,  suffix: "%" },
      { key: "lumaOnly",      type: "toggle", label: "Preserve colors" },
      { key: "previewDiffuse", type: "toggle", label: "Preview diffuse" },
    ],
  },
  levels: {
    label: "Tone Levels",
    icon: "sliders-horizontal",
    desc: "Adjust shadows, highlights, gamma",
    category: "color",
    isAsync: false,
    hasConfigure: false,
    defaultParams: { inLo: 0, inHi: 255, gamma: 1.0 },
    paramsUI: [
      { key: "inLo",  type: "range", label: "Shadows",    min: 0,   max: 254, step: 1,    suffix: "" },
      { key: "inHi",  type: "range", label: "Highlights", min: 1,   max: 255, step: 1,    suffix: "" },
      { key: "gamma", type: "range", label: "Midtones",   min: 0.1, max: 3.0, step: 0.05, suffix: "" },
    ],
  },
  curves: {
    label: "Curves",
    icon: "chart-spline",
    desc: "Fine-tune color curves",
    category: "color",
    isAsync: false,
    hasConfigure: false,
    defaultParams: { rgb: [[0,0],[255,255]], r: null, g: null, b: null },
    paramsUI: [],
  },
  albedo_compress: {
    label: "Albedo Compress",
    icon: "circle-dot",
    desc: "Compress color variation",
    category: "color",
    isAsync: false,
    hasConfigure: false,
    defaultParams: { mode: "auto", strength: 100 },
    paramsUI: [
      { key: "mode", type: "select", label: "Material", options: [
        { value: "auto",     label: "Auto (from tag)"  },
        { value: "masonry",  label: "Masonry / Brick"  },
        { value: "wood",     label: "Wood / Bark"      },
        { value: "metal",    label: "Metal"            },
        { value: "concrete", label: "Concrete"         },
        { value: "plaster",  label: "Plaster"          },
        { value: "tile",     label: "Tile / Ceramic"   },
        { value: "asphalt",  label: "Asphalt / Road"   },
        { value: "fabric",   label: "Fabric / Cloth"   },
        { value: "painted",  label: "Painted"          },
        { value: "organic",  label: "Organic / Leaves" },
        { value: "generic",  label: "Generic"          },
      ]},
      { key: "strength", type: "range", label: "Strength", min: 0, max: 100, step: 1, suffix: "%" },
    ],
  },
  hsl: {
    label: "Hue / Saturation",
    icon: "palette",
    desc: "Shift hue, saturation, lightness",
    category: "color",
    isAsync: false,
    hasConfigure: false,
    defaultParams: { hue: 0, saturation: 0, lightness: 0 },
    paramsUI: [
      { key: "hue",        type: "range", label: "Hue",        min: -180, max: 180, step: 1,   suffix: "°" },
      { key: "saturation", type: "range", label: "Saturation", min: -100, max: 100, step: 1,   suffix: "%" },
      { key: "lightness",  type: "range", label: "Lightness",  min: -100, max: 100, step: 1,   suffix: "%" },
    ],
  },
  ai_normalize: {
    label: "AI Clean Up",
    icon: "sparkles",
    desc: "Clean up lighting with AI",
    category: "lighting",
    isAsync: true,
    hasConfigure: false,
    defaultParams: { strength: "balanced", userHint: "" },
    paramsUI: [
      { key: "strength", type: "select", label: "Intensity", options: [
        { value: "minimal",    label: "Minimal"    },
        { value: "balanced",   label: "Balanced"   },
        { value: "aggressive", label: "Aggressive" },
      ]},
      { key: "userHint", type: "textarea", label: "Extra instructions",
        placeholder: "e.g. keep the graffiti intact, remove the window reflection…" },
    ],
  },
  ai_seamless: {
    label: "AI Make Tileable",
    icon: "grid-3x3",
    hidden: true,
    category: "tiling",
    isAsync: true,
    hasConfigure: false,
    defaultParams: { axes: "xy" },
    paramsUI: [
      { key: "axes", group: "dir", type: "select", label: "Direction", options: [
        { value: "x",  label: "↔ Horizontal only" },
        { value: "y",  label: "↕ Vertical only"   },
        { value: "xy", label: "⊞ Both axes"        },
      ]},
    ],
  },
  seamless_offset: {
    label: "Make Tileable",
    icon: "grid-3x3",
    desc: "Blend edges to create seamless tiles",
    category: "tiling",
    isAsync: false,
    hasConfigure: false,
    defaultParams: {
      axes: "xy", shiftX: 0, shiftY: 0,
      widthX: 16, widthY: 16,
      blendX: 6, blendY: 6,
      sharpenX: 10, sharpenY: 10,
      noiseIntX: 50, noiseIntY: 50,
      noiseScaleX: 5, noiseScaleY: 5,
      debugTile: false,
    },
    paramsUI: [
      { key: "axes", group: "dir", type: "select", label: "Direction", options: [
        { value: "x",  label: "↔ Horizontal only" },
        { value: "y",  label: "↕ Vertical only"   },
        { value: "xy", label: "⊞ Both axes"        },
      ]},
      { key: "shiftX", group: "shift",      type: "range", label: "H Offset",     min: -500, max: 500, step: 1,  suffix: "px", showIf: { axes: ["x", "xy"] } },
      { key: "widthX", group: "band",      type: "range", label: "H Width",      min: 0,    max: 200, step: 1,  suffix: "px", showIf: { axes: ["x", "xy"] } },
      { key: "blendX", group: "band",      type: "range", label: "H Blend",      min: 0,    max: 200, step: 1,  suffix: "px", showIf: { axes: ["x", "xy"] } },
      { key: "sharpenX", group: "sharpen",    type: "range", label: "H Sharpen",    min: 0,    max: 100, step: 5,  suffix: "%",  showIf: { axes: ["x", "xy"] } },
      { key: "noiseIntX", group: "noise",   type: "range", label: "H Noise",      min: 0,    max: 100, step: 5,  suffix: "%",  showIf: { axes: ["x", "xy"] } },
      { key: "noiseScaleX", group: "noise", type: "range", label: "H Noise Scale", min: 1,    max: 20,  step: 1,  suffix: "",   showIf: { axes: ["x", "xy"] } },
      { key: "shiftY", group: "shift",      type: "range", label: "V Offset",     min: -500, max: 500, step: 1,  suffix: "px", showIf: { axes: ["y", "xy"] } },
      { key: "widthY", group: "band",      type: "range", label: "V Width",      min: 0,    max: 200, step: 1,  suffix: "px", showIf: { axes: ["y", "xy"] } },
      { key: "blendY", group: "band",      type: "range", label: "V Blend",      min: 0,    max: 200, step: 1,  suffix: "px", showIf: { axes: ["y", "xy"] } },
      { key: "sharpenY", group: "sharpen",    type: "range", label: "V Sharpen",    min: 0,    max: 100, step: 5,  suffix: "%",  showIf: { axes: ["y", "xy"] } },
      { key: "noiseIntY", group: "noise",   type: "range", label: "V Noise",      min: 0,    max: 100, step: 5,  suffix: "%",  showIf: { axes: ["y", "xy"] } },
      { key: "noiseScaleY", group: "noise", type: "range", label: "V Noise Scale", min: 1,    max: 20,  step: 1,  suffix: "",   showIf: { axes: ["y", "xy"] } },
      { key: "debugTile", group: "debug", type: "toggle", label: "Show debug tile" },
    ],
  },
  mirror_tile: {
    label: "Mirror Tile",
    icon: "flip-horizontal",
    desc: "Mirror edges for seamless tiling",
    category: "tiling",
    isAsync: false,
    hasConfigure: false,
    defaultParams: {
      axes: "xy", shiftX: 0, shiftY: 0,
      widthX: 16, widthY: 16,
      blendX: 6, blendY: 6,
      sharpenX: 10, sharpenY: 10,
      noiseIntX: 50, noiseIntY: 50,
      noiseScaleX: 5, noiseScaleY: 5,
      debugTile: false,
    },
    paramsUI: [
      { key: "axes", group: "dir", type: "select", label: "Direction", options: [
        { value: "x",  label: "↔ Horizontal only" },
        { value: "y",  label: "↕ Vertical only"   },
        { value: "xy", label: "⊞ Both axes"        },
      ]},
      { key: "shiftX", group: "shift",      type: "range", label: "H Center",     min: -500, max: 500, step: 1,  suffix: "px", showIf: { axes: ["x", "xy"] } },
      { key: "widthX", group: "band",      type: "range", label: "H Width",      min: 0,    max: 200, step: 1,  suffix: "px", showIf: { axes: ["x", "xy"] } },
      { key: "blendX", group: "band",      type: "range", label: "H Blend",      min: 0,    max: 200, step: 1,  suffix: "px", showIf: { axes: ["x", "xy"] } },
      { key: "sharpenX", group: "sharpen",    type: "range", label: "H Sharpen",    min: 0,    max: 100, step: 5,  suffix: "%",  showIf: { axes: ["x", "xy"] } },
      { key: "noiseIntX", group: "noise",   type: "range", label: "H Noise",      min: 0,    max: 100, step: 5,  suffix: "%",  showIf: { axes: ["x", "xy"] } },
      { key: "noiseScaleX", group: "noise", type: "range", label: "H Noise Scale", min: 1,    max: 20,  step: 1,  suffix: "",   showIf: { axes: ["x", "xy"] } },
      { key: "shiftY", group: "shift",      type: "range", label: "V Center",     min: -500, max: 500, step: 1,  suffix: "px", showIf: { axes: ["y", "xy"] } },
      { key: "widthY", group: "band",      type: "range", label: "V Width",      min: 0,    max: 200, step: 1,  suffix: "px", showIf: { axes: ["y", "xy"] } },
      { key: "blendY", group: "band",      type: "range", label: "V Blend",      min: 0,    max: 200, step: 1,  suffix: "px", showIf: { axes: ["y", "xy"] } },
      { key: "sharpenY", group: "sharpen",    type: "range", label: "V Sharpen",    min: 0,    max: 100, step: 5,  suffix: "%",  showIf: { axes: ["y", "xy"] } },
      { key: "noiseIntY", group: "noise",   type: "range", label: "V Noise",      min: 0,    max: 100, step: 5,  suffix: "%",  showIf: { axes: ["y", "xy"] } },
      { key: "noiseScaleY", group: "noise", type: "range", label: "V Noise Scale", min: 1,    max: 20,  step: 1,  suffix: "",   showIf: { axes: ["y", "xy"] } },
      { key: "debugTile", group: "debug", type: "toggle", label: "Show debug tile" },
    ],
  },
};

/** @type {Array<{ key: BlockCategory, label: string }>} */
const BLOCK_CATEGORIES = [
  { key: "geometry", label: "Geometry" },
  { key: "lighting", label: "Lighting" },
  { key: "color",    label: "Color"    },
  { key: "tiling",   label: "Tiling"   },
];

// ── FACTORY ───────────────────────────────────────────────────────────────
/** @returns {Block[]} */
function defaultPipeline() {
  return [
    makeBlock("perspective",       { manualCorners: null, autoDetect: false }, false),
    makeBlock("retinex",           { strength: 80 }),
    makeBlock("highpass",          {}),
    makeBlock("ai_normalize",      {}),
    makeBlock("albedo_compress",   {}),
  ];
}

/**
 * @param {string} type
 * @param {Object} [paramsOverride]
 * @param {boolean} [enabled]
 * @returns {Block}
 */
function makeBlock(type, paramsOverride = {}, enabled = true) {
  const def = BLOCK_DEFS[type];
  if (!def) throw new Error(`Unknown block type: ${type}`);
  return {
    type,
    enabled,
    params: { ...def.defaultParams, ...paramsOverride },
    _cache:    null,
    _dirty:    true,
    _running:  false,
    _everRun:  false,
  };
}

// ── CACHE INVALIDATION ────────────────────────────────────────────────────
// Async blocks keep their _cache on invalidation — expensive AI results are
// preserved and shown as stale (yellow dot) until the user re-runs them.
// CPU blocks are cheap to recompute so their cache is cleared normally.
/**
 * @param {Region} region
 * @param {number} idx
 */
function invalidateCacheFrom(region, idx) {
  for (let i = idx; i < region.pipeline.length; i++) {
    const b = region.pipeline[i];
    if (!BLOCK_DEFS[b.type]?.isAsync) b._cache = null;
    b._dirty = true;
  }
  if (idx === 0) region._variantInputDirty = true;
}

// ── EXECUTION ENGINE ──────────────────────────────────────────────────────
// Variant pipeline model:
//   Parent  → raw_crop → [block0 → block1 → …] → parent.extracted
//   Variant → parent.extracted → [optional crop via outputW/H + cropX/Y]
//             → [variant block0 → …] → variant.extracted
//
// _variantInputCanvas() supplies the cropped parent.extracted as the variant's
// starting canvas. If the variant has no blocks (pipeline: []) it gets the full
// parent output unchanged. Cascade from runRegion → autoRunCPU propagates the
// parent's new output to all variants automatically for CPU-only variant pipelines.
//
// Runs blocks [startIdx … targetIdx], reusing deepest valid cache before targetIdx.
// ctx.block is mutated per iteration so runners can write _debug without a find().
// Async blocks only execute when ctx.ai is set (explicit user-triggered run).
// Without ctx.ai they act as passthroughs: use their last cache if available, else skip.

/**
 * Run pipeline blocks from start to target index.
 * @param {Region} region
 * @param {number} targetIdx
 * @param {PipelineCtx} ctx
 * @returns {Promise<HTMLCanvasElement|null>}
 */
async function runPipelineUpTo(region, targetIdx, ctx) {
  let canvas = region.parentId ? _variantInputCanvas(region) : _rawCropCanvas(region);
  if (!canvas) return null; // variant whose parent hasn't been run yet
  let startIdx = 0;

  for (let i = 0; i < targetIdx; i++) {
    const b = region.pipeline[i];
    if (b.enabled && b._cache && !b._dirty) { canvas = b._cache; startIdx = i + 1; }
  }

  for (let i = startIdx; i <= targetIdx; i++) {
    if (ctx.signal?.aborted) return null;
    const b = region.pipeline[i];
    if (!b.enabled) continue;

    // Async block without an AI context: use cached output as passthrough, never execute.
    if (BLOCK_DEFS[b.type]?.isAsync && !ctx.ai) {
      if (b._cache) canvas = b._cache;
      continue;
    }

    const runner = BLOCK_RUNNERS[b.type];
    if (!runner) continue;

    ctx.block  = b;
    b._running = true;
    // Only rebuild inspector for async blocks — CPU blocks complete too fast to need it
    if (BLOCK_DEFS[b.type]?.isAsync) renderInspector();
    try {
      canvas = await runner(canvas, b.params, ctx);
      b._cache   = canvas;
      b._dirty   = false;
      b._everRun = true;
      if (BLOCK_DEFS[b.type]?.isAsync && canvas) {
        _idbPut(`block_${region.id}_${i}`, canvas.toDataURL("image/png")).catch((e) => console.warn("[IDB] cache write failed", e));
        analytics.track("ai_run", { block: b.type });
      }
    } catch (e) {
      if (ctx.signal?.aborted) return null;
      console.warn(`[Pipeline] block "${b.type}" failed, skipping:`, e);
      showToast(`"${BLOCK_DEFS[b.type]?.label || b.type}" failed — skipped`, "error");
    }
    b._running = false;
  }
  return canvas;
}

/**
 * Run the full pipeline for a region.
 * @param {Region} region
 * @param {PipelineCtx} ctx
 * @returns {Promise<HTMLCanvasElement|null>}
 */
async function runPipeline(region, ctx) {
  return runPipelineUpTo(region, region.pipeline.length - 1, ctx);
}

// ── PUBLIC ENTRY POINTS ───────────────────────────────────────────────────
/**
 * @param {Region} region
 * @param {boolean} [withAI]
 * @returns {PipelineCtx}
 */
function _makeCtx(region, withAI = true) {
  return {
    region,
    state,
    block: null, // mutated per block inside runPipelineUpTo
    ai: (withAI && state.apiKey) ? new GoogleGenAI({ apiKey: state.apiKey }) : null,
    signal: region._runController?.signal ?? null,
  };
}

/**
 * Run the full pipeline for one region, cancelling any in-flight run.
 * @param {Region} region
 * @returns {Promise<void>}
 */
async function runRegion(region) {
  const needsAI = region.pipeline.some(b => b.enabled && BLOCK_DEFS[b.type]?.isAsync);
  if (needsAI && !state.apiKey) { showApiKeyModal(() => runRegion(region)); return; }
  if (region.parentId) {
    const par = getParentRegion(region);
    if (!par?.extracted) {
      showToast(`Run "${par?.label ?? "parent"}" first`, "error");
      return;
    }
  }
  region._runController?.abort();
  const controller = new AbortController();
  region._runController = controller;
  renderInspector();
  _startAnimLoop();

  try {
    const result = await runPipeline(region, _makeCtx(region));
    if (result && region._runController === controller) {
      region.extracted = result;
      // Cascade: parent finished → variants inherit the new output automatically.
      // invalidateCacheFrom marks _variantInputDirty so _variantInputCanvas
      // re-crops from the fresh parent.extracted on the next call.
      // autoRunCPU then immediately sets v.extracted (empty-pipeline variants)
      // or re-runs any CPU blocks the variant added on top.
      getVariants(region).forEach(v => { invalidateCacheFrom(v, 0); autoRunCPU(v, 0); });
      rebuildAtlas();
      saveProject();
      renderPreview();
      const blocks = region.pipeline.filter(b => b.enabled && b._everRun).map(b => b.type);
      if (blocks.length) analytics.track("pipeline_run", { blocks: blocks.join(",") });
    }
  } catch (e) {
    if (region._runController === controller) {
      console.error("[Pipeline] runRegion:", e);
      showToast("Pipeline failed — " + (e.message ?? e), "error");
    }
  }

  if (region._runController === controller) region._runController = null;
  renderInspector();
}

/**
 * Invalidate from blockIdx, then re-run the full pipeline.
 * @param {Region} region
 * @param {number} blockIdx
 * @returns {Promise<void>}
 */
async function runFromBlock(region, blockIdx) {
  invalidateCacheFrom(region, blockIdx);
  await runRegion(region);
}

/**
 * Auto-run CPU-only blocks starting at fromIdx.
 * Async blocks are skipped as passthroughs (use their cache or skip) — never executed.
 * Does NOT touch _runController — CPU blocks complete synchronously, no abort needed.
 * Aborts any in-flight async run because its input has changed.
 * @param {Region} region
 * @param {number} fromIdx
 * @returns {Promise<void>}
 */
async function autoRunCPU(region, fromIdx) {
  let lastCPU = -1;
  for (let i = fromIdx; i < region.pipeline.length; i++) {
    const b = region.pipeline[i];
    if (!b.enabled) continue;
    if (BLOCK_DEFS[b.type]?.isAsync) continue; // skip async, keep scanning for CPU blocks after
    if (b._dirty) lastCPU = i;
  }

  if (lastCPU < 0) {
    if (region.parentId) {
      // Variant with no CPU blocks: set extracted from parent crop.
      const vc = _variantInputCanvas(region);
      if (vc) { region.extracted = vc; rebuildAtlas(); }
    } else {
      // Parent with no dirty CPU blocks: still cascade in case variants need refresh.
      getVariants(region).forEach(v => { invalidateCacheFrom(v, 0); autoRunCPU(v, 0); });
    }
    renderPreview();
    return;
  }

  // CPU input changed — abort any in-flight async run (its input is now stale)
  region._runController?.abort();
  region._runController = null;

  try {
    const ctx = { region, state, block: null, ai: null, signal: null };
    const result = await runPipelineUpTo(region, lastCPU, ctx);
    if (!result) return;

    region.extracted = result;
    rebuildAtlas();
    // Cascade: CPU change on parent → variants inherit fresh parent output.
    getVariants(region).forEach(v => { invalidateCacheFrom(v, 0); autoRunCPU(v, 0); });
  } catch (e) { console.warn("[Pipeline] autoRunCPU failed:", e); }

  renderPreview();
}

/**
 * Run all selected regions sequentially.
 * @returns {Promise<void>}
 */
async function runAllRegions() {
  const needsAI = state.regions.some(r => r.selected && r.pipeline.some(b => b.enabled && BLOCK_DEFS[b.type]?.isAsync));
  if (needsAI && !state.apiKey) { showApiKeyModal(() => runAllRegions()); return; }
  const toRun = state.regions.filter(r => r.selected);
  if (!toRun.length) return;
  setStatus("running", `Processing ${toRun.length} region${toRun.length > 1 ? "s" : ""}…`);
  setProgress(5);
  for (let i = 0; i < toRun.length; i++) {
    await runRegion(toRun[i]);
    setProgress(5 + ((i + 1) / toRun.length) * 90);
  }
  setProgress(100);
  setStatus("ok", `${toRun.length} texture${toRun.length > 1 ? "s" : ""} ready`);
  showToast(`${toRun.length} texture${toRun.length > 1 ? "s" : ""} ready`);
}

// ── BLOCK RUNNERS REGISTRY ────────────────────────────────────────────────
// Runner functions are defined in their respective files (math.js, seamless.js, ai.js)
// and are referenced here by name. All files load before pipeline.js (see index.html).
/** @type {Object<string, BlockRunner>} */
const BLOCK_RUNNERS = {
  perspective:     perspectiveRunner,
  transform:       transformRunner,
  retinex:         retinexRunner,
  highpass:        highpassRunner,
  levels:          levelsRunner,
  curves:          curvesRunner,
  albedo_compress: albedoCompressRunner,
  hsl:             hslRunner,
  ai_normalize:    aiNormalizeRunner,
  ai_seamless:     aiSeamlessRunner,
  seamless_offset: seamlessOffsetRunner,
  mirror_tile:     mirrorTileRunner,
};
