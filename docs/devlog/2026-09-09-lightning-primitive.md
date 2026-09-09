# 2026-09-09 — A `lightning` FX primitive (net-new, mesh-based)

Owner didn't like the ribbon's `crackle`/`wander` travel styles for lightning — a ribbon is a smooth extruded
band and can't branch, so no spine-displacement slider gets to a real bolt. We workshopped the look in a
throwaway canvas reference ("Lightning Lab"), locked a param set, and built it as a proper primitive separate
from the trail. Mesh-first, per owner call.

## Shape

- **`lightningGeometry.ts`** (pure, 16 tests) — two stages, the same split as `ribbonGeometry.ts`:
  - `buildStrike(shape, ax, ay, bx, by, seed)` → polylines. Midpoint displacement + a Laplacian relax
    (smoothing, endpoints pinned) + recursive branches, seeded (mulberry32) and capped at `LIGHTNING_MAX_BOLTS`
    (60). Deterministic, so a replay reproduces the exact bolt. `travel` (source→target) and `radiate` (N arms
    from the source) modes.
  - `writeLightningMesh(buf, bolts, taper)` → one triangle-list mesh: 2 verts per point offset along the
    smoothed normal, writing `aPosition`, `aUV` (u = along for the colour gradient, v = across for the soft
    core) and `aBorn` (the travel-reach gate). Fixed-size buffers, degenerate index tail — the same
    never-reallocate discipline as the ribbon.

- **`primitives/lightning.ts`** — the Pixi primitive, modelled on `ribbon.ts`:
  - Pooled shader (`fx-lightning`): a white→violet gradient core with a soft glow halo, premultiplied +
    `blendMode: 'add'`. Travel growth is a single `uReach` uniform gating on `aBorn` — **no per-frame geometry
    rebuild**; the mesh is rewritten only on a flicker re-strike.
  - Lifecycle owned by the instance: `travelMs` (grow, `uReach` eased in) → `dwellMs` (full) → `releaseMs`
    (fade), looping under a continuous preview, one-shot under a Fire. Two-point anchoring via `setAim`
    (source→target, in container space); `setHead` is the radiate origin / fallback.
  - Full filter lab: `...BLUR_PARAM_SPECS, ...filterLabSpecs(FILTERS), ...TRANSFORM_PARAM_SPECS` + a
    `FilterStack`/`ContainerTransform` over the container — so bloom (where the real luminous glow comes from,
    the canvas reference could only fake it), godray, colour, distortion, etc. all apply.
  - Custom third vertex attribute `aBorn` added via `geometry.addAttribute` over its own `Buffer` (MeshGeometry
    only wires `aPosition`/`aUV`).

- Registered in `primitives/index.ts` (self-register + prewarm/link steps); appears in the workbench picker
  automatically. Committed `defs/lightning.json` (all-defaults = the locked look) as a starting point.

## Defaults = the workshop lock

`chaos 0.2 · smooth 0.47 · detail 5 · taper 0.22 · branchChance 0.1 · branchSpread 12 · branchDepth 2 · width
28 · coreWidth 1.8 · glowStrength 0.8 · gain 1 · core #eaf3ff → tip #c58cff · glow #5a63ff · flicker 9 · decay
0.72 · travel 300 · dwell 620 · release 180`. A `lightning.test.ts` pins these so a changed default is a
deliberate, reviewed edit.

## Not yet / follow-ups

- **No player-facing change**: nothing binds a lightning def yet, so there's no patch note — it's an authoring
  capability. Owner authors/binds a def in the workbench.
- **Sparkle motes** (a reference knob the owner tuned to 0.76) are NOT in this primitive — they'd be a second
  point-mesh or a companion particle layer. Deferred as a clean follow-up.
- The mesh + shader were authored without a live GL context (headless can't render), so the **visual** wants an
  in-workbench eyeball; the logic, specs, geometry and gates are all covered/green. Crackle/wander on the
  ribbon are left as-is until the owner is happy with the bolt, then a separate PR can retire them.
