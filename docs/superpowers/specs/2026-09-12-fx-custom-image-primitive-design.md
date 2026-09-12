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

## Out of scope (later phases)

Sprite-sheet / frame animation; count + scatter; mesh deformation (`MeshRope`/`MeshPlane`/`PerspectiveMesh`);
using the image as a displacement map or mask; a delete-image route (unused files are pruned by hand / git).

## Tests

`imageLibrary.test.ts` (pure helpers: ids, `fitWithin`), `custom.test.ts` (spec validity, lifecycle,
aim), `fxDefsPlugin.test.ts` (route + image write), plus the three enumerations every new primitive must
join: `prodPlayback.test.ts`, `copy.ts`/`copy.test.ts`, `prewarm.test.ts`.
