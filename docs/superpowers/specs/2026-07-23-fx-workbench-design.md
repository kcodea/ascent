# FX Workbench — design

**Date:** 2026-07-23
**Status:** approved (owner, 2026-07-23) — ready for an implementation plan
**Owner:** Mike (presentation seam)

---

## 1. Why

Every new visual effect currently costs a bespoke tuner panel. The repo has **34 `*Tuner.tsx` panels and
~30 `*Config.ts` files — 7,724 lines**, the large majority of it copy-paste. Adding one effect means
writing, by hand:

1. `xxxConfig.ts` — a `Config` interface, a `DEFAULTS` object, a `RANGES` table, a `KEYS` array, and a
   localStorage get/set/reset triple.
2. `XxxTuner.tsx` — a `LABELS` map, a slider loop, copy/reset buttons, draggable-panel wiring.
3. A registration entry in `DevMenu.tsx`.

Those are **four parallel lists per effect that nothing forces to agree**, and they have already drifted.
`TrailTuner.tsx` derives its rows from `TRAIL_KEYS` (11 keys, generated from `DEFAULTS`) but its `LABELS`
map was hand-written with 9, so the Trail tuner renders two sliders with blank labels:

```
packages/ui/src/TrailTuner.tsx(11,7): error TS2739: Type '{ emitSpacing: string; ... }' is missing the
  following properties from type 'Record<keyof TrailConfig, string>': count, width
```

That error is real and currently unreported, because `packages/ui` is excluded from the root `typecheck`
and CI never runs `typecheck:web` (`build:web` is a Vite/esbuild build and does not typecheck). Fixing
that gap and the 50 errors it hides is **tracked separately** and is not part of this spec.

Beyond boilerplate, today's tuners share two hard limits: you must **play the game to the moment** an
effect fires in order to see it, and you can only ever see **one variant at a time**.

### Success criteria

- A new effect that reuses existing primitives requires **no new panel code** — only a def.
- The set of tunable parameters and the UI that edits them come from **one source**, so the `TrailTuner`
  class of drift cannot recur.
- Any effect can be staged, looped, **scrubbed to a frame**, and **A/B compared** without playing to it.
- The effect the owner tunes is byte-for-byte the effect that ships.
- No measurable frame-time regression versus today's hand-written FX.

## 2. Decisions taken

| # | Decision | Rationale |
|---|---|---|
| 1 | **New effects first; existing tuners migrate opportunistically** | No big-bang PR across 34 already-dialled effects. Old panels migrate when we're in them for other reasons. |
| 2 | **Mounts inside the real web app, not a standalone studio** | Effects tune against real cards, real frames, the real backdrop, at 1x. No hand-port step, and no grey-rectangle lie. |
| 3 | **Its own purpose-built UI shell** | The workbench is explicitly *not* constrained by in-game tuner conventions (`.sfxmix` draggable boxes). It is designed for usability on its own terms. |
| 4 | **Composition from primitives + a timeline** | Most new effect requests should be assembled and tuned, not coded. Exotic one-offs stay hand-written and register into the same system. |
| 5 | **Effects are data played by a runtime player** | Mirrors the engine's existing philosophy (cards are data + effect subscriptions, never bespoke classes). One code path — the tuned artifact is the shipped artifact. |

