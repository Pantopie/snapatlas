// ── ATLAS PIPELINE ─────────────────────────────────────────────────────────
// Global post-processing pipeline that runs after all per-region pipelines,
// on the composited atlas as a whole. CPU-only blocks only.

/**
 * Block types allowed in the global atlas pipeline (CPU-only).
 * @type {Set<string>}
 */
const ATLAS_BLOCK_TYPES = new Set(["levels", "curves", "hsl", "highpass", "stylize"]);

/**
 * Invalidate atlas pipeline block caches from a given index.
 * @param {{ pipeline: Block[] }} atlas
 * @param {number} fromIdx
 */
function invalidateAtlasFrom(atlas, fromIdx) {
  for (let i = fromIdx; i < atlas.pipeline.length; i++) {
    atlas.pipeline[i]._cache = null;
    atlas.pipeline[i]._dirty = true;
  }
}

/**
 * Run the global atlas pipeline on a source canvas, caching each block output.
 * @param {{ pipeline: Block[] }} atlas
 * @param {HTMLCanvasElement|null} srcCanvas
 * @returns {Promise<HTMLCanvasElement|null>}
 */
async function runAtlasPipeline(atlas, srcCanvas) {
  if (!srcCanvas) return null;
  let canvas = srcCanvas;
  for (let i = 0; i < atlas.pipeline.length; i++) {
    const b = atlas.pipeline[i];
    if (!b.enabled) continue;
    if (b._cache && !b._dirty) { canvas = b._cache; continue; }
    const runner = BLOCK_RUNNERS[b.type];
    if (!runner) continue;
    const ctx = { region: null, state, block: b, ai: null, signal: null };
    try {
      const out = await runner(canvas, b.params, ctx);
      if (out) { b._cache = out; b._dirty = false; canvas = out; }
    } catch (e) {
      console.warn(`[AtlasPipeline] block "${b.type}" failed:`, e);
      showToast(`Atlas block "${BLOCK_DEFS[b.type]?.label || b.type}" failed`, "error");
    }
  }
  return canvas;
}
