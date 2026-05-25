# 🗺️ Roadmap

Ideas and planned features for SnapAtlas. No timeline commitments - this is a direction, not a schedule.

---

## 🧩 Pipeline & Processing

### Per-block masks

Optional mask layer on each pipeline block. White = full effect, black = skip, grey = partial blend.

Main use case: mask the AI Seamless block to exclude windows, logos, or structural details from the tiling pass while keeping them in the final tile. Masks stored as greyscale canvases, persist with the session.

### AI "Add Detail" block

New block that uses a generative model to add fine surface detail (pores in concrete, wood grain, fabric weave) without changing overall shading or colour. Different from the seamless pass -- targets sub-pixel detail, not tiling.

Strength slider to blend between original and detailed output. Runs after retinex/seamless so it operates on a flat albedo.

### Global atlas pipeline

Post-processing blocks that run on the composited atlas after all per-region pipelines. Unify the look of tiles from different photos.

Candidate blocks: colour grade, stylise (cel-shading, palette reduction), noise/grain, final sharpness. Per-region outputs stay intact so re-running one region does not re-run the global pass.

---

## 🔧 Workflow

### Undo / Redo

Full history for region edits: adding, deleting, moving, and resizing regions, as well as pipeline changes. Ctrl+Z / Ctrl+Y (or Cmd on Mac) to step through the stack. History is per-session and does not persist across reloads.

### Region variant improvements

Variants currently inherit the parent's full pipeline with no way to diverge mid-way. Each block in a variant should have an "inherit from parent" toggle. Turning it off reveals the block's own controls. Variant rebuilds from the last inherited step instead of always starting from the parent's final output.

This makes variants useful for generating alternatives (clean/worn, day/night, summer/winter) from one base region without duplicating work.

### Manual atlas packing

The packer sorts by area. Users sometimes want a specific layout -- keeping related tiles adjacent, matching an existing UV layout, or just tidiness.

Make tiles draggable in the Packing tab. Reorder list in the side panel with drag handles. "Lock position" pin per tile lets the algorithm fill around fixed placements. Show wasted-space feedback when manual ordering conflicts with tight packing.

### Multiple atlases

One atlas per project is limiting for complex scenes. Each project should hold multiple named atlases with their own size, format, and region subsets. Export produces a zip with one file per atlas and a unified UV map JSON.

---

## 👁️ Preview & Measurement

### 3D PBR preview with lighting

Real-time 3D preview that applies the atlas to a simple mesh with configurable lighting. See how the texture reads in context before export.

Mesh presets: plane, cube, cylinder, sphere, wall-with-trim. IBL with a few built-in HDRIs (interior, overcast, studio, night). Directional light controls for raking-light tests. Builds on the existing cube preview.

### Real-world scale calibration

Draw a calibration line on the photo ("this brick course is 200 mm") to set a pixels-per-millimetre ratio. Output dimensions become physically driven: enter "200 mm x 200 mm" instead of "512 x 512".

This gives texel density display in the preview, automatic consistency across regions from different photos, and a to-scale grid overlay in the atlas view.

---

## ✨ Generation

### Procedural edge wear & dust

Generate trim-sheet edge elements: chipped corners, surface wear, ambient dust, contact dirt. Essential for Hotspot textures.

Pick a tile, choose an edge type (corner chip, wear band, ground dust), set intensity and material response. SnapAtlas synthesises a matching trim strip at the same output resolution. Edge maps export as atlas entries or alpha overlays.
