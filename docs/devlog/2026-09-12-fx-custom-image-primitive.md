# 2026-09-12 — FX `custom` primitive: an imported PNG/SVG as a first-class effect layer

**What shipped.** A new FX primitive, `custom` (picker label "Custom"): import a PNG or SVG in the workbench and
drive it like any other layer — size, pivot, offset, rotation, flip, aim-at-target, alpha over life, tint,
blend mode, **the whole filter lab**, and **the transform envelope** (scale / spin / drift). The image is drawn
with its **true colours** at display resolution (fitted within 1024 px on the longest side, never upscaled).
Design: `docs/superpowers/specs/2026-09-12-fx-custom-image-primitive-design.md`. Built autonomously on the
owner's instruction to continue to a testable product; the visual needs an in-workbench eyeball.

**Why a new pipeline, not the existing `shape` import.** `shapeLibrary.ts` bakes imports to a 128 px square
silhouette (alpha = mask) and `particleMaterial.ts` discards or cel-quantises the art's RGB — right for a
particle, wrong for a picture. The owner chose to leave that pipeline untouched, so `imageLibrary.ts` is a
separate, simpler registry with its own id namespace (`image:<slug>`) and folder (`defs/images/`).

**The non-obvious decisions.**

- **Bytes go to disk on import.** A new dev route `/__fx/image` (a third `WriteKind` in `fxDefsPlugin.ts`)
  writes `defs/images/<slug>.png` the moment the file is picked. There is no local-only tier and therefore
  **no promote-on-Save step** — a 1024 px PNG can't live in localStorage's ~5 MB budget, and the def should
  reference the file it will ship with. Committed images bundle via `import.meta.glob`, exactly like art:
  **only commit an image meant to ship.**
- **No reload on import — and why that needed a measurement.** The first cut invalidated the glob's module
  without sending `full-reload`; the end-to-end smoke showed **Vite reloads on its own** for any new
  glob-matched file (`[vite] page reload …/images/smoke-test-red.png`), and that reload can race the
  Inspector's `onChange` and lose the import from the layer. So the plugin now hides `defs/images/` from
  the watcher (`server.watch.ignored`). The running page resolves a fresh import from an in-session
  overlay; imported *slugs* persist in localStorage so the picker lists them after a reload; a DEV-only
  `import.meta.url`-relative URL serves the bytes until a restart refreshes the glob. Art keeps its reload —
  it is written by Save, which reloads anyway.
- **A PNG that already fits is sent byte-for-byte** — a canvas re-encode can inflate a well-optimised file
  toward the 4 MB cap. Only resized images and SVGs go through a canvas (an `<img>` rasterises SVG natively).
- **New `image` param kind** (`params.ts`): like `shape`, the value is a runtime-registry id; unlike `shape`,
  `''` is a legal value and default ("no image picked"), because a fresh layer has nothing chosen.
- **Lazy sprite.** `getImageTexture` is synchronous and `null` until the decode lands; the primitive builds
  its `Sprite` on the first frame the texture is ready and `isComplete` is clocked, so a missing image never
  hangs a one-shot fire.
- **`blendMode` defaults to `normal`** (every other primitive defaults to `add`) — a full-colour picture
  usually shouldn't be additive.

## Phase 2 (2026-09-13) — sheet, scatter, mesh, cross-layer roles

Same branch, same day+1, again autonomous to a testable product. Everything composes: a scattered, tilted,
sprite-sheet-animated image with bloom on it is one layer.

- **Sprite sheet** (grid PNG): a frame is `new Texture({ source, frame })` sharing the sheet's source. The
  question that decided the design — "do Pixi meshes honour a sub-frame?" — was answered by reading
  `BatchableMesh`: it applies `texture.textureMatrix` when not simple. So one texture swap serves Sprites and
  all three meshes; verified in-browser incl. `PerspectiveMesh`. `overLife` mode plays the strip exactly once
  per play whatever the fps — the right default for a one-shot impact sheet.
- **Scatter** rolls off the layer's seed in a fixed draw order (`rollScatter`), so a seeded def scatters
  identically every fire and a knob change re-rolls the SAME numbers into a new shape. Copies stagger in order
  and each runs its own clock; a one-shot waits for the last one.
- **Mesh modes**: `plane` wobbles by writing `geometry.positions` from a kept base copy then
  `getBuffer('aPosition').update()`; `rope` mutates its point objects in place (MeshRope auto-rebuilds every
  render); `perspective` calls `setCorners` only when the projected corners change (it rebuilds geometry).
  All knobs are `enabledWhen` their mode.
- **Roles need a cross-layer seam that did not exist**: `FxContext.effectRoot` — the player now passes its own
  container (the parent of every layer). `displace` hangs a `DisplacementFilter` driven by a hidden map sprite
  off the root; `mask` sets the root's alpha mask. Both verified against a real sibling layer (green square:
  masked inside/outside/inverted correctly; displaced edge moved) and both fully removed on destroy.
- **Known limitation, measured not assumed:** `DisplacementFilter` samples the map sprite's whole texture and
  ignores a sub-frame, so a sheet used as a displacement map is the full sheet, not the current frame. Fix is
  to bake frames into standalone sources; deferred.
- **Probe lesson that cost time:** importing a browser probe with `?v=<timestamp>` splits its direct imports
  into fresh module instances (an empty registry). Import the plain URL on a fresh page.

**Deferred:** per-frame displacement maps; a delete-image route; vector (non-rasterised) SVG.
