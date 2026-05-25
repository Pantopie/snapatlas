# SnapAtlas - Coding Recommendations

## Dependencies

- Keep it zero in the browser. Dev dependencies should have a clear reason.

## Code style

- Functions and plain objects over classes and `this`.
- Pipeline blocks as data (`BLOCK_DEFS`), runners in `BLOCK_RUNNERS`.
- Public functions (like `export.js`) stay pure - no DOM, no `state`. Internal modules can touch `state`.
- Early returns and guard clauses keep nesting shallow (ideally under 3 levels).

## JSDoc

- `@param` and `@returns` on every function. Types as `@typedef` at the top of each module.
- No `.ts` files. TypeScript works through JSDoc (`tsconfig.json` has `noEmit: true`).
- Runtime-only fields prefixed with `_` (like `_cache`, `_dirty`).

## Memory & garbage collection

- `Float32Array`, `Uint8ClampedArray`, `Uint32Array` for pixel data over regular arrays or objects.
- Reuse buffers (ping-pong pattern, see `_delightCanvas` in `ai.js`).
- Pipeline blocks memoize with `_cache`/`_dirty`. Async caches survive invalidation, CPU caches are cleared.
- Avoid allocating canvases in hot loops. Keep loop-invariant variables outside the loop body.

## Canvas & image processing

- Canvas 2D is the default. WebGL and OffscreenCanvas can be useful.
- Source images are read-only. Copy before writing.
- Straight alpha, not pre-multiplied.

## Module structure

- One file per concern. Load order in `build.ts` (`ORDER` array).
- No circular dependencies -- reference only globals from modules loaded before yours.
- No barrel files.

## UI

- Query DOM elements once at module scope with `getElementById`, store in local constants.
- Event listeners at module scope, not wrapped in init calls. No frameworks.
- Render functions (`renderCanvas`, `renderInspector`, etc.) read state and write DOM. Full re-render, no diffing.
- Each panel owns its canvas. Canvas renders are called cross-module when other panels invalidate them.
- Internal UI state (drag, pan, hover) lives in module-level `let` variables.

## Styling

- One component = one CSS block, flat selectors, max 2 levels deep.
- Use `:root` tokens for colors, spacing, fonts, radius, z-index (`--s*`, `--fs*`, `--r*`, `--z*`, `--dur*`, `--ease*`).
- No utility classes. Components own their styling.
- Animation: enter is instant (0ms), leave uses standard easing. Movement uses `--ease-physical`.

## Naming

| Pattern       | Where                                 |
| ------------- | ------------------------------------- |
| `camelCase`   | Functions, variables                  |
| `PascalCase`  | JSDoc `@typedef` names                |
| `UPPER_SNAKE` | Module-level constants                |
| `_prefix`     | Internal helpers, runtime-only fields |

## Pipeline blocks

- `isAsync` blocks need `ctx.ai` to run. Without one they act as passthroughs.
- `hasConfigure` blocks can open a config modal.
- `hidden` blocks live in `BLOCK_DEFS` but skip the add-block UI.
- Parent to variant invalidation goes through `invalidateCacheFrom(v, 0)`.
