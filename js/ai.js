// ── MATERIAL CLASSIFICATION ────────────────────────────────────────────────
// Text-only Gemini call — cheap, returns a 3-axis classification object.
// No image generation; uses the standard multimodal model.
/**
 * @typedef {Object} GeminiResponse
 * @property {HTMLCanvasElement|null} canvas
 * @property {string|null}            receivedMime
 * @property {string|null}            receivedB64
 * @property {string[]}               textParts
 */
/** @param {HTMLCanvasElement} inputCanvas @returns {Promise<MaterialClassification>} */
async function _classifyMaterial(inputCanvas) {
  const b64 = inputCanvas.toDataURL("image/jpeg", 0.75).split(",")[1];
  const prompt =
    `Classify this surface texture on THREE orthogonal axes. Return ONLY valid JSON — no explanation, no markdown fences:\n` +
    `{\n` +
    `  "materialClass": "<masonry|wood|metal|concrete|plaster|tile|asphalt|fabric|painted|glass|organic|generic>",\n` +
    `  "semanticClass": "<flat_surface|door|window|facade|sign|panel|floor|ground|ceiling|trim|road|object>",\n` +
    `  "tilingClass":   "<stochastic|directional|grid|symmetric|unique>",\n` +
    `  "subtype": "<concise descriptor e.g. red brick, rough concrete, oak planks, galvanised steel>",\n` +
    `  "notes": "<one sentence: key property for texture reconstruction>"\n` +
    `}\n\n` +
    `AXIS 1 — materialClass (physical substance):\n` +
    `  masonry: brick, stone, block — periodic units with mortar/grout\n` +
    `  wood: planks, boards, parquet — grain direction is critical\n` +
    `  metal: panels, cladding, corrugated sheet, chain-link\n` +
    `  concrete: poured or precast — may have formwork texture\n` +
    `  plaster: render, stucco, skim coat\n` +
    `  tile: ceramic, porcelain, terracotta — glazed units with grout\n` +
    `  asphalt: tarmac, bitumen — fine aggregate mix\n` +
    `  fabric: canvas, rope, woven textile\n` +
    `  painted: painted surface where paint layer dominates\n` +
    `  glass: glazing, mirror — treat as opaque for albedo\n` +
    `  organic: moss, bark, soil, leaves\n` +
    `  generic: anything not covered above\n\n` +
    `AXIS 2 — semanticClass (what the surface IS in the scene):\n` +
    `  flat_surface: plain wall/floor/ceiling face — no object boundary\n` +
    `  door: any door or hatch, including garage doors\n` +
    `  window: any glazed aperture\n` +
    `  facade: architectural facade spanning multiple elements\n` +
    `  sign: text, logo, painted marking, sticker, poster\n` +
    `  panel: cladding, access, or decorative panel\n` +
    `  floor: floor tile or paving layout (viewed from above)\n` +
    `  ground: road, path or ground surface (viewed from above)\n` +
    `  ceiling: overhead surface\n` +
    `  trim: skirting, moulding, architrave, decorative strip\n` +
    `  road: road surface with lane markings\n` +
    `  object: 3-D object surface — vehicle, furniture, equipment\n\n` +
    `AXIS 3 — tilingClass (periodic structure of the surface):\n` +
    `  stochastic: no repeating pattern (gravel, concrete, asphalt, sand)\n` +
    `  directional: pattern flows in one direction (wood grain, corrugated metal, fabric weave)\n` +
    `  grid: regular 2-D repeat (brick, ceramic tile, block paving, herringbone parquet)\n` +
    `  symmetric: bilateral or rotational symmetry (door panels, windows, ornamental facades)\n` +
    `  unique: one-shot surface, not intended to tile (signs, most doors, unique decals)`;

  try {
    const ai = new GoogleGenAI({ apiKey: state.apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: b64 } },
            { text: prompt },
          ],
        },
      ],
      config: { temperature: 0 },
    });
    const text =
      response.candidates?.[0]?.content?.parts
        ?.filter((p) => p.text)
        .map((p) => p.text)
        .join("")
        .trim() ?? "";
    const jsonStr = text.replace(/^```json\s*|^```\s*|```\s*$/gm, "").trim();
    const result = JSON.parse(jsonStr);
    // Validate and clamp to known values
    if (!MATERIAL_CLASSES[result.materialClass])
      result.materialClass = "generic";
    if (!SEMANTIC_CLASSES[result.semanticClass])
      result.semanticClass = "flat_surface";
    if (!TILING_CLASSES[result.tilingClass]) result.tilingClass = "stochastic";
    console.log(
      "[SnapAtlas] classified:",
      result.materialClass,
      "/",
      result.semanticClass,
      "/",
      result.tilingClass,
      "—",
      result.subtype,
    );
    return result;
  } catch (e) {
    console.warn("[SnapAtlas] classify failed, defaulting to generic:", e);
    return {
      materialClass: "generic",
      semanticClass: "flat_surface",
      tilingClass: "stochastic",
      subtype: "unknown",
      notes: "classification failed",
    };
  }
}

// ── MATERIAL-AWARE PASS 1 PROMPT ───────────────────────────────────────────
// Builds a targeted normalization prompt from all 3 classification axes.
// Semantic rules inject strict preservation constraints for architectural objects.
// Material rules drive reconstruction strategy and delight behavior.
/**
 * @param {Region} region
 * @param {number} inputW
 * @param {number} inputH
 * @param {string} [userHint]
 * @param {string} [strength]
 * @returns {string}
 */
function _buildP1Prompt(region, inputW, inputH, userHint = "", strength = "balanced") {
  const W = region.outputW,
    H = region.outputH;
  const mat = region.material;
  const materialClass = mat?.materialClass ?? "generic";
  const semanticClass = mat?.semanticClass ?? "flat_surface";
  const sub = mat?.subtype ? `(${mat.subtype})` : "";

  // Super-resolution block: injected when input is smaller than the target output.
  // Instructs the AI to synthesize detail rather than upscale blur.
  const srScale = inputW && inputH ? Math.max(W / inputW, H / inputH) : 1;
  const srBlock =
    srScale > 1.5
      ? `━━━ TASK 0 · SUPER-RESOLUTION ━━━\n` +
        `Reference input: ${inputW}×${inputH} px  →  Target output: ${W}×${H} px (${srScale.toFixed(1)}× upscale)\n` +
        `The input is a low-resolution photograph crop. Generate the texture at full ${W}×${H} resolution.\n` +
        `· Synthesize all missing high-frequency detail: sharp edges, crisp micro-texture, clear structural lines\n` +
        `· Do NOT preserve or propagate any blur, pixelation, or compression artifacts from the input\n` +
        `· Treat the input as a blurry thumbnail — reconstruct all fine detail from material and context cues\n` +
        `· Output must look as if photographed at ${W}×${H} native resolution, not upscaled\n\n`
      : "";

  const prefix =
    `You are generating a game-ready PBR albedo texture from a real-world photograph.\n` +
    `OUTPUT: exactly ${W}×${H} px, perfectly front-facing orthographic view.\n\n` +
    srBlock +
    `━━━ TASK 1 · PERSPECTIVE CORRECTION ━━━\n` +
    `Make parallel lines truly parallel. Remove foreshortening. Correct all geometric distortion.\n\n` +
    `━━━ TASK 2 · OCCLUDER REMOVAL ━━━\n` +
    `Remove people, vehicles, poles, wires. Reconstruct the surface behind them.\n\n`;

  // Semantic preservation rules — injected only where strict constraints apply.
  // These override material reconstruction behavior for architectural objects.
  const semanticRules =
    {
      door:
        `━━━ SEMANTIC RULE · DOOR ━━━\n` +
        `· Treat this as a complete physical door scan with partial occlusion\n` +
        `· Reconstruct missing or hidden parts as if fully visible\n` +
        `· Preserve correct door design logic (symmetry, panel structure, proportions)\n` +
        `· Keep hardware consistent with material reality (hinges, handles, locks)\n` +
        `· If a region is occluded, infer plausible completion — do NOT leave gaps\n` +
        `· Do NOT stylize or redesign the door beyond realistic reconstruction\n\n`,

      window:
        `━━━ SEMANTIC RULE · WINDOW ━━━\n` +
        `· Treat as full architectural window system partially visible\n` +
        `· Reconstruct missing mullions, frame parts, and symmetry logically\n` +
        `· Maintain architectural consistency and physical plausibility\n` +
        `· Glass is treated as opaque albedo surface (no transparency)\n` +
        `· Infer hidden structural repetition if partially occluded\n\n`,

      sign:
        `━━━ SEMANTIC RULE · SIGN ━━━\n` +
        `· Preserve all semantic content (text, logos, symbols) exactly\n` +
        `· Lighting must be fully removed but graphic content remains intact\n` +
        `· Reconstruct missing edges or partial occlusion without altering meaning\n` +
        `· Treat as high-priority information layer over material surface\n\n`,

      facade:
        `━━━ SEMANTIC RULE · FACADE ━━━\n` +
        `· Reconstruct full architectural rhythm (even if partially occluded)\n` +
        `· Maintain structural logic: repetition, symmetry, spacing\n` +
        `· Complete missing architectural segments coherently\n` +
        `· Do not flatten or homogenize architectural variation\n\n`,

      panel:
        `━━━ SEMANTIC RULE · PANEL ━━━\n` +
        `· Reconstruct full panel system including hidden seams\n` +
        `· Maintain consistent modular layout and spacing\n` +
        `· Infer missing panel boundaries if partially visible\n\n`,

      trim:
        `━━━ SEMANTIC RULE · TRIM ━━━\n` +
        `· Reconstruct full trim/moulding profile as continuous geometry\n` +
        `· Maintain consistent decorative rhythm and profile shape\n\n`,
    }[semanticClass] ?? "";

  // Material reconstruction + delight — driven by physical substance
  const materialSections = {
    masonry:
      `━━━ TASK 3 · MASONRY RECONSTRUCTION ${sub} ━━━\n` +
      `· Reconstruct full masonry grid as a consistent structural system (brick/stone/block)\n` +
      `· Enforce uniform unit scale and alignment across the entire surface\n` +
      `· Repair broken or occluded mortar/grout lines using surrounding structural logic\n` +
      `· Infer missing bricks/stones under occluders to maintain continuous masonry pattern\n` +
      `· Keep weathering and age variation as material signal, not lighting\n\n` +
      `━━━ TASK 4 · ALBEDO COLLAPSE ━━━\n` +
      `Fully collapse illumination into intrinsic material color.\n` +
      `Remove ALL lighting influence: shadows, gradients, highlights, exposure bias.\n` +
      `Output must behave as a uniform diffuse scan of the masonry surface.\n\n`,

    wood:
      `━━━ TASK 3 · WOOD RECONSTRUCTION ${sub} ━━━\n` +
      `· Reconstruct continuous wood plank system with correct board scale and spacing\n` +
      `· Enforce consistent grain direction across the entire surface\n` +
      `· Infer occluded plank segments and continue grain flow through missing regions\n` +
      `· Preserve knots, rings, and structural imperfections as intrinsic material features\n` +
      `· Do NOT break grain continuity or alter board frequency\n\n` +
      `━━━ TASK 4 · ALBEDO COLLAPSE ━━━\n` +
      `Remove all lighting effects completely (directional shading, specular response, shadows).\n` +
      `Convert appearance into uniform diffuse wood material color and grain signal.\n\n`,

    metal:
      `━━━ TASK 3 · METAL RECONSTRUCTION ${sub} ━━━\n` +
      `· Reconstruct continuous metal surface system (panels, sheets, or structured metal forms)\n` +
      `· Enforce consistent panel geometry, seam spacing, and structural repetition\n` +
      `· Restore occluded rivets, welds, dents, and scratches consistent with surrounding surface\n` +
      `· Preserve damage as material signal (do not over-smooth or erase wear)\n` +
      `· Ensure structural coherence across the full surface\n\n` +
      `━━━ TASK 4 · ALBEDO COLLAPSE ━━━\n` +
      `Aggressively remove all specular and directional lighting information.\n` +
      `Flatten surface into true diffuse metal albedo representation.\n\n`,

    concrete:
      `━━━ TASK 3 · CONCRETE RECONSTRUCTION ${sub} ━━━\n` +
      `· Reconstruct continuous poured material with consistent aggregate distribution\n` +
      `· Restore occluded formwork patterns, cracks, and surface irregularities\n` +
      `· Maintain structural continuity of pour lines and surface transitions\n` +
      `· Do not regularize or overly clean natural concrete imperfections\n\n` +
      `━━━ TASK 4 · ALBEDO COLLAPSE ━━━\n` +
      `Remove all lighting gradients and shadow information completely.\n` +
      `Preserve only intrinsic concrete color and physical surface variation.\n\n`,

    plaster:
      `━━━ TASK 3 · PLASTER RECONSTRUCTION ${sub} ━━━\n` +
      `· Reconstruct continuous plaster/render surface with consistent texture scale\n` +
      `· Restore occluded cracks, brush marks, and surface irregularities\n` +
      `· Maintain coherence of applied layers (paint, render, skim coat)\n` +
      `· Do not flatten or erase intentional surface texture\n\n` +
      `━━━ TASK 4 · ALBEDO COLLAPSE ━━━\n` +
      `Fully remove lighting influence while preserving material coloration and texture.\n\n`,

    tile:
      `━━━ TASK 3 · TILE RECONSTRUCTION ${sub} ━━━\n` +
      `· Reconstruct complete tile grid with strict geometric regularity\n` +
      `· Ensure tile size, spacing, and alignment remain globally consistent\n` +
      `· Restore occluded tiles and grout lines using grid logic\n` +
      `· Preserve tile variation, glaze pattern, and surface detail per unit\n` +
      `· Do not break grid structure under occlusion\n\n` +
      `━━━ TASK 4 · ALBEDO COLLAPSE ━━━\n` +
      `Remove all reflections, highlights, and lighting gradients.\n` +
      `Output uniform diffuse ceramic/tile albedo.\n\n`,

    asphalt:
      `━━━ TASK 3 · ASPHALT RECONSTRUCTION ${sub} ━━━\n` +
      `· Reconstruct continuous stochastic surface with realistic aggregate distribution\n` +
      `· Restore cracks and surface variation consistently without introducing structure\n` +
      `· No repeating pattern enforcement (fully non-periodic surface)\n\n` +
      `━━━ TASK 4 · ALBEDO COLLAPSE ━━━\n` +
      `Fully normalize lighting to flat diffuse surface.\n` +
      `Remove all illumination variation across the material.\n\n`,

    fabric:
      `━━━ TASK 3 · FABRIC RECONSTRUCTION ${sub} ━━━\n` +
      `· Reconstruct weave system with consistent warp/weft structure\n` +
      `· Maintain correct thread density and directional flow\n` +
      `· Restore occluded fibers using surrounding weave logic\n` +
      `· Preserve wrinkles only as geometry-driven detail, not lighting\n\n` +
      `━━━ TASK 4 · ALBEDO COLLAPSE ━━━\n` +
      `Remove all shading, creases from lighting, and specular variation.\n` +
      `Preserve only true fiber color and weave structure.\n\n`,

    painted:
      `━━━ TASK 3 · PAINTED SURFACE RECONSTRUCTION ${sub} ━━━\n` +
      `· Reconstruct continuous painted surface with consistent substrate structure\n` +
      `· Restore brush strokes, drips, and paint layering consistently\n` +
      `· Preserve occluded painted elements logically\n` +
      `· Maintain paint thickness and texture variation\n\n` +
      `━━━ TASK 4 · ALBEDO COLLAPSE ━━━\n` +
      `Remove all lighting artifacts while preserving paint color and texture.\n\n`,

    glass:
      `━━━ TASK 3 · GLASS RECONSTRUCTION ${sub} ━━━\n` +
      `· Treat as opaque material for albedo reconstruction\n` +
      `· Restore surface coatings, frost, etching, or texture consistently\n` +
      `· Reconstruct missing regions using surrounding structural logic\n\n` +
      `━━━ TASK 4 · ALBEDO COLLAPSE ━━━\n` +
      `Remove all reflections and lighting effects completely.\n` +
      `Output flat diffuse representation of glass surface.\n\n`,

    organic:
      `━━━ TASK 3 · ORGANIC RECONSTRUCTION ${sub} ━━━\n` +
      `· Reconstruct natural surface continuity (bark, moss, soil, foliage)\n` +
      `· Maintain organic variability without artificial regularization\n` +
      `· Restore occluded growth patterns consistently\n\n` +
      `━━━ TASK 4 · ALBEDO COLLAPSE ━━━\n` +
      `Remove all lighting influence while preserving natural color variation.\n\n`,

    generic:
      `━━━ TASK 3 · STRUCTURAL RECONSTRUCTION ━━━\n` +
      `· Reconstruct full surface system with consistent structural logic\n` +
      `· Restore occluded elements using local and global context inference\n` +
      `· Maintain scale, rhythm, and material identity\n\n` +
      `━━━ TASK 4 · ALBEDO COLLAPSE ━━━\n` +
      `Remove all illumination effects and normalize to diffuse albedo signal.\n` +
      `Preserve only intrinsic material properties.\n`,
  };
  const materialSection =
    materialSections[materialClass] ?? materialSections.generic;

  const intensityBlock =
    strength === "minimal"
      ? `━━━ CLEANUP INTENSITY · MINIMAL ━━━\n` +
        `Apply a light touch. Remove only strong shadows and obvious highlights.\n` +
        `Preserve photographic variation and subtle tonal differences.\n` +
        `When in doubt, leave detail intact — do not over-process.\n\n`
      : strength === "aggressive"
      ? `━━━ CLEANUP INTENSITY · AGGRESSIVE ━━━\n` +
        `Push all normalization to maximum. Remove every trace of directional lighting,\n` +
        `ambient occlusion, and tonal variation. Even subtle shading must be fully eliminated.\n` +
        `Produce the flattest, most uniform albedo possible.\n\n`
      : ""; // balanced = default behaviour, no modifier needed

  const hintBlock = userHint?.trim()
    ? `━━━ ADDITIONAL INSTRUCTIONS ━━━\n${userHint.trim()}\n\n`
    : "";

  return (
    prefix +
    semanticRules +
    materialSection +
    intensityBlock +
    hintBlock +
    `\nReturn ONLY the final image. Output must be exactly ${W}×${H} pixels.`
  );
}

// Build the AI input canvas from the region box + perspective settings.
// Always re-derived from source so re-running AI never uses a previous AI result.
//  • manualCorners set  → DLT homography (fast, no VP detection)
//  • perspCorr only     → auto-detect VPs on full image (slower, ~200 ms)
//  • neither            → raw crop, cover-resized to output dims
// Returns a canvas at region.outputW × region.outputH.
/** @param {Region} region @returns {HTMLCanvasElement} */
function _buildInputCanvas(region) {
  let inputCanvas; // always outputW × outputH
  if (region.perspCorr) {
    const raw = _rawCropCanvas(region);
    if (!raw) return _buildFallbackInput(region);
    const W = raw.width,
      H = raw.height;
    if (region.manualCorners) {
      const mc = region.manualCorners;
      const srcPts = [
        { x: mc.tl.x * W, y: mc.tl.y * H },
        { x: mc.tr.x * W, y: mc.tr.y * H },
        { x: mc.br.x * W, y: mc.br.y * H },
        { x: mc.bl.x * W, y: mc.bl.y * H },
      ];
      const H4 = _computeH4pt(srcPts, [
        { x: 0, y: 0 },
        { x: region.outputW, y: 0 },
        { x: region.outputW, y: region.outputH },
        { x: 0, y: region.outputH },
      ]);
      if (H4) {
        let ok = true;
        for (const p of srcPts) {
          const ww = H4[2][0] * p.x + H4[2][1] * p.y + H4[2][2];
          if (ww <= 0 || !isFinite(ww)) {
            ok = false;
            break;
          }
        }
        if (ok) inputCanvas = _applyH(raw, H4, region.outputW, region.outputH);
      }
    }
    if (!inputCanvas) {
      // Auto-detect: use full image for better line statistics
      const [x1, y1] = region.box;
      const cropOx = x1 * state.image.width,
        cropOy = y1 * state.image.height;
      const { vVP: vF, hVP: hF, corners: cornersF } = _detectVPs(state.image);
      const vVP = vF ? { x: vF.x - cropOx, y: vF.y - cropOy } : null;
      const hVP = hF ? { x: hF.x - cropOx, y: hF.y - cropOy } : null;
      const corners = cornersF
        ? {
            tl: { x: cornersF.tl.x - cropOx, y: cornersF.tl.y - cropOy },
            tr: { x: cornersF.tr.x - cropOx, y: cornersF.tr.y - cropOy },
            br: { x: cornersF.br.x - cropOx, y: cornersF.br.y - cropOy },
            bl: { x: cornersF.bl.x - cropOx, y: cornersF.bl.y - cropOy },
          }
        : null;
      if (corners) {
        const H4 = _computeH4pt(
          [corners.tl, corners.tr, corners.br, corners.bl],
          [
            { x: 0, y: 0 },
            { x: region.outputW, y: 0 },
            { x: region.outputW, y: region.outputH },
            { x: 0, y: region.outputH },
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
          if (ok)
            inputCanvas = _applyH(raw, H4, region.outputW, region.outputH);
        }
      }
      if (!inputCanvas)
        inputCanvas = _rectifyWithVPs(
          raw,
          region.outputW,
          region.outputH,
          vVP,
          hVP,
        );
    }
  }
  return inputCanvas || _buildFallbackInput(region);
}

/** @param {Region} region @returns {HTMLCanvasElement} */
function _buildFallbackInput(region) {
  const raw = _rawCropCanvas(region);
  if (!raw) {
    const empty = document.createElement("canvas");
    empty.width = region.outputW; empty.height = region.outputH;
    return empty;
  }
  const maxSide = 1024;
  const s = Math.min(1, maxSide / Math.max(raw.width, raw.height));
  if (s >= 1) return raw;
  const out = document.createElement("canvas");
  out.width = Math.round(raw.width * s);
  out.height = Math.round(raw.height * s);
  out.getContext("2d").drawImage(raw, 0, 0, out.width, out.height);
  return out;
}

/** @param {Region} region @returns {Promise<HTMLCanvasElement|null>} */
async function extractTextureWithAI(region) {
  let inputCanvas = _buildInputCanvas(region);

  // ── PASS 0 · Material classification (text-only, cheap) ───────────────
  // Skip if already classified (re-generating preserves the class).
  if (!region.material) {
    region.generatingPass = 0;
    renderInspector();
    region.material = await _classifyMaterial(inputCanvas);
    renderInspector(); // show material badge immediately
  }

  // ── Delight prepass (deterministic Retinex blur-division) ──────────────
  if (region.delight && (region.delightStrength ?? 80) > 0)
    inputCanvas = _delightCanvas(
      inputCanvas,
      (region.delightStrength ?? 80) / 100,
    );

  // ── PASS 1 · Material-aware normalization ──────────────────────────────
  region.generatingPass = 1;
  renderInspector();

  const p1Prompt = _buildP1Prompt(
    region,
    inputCanvas.width,
    inputCanvas.height,
  );
  const p1Sent = inputCanvas.toDataURL("image/png").split(",")[1];
  const p1 = await _callGemini(p1Sent, "image/png", p1Prompt);

  region._debug = {
    pass1: {
      sentB64: p1Sent,
      sentMime: "image/png",
      prompt: p1Prompt,
      ...p1,
    },
    pass2: null,
  };

  if (!p1.canvas) {
    renderInspector();
    return null;
  }

  // Store Pass 1 result so btn-p2 can use it without re-running Pass 1
  region.p1Canvas = p1.canvas;
  _idbPut(`p1_${region.id}`, p1.canvas.toDataURL("image/png")).catch((e) => console.warn("[IDB] p1 cache write failed", e));

  // Pass 1 result only — seam repair runs separately as Pass 2
  return p1.canvas;
}

// ── Gemini API helper ──────────────────────────────────────────────────────
// Sends one image + prompt, returns { canvas, receivedMime, receivedB64, textParts }.
// canvas is at the native resolution Gemini returned; canvas is null if no image returned.
// extraImages: optional [{b64, mime}] — appended after the primary image (e.g. seam mask).
/** @returns {Promise<GeminiResponse>} */
async function _callGemini(b64, mime, prompt, temperature = 0.4, extraImages = []) {
  const ai = new GoogleGenAI({ apiKey: state.apiKey });
  return _callGeminiWithAI(ai, b64, mime, prompt, temperature, extraImages);
}

// ── BLOCK RUNNERS ─────────────────────────────────────────────────────────
// AI Normalize: material classification + Pass 1 normalization.
// Input canvas is whatever came out of the previous pipeline block
// (already perspective-corrected, delit, HP-delit, etc.).
/**
 * @param {HTMLCanvasElement} input
 * @param {{ userHint: string, strength: string }} params
 * @param {PipelineCtx} ctx
 * @returns {Promise<HTMLCanvasElement>}
 */
async function aiNormalizeRunner(input, params, ctx) {
  const { region, ai, signal } = ctx;
  if (!ai) throw new Error("No Gemini API key — add one in the sidebar");

  // Material classification — skip if already done.
  // Variants always inherit from their parent (same physical surface, different crop).
  // Standalone regions classify on the raw crop so lighting/processing doesn't skew results.
  if (!region.material) {
    if (region.parentId) {
      region.material = getParentRegion(region)?.material ?? null;
    }
    if (!region.material) {
      const rawCanvas = _rawCropCanvas(region);
      region._classifying = true;
      renderInspector();
      region.material = await _classifyMaterial(rawCanvas ?? input);
      region._classifying = false;
      if (signal?.aborted) return null;
      renderInspector();
    }
  }

  const p1Prompt = _buildP1Prompt(region, input.width, input.height, params.userHint, params.strength ?? "balanced");
  const p1Sent = input.toDataURL("image/png").split(",")[1];

  const p1 = await _callGeminiWithAI(ai, p1Sent, "image/png", p1Prompt);
  if (signal?.aborted) return null;
  if (!p1.canvas) throw new Error("AI returned no image for normalize pass");

  if (ctx.block) ctx.block._debug = { sentB64: p1Sent, sentMime: "image/png", prompt: p1Prompt, ...p1 };

  _idbPut(`p1_${region.id}`, p1.canvas.toDataURL("image/png")).catch((e) => console.warn("[IDB] p1 cache write failed", e));
  return p1.canvas;
}

// AI Seamless: 2×2 tiled inpainting of seam cross.
// Input is the normalized texture from the previous block (e.g. ai_normalize).
/**
 * @param {HTMLCanvasElement} input
 * @param {{ axes: string }} params
 * @param {PipelineCtx} ctx
 * @returns {Promise<HTMLCanvasElement>}
 */
async function aiSeamlessRunner(input, params, ctx) {
  const { region, ai, signal } = ctx;
  if (!ai) throw new Error("No Gemini API key — add one in the sidebar");

  const axes = params.axes ?? "xy";
  const W = input.width, H = input.height;
  const seamWidth = 32;

  // 1. Offset so seam moves to center
  const offsetCanvas = _buildSeamOffsetCanvas(input);

  // 2. Gaussian mask over seam cross
  const mask = _buildSeamMask(W, H, axes, seamWidth);

  // 3. Red overlay for the AI
  const overlaidCanvas = _paintMaskOverlay(offsetCanvas, mask);

  // 4. Downscale to ≤1024 for the API
  const maxSend = 1024;
  const sendScale = Math.min(1, maxSend / Math.max(W, H));
  const sendW = Math.max(8, Math.round(W * sendScale));
  const sendH = Math.max(8, Math.round(H * sendScale));
  let sendCanvas = overlaidCanvas;
  if (sendScale < 1) {
    sendCanvas = document.createElement("canvas");
    sendCanvas.width = sendW; sendCanvas.height = sendH;
    sendCanvas.getContext("2d").drawImage(overlaidCanvas, 0, 0, sendW, sendH);
  }
  const sentB64 = sendCanvas.toDataURL("image/png").split(",")[1];
  if (signal?.aborted) return null;

  const matCtx = region.material
    ? `${region.material.materialClass} ${region.material.semanticClass}`
    : "texture";
  const axesDesc = axes === "x" ? "horizontally" : axes === "y" ? "vertically" : "in both directions";

  const prompt =
    `You are an expert texture restoration system.\n\n` +
    `INPUT: A ${matCtx} texture with a masked region (red overlay) that must be repaired.\n\n` +
    `TASK: Reconstruct the masked pixels so they visually match the surrounding material.\n\n` +
    `STRICT RULES:\n` +
    `· Only modify pixels inside the red region\n` +
    `· Match surrounding color, lighting, texture density, grain direction, and local structure\n` +
    `· Do not introduce new objects or change material type\n` +
    `· Do not blur or smear — generate real texture detail\n\n` +
    `OUTPUT: Return the full ${sendW}×${sendH} image with the region repaired.`;

  const p2 = await _callGeminiWithAI(ai, sentB64, "image/png", prompt, 0.3);
  if (signal?.aborted) return null;
  if (!p2.canvas) throw new Error("AI returned no image for seamless pass");

  if (ctx.block) ctx.block._debug = { sentB64, sentMime: "image/png", prompt, ...p2 };

  // 5. Normalize inpainted back to W × H before compositing.
  // Gemini may return a different native resolution; always resize to match the
  // input so _compositeMasked receives consistent dimensions.
  let inpainted = p2.canvas;
  if (inpainted.width !== W || inpainted.height !== H) {
    const full = document.createElement("canvas");
    full.width = W; full.height = H;
    full.getContext("2d").drawImage(inpainted, 0, 0, W, H);
    inpainted = full;
  }

  // 6. Composite + offset back
  const composited = _compositeMasked(offsetCanvas, inpainted, mask);
  const result = _buildSeamOffsetCanvas(composited);
  _idbPut(`extracted_${region.id}`, result.toDataURL("image/png")).catch((e) => console.warn("[IDB] extracted cache write failed", e));
  return result;
}

/** @returns {Promise<GeminiResponse>} */
async function _callGeminiWithAI(ai, b64, mime, prompt, temperature = 0.4, extraImages = []) {
  const parts = [
    { inlineData: { mimeType: mime, data: b64 } },
    ...extraImages.map(img => ({ inlineData: { mimeType: img.mime, data: img.b64 } })),
    { text: prompt },
  ];
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: "user", parts }],
    config: { responseModalities: ["TEXT", "IMAGE"], temperature, candidateCount: 1 },
  });

  const resParts = response.candidates?.[0]?.content?.parts || [];
  const imgPart = resParts.filter(p => p.inlineData).at(-1);
  const textParts = resParts.filter(p => p.text).map(p => p.text);

  if (!imgPart) {
    console.warn("[SnapAtlas] No image in Gemini response:", textParts);
    return { canvas: null, receivedMime: null, receivedB64: null, textParts };
  }

  const { mimeType: receivedMime, data: receivedB64 } = imgPart.inlineData;
  const canvas = await new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const out = document.createElement("canvas");
      // Store at the native resolution Gemini returned — never downscale here.
      // Callers that need a specific size (e.g. aiSeamlessRunner) handle their
      // own resize; the pipeline passthrough scales on-the-fly when outputW/H changes.
      out.width = img.naturalWidth; out.height = img.naturalHeight;
      out.getContext("2d").drawImage(img, 0, 0);
      res(out);
    };
    img.src = `data:${receivedMime};base64,${receivedB64}`;
  });
  return { canvas, receivedMime, receivedB64, textParts };
}

/** @deprecated @param {Region} r @returns {Promise<HTMLCanvasElement>} */
async function cropFallback(r) {
  const [x1, y1, x2, y2] = r.box;
  const fc = document.createElement("canvas");
  fc.width = r.outputW;
  fc.height = r.outputH;
  fc.getContext("2d").drawImage(
    state.image,
    x1 * state.image.width,
    y1 * state.image.height,
    (x2 - x1) * state.image.width,
    (y2 - y1) * state.image.height,
    0,
    0,
    r.outputW,
    r.outputH,
  );
  return fc;
}

// ── Delight prepass ───────────────────────────────────────────────────────
// Retinex-style blur-division: divides each pixel by the local illumination
// envelope (large Gaussian ≈ 3× box-blur passes) then restores the global
// mean brightness.  Only the low-frequency illumination is removed; all
// high-frequency material detail is preserved.
//
//   delit[p] = I[p] / blur(I)[p]  ×  mean(blur(I))
//   result   = lerp(I[p], delit[p], strength)
//
// strength: 0–1.  blurFraction: blur radius as fraction of min(W,H), default 0.18.
/**
 * @param {HTMLCanvasElement} src
 * @param {number} strength - [0,1]
 * @param {number} [blurFraction]
 * @returns {HTMLCanvasElement}
 */
function _delightCanvas(src, strength, blurFraction) {
  if (!(strength > 0)) return src;
  blurFraction = blurFraction || 0.18;

  const W = src.width,
    H = src.height,
    N = W * H;
  const T = src.getContext("2d").getImageData(0, 0, W, H).data;

  // ── Single-channel luminance (perceptual weights) ─────────────────────
  // Blurring one channel instead of three saves 2/3 of the compute time.
  // The illumination envelope is achromatic, so luminance is the right signal.
  const L = new Float32Array(N); // ping buffer
  const Lb = new Float32Array(N); // pong buffer  → final blur result
  const tmp = new Float32Array(N); // scratch for vertical pass
  for (let i = 0; i < N; i++)
    L[i] =
      (T[i * 4] * 0.2126 + T[i * 4 + 1] * 0.7152 + T[i * 4 + 2] * 0.0722) / 255;

  // In-place separable box-blur (clamp-to-edge), reads `src`, writes `dst`.
  // `tmp` is the shared scratch; no allocations inside.
  const blurR = Math.max(8, Math.round(Math.min(W, H) * blurFraction));
  const blurInv = 1 / (2 * blurR + 1);
  function boxBlur(src, dst) {
    // Horizontal pass: src → tmp
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let s = 0;
      for (let k = -blurR; k <= blurR; k++)
        s += src[row + Math.max(0, Math.min(W - 1, k))];
      tmp[row] = s * blurInv;
      for (let x = 1; x < W; x++) {
        s +=
          src[row + Math.min(W - 1, x + blurR)] -
          src[row + Math.max(0, x - blurR - 1)];
        tmp[row + x] = s * blurInv;
      }
    }
    // Vertical pass: tmp → dst
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -blurR; k <= blurR; k++)
        s += tmp[Math.max(0, Math.min(H - 1, k)) * W + x];
      dst[x] = s * blurInv;
      for (let y = 1; y < H; y++) {
        s +=
          tmp[Math.min(H - 1, y + blurR) * W + x] -
          tmp[Math.max(0, y - blurR - 1) * W + x];
        dst[y * W + x] = s * blurInv;
      }
    }
  }

  // Three passes (ping-pong L↔Lb) ≈ Gaussian; no extra allocations
  boxBlur(L, Lb);
  boxBlur(Lb, L);
  boxBlur(L, Lb);
  // Lb now holds the 3-pass blurred luminance (illumination envelope)

  // Mean of blur (to restore overall brightness after division)
  let meanL = 0;
  for (let i = 0; i < N; i++) meanL += Lb[i];
  meanL /= N;

  // ── Per-pixel correction ──────────────────────────────────────────────
  // scale = meanL / Lb[p]:  > 1 in dark zones (lift), < 1 in bright zones (lower)
  // blend = lerp(1, scale, strength): strength=0 → identity, 1 → full Retinex
  // Applied uniformly to R, G, B → no hue shift.
  const eps = 1e-4;
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const outCtx = out.getContext("2d");
  const img = outCtx.createImageData(W, H);
  const D = img.data;

  for (let i = 0; i < N; i++) {
    const scale = meanL / (Lb[i] + eps);
    const blend = 1 + strength * (scale - 1);
    D[i * 4] = Math.max(0, Math.min(255, T[i * 4] * blend + 0.5)) | 0;
    D[i * 4 + 1] = Math.max(0, Math.min(255, T[i * 4 + 1] * blend + 0.5)) | 0;
    D[i * 4 + 2] = Math.max(0, Math.min(255, T[i * 4 + 2] * blend + 0.5)) | 0;
    D[i * 4 + 3] = 255;
  }

  outCtx.putImageData(img, 0, 0);
  return out;
}
