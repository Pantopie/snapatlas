// ── PROJECT PERSISTENCE ────────────────────────────────────────────────────

/** Storage-full warning shown at most once per session. */
let _storageWarnShown = false;
function _warnStorageFull() {
  if (_storageWarnShown) return;
  _storageWarnShown = true;
  showToast("Storage full — progress won't persist after refresh", "error");
}

// ── INDEXED DB ────────────────────────────────────────────────────────────
/** @type {IDBDatabase|null} */
let _idbConn = null;
/** @returns {Promise<IDBDatabase>} */
function _openDB() {
  if (_idbConn) return Promise.resolve(_idbConn);
  return new Promise((res, rej) => {
    const req = indexedDB.open("snapatlas_assets", 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore("assets");
    req.onsuccess = (e) => {
      _idbConn = e.target.result;
      res(_idbConn);
    };
    req.onerror = () => rej(req.error);
  });
}
/** @param {string} key @param {*} value @returns {Promise<void>} */
async function _idbPut(key, value) {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("assets", "readwrite");
    tx.objectStore("assets").put(value, key);
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}
/** @param {string} key @returns {Promise<*>} */
async function _idbGet(key) {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("assets", "readonly");
    const req = tx.objectStore("assets").get(key);
    req.onsuccess = () => res(req.result ?? null);
    req.onerror = rej;
  });
}
/** @returns {Promise<void>} */
async function _idbClear() {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("assets", "readwrite");
    tx.objectStore("assets").clear();
    tx.oncomplete = () => { _storageWarnShown = false; res(); };
    tx.onerror = rej;
  });
}

// ── Shared helpers ─────────────────────────────────────────────────────────
/** @param {string} dataUrl @returns {Promise<HTMLCanvasElement>} */
function _loadCanvasFromDataUrl(dataUrl) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => {
      const c = document.createElement("canvas");
      c.width = i.naturalWidth;
      c.height = i.naturalHeight;
      c.getContext("2d").drawImage(i, 0, 0);
      res(c);
    };
    i.src = dataUrl;
  });
}

/**
 * Canonical region metadata — used by both session-save and disk-export.
 * Only serializes stable fields; runtime-only fields (_cache, _dirty, _running,
 * _runController) are intentionally excluded.
 * @param {Region} r
 * @returns {{ id:string, photoId:string|null, label:string, _userNamed:boolean, box:{x:number,y:number,w:number,h:number}, outputW:number, outputH:number, selected:boolean, material:MaterialClassification|null, thumb:string, parentId:string|null, cropX:number, cropY:number, pipeline:{type:string,enabled:boolean,params:Object,hasCached:boolean}[] }}
 */
function _regionMeta(r) {
  return {
    id: r.id,
    photoId:    r.photoId    ?? null,
    label:      r.label,
    _userNamed: r._userNamed ?? false,
    box: r.box,
    outputW: r.outputW,
    outputH: r.outputH,
    selected: r.selected,
    material: r.material ?? null,
    thumb: r.thumb,
    parentId: r.parentId ?? null,
    cropX:    r.cropX    ?? 0,
    cropY:    r.cropY    ?? 0,
    pipeline: (r.pipeline ?? []).map(b => ({
      type:     b.type,
      enabled:  b.enabled,
      params:   { ...b.params },
      hasCached: !!b._cache,
    })),
  };
}

/** @param {string} dataUrl @returns {Promise<HTMLImageElement>} */
function _loadImageFromDataUrl(dataUrl) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
}

/** Shared UI restoration after any project load (session or disk). */
function _restoreUIAfterLoad() {
  dropOverlay.classList.add("hidden");
  btnNew.classList.remove("is-hidden");
  btnSaveProject.classList.remove("is-hidden");
  document.getElementById("snap-ctrl").classList.remove("is-hidden");
  if (state.regions.length) setTool("select");
  atlasNameInput.value = state.atlasName || "Untitled Atlas";
  renderCanvas();
  renderInspector();
  renderPreview();
  updateButtons();
}

/** @param {Block} b @returns {Block} */
function _hydrateBlock(b) {
  return { ...b, _cache: null, _dirty: true, _running: false, _everRun: false };
}

/** @type {string[]} */
const _DEFAULT_PIPELINE_TYPES = ["perspective", "retinex", "highpass", "ai_normalize", "ai_seamless"];

/**
 * Restore a saved region object with runtime fields.
 * @param {Object} r - Saved region data
 * @param {HTMLCanvasElement|null} extracted
 * @param {(HTMLCanvasElement|null)[]} [blockCaches] - One per pipeline slot
 * @returns {Region}
 */
