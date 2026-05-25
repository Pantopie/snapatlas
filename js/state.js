// ── TYPES ───────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Photo
 * @property {string}          id          - UUID
 * @property {HTMLImageElement} img         - Decoded source image
 * @property {number}          x           - World-space X in photo pixels
 * @property {number}          y           - World-space Y in photo pixels
 * @property {boolean}         [_savedToIdb]
 */

/**
 * @typedef {Object} MaterialClassification
 * @property {string} materialClass  - Key into MATERIAL_CLASSES
 * @property {string} semanticClass  - Key into SEMANTIC_CLASSES
 * @property {string} tilingClass    - Key into TILING_CLASSES
 * @property {string} subtype        - Concise descriptor, e.g. "red brick"
 * @property {string} notes          - One-sentence summary for texture reconstruction
 */

/**
 * @typedef {Object} Block
 * @property {string}  type       - Key into BLOCK_DEFS
 * @property {boolean} enabled
 * @property {Object}  params     - Merged default+user params (shape varies by type)
 * @property {HTMLCanvasElement|null} _cache
 * @property {boolean} _dirty
 * @property {boolean} _running
 * @property {boolean} _everRun
 */

/**
 * @typedef {Object} Region
 * @property {string}                      id
 * @property {string}                      photoId
 * @property {string}                      label
 * @property {boolean}                     _userNamed
 * @property {[number,number,number,number]} box  - Normalised [x1,y1,x2,y2] ∈ [0,1]
 * @property {number}                      outputW
 * @property {number}                      outputH
 * @property {boolean}                     selected
 * @property {boolean}                     [noRotate]
 * @property {MaterialClassification|null} material
 * @property {HTMLCanvasElement|null}       thumb
 * @property {string|null}                 parentId
 * @property {number}                      cropX  - Variant sub-region crop [0,1]
 * @property {number}                      cropY
 * @property {Block[]}                     pipeline
 * @property {HTMLCanvasElement|null}       extracted
 * @property {HTMLCanvasElement|null}       _rawCrop
 * @property {HTMLCanvasElement|null}       _variantInputCache
 * @property {boolean}                     _variantInputDirty
 * @property {boolean}                     _classifying
 * @property {AbortController|null}        _runController
 */

/**
 * @typedef {{ label: string, icon: string, color: string }} MaterialClassDef
 */

/**
 * @typedef {{ label: string, icon: string }} SemanticClassDef
 */

// ── STATE ──────────────────────────────────────────────────────────────────
const state = {
  apiKey: localStorage.getItem("snapatlas_key") || "",
  /** @type {Photo[]} */
  photos: [],
  /** @type {Region[]} */
  regions: [],
  regionCounter: 0,   // monotonically incrementing; never reset on delete
  hoveredIdx: -1,
  inspectedIdx: null,           // which region the inspector is showing
  drawing: false,
  drawPhoto: null,              // photo object currently being drawn on
  drawStart: { x: 0, y: 0 },   // photo-normalized [0,1]
  drawEnd:   { x: 0, y: 0 },   // photo-normalized [0,1]
  processed: false,
  /** @type {HTMLCanvasElement|null} */
  atlasCanvas: null,
  /** @type {Object|null} */
  packedLayout: null,
  /** @type {Array} */
  packedStrips: [],
  previewMode: "extracted",
  snapGrid: 16,
  resizing: null,
  moving: null,
  movingPhoto: null,            // {photo, origX, origY, startWx, startWy}
  tool: "create",
  pvResizing: null,
  pvHovered: -1,
  pvAtlasSize: 0,
  /** @type {string[]} */
  pvSelected: [],
  atlasName: "Untitled Atlas",
};

// ── PHOTO HELPERS ──────────────────────────────────────────────────────────
/** @param {string} id @returns {Photo|null} */
function getPhoto(id)         { return state.photos.find(p => p.id === id) ?? null; }
/** @param {Region} r @returns {Photo|null} */
function getPhotoForRegion(r) { return getPhoto(r.photoId); }

const GRID = 8; // all region output dimensions are multiples of this

// Material class definitions — drives AI pass selection, prompting, and seam strategy.
// ── 3-axis surface taxonomy ────────────────────────────────────────────────
// Axis 1: physical substance → controls delight, microstructure, synthesis
/** @type {Object<string, MaterialClassDef>} */
const MATERIAL_CLASSES = {
  masonry:  { label: "Masonry",  emoji: "🧱", color: "#c8785a" },
  wood:     { label: "Wood",     emoji: "🪵", color: "#a07840" },
  metal:    { label: "Metal",    emoji: "⚙️", color: "#7090a8" },
  concrete: { label: "Concrete", emoji: "🏗️", color: "#909098" },
  plaster:  { label: "Plaster",  emoji: "🏛️", color: "#c8b890" },
  tile:     { label: "Tile",     emoji: "🔷", color: "#80a8c8" },
  asphalt:  { label: "Asphalt",  emoji: "🛣️", color: "#606870" },
  fabric:   { label: "Fabric",   emoji: "🧵", color: "#a080c0" },
  painted:  { label: "Painted",  emoji: "🎨", color: "#c8a030" },
  glass:    { label: "Glass",    emoji: "🪟", color: "#80c8d0" },
  organic:  { label: "Organic",  emoji: "🌿", color: "#608060" },
  generic:  { label: "Generic",  emoji: "◻️", color: "#787878" },
};

// Axis 2: what the surface IS in the scene → controls preservation aggressiveness
/** @type {Object<string, SemanticClassDef>} */
const SEMANTIC_CLASSES = {
  flat_surface: { label: "Surface", emoji: "▭" },
  door:         { label: "Door",    emoji: "🚪" },
  window:       { label: "Window",  emoji: "🪟" },
  facade:       { label: "Facade",  emoji: "🏢" },
  sign:         { label: "Sign",    emoji: "🪧" },
  panel:        { label: "Panel",   emoji: "⊞" },
  floor:        { label: "Floor",   emoji: "▱" },
  ground:       { label: "Ground",  emoji: "🌍" },
  ceiling:      { label: "Ceiling", emoji: "⬜" },
  trim:         { label: "Trim",    emoji: "➖" },
  road:         { label: "Road",    emoji: "🛣️" },
  object:       { label: "Object",  emoji: "💠" },
};

// Axis 3: periodicity topology → controls seam strategy and synthesis strength
/** @type {Object<string, SemanticClassDef>} */
const TILING_CLASSES = {
  stochastic:  { label: "Stochastic",  emoji: "🔀" },
  directional: { label: "Directional", emoji: "➡️" },
  grid:        { label: "Grid",        emoji: "⊞" },
  symmetric:   { label: "Symmetric",   emoji: "⇔" },
  unique:      { label: "Unique",      emoji: "💠" },
};


/**
 * Snap a single pixel value to the nearest multiple of state.snapGrid, clamped to [GRID, 1024].
 * @param {number} v
 * @returns {number}
 */
const _snapDim = (v) =>
  Math.max(
    GRID,
    Math.min(1024, Math.round(v / state.snapGrid) * state.snapGrid),
  );

/**
 * Default output dimensions for a newly drawn region.
 * Targets ~half the source pixel size to avoid sending huge images to the AI.
 * @param {number} srcW
 * @param {number} srcH
 * @returns {{ outputW: number, outputH: number }}
 */
function _defaultDims(srcW, srcH) {
  const scale = Math.min(1, 512 / Math.max(srcW, srcH));
  return { outputW: _snapDim(srcW * scale), outputH: _snapDim(srcH * scale) };
}

