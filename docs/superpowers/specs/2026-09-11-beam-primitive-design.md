# Beam FX Primitive — Design Spec

**Date:** 2026-09-11
**Status:** Design, pending owner review → implementation plan (superpowers:writing-plans)
**Owner:** Mike (presentation)
**Branch/worktree:** `feat/beam-primitive` @ `.claude/worktrees/beam` (off `origin/main` `5332b5ad`)

## Goal

A new mesh FX primitive, **`beam`** — a clean, sustained beam of energy that reaches from a source to a
target, holds, then fades. It is the **ordered counterpart to `lightning`'s chaos**: rays, heals, drains,
buff-links, channelled connections. Fully authorable in the FX workbench with the complete filter lab, exactly
like lightning and ribbon.

## Why (gap analysis)

The primitive palette today covers *chaotic* source→target (`lightning`), *motion trails* (`ribbon`),
*outward rings* (`shockwave`), and *particles* (`burst`/`emitter`/`smoke`), plus `react` (the card itself
moves) and `screen` (shake/flash/sound). There is **no clean, ordered source→target connection** — the thing
every beam/ray/drain/heal-link needs. Beam fills that hole.

## Non-goals (YAGNI)

- **No `radiate` mode** (lightning owns the burst-of-arms look; a beam radiating is meaningless). A beam is one
  line between two points.
- **No branching.** A beam does not fork.
- **No retract-on-release.** Release is a fade, not a shrink-back (matches lightning).
- **No bespoke impact burst at the far end** — the core→tip colour gradient already hot-ends the beam at the
  target, and the filter-lab bloom does the rest. A separate impact primitive can be layered in a def if ever
  wanted.

## Architecture

**Clone `lightning`'s proven architecture, swap the geometry and shader.** Same four load-bearing pieces:

1. **Two-point anchoring**, identical contract to lightning: the instance implements `setHead(x, y)` (the head
   fallback) and `setAim(sx, sy, tx, ty)` (source + target, container-local, staged only when both ends are on
   screen). The existing `driveLayerHeads`/`anchors.ts` path already feeds these — **no choreography changes**.
   Re-read every frame so the beam tracks two moving bodies (a live tether).
2. **Phase clock**: a private `clockMs`/`castStartMs` accumulated from `dtMs`, gated into
   `travelMs` → `dwellMs` → `releaseMs` (the exact shape of `LightningInstance.update`). `travelMs === 0`
   means "appear full-length immediately" (the "hold" behaviour), so **no `mode` enum is needed**.
3. **Pooled shader** via `acquireShader(BEAM_SHADER_KEY, makeBeamShader, writeAllUniforms)` +
   `releaseShader` in `destroy()`; `prewarmBeamShaders` / `linkBeamShaderOn` exported and wired into both
   prewarm step lists (main pool + slot canvases), mirroring lightning.
4. **Filter lab + transform**: `new FilterStack(ctx.container, FILTERS)` and `new ContainerTransform(...)`,
   `.frame(p, prog, dt)` each update — so bloom/blur/rgbSplit/godray/transform all apply. Bloom is again where
   the luminous magic comes from.

### What is SIMPLER than lightning

The beam has **no branches and no per-strike regeneration**, so:

- The travel-reveal coordinate is just the **along-fraction = `uv.u`** (0 at source → 1 at target). There is no
  separate `aBorn` vertex attribute (lightning needed it only because branch births ≠ `u`). The shader gates on
  `vUV.x` directly: `if (vUV.x > uReach) discard;`.