function _hydrateRegion(r, extracted, blockCaches = []) {
  // Variants start with an empty pipeline by design. The old code had
  // `r.pipeline.length` in the condition, which treated `[]` as falsy and
  // wrongly applied defaultPipeline() to variants — re-running all CPU blocks
  // on top of the already-processed parent output. Use Array.isArray() only so
  // an explicit empty array is preserved as-is.
  //
  // Migration: if a variant already had the default pipeline saved due to the
  // old bug, clear it so it doesn't corrupt the variant's output.
  let savedPipeline = r.pipeline;
  if (r.parentId && Array.isArray(savedPipeline) &&
      savedPipeline.length === _DEFAULT_PIPELINE_TYPES.length &&
      savedPipeline.every((b, i) => b.type === _DEFAULT_PIPELINE_TYPES[i])) {
    savedPipeline = []; // wipe wrongly-saved default pipeline from variant
  }

  const pipeline = Array.isArray(savedPipeline)
    ? savedPipeline.map((b, bi) => {
        const cache = blockCaches[bi] ?? null;
        return { ..._hydrateBlock(b), _cache: cache, _dirty: !cache, _everRun: !!cache };
      })
    : defaultPipeline();
  return {
    ...r,
    photoId:    r.photoId    ?? null,
    material:   r.material   ?? null,
    parentId:   r.parentId   ?? null,
    _userNamed: r._userNamed ?? false,
    selected:  r.selected  ?? true,
    cropX:     r.cropX     ?? 0,
    cropY:     r.cropY     ?? 0,
    pipeline,
    extracted: extracted ?? null,
    _rawCrop:  null,
    _variantInputCache: null,
    _variantInputDirty: true,
    _classifying: false,
    _runController: null,
  };
}

// ── Session persistence (localStorage + IDB) ───────────────────────────────
/** Saves project state to localStorage and photo data to IndexedDB. */
function saveProject() {
  if (!state.photos.length) return;
  const photos   = state.photos.map(p => ({ id: p.id, x: p.x, y: p.y }));
  const regions  = state.regions.map(r => ({ ..._regionMeta(r), hasExtracted: !!r.extracted }));
  try {
    localStorage.setItem("snapatlas_project", JSON.stringify({ version: 3, photos, regions, processed: state.processed, regionCounter: state.regionCounter, atlasName: state.atlasName }));
    btnNew.classList.remove("is-hidden");
    btnSaveProject.classList.remove("is-hidden");
  } catch (_) { _warnStorageFull(); }
  // Persist each photo image to IDB (fire-and-forget; only needed if not already there)
  for (const p of state.photos) {
    if (p._savedToIdb) continue;
    const c = document.createElement("canvas");
    c.width = p.img.width; c.height = p.img.height;
    c.getContext("2d").drawImage(p.img, 0, 0);
    _idbPut(`source_${p.id}`, c.toDataURL("image/jpeg", 0.92))
      .then(() => { p._savedToIdb = true; })
      .catch(_warnStorageFull);
  }
}

/** @returns {Promise<void>} */
async function loadProject() {
  let raw;
  try { raw = localStorage.getItem("snapatlas_project"); } catch (_) { raw = null; }
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);

    // ── Migration: v1/v2 single-photo format ──────────────────────────────
    if (!saved.photos) {
      const srcDataUrl = saved.imageData || (await _idbGet("source"));
      if (!srcDataUrl) return;
      const img = await _loadImageFromDataUrl(srcDataUrl);
      const legacyId = "photo_legacy";
      state.photos = [{ id: legacyId, img, x: 0, y: 0, _savedToIdb: false }];
      if (saved.imageData) _idbPut(`source_${legacyId}`, saved.imageData).catch(_warnStorageFull);
      const regions = (saved.regions ?? []).map(r => ({ ...r, photoId: r.photoId ?? legacyId }));
      saved.photos  = [{ id: legacyId, x: 0, y: 0 }];
      saved.regions = regions;
    } else {
      // New multi-photo format
      const loadedPhotos = await Promise.all(
        saved.photos.map(async p => {
          const dataUrl = await _idbGet(`source_${p.id}`);
          if (!dataUrl) return null;
          const img = await _loadImageFromDataUrl(dataUrl);
          return { id: p.id, img, x: p.x, y: p.y, _savedToIdb: true };
        }),
      );
      state.photos = loadedPhotos.filter(Boolean);
      if (!state.photos.length) return;
    }

    state.regions = await Promise.all(
      (saved.regions ?? []).map(async r => {
        let extracted = null;
        if (r.hasExtracted) {
          const data = await _idbGet(`extracted_${r.id}`);
          if (data) extracted = await _loadCanvasFromDataUrl(data);
        }
        const blockCaches = await Promise.all(
          (r.pipeline ?? []).map(async (b, bi) => {
            if (!b.hasCached) return null;
            const data = await _idbGet(`block_${r.id}_${bi}`);
            return data ? _loadCanvasFromDataUrl(data) : null;
          }),
        );
        return _hydrateRegion(r, extracted, blockCaches);
      }),
    );

    state.processed = saved.processed ?? false;
    state.regionCounter = saved.regionCounter ?? state.regions.length;
    state.atlasName = saved.atlasName ?? "Untitled Atlas";
    if (state.processed) _rebuildAtlasFromState();

    _restoreUIAfterLoad();
    // CPU block caches are not persisted — re-run them now so intermediates are
    // ready. Async block caches were restored from IDB above, so only the fast
    // CPU stages will actually execute.
    for (const r of state.regions) await autoRunCPU(r, 0);
    renderInspector();
    setStatus("", "");
    showToast("Project restored");
  } catch (e) {
    console.warn("Failed to restore project:", e);
    localStorage.removeItem("snapatlas_project");
  }
}

