# End-of-Turn Charge Glyph — replacing the burning rope

**Date:** 2026-07-15 · **Branch:** `feat/eot-glyph-timer` · **Owner:** Mike (presentation)

## Goal

Replace the burning-rope turn-timer *visual* with a board-native "charging glyph" effect.
The turn timer's **mechanics are unchanged** — the clock still counts down `turnSeconds`, the ring
still displays it, `timeUp` still fires. We are swapping only the rope's presentation, and (phase 2,
later) the 5-second countdown SFX.

## The effect

Over the final `min(20, turnSeconds)` seconds, white-hot blue energy charges the arcane glyph etched
into the board (`testboard2.webp`): energy builds **from both edges inward** along the horizontal
midline conduit, converges on the central sigil, and the sigil fills **last**, completing exactly as
the clock hits 0. End-state matches the provided mockup: fully-lit sigil + full horizontal beam +
soft halo.

- **Both-sides-in**, not left-to-right (explicit owner call).
- Charge fraction is `elapsed / window` — same drive as the rope's flame, so it lands on 0 precisely.
- Reads in peripheral vision during a busy shop; concentrates the eye on board center.

## Assets

- `apps/web/public/fx/turn-glyph.svg` — the **fully-charged silhouette** (one white filled compound
  path: central sigil + horizontal conduit, symmetric about center, viewBox 1385×544, midline y≈274).
  Used as a CSS `mask-image`.
- `apps/web/public/testboard2.webp` — the live board; the SVG aligns to its etched gold mandala.
- Reference mockup (charged) + board screenshot — provided in-session (owner's Downloads).

## Approach — CSS mask + Pixi motes (mirrors ward/reborn)

**Layer stack:**
1. **Charge-fill (CSS):** blue gradient (deep-blue → cyan → white-hot core) with `turn-glyph.svg` as
   `mask-image` — shows only through the glyph shape.
2. **Both-sides reveal (CSS mask, turn-clock driven):** a symmetric horizontal wipe — lit at both
   edges, a central gap that closes inward as `--charge` goes 0→1. Sigil blooms in over the final
   stretch, core lights at 0.
3. **Static glow:** a *static* drop-shadow halo whose **opacity** ramps (never an animated
   filter/shadow — perf north star).
4. **Pixi (movement):** white-hot motes streaming toward center, a flare riding each converging
   front, a bloom pop when the sigil completes.

**Drive:** a small component subscribing to `useTurnSeconds`, a rAF interpolating the sub-second
fraction, writing a single `--charge` (0→1) to a ref each frame — compositor-only, card tree
untouched (clock lives in `turnClock.ts`'s external store). Trigger window = `min(20, turnSeconds)`,
same as the rope.

**Positioning:** reuse the rope's anchor — `--rope-y` (measured board midline) + a board-width scale
+ x/y nudge knobs — since the conduit lives on the identical line. Rope code is removed; this drops
into the same slot in the warband zone.

## Workflow

1. **Standalone tuner first** — `apps/web/public/fx/turn-glyph-preview.html`: the board image + the
   SVG + color/timing/alignment sliders + "Copy CSS", mirroring `ward-css-preview.html` /
   `reborn-css-preview.html`. Lock the look here cheaply (avoids the "rejected 3 full builds" trap).
2. **Wire into Recruit** — port the locked CSS + a `ChargeGlyph` component into the warband zone,
   driven by the turn clock; add the Pixi motes to `pixiFx.ts`.
3. **Remove the rope** — delete `BurnRope`, `.rope*` CSS + keyframes, `ROPE_SECONDS`, the Layout Lab
   "Rope" group; keep `--rope-y` (now feeds the glyph) or rename.
4. **Verify perf** — confirm the per-frame reveal repaint is cheap on a heavy late-game board (prod
   build); offload to Pixi if it measures badly.

## Deferred (phase 2)

- Replace the 5-second countdown **SFX** (`sfx.ts`) with new charge/impact audio + the owner's
  vision for that.

## Out of scope

Timer mechanics, the ring display, combat, any board/card changes.

## Acceptance

- In the final ~20s, energy charges from both sides into the sigil, completing at 0s, matching the
  mockup; no rope anywhere.
- Snappy at all times on a full board (perf north star) — no per-frame paint-property loops.
- Look approved in the tuner before it ships.