**Rejected:** a node graph (months of work rebuilding Unity's VFX Graph for a one-person pipeline);
codegen (every tweak becomes a rebuild, generated files rot when hand-edited — cf. the
`opponentPool.data.ts` "never hand-edit" trap, and the workbench could no longer round-trip a
hand-touched effect); dev-data/prod-baked hybrid (two code paths for one effect is how a dev↔prod
divergence sneaks back in — the exact class of bug fixed in `35796425`).

## 3. Architecture

Everything lives under `packages/ui/src/fx/`. Not a new package: it is pure presentation, sits inside one
ownership lane, and needs both the Pixi layer and the real card DOM. Extract later only if it earns it.

The layout below is the **eventual** shape; P1 builds only the ribbon primitive (see §7).

```
packages/ui/src/fx/
  primitives/     ribbon.ts, burst.ts, shockwave.ts, shaderQuad.ts, emitter.ts
  defs/           <name>.fx.ts — the effects themselves, as data
  player.ts       play(def, anchors) -> handle
  anchors.ts      resolve a named anchor to live screen space
  scenarios.ts    staged situations for authoring
  schema.ts       the FxPrimitive contract + zod def validation
  ui/             the workbench shell (dev-only)
```

### 3.1 Primitive

The single unit of rendering. One module, one object:

```ts
interface FxPrimitive<P> {
  id: string;                        // 'ribbon'
  schema: ZodSchema<P>;              // validation + defaults
  ui: UiHints<P>;                    // per-param: control kind, range, label, group
  spawn(ctx: FxContext, params: P): FxInstance;
}

interface FxInstance {
  update(dtMs: number): void;
  setParams(next: Partial<P>): void; // live editing without a respawn
  destroy(): void;
}
```

`schema` and `ui` are declared side by side in the same file and are the **only** description of a
primitive's parameters. The inspector panel is generated from `ui`; defaults and validation come from
`schema`. There is no second list to keep in sync — this is the structural fix for the drift in §1.

`UiHints` covers more than numbers: `slider`, `color`, `palette`, `enum`, `toggle`, `vector2`, `curve`.
Today every tuner control is a number slider, which is why colours are currently hard-coded constants.

### 3.2 Def

An effect is data. No expressions, no conditionals — this is deliberately not a language.

```ts
export const chainBolt: FxDef = {
  id: 'chain-bolt',
  duration: 600,
  layers: [
    { at: 0,   primitive: 'ribbon', anchor: 'travel', params: { /* ... */ } },
    { at: 180, primitive: 'burst',  anchor: 'target', params: { /* ... */ } },
  ],
};
```

`at` is milliseconds from effect start. `anchor` names where the layer attaches. Anything needing real
logic becomes a hand-written primitive registered into the same system, rather than a new def keyword.

### 3.3 Anchors

The bridge between a def and live screen space: `slot`, `card`, `unit`, `travel` (the path between two
units), `cursor`, `camera`. Anchors resolve per-play, and **measure the slot rather than a mid-flight
rect** — the bug class fixed in `1e566c21`, which the anchor layer should now make hard to reintroduce.

### 3.4 Player

`play(def, anchors, opts) -> { stop(), scrub(ms), setSpeed(n) }`. Instantiates each layer at its `at`
time, drives them off the existing Pixi ticker, and reuses the current `PixiFxLayer` canvas. One player
means one place to pool, optimise, and apply lag-smoothing.

`scrub(ms)` is what makes frame-accurate authoring possible: rebuild deterministic state at an arbitrary
time rather than waiting for the effect to reach it.

### 3.5 Scenario driver

Stages anchors so no effect requires playing to its moment: `twoUnits`, `lunge`, `chainOfFour`, `cursor`,
`singleSlot`, `wholeBoard`. Transport: play / loop / pause / scrub / step-frame / speed — with **1x
always the reference**, since that is how the game is actually played.

## 4. The workbench UI

Its own shell, dev-only, stripped from production exactly as `DevMenu` is today.

- **Left** — effect defs; primitive palette.
- **Centre** — the stage: real cards on the real backdrop. Transport bar beneath.
- **Right** — inspector: controls for the selected layer, generated from `ui` hints, grouped.
- **Bottom** — timeline: layers as bars, dragged to retime.
- **Pinned** — ms/frame and draw-call readout, always visible. Performance is the north star, so the cost
  of an effect is visible while authoring it rather than discovered later.

The two capabilities that make this a product rather than a panel generator: **scrub** (freeze frame 140
and adjust it) and **A/B compare** (two variants on the same beat, side by side).

**Saving** writes the def back into the repo through a small dev-only Vite middleware. Clipboard
round-trips are where tuned values get lost today.

## 5. Migration path

An existing `*Config.ts` registers a legacy adapter exposing its params as `ui` hints. Its panel is then
generated, and the hand-written `*Tuner.tsx` plus the `LABELS`/`RANGES`/`KEYS` triplication are deleted.
Effect code and `DEFAULTS` are untouched, so **no shipped value changes**. Done opportunistically, per
decision 1.

## 6. Testing and performance

- **Primitives** — unit tests for schema defaults and validation.
- **Defs** — golden tests: a def plus a fixed seed produces a stable instantiation.
- **Perf** — `npm run perf` before shipping; the pinned readout catches regressions during authoring. The
  player instantiates Pixi objects at spawn, not per frame, so the hot loop keeps the same shape as
  today's hand-written FX.
- **Prod cost** — the workbench and all `ui` hints are behind `import.meta.env.DEV` and tree-shaken out,
  so players pay nothing. Verified by checking the prod bundle after P1.

## 7. Phasing

Each phase is independently useful; work can stop at any boundary. **The implementation plan that follows
this spec covers P1 only** — P2–P4 get their own plans once P1 has proven the contract in practice.

- **P1 — Foundation.** `FxPrimitive` contract, schema→UI generator, player, the ribbon primitive ported
  from the sandbox prototype, minimal shell with transport, two scenarios. Ships the trail effect for real.
- **P2 — Composition.** Timeline, anchors, multi-layer defs, three or four more primitives (burst,
  shockwave, shaderQuad, emitter), save-to-file.
- **P3 — Product.** A/B compare, preset and palette library, perf HUD, golden tests.
- **P4 — Migration.** Legacy adapter; migrate tuners opportunistically.

## 8. Risks

| Risk | Mitigation |
|---|---|
| The def format creeps into an ad-hoc scripting language | Primitives stay few and concrete; no expressions or conditionals in defs; exotic behaviour is hand-written code. |
| The player's indirection costs frame time | Instantiate at spawn, not per frame; pinned perf readout; `npm run perf` gate before P1 ships. |
| The workbench leaks into the production bundle | `import.meta.env.DEV` guard; verify prod bundle size after P1. |
| Migration silently changes a dialled-in effect | Adapters change only the panel, never `DEFAULTS`; migrate opportunistically, one effect per PR. |
| A dev-only file-write endpoint touches the working tree | Dev middleware only, writes confined to `fx/defs/`, never enabled in a prod build. |

## 9. Prototype

A standalone prototype of the ribbon primitive — posterized cel-banded trail shader, shard layer, baked
haze, six palettes, six preview scenarios — was built on 2026-07-23 and validated in the browser. It is
the reference implementation for the P1 ribbon primitive.

Two findings from it worth carrying forward:

- The art style is **band quantisation** (`floor(d * bands)`), not soft additive particles. Verified
  numerically: pixels inside a trail collapse to a handful of discrete colours.
- A linear width falloff never lets the top band fire — only a ~3px centre line crosses the threshold. A
  **plateau profile** (`1 - smoothstep(plateau, 1, across)`) is required for the fat hot core the target
  art style has. This should be a parameter of the ribbon primitive, not a constant.
