# FX `custom` primitive — an imported image as a first-class effect layer (Phase 1)

**Status:** designed + built autonomously 2026-09-12 on owner instruction ("continue without my guidance until we
have a testable product"). Owner decisions taken beforehand: general-purpose (size the cap for the biggest
case) and an **isolated** image pipeline that leaves the particle-silhouette import untouched.

## Goal

Import a PNG or SVG and drive it in the FX workbench like any other layer: position, size, pivot, rotation,
flip, alpha over life, tint, blend mode, the **whole filter lab**, and the **transform envelope**
(scale/spin/drift). The image renders with its **true colours** at display resolution.

## What already existed (and is reused, not copied)

- The shared per-primitive infrastructure: `filterLabSpecs(FILTERS)` + `FilterStack`, `TRANSFORM_PARAM_SPECS`
  + `ContainerTransform`, `BLUR_PARAM_SPECS`, `FX_BLEND_MODES`, `curve.ts`, the player's anchor/`setHead`/
  `setAim` hooks and one-shot/loop lifecycle.
- The dev-only write plugin (`apps/web/fxDefsPlugin.ts`) with its slug/traversal/PNG guards and the
  "glob is a transform-time expansion" watcher pattern.

## Why not the existing `shape` import

`shapeLibrary.ts` bakes imports to a **128 px square** with alpha treated as a silhouette, and
`particleMaterial.ts` discards or cel-quantises the art's RGB. Both are right for particles and wrong for a
displayed image. The owner chose isolation over generalising that pipeline, so nothing in it changes.

## Design

### Storage: bytes go to disk on import (`defs/images/<slug>.png`)

- New dev route **`POST /__fx/image`** (a third `WriteKind`), same guards as art, written to `defs/images/`.
  The existing 4 MB cap already fits a 1024 px PNG.
