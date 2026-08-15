# Custom SVG emit shapes for the FX workshop — design

**Date:** 2026-08-12
**Owner:** Mike (presentation)
**Branch:** `feat/fx-svg-emit-shape`

## Goal

Let an FX author upload an SVG in the workshop and use it as a particle **emit shape** — the region particles
spawn from — alongside the existing `point` / `ring` / `disc` / `box`. Particles are born either **along the
SVG's outline** or **filling its interior**, chosen per layer by a toggle.

This is distinct from the existing SVG-as-particle-**shape** upload (`Inspector.tsx` already accepts `.svg`/`.png`
and rasterizes it into the *texture each particle is drawn with*). Emit shape is *where* particles are born, not
*what they look like*.

## Core decision: bake a normalized point cloud into the def

On upload (and on outline↔fill toggle), the workshop samples the SVG into a set of spawn points normalized to a
unit box `[-1, 1]²` (aspect preserved, centered), and stores that array in the layer. At emit time the sampler
just picks a point from the array — **nothing parses SVG at runtime.**

Why baking rather than storing the SVG and sampling live:
- **It ships to prod.** The point array lives in the def JSON, which players receive. Uploaded `art:` textures
  are DEV-gated (`shapeLibrary.ts` `artModules()` returns `{}` outside DEV), so an emit shape that depended on a
  committed texture would silently not work for players. A baked point cloud has no such gate.
- **The sampler stays a pure, deterministic, testable function** (`emissionOffset`), consistent with how every
  other emit shape already works.

Cost: the def grows by the point array (~a few KB at the default density). A density control + a hard cap keep
this bounded.

## Architecture

All new code is in `packages/ui/src/fx/**` (presentation). No engine/content/core changes.

1. **`emitShape: 'svg'`** joins the `EmitShape` union in `packages/ui/src/fx/motion.ts`. The layer's emission
   params gain:
   - `emitPoints?: [number, number][]` — the baked, normalized ([-1, 1]) spawn points.
   - `emitFill?: boolean` — false = outline, true = fill. Metadata for the UI + re-bake; the sampler only reads
     `emitPoints` (the bake already encoded the mode).
2. **Sampler** — `emissionOffset` (motion.ts) gets an `'svg'` case: `const pt = emitPoints[Math.floor(randA * N)]`,
   then `ox = pt.x * emitRadius * squashX + offsetX`, `oy = pt.y * emitRadius * squashY + offsetY` — identical
   post-processing to the other shapes, so an SVG emit area ovals/translates exactly like a disc. Empty/missing
   `emitPoints` (or `N === 0`) → behaves as `point` (the anchor). Pure; `randA` indexes the cloud (uses only the
   first random, like `ring`; `randB` unused for `svg`).
3. **Baker** — a new module `packages/ui/src/fx/svgEmit.ts` exporting
   `svgToEmitPoints(svgText: string, opts: { fill: boolean; count: number }): [number, number][]`:
   - **Outline:** parse the SVG, walk each `<path>` (and primitive shapes converted to paths) by arc length via
     `SVGPathElement.getTotalLength()` / `getPointAtLength()`, distributing `count` samples across paths in
     proportion to their length.
   - **Fill:** rasterize the SVG to an offscreen canvas (draw an `<img>` of the SVG data URL), read the alpha
     channel, and take `count` samples at pixels whose alpha exceeds a threshold (rejection sampling against the
     mask, seeded so a given SVG+count is reproducible).
   - Both: map from the SVG's `viewBox` (or intrinsic size) into `[-1, 1]²`, aspect-preserved and centered.
   - Runs in the browser (DOM/canvas), only in the workshop at bake time. A malformed SVG or a zero-area result
     yields `[]` (→ the sampler's point fallback) with a surfaced inline error, never a throw.
4. **Workshop UI** (`packages/ui/src/fx/ui/Inspector.tsx`) — when a layer's emit shape is `svg`:
   - an **Upload SVG** button (`accept=".svg,image/svg+xml"`),
   - an **outline / fill** toggle (`emitFill`),
   - a **density** slider (the bake `count`).
   Uploading a file, or flipping the toggle / density, re-runs `svgToEmitPoints` and writes `emitPoints` back
   into the layer (the same `change()`/autosave path every other inspector control uses).

   **Raw-SVG persistence.** Only the baked `emitPoints` (+ `emitFill`, `emitShape`) persist to the committed
   def. But re-baking on a toggle/density change needs the original SVG text, and that must survive a page
   reload within an authoring session — so the raw SVG is stored in `localStorage` keyed by a per-layer/import
   slug, mirroring how `custom:` particle-shape imports keep their PNG bytes (`shapeLibrary.ts`). After a reload
   with the SVG still in session, toggle/density re-bake instantly; if the SVG is gone (new session, cleared
   storage), the controls prompt a re-upload rather than silently failing. The committed def never carries the
   SVG, only the points.

## Defaults & limits

- **Density default:** 400 points. **Slider range:** ~64–4000. Hard cap 4000 (keeps a def's size bounded).
- **Fill alpha threshold:** a fixed sensible value (e.g. alpha > 0.5) — not exposed initially (YAGNI).
- Normalization preserves the SVG's aspect ratio; `squashX`/`squashY` remain the way to deliberately reshape.

## Testing

- **Sampler (`emissionOffset` `'svg'` case)** — unit tests: a known `emitPoints` array + fixed `randA` lands on
  the expected scaled/squashed/offset position; empty array falls back to the anchor; the existing shapes are
  unchanged (bit-identical at their defaults).
- **Baker outline path** — unit-testable with a trivial SVG (e.g. a straight `<line>`/`<path>`): assert the
  sampled points lie on the segment and normalize into `[-1, 1]` with the right aspect. (The **fill** path needs
  a real canvas, so it is exercised via a light integration / manual workshop check rather than a pure unit
  test — noted, not hidden.)
- **Full gates:** `typecheck` + `lint` + full `npm test` + `build:web` green. (Run the FULL `npm test` — the
  `fx/directCalls.test.ts` guard lives outside `choreo/`.)

## Out of scope (YAGNI)

- No per-point weighting, no animated/morphing emit shapes, no multi-shape blends.
- No committed-asset store for the SVG itself — the baked points are the portable artifact; the raw SVG is only
  kept in session for re-baking during authoring.
- No exposed fill-threshold or normalization-fit options initially.