// ── Disk export / import (.snapatlas) ─────────────────────────────────────
/** @returns {Promise<void>} */
async function exportProject() {
  if (!state.photos.length) return;
  showToast("Preparing project file…");
  try {
    const photos = await Promise.all(
      state.photos.map(async p => {
        const data = await _idbGet(`source_${p.id}`) || (() => {
          const c = document.createElement("canvas");
          c.width = p.img.width; c.height = p.img.height;
          c.getContext("2d").drawImage(p.img, 0, 0);
          return c.toDataURL("image/jpeg", 0.92);
        })();
        return { id: p.id, x: p.x, y: p.y, data };
      }),
    );
    const regions = await Promise.all(
      state.regions.map(async r => {
        const extracted = r.extracted
          ? r.extracted.toDataURL("image/png")
          : await _idbGet(`extracted_${r.id}`);
        const pipeline = await Promise.all(
          (r.pipeline ?? []).map(async (b, bi) => {
            const cached = BLOCK_DEFS[b.type]?.isAsync
              ? (b._cache ? b._cache.toDataURL("image/png") : await _idbGet(`block_${r.id}_${bi}`))
              : null;
            return { type: b.type, enabled: b.enabled, params: { ...b.params }, cached: cached || null };
          }),
        );
        return { ..._regionMeta(r), pipeline, extracted: extracted || null };
      }),
    );
    const payload = JSON.stringify({
      version: 3,
      exportedAt: new Date().toISOString(),
      photos,
      regions,
      processed: state.processed,
      regionCounter: state.regionCounter,
      atlasName: state.atlasName,
    });
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = (state.atlasName || "project").replace(/[^a-z0-9_-]/gi, "_");
    a.download = `${slug}.snapatlas`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("", "");
    showToast("Project saved");
  } catch (e) {
    console.warn("exportProject failed:", e);
    showToast("Failed to save project", "error");
  }
}

/** @param {File} file @returns {Promise<void>} */
async function importProject(file) {
  showToast("Loading project…");
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // Accept both new multi-photo format and legacy single-photo format
    const isLegacy = !data.photos && data.source;
    if (!isLegacy && (!Array.isArray(data.photos) || !Array.isArray(data.regions))) {
      throw new Error("Unrecognised .snapatlas format");
    }

    await _idbClear();
    state.atlasCanvas = null;
    state.packedLayout = null;
    state.packedStrips = [];

    if (isLegacy) {
      // v1/v2 single-photo migration
      const img = await _loadImageFromDataUrl(data.source).catch(() => {
        throw new Error("Could not decode source image");
      });
      const legacyId = "photo_legacy";
      state.photos = [{ id: legacyId, img, x: 0, y: 0, _savedToIdb: false }];
      _idbPut(`source_${legacyId}`, data.source).catch(_warnStorageFull);
      data.regions = (data.regions ?? []).map(r => ({ ...r, photoId: r.photoId ?? legacyId }));
    } else {
      state.photos = await Promise.all(
        data.photos.map(async p => {
          const img = await _loadImageFromDataUrl(p.data).catch(() => {
            throw new Error(`Could not decode photo ${p.id}`);
          });
          _idbPut(`source_${p.id}`, p.data).catch(_warnStorageFull);
          return { id: p.id, img, x: p.x ?? 0, y: p.y ?? 0, _savedToIdb: true };
        }),
      );
    }

    state.regions = await Promise.all(
      (data.regions ?? []).map(async r => {
        let extracted = null;
        if (r.extracted) {
          extracted = await _loadCanvasFromDataUrl(r.extracted);
          _idbPut(`extracted_${r.id}`, r.extracted).catch(_warnStorageFull);
        }
        const blockCaches = await Promise.all(
          (r.pipeline ?? []).map(async (b, bi) => {
            if (!b.cached) return null;
            _idbPut(`block_${r.id}_${bi}`, b.cached).catch(_warnStorageFull);
            return _loadCanvasFromDataUrl(b.cached);
          }),
        );
        return _hydrateRegion(r, extracted, blockCaches);
      }),
    );

    state.processed = data.processed ?? false;
    state.regionCounter = data.regionCounter ?? state.regions.length;
    state.atlasName = data.atlasName ?? "Untitled Atlas";
    if (state.processed) _rebuildAtlasFromState();

    saveProject();
    _restoreUIAfterLoad();
    for (const r of state.regions) await autoRunCPU(r, 0);
    renderInspector();
    setStatus("", "");
    showToast(`Loaded "${file.name}"`);
  } catch (e) {
    console.warn("importProject failed:", e);
    showToast(e.message || "Failed to load project file", "error");
  }
}