- One id namespace: **`image:<slug>`**. There is no local-only tier and therefore **no promote-on-Save
  step** — a def references the committed file from the moment it is imported. (Rationale: a 1024 px PNG
  cannot live in localStorage's ~5 MB budget, and IndexedDB would be more machinery than the feature.)
- Shipping: `import.meta.glob('./defs/images/*.png', { eager, ?url })` bundles committed images exactly
  like `defs/art/`. **Only commit an image meant to ship** — same policy as art.
- Staleness (the glob is frozen at transform time) — and a measured surprise: a new glob-matched file makes
  **Vite itself force a page reload**, which for an import (written mid-edit) would yank the page away and
  could race the Inspector's state update. So the plugin **hides `defs/images/` from Vite's watcher**
  (`server.watch.ignored`) and three belts cover the frozen glob instead:
  1. an in-session **overlay** (`registerSavedImage`) decodes the just-imported data URL immediately;
  2. imported **slugs** (never bytes) persist in localStorage so the picker still lists them after a reload;
  3. a DEV-only `import.meta.url`-relative fallback URL resolves any slug the frozen glob can't — the file
     is still *served*, only the watcher is silenced. A dev-server restart lets the glob catch up.
- Import normalisation: decode via `<img>` (rasterises SVG natively), fit within **1024 px** on the longest
  side (aspect preserved, **never upscaled**); a PNG that already fits is sent **byte-for-byte** (no
  re-encode), otherwise re-encoded from a canvas. Slug from the filename via `defStore.slugify`.

### The primitive: `primitives/custom.ts` (id `custom`, picker label "Custom")

A plain `Sprite` — no particle shader — so colours are exact. Built lazily on the first frame the texture is
decoded (sync `getImageTexture` returns `null` until then), so a def is always constructible.

Params (own): `image` (new `image` param kind; `''` = none), `size` (px, longest side, at reference
scale — the player's card-scale multiplier does the rest), `durationMs`, `pivotX/Y` (0..1 → anchor),
`offsetX/Y` (px from the anchor point), `rotation` (deg), `aimMode` (`fixed` | `sourceToTarget` — the latter
adds the moment's source→target angle via `setAim`, so an arrow drawn pointing +x points at the victim),
`flipX/Y`, `alpha` × `alphaCurve` (over life), `tint` + `tintColor`, `blendMode` (default **normal** — a
full-colour image usually shouldn't be additive). Spread: blur, the filter lab, the transform envelope.

Placement: the layer container's children draw at absolute screen coords and `ContainerTransform` pivots
about the head, so the sprite sits at `head + offset` and the envelope scales/spins it about the anchor.

Lifecycle: `prog = clock / durationMs`, wrapping in the continuous preview; `isComplete` = one-shot and
elapsed ≥ duration (so a missing/undecoded image never hangs a fire).

### New `image` param kind (`params.ts`)

Mirrors `shape`: the value is an id string whose validity is a runtime question. Differs in one way: `''`
is a legal value/default meaning "no image", because a fresh layer has nothing picked yet.

### Workbench (`Inspector.tsx`)

`ImageField`: a picker of `image:` ids (committed + this session's imports), a thumbnail of the selection,
and an **Import PNG / SVG…** button. Reuses the `fxwb-shape*` classes — no `styles.css` change.

## Phase 2 (built 2026-09-13, same branch) — all composable with each other and with Phase 1

Owner decisions taken beforehand: grid sheet (one PNG), all three mesh modes, and displacement/mask acting on
the effect's **other layers**. Pure maths in `fx/customGeometry.ts` (tested headless); the primitive keeps a
list of `Copy { wrap, node }` and rebuilds it only on a STRUCTURAL param change.

- **Sprite sheet** — `sheetCols × sheetRows`, `sheetFrames` (0 = all), `sheetFps`, `sheetMode`
  (loop · once · pingpong · **overLife** = the whole strip exactly once per play), `sheetStart`. A frame is a
  sub-`Texture` sharing the sheet's source (`Texture({ source, frame })`); Pixi's mesh batcher applies the
  texture matrix for sub-frames, so the same swap works on Sprites and every mesh (verified incl.
  `PerspectiveMesh`). `Size` refers to ONE frame.
- **Count + scatter** — `count` copies rolled from the layer's seed (`makeRng(ctx.seed)` in a fixed draw order,
  so the same seed always yields the same field); `scatterRadius` + `scatterShape` (disc / square), rotation /
  size / alpha jitter, `staggerMs` in order. Each copy runs its own clock (own Duration, own sheet playback);
  a one-shot completes at `duration + (count-1)·stagger`. Defaults are the exact identity roll.
- **Render mode** — `sprite` · `plane` (`MeshPlane`; vertices displaced each frame by a travelling sine —
  amount / waves / speed / axis) · `rope` (`MeshRope` along an arc of sagitta `bendAmount` + a sine wave;
  points mutated in place, the rope auto-rebuilds) · `perspective` (`PerspectiveMesh`; corners from a pinhole
  projection of the tilted quad — `setCorners` only when they change, since it rebuilds geometry). Every
  mode's knobs are `enabledWhen` its mode so the Inspector lights only the relevant ones.
- **Role** — `draw` · `displace` · `mask`, via a new **`FxContext.effectRoot`** (the player's own container,
  parent of every layer — per-effect, since `playDef`/the workbench hand each player a fresh container).
  `displace`: a hidden (`renderable = false`) map sprite on the root + a `DisplacementFilter` appended to
  `root.filters` (padding = max scale). `mask`: the sprite on the root + `root.setMask({ mask, inverse })`.
  Both are removed in `destroy()`; without a root (spawned outside a player) they no-op. **Known
  limitation:** Pixi's `DisplacementFilter` samples the sprite's WHOLE texture, ignoring a sub-frame — so a
  multi-frame sheet used as a displacement map samples the full sheet, not the current frame (the mask role
  renders the sprite normally and does honour the frame). Fix later by baking each frame into its own source.

## Phase 3 (built 2026-09-13, same branch) — anti-stale variation + aimed art

Owner's two questions answered as features. All per-copy variation is rolled from the layer's seed
(`rollVariation`, always seven draws per copy in a fixed order so toggling one feature never reshuffles the
others), which means in-game every fire varies and a workbench-locked seed repeats.

- **Anti-stale, from ONE sheet:** `sheetVariantRows` (each row a separate take, one picked per copy — Frame
  count then limits per row), `randomStart`, `randomFlipX/Y`, `fpsJitter`, `hueJitter` (a per-copy
  `ColorMatrixFilter.hue` — a real hue rotation, opt-in: one filter pass per copy), `randomReverse`.
  Rotation/Size jitter already varied a lone image per fire (a Count-1 copy still gets its roll).
- **Aimed art:** `aimStretch` scales the LENGTH to the source→target distance (`setAim` now keeps the
  distance; Size becomes thickness); `aimUpright` mirrors across the image's own axis when the aim points
  left (`aimsLeft` = cos < 0) so a side-view image never renders upside-down; render mode **`slice`** (a
  `NineSliceSprite` with zero top/bottom borders = a horizontal 3-slice, `sliceCap` px per end) so only the
  body stretches and the caps stay crisp. Stretch also applies to `rope` (the arc spans the distance) and
  `sprite`/`plane` (whole-frame x-scale). Verified in-browser: upright flips the left-facing beam's top back
  up, a stretched slice spans exactly source→target.

## Still out of scope

A delete-image route (unused files are pruned by hand / git); per-frame displacement maps (above); vector
(non-rasterised) SVG.

## Tests

`imageLibrary.test.ts` (pure helpers: ids, `fitWithin`), `custom.test.ts` (spec validity, lifecycle,
aim), `fxDefsPlugin.test.ts` (route + image write), plus the three enumerations every new primitive must
join: `prodPlayback.test.ts`, `copy.ts`/`copy.test.ts`, `prewarm.test.ts`.