- The mesh is a **single quad strip**, not up to 60 polylines. Geometry is tiny (~tens of verts).
- No `flicker`-driven re-strike loop. (A *subtle brightness breathing* is kept as an optional `flicker` knob
  defaulting to 0 — steady — reusing lightning's envelope idea, but it never rebuilds geometry.)

## Components

### `packages/ui/src/fx/beamGeometry.ts` (pure, unit-tested — mirrors `lightningGeometry.ts`)

Pure maths, no renderer. A straight strip from `A=(ax,ay)` to `B=(bx,by)` at `width` px, subdivided into
`segments` spans along its length so an optional `waver` can bow it.

```ts
export interface BeamShape {
  width?: number;      // full glow-envelope width in px (shader carves the bright core from the middle). Default 18.
  segments?: number;   // length subdivisions (enables waver). Default 24.
  waver?: number;      // 0 = dead straight; >0 = subtle animated sinusoidal bow, as a fraction of width. Default 0.12.
  waverFreq?: number;  // sine cycles along the beam. Default 2.5.
}
export const BEAM_MAX_SEGMENTS = 48;
export const BEAM_MAX_VERTS = (BEAM_MAX_SEGMENTS + 1) * 2;   // 2 verts (left/right of spine) per along-point
export const BEAM_MAX_INDICES = BEAM_MAX_SEGMENTS * 6;       // triangle list, 6 per quad

export interface BeamMeshBuffers { position: Float32Array; uv: Float32Array; index: Uint32Array; }
export function makeBeamBuffers(): BeamMeshBuffers;

/**
 * Lay the beam strip into `buf`. `phase` (seconds) animates the waver; `A==B` (zero length) writes a
 * degenerate/empty strip safely. Returns live vertex/index counts; the index tail is zero-filled (degenerate).
 * uv.u = along-fraction 0(source)→1(target); uv.v = 0 on one edge, 1 on the other.
 */
export function writeBeamMesh(
  buf: BeamMeshBuffers, ax: number, ay: number, bx: number, by: number,
  shape: BeamShape, phase: number,
): { vertexCount: number; indexCount: number };
```

Waver: each interior along-point is displaced along the beam's unit normal by
`sin(u * waverFreq * TAU + phase) * waver * width * taperToEnds(u)`, where `taperToEnds` is a window that is 0
at both ends and peaks mid-beam (so the beam always meets its anchors). Straight (`waver===0`) ⇒ all spine
points colinear on A→B. `phase` is supplied by the instance as `clockMs/1000 * waverSpeed` — so `waverSpeed`
is a primitive param that animates the bow, while `waver`/`waverFreq`/`segments`/`width` are the static
`BeamShape` fields the geometry reads directly.

### `packages/ui/src/fx/primitives/beam.ts` (the primitive — mirrors `lightning.ts`)

`BeamInstance implements FxInstance<BeamParams>` with the lightning structure: pooled shader, `MeshGeometry`
with `position`+`uv` buffers (no third attribute), `FilterStack` + `ContainerTransform`, `setHead`/`setAim`,
`update(dtMs)`, `setParams`, `isComplete`, `destroy`. Rebuilds the strip from current anchors each frame **only
when `waver > 0`** (it's cheap — tens of verts); a straight beam builds once on anchor change. Exposes
`beamPrimitive`, `registerPrimitive(beamPrimitive)`, and `prewarmBeamShaders`/`linkBeamShaderOn`.

**Shader (fragment)** draws, premultiplied + additive:
- `across = abs(vUV.y * 2 - 1)` → bright **core** (`uCoreFrac`) + soft **glow** halo (`uGlow`).
- **reveal**: `if (vUV.x > uReach) discard;` — beam grows source→target over `travelMs`.
- **colour**: `mix(uCore, uTip, vUV.x)` — core colour at source, tip colour at target (natural hot target end).
- **flow**: a scrolling brightness band, `0.5 + 0.5*sin((vUV.x*uFlowFreq - uTime*uFlowSpeed*uFlowDir)*TAU)`,
  mixed in by `uFlowAmt`. `uFlowDir` ±1 sets direction (toward target = cast/heal; toward source = drain).
- **end-caps**: soft fade near `vUV.x` 0 and 1 by `uEndSoft` so ends aren't hard rectangles.
- `uAlpha` (lifecycle fade × optional flicker breathing) × `uGain`.

### Params (`SPECS satisfies FxParamSpecs`) + locked defaults (prismatic/neutral)

| param | group | kind | default |
|---|---|---|---|
| `travelMs` | Lifecycle | slider 0–1500 | **200** |
| `dwellMs` | Lifecycle | slider 0–2000 | **520** |
| `releaseMs` | Lifecycle | slider 0–1000 | **200** |
| `width` | Shape | slider 2–80 px | **18** |
| `coreWidth` | Shape | slider 0.4–12 px | **3** |
| `segments` | Shape | slider 2–48 | **24** |
| `waver` | Shape | slider 0–1 | **0.12** |
| `waverFreq` | Shape | slider 0–8 | **2.5** |
| `waverSpeed` | Shape | slider 0–6 | **1.2** |
| `flowAmt` | Flow | slider 0–1 | **0.35** |
| `flowSpeed` | Flow | slider 0–6 | **1.4** |
| `flowFreq` | Flow | slider 0–20 | **6** |
| `flowDir` | Flow | enum `['target','source'] as const` | **'target'** |
| `glowStrength` | Glow & colour | slider 0–1 | **0.7** |
| `gain` | Glow & colour | slider 0.2–3 | **1** |
| `coreColor` | Glow & colour | color | **0xf2f6ff** (near-white) |
| `tipColor` | Glow & colour | color | **0xdce8ff** (understated) |
| `glowColor` | Glow & colour | color | **0x9fb8ff** (soft blue-white) |
| `flicker` | Glow & colour | slider 0–20 | **0** (steady) |
| `blendMode` | Glow & colour | enum `FX_BLEND_MODES` | **'add'** |

Then spread `...BLUR_PARAM_SPECS, ...filterLabSpecs(FILTERS), ...TRANSFORM_PARAM_SPECS` (full filter lab). The
defaults are deliberately understated so every card tints the beam from the workbench.

### `packages/ui/src/fx/defs/beam.json`

Starter def, all defaults (mirror `lightning.json`'s shape — a single `beam` layer, `params: {}`).

## Files & wiring (exact touch points)

**Create:**
- `packages/ui/src/fx/beamGeometry.ts` + `packages/ui/src/fx/beamGeometry.test.ts`
- `packages/ui/src/fx/primitives/beam.ts` + `packages/ui/src/fx/primitives/beam.test.ts`
- `packages/ui/src/fx/defs/beam.json`

**Modify (registration + the tests a new primitive always breaks):**
- `packages/ui/src/fx/primitives/index.ts` — `import './beam';`, `import { linkBeamShaderOn, prewarmBeamShaders } from './beam';`, add `() => prewarmBeamShaders(renderer)` to `fxPrewarmSteps` and `keep(linkBeamShaderOn)` to `slotPrewarmSteps`.
- `packages/ui/src/fx/primitives/prewarm.test.ts` — `steps.length` assertions **5 → 6** (currently two `toBe(5)` at lines 43, 63), and add `vi.mock('./beam', () => ({ prewarmBeamShaders: vi.fn(), linkBeamShaderOn: vi.fn(() => ({ id: 'beam' })) }));`.
- `packages/ui/src/fx/prodPlayback.test.ts` — add `'beam'` to the sorted `listPrimitives()` id list (first, alphabetically).
- `packages/ui/src/fx/ui/copy.ts` — add `beam: { label: 'Beam', blurb: 'A clean sustained beam from source to target — grows in, holds, fades. Rays, heals, drains, links, channels.' }`.

**No changes** to `bindings.json`, the simulator, or `choreo/*` — this spec ships the *primitive and its
workbench authorability only*. Wiring a specific card to a beam def is a separate, later change (the way
lightning shipped before Paragon was bound to it).

## Testing

- **`beamGeometry.test.ts`**: vertex count `(segments+1)*2`; `uv.u` monotonic 0→1; `uv.v` alternates 0/1;
  endpoints sit exactly on A and B (offset only perpendicular by `±width/2`); `waver===0` ⇒ spine colinear;
  `waver>0` ⇒ interior displaced but endpoints pinned; `A==B` safe (no NaNs, empty/degenerate); index tail
  zero-filled; never writes past `BEAM_MAX_*`.
- **`beam.test.ts`** (mirrors `lightning.test.ts`, runtime-construct needs WebGL so it's specs-only): `id` is
  `'beam'`; `validateSpecs(beamPrimitive.params) === []`; defaults match the table above (`toMatchObject`);
  filter-lab/blur/transform knobs present (`params.blur`, `params.fxSpin`, `params.bloomOn` defined — cast to
  `Record<string, unknown>` since filter-lab specs are runtime-generated).
- **Gates:** `npm run typecheck && npm run lint && npm test && npm run build:web` all green before PR.

## Performance

Single tiny strip (≤ `(48+1)*2 = 98` verts). Per-frame rebuild happens **only when `waver>0`** and is
negligible at this size; a straight beam builds once per anchor change. Pooled shader (no per-fire compile;
prewarmed). Additive mesh, no paint-property animation, no per-frame layout reads. Consistent with the
"snappy at all times" rule.

## Open decisions (resolved)

- **Archetype:** prismatic/neutral defaults (owner pick) — understated, tinted per card.
- **Lifecycle:** travel→dwell→release, `travelMs=0` = hold (no `mode` enum).
- **Flow direction:** a knob (`flowDir`), default toward target.
- **Waver:** included at a low default (the beam's "organic energy" analog of lightning's chaos); cheap given
  the subdivided strip.

## Reviewer notes

This is intentionally a faithful structural clone of `lightning.ts` / `lightningGeometry.ts`. A reviewer should
check the clone *diverges only where stated* (no `aBorn`, no branches/flicker-regen, reveal on `vUV.x`) and
that the five registration-breakage touch points above are all updated together.
