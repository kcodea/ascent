# FX Workbench Overhaul — Design Spec

**Date:** 2026-08-25
**Owner:** Mike (presentation seam)
**Status:** Design approved in brainstorm (visual companion); ready for implementation planning.

## 1. Problem

The FX workbench grew unwieldy after a large capability expansion (31 pixi-filters, a transform
envelope, rate/spin curves, a screen-cue layer — all merged in #1202). Every one of these adds a
group to the per-primitive parameter rail, so a single primitive now exposes ~35 collapsible groups
plus ~140 knobs. The owner flagged all four pain axes at once:

- **The parameter rail** — a wall of ~35 groups; no search, no way to see only what matters.
- **Overall layout** — panels (layers, inspector, timeline, preview, library) cramped and fighting.
- **Building/composing** — the multi-layer + timeline authoring workflow feels clunky.
- **Finding & focusing** — no search/filter, no "only what I changed", no drag-first editing.

Additional owner asks surfaced during design:

- Previews should NOT run on the live game board; the author wants a **composable stage**.
- A **colour system**: HSB picker, labelled palette stops, gradients, a deep preset library shown by colour.
- **Blend modes** exposed wherever compositing happens.
- **Drag-to-edit** as the default interaction everywhere.

## 2. Goals & non-goals

**Goals**

- A calm, **design-app** layout (Figma-like) with a **timeline** backbone borrowed from After Effects.
- A Properties panel that shows **only the selected layer**, collapsed and searchable, with an "only
  what I changed" view — so ~35 groups never appear as a wall unless summoned.
- A **Stage Setter**: a custom, composable preview canvas (a "mini-board composer") that can stage
  every anchoring/targeting mechanic the game uses today.
- A unified **colour system**: HSB single-colour picker, labelled palette, gradient editor, preset library.
- **Blend modes** surfaced per layer and per compositing filter.
- **Drag-first** direct manipulation across layers, values, curves, timeline spans, and stage actors.

**Non-goals**

- No change to the FX runtime/engine behaviour, the deterministic sim, or how defs play in combat.
  This is a **presentation/tooling** overhaul: it edits the same `FxDef` / param data the runtime
  already consumes. New param KINDS (colour, gradient) are additive to `params.ts` and coerce to the
  existing numeric/array payloads the shaders read.
- No new render primitives (owner deferred lightning/beam/sprite).
- Not a rewrite: **build on** the existing systems — `Inspector.tsx`, `Workbench.tsx`, `scenarios.ts`,
  `anchors.ts`, `reactTargets.ts`, `palettes.ts`, `filterStack.ts`/`filterRegistry.ts`, and the
  `params.ts` spec system. Refactor the two oversized files (`Workbench.tsx` ~2.8k lines,
  `Inspector.tsx` ~0.8k) into focused units as we touch them, but no unrelated refactoring.

## 3. Layout — "design app + timeline lane"

Chosen direction: **B (Figma design-app) with A (After Effects) timeline blended in.**

```
┌──────────────────────────────────────────────────────────┐
│ top: ▸Fire · transport · ⌘K jump · slot(over/under) · fps ✕ │
├──────────┬───────────────────────────────┬───────────────┤
│  LAYERS  │           STAGE                │  PROPERTIES   │
│  (list,  │   (Stage Setter canvas —       │  (selected    │
│   drag   │    big; the backbone)          │   layer only) │
│   reorder)                                │               │
├──────────┴───────────────────────────────┴───────────────┤
│  TIMELINE — one lane per layer × time (collapsible)        │
└──────────────────────────────────────────────────────────┘
```

- **Layers (left):** the composition's layers as a draggable list (reorder by grip). Each row shows
  its primitive, name, and blend-mode badge. `+ add layer` → pick a primitive.
- **Stage (centre):** the Stage Setter canvas (§4) — the visual backbone.
- **Properties (right):** the selected layer's params (§5).
- **Timeline (bottom):** a real lane per layer with draggable `at`/`life` spans and a playhead;
  **collapsible** to a single header when tuning. Selecting a span selects the layer (drives Properties).
- **Top bar:** Fire/transport, a **⌘K command bar** (jump to any layer/param/filter), the `over/under`
  slot toggle, fps, close.

Selecting a layer (in the list OR the timeline OR by clicking its actor on the stage) is the single
selection that drives the Properties panel.

## 4. Stage Setter — the mini-board composer

Replaces `realBoard` as the default authoring canvas. A composable scene the author arranges; effects
anchor to *it* instead of the live game DOM. Backed by the existing `FxScenario`/`stageAll`/`anchors`
system — a custom stage is effectively an author-defined scenario whose anchors come from placed actors.

**The audit** (code-verified against `anchors.ts`, `scenarios.ts`, `reactTargets.ts`, `bindings.ts`,
`choreo/score.ts`, `useCombatReplay.ts`) confirmed the stage must be a **mini-board composer**, not just
draggable Source/Target points, to cover everything:

- **Two facing rows of cards, arbitrary N** — required for `reach` (`self`/`neighbours`/`allies`/`board`)
  and order (`ripple`/`cascade`/`volley`); `board` reach needs the opposing row too.
- **Mock cards are REAL card elements** (real `Card.tsx` DOM: `.badge/.plate/.value`), with dummy stats —
  because the `react` primitive animates that DOM and rolls the stat number; rectangles can't stage it.
- **Roles per actor** — tag a placed unit as `source` / `target` / `struck` / `self-buffed` / `buffed`
  so fan-out modes (`struck`/`damaged`/`selfBuffed`/`buffed`) preview correctly.
- **Head motion** — the existing scenario motions (one-way arrive-and-stay, bounce, pinned-cursor,
  stationary) applied over the placed points; plus per-layer `travelMs`/`bow`.
- **Camera / full-screen mode** — a distinct "whole-screen" concept (viewport-centre framing) for
  `camera`-anchored defs (e.g. `shop-buff-aura`), not a draggable point.
- **Scoped cue preview** — the global `screen` cue (shake/flash/sound) previewed **scoped to the stage**,
  not the whole editor.
- **Backdrops** — reuse `backdrop.ts`; a backdrop may be a solid, a swatch, or a gradient (§5.3).
- **Saved named stages** — "Melee clash", "Ranged bolt", "Self/aura", "Full row"… one-click preset
  canvases; the last-used stage is remembered **per effect**.

**Residue (kept on `realBoard` / a scripted combat):** three event-timing-derived behaviours can be
*approximated* but not faithfully synthesised, so `realBoard` remains available as a final check for them:
`launchOnDeath` (Fel Spikes launching from a still-visible corpse rect on a held damage beat), the rally
source→target sparkle pairing, and live stat-roll/withhold. These are called out in the coverage matrix.

## 5. Colour system

A single, consistent colour toolkit reused wherever colour lives.

### 5.1 HSB single-colour picker

Three **horizontal** tuning bars — **Hue**, **Saturation**, **Brightness** — with a live swatch and
readout. New `params.ts` kind `color` (payload: a packed `0xRRGGBB` number, matching the shader/pixi
`ColorSource` inputs). Used by: flash colour, and every filter colour previously omitted because the
param system had no colour kind (Glow, Outline, Drop Shadow, Colour Overlay/Replace, Bevel).

### 5.2 Palette (labelled, four stops, rim → core)

The particle palette is an ordered ramp, **verified identical across primitives**: all primitives feed
the one shared `posterizePal(intensity, bands, pal[4])` (`shaderChunks.ts`) over a "distance-from-core"
field. Intensity 0 = the **outer edge** of the drawn shape, 1 = its **hot centre** — a particle's
edge→centre, a ribbon's width edge→centreline, a shockwave ring band's edge→centreline (shockwave
explicitly ports the ribbon cross-section into ring space).

Stops are **labelled** (geometry-agnostic): **Rim** (outer edge) → **Outer** → **Inner** → **Core**
(hot centre; also tints the **Glow** halo on primitives that have one). Click a stop → the §5.1 HSB
picker. The `palette` param keeps its existing 4-number payload; only its editor + labels change.

### 5.3 Gradient editor

A multi-stop gradient bar: drag stops to move, click the bar to add, drag a stop off to remove, click a
stop to recolour (§5.1); pick `linear`/`radial`/`conic` where the target supports it. Applies to:

- the **palette ramp** (four fixed stops → flexible add/move/recolour; still coerces to the 4-stop
  payload the shader reads, or a new N-stop payload if we extend it — **decide in planning**),
- stage **backdrops**,
- the **ColorGradient filter** — this editor IS the stops-array input it needed, so it comes **off the
  omitted-filter list** (omitted 5 → 4).

### 5.4 Preset palette library (shown by colour)

A deep, grouped gallery. Each preset renders as its **four stops as tiny squares** (rim→core) plus a
thin gradient bar — pick by what you'll see, name is a label. Click applies all four onto the labelled
stops. Seed set (~24), grouped, listed here for the build to seed into `palettes.ts`:

- **Fire:** Ember, Gold, Magma, Blood, Sunset, Amber
- **Cool:** Violet, Ice, Ocean, Mint, Arctic, Plasma
- **Energy:** Acid, Neon, Electric, Toxic, Radio, Spark
- **Nature/Special:** Forest, Poison, Earth, Ash, Void, Holy

(The existing 6 — violet, ember, mint, magenta, gold, acid — remain; the library is a superset.)

## 6. Blend modes

Surface the existing `FX_BLEND_MODES` (`normal`/`add`/`screen`/`multiply`/`overlay`) as a segmented
control **on each layer** (already a per-primitive `blendMode` param — just promoted into the layer
header) **and on each filter that composites** (pixi filters exposing a `blendMode`, e.g. Bloom/Glow).

## 7. Drag-first interaction

Direct manipulation is the default:

- **Reorder layers** — drag the grip in the Layers list (and mirrored on the timeline).
- **Scrub any number** — drag on a knob's value/label to change it (fine drag = fine step).
- **Curve points** — drag on the inline curve graph.
- **Timeline spans** — drag `at`/`life` handles.
- **Stage actors** — drag on the canvas to place source/target/cards; scroll to zoom.

## 8. Properties panel — the declutter

Selected-layer only. Three ways to cut noise, plus collapse-by-default:

- **Search** — a box that filters every knob across all groups to matching ones (flat results with
  group breadcrumbs). Backs the ⌘K jump too.
- **View chips: All / Essentials / Changed** — Essentials shows the ~6 params marked `essential` in the
  spec; Changed shows only params differing from their default (modified set).
- **Collapsed groups with count badges** — each group is one line with an "N changed" / "N on" badge.
  All 31 filters live under **one "Filters" master group** ("N on · 30"); opening it shows a toggle list
  where enabled filters float to the top and expand inline to amount + curve + knobs.
- **Modified affordance** — a modified knob shows a dot + accent; its group carries the count.
  **Double-click a label resets to default.**
- **Inline curve editors** for `curve` params.

This is a pure presentation reorganisation of the existing `FxParamSpec` data (`group`, `essential`,
`enabledWhen`, `kind`) — no spec data changes except adding the `color`/`gradient` kinds (§5).

## 9. Component decomposition (build units)

Each a focused unit with a clear boundary:

1. **`WorkbenchShell`** — the 4-region layout + top bar + ⌘K command bar (splits `Workbench.tsx`).
2. **`LayersPanel`** — draggable layer list + add/remove.
3. **`Timeline`** — lanes, spans, playhead, collapse (extends existing `Timeline.tsx`).
4. **`Inspector` v2** — search + view chips + collapsed groups + Filters master group (rework of
   `Inspector.tsx`); consumes `FxParamSpec` unchanged.
5. **Colour kit** — `ColorPickerHSB`, `GradientEditor`, `PalettePicker` (labelled stops),
   `PresetPaletteLibrary`; plus `params.ts` `color`/`gradient` kinds + coercion.
6. **`StageSetter`** — canvas, draggable actors (real mock `Card` elements), two-row board, roles,
   head-motion picker, camera/full-screen mode, scoped cue preview, saved stages (a custom
   `FxScenario` producer over placed anchors).
7. **`dragEdit`** — shared drag utilities (value scrub, reorder, curve drag, span drag, actor drag).

## 10. Coverage guarantee

The Stage Setter + Properties + Colour system together cover **every** anchor, head-motion, reach,
react part, fan-out, filter, blend, colour and cue in the game today (per the §4 audit), with the three
event-timing behaviours (§4 residue) keeping the `realBoard` path as a final check.

## 11. Open questions for planning

1. **Palette payload:** keep the fixed 4-stop shader payload (gradient editor constrained to 4 stops on
   palettes), or extend the shader to N stops? (Leaning: keep 4 for palettes; N-stop gradients only for
   the ColorGradient filter + backdrops, which accept arrays.)
2. **Phasing:** this is large — likely built in phases (shell/layout → Inspector declutter → colour kit
   → Stage Setter → drag polish), each independently shippable. The implementation plan sequences them.
3. **`react` mock cards:** confirm the mock `Card` renders with the exact `.badge.atk > .plate/.value`
   structure `partElements` queries (so part-targeting + stat-roll preview honestly).
