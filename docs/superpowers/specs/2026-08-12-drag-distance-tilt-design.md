# Card drag tilt — distance/motion-driven directional dive

**Date:** 2026-08-12
**Area:** `packages/ui` (presentation) — the floating `.dragcard` in Recruit
**Status:** Design approved, pre-plan

## Problem

The dragged card's 3D lean does not honestly track the direction it is travelling. Two faults, both
in the tilt math (the position/follow logic is fine):

1. **Non-uniform axes.** The tilt is driven by two independent knobs, `hLean` (0.5) and `vLean` (−0.2).
   East/west leans hard; north/south barely tips. The lean direction therefore misrepresents the
   travel direction, worst on the vertical and diagonal.
2. **Weak, short-lived signal.** Tilt is computed from the *lag-gap* (`live.x − m.rx`, cursor minus
   smoothed render position) — the same signal that drives the follow. With `follow` now at 0.95
   (near-instant catch-up) that gap is tiny and collapses the instant the cursor eases, so the dive is
   faint and twitchy. Position and tilt are fighting over one shrinking signal.

**Desired feel (owner):** the card should tilt as though diving in the direction of travel — the
**leading edge dips toward the board** — *uniformly* on every axis (N/S/E/W and diagonal), scaled by
how far/fast the card is moving, and it should **settle flat when the cursor stops**.

## Reference

PixiJS `mesh_perspective_3d` example (owner-supplied). Its mapping:

```js
angleY = -(x - mesh.x) / 10;   // horizontal offset → rotate about Y
angleX = -(y - mesh.y) / 10;   // vertical offset   → rotate about X
```

The load-bearing detail: **both axes use the same divisor (`/10`) — one uniform gain** — and the result
is a true 3D perspective rotation (near edge grows, far edge shrinks). Our `.dragcard` already produces
that foreshortening via its CSS `perspective() rotateX rotateY` transform, so **no PixiJS is involved** —
we only change how the two rotation angles are computed.

The one adaptation: the demo pins the mesh at screen-center and moves the *pointer*, so its signal is
`pointer − center`. Our card rides *under* the cursor, so that offset is ≈0. The travel-direction
equivalent is to substitute the card's own **movement** for `pointer − center`.

## Design

### 1. Signal — smoothed travel velocity

Extend `dragMotionRef` with a smoothed velocity `{ vx, vy }`. Each rAF frame, after the render position
`m.rx/m.ry` updates, take the per-frame delta and fold it into an exponential moving average:

```
inst_vx = m.rx - prevRx
inst_vy = m.ry - prevRy
vx += (inst_vx - vx) * tiltEase      // frame-rate-normalised, same pattern as the follow catch-up
vy += (inst_vy - vy) * tiltEase
```

The EMA (not the raw per-frame delta) gives a stable direction, a natural build as you start moving, and
a smooth ease back to zero — i.e. **flat** — when the cursor stops. This is the "distance travelled"
signal: its magnitude is the card's speed.

### 2. Tilt — uniform directional dive

Replace the current `tiltPerPx · hLean · gx` / `tiltPerPx · vLean · gy` with the reference's single-gain
mapping, fed by the smoothed velocity (screen y is down+):

```
rotX = clamp(-tiltGain * vy, ±tiltMax)   // vertical travel   → pitch about X
rotY = clamp(+tiltGain * vx, ±tiltMax)   // horizontal travel → roll about Y
```

One `tiltGain` for both axes (kills the N/S weakness). Signs confirmed by eye against the owner's sketch:
the **leading edge dives toward the board** — drag **south → bottom two corners pinch**, **east → right
corners pinch**, north/west the reverse.

### 2b. Decouple position from tilt (the slide fix — now load-bearing)

At the locked `perspective 525` and up to `45°` of tilt, the current single-transform approach
(`perspective(P) translate(bigOffset) rotateX rotateY` in one `dragTransform` call) **slides the card
sideways**: the large position translate sits *inside* the perspective, so any tilt's depth is multiplied by
that offset and shoves the card off-axis instead of pitching cleanly. It only looked acceptable before
because the old tilt was tiny (`tiltMax 20`) and perspective very gentle (`4000`).

Fix — split the floating card into two nested elements:

- **Outer `.dragcard`** (position): plain 2D `translate` + `zoom` lift, and it carries the `perspective`
  **CSS property** (vanishing point = its own center). The existing follow / grab-anchor / recentre / zoom
  math is unchanged; it just no longer includes `perspective()`/`rotate` in its transform.
- **New inner `.dragtilt` wrapper** (tilt): `transform: rotateX(rotX) rotateY(rotY)` about `50% 50%`, so the
  dive is a clean symmetric pitch and the receding edge's corners genuinely pinch. Wraps `<Card>`.

The rAF writes the outer's translate/zoom and the inner's rotation each frame (two `style.transform`
writes, both compositor-only). Snap-back / magnet-slide keep the existing `dragTransform` on the outer
(they rotate 0°, so no slide) — untouched. This nested split is also the "revisit how position is rendered"
the owner asked for: **position outside, tilt inside.**

### 3. Tuner (`dragFeel.ts` + `DragTuner.tsx`)

- **Remove** from the Tilt group: `tiltPerPx`, `hLean`, `vLean`.
- **Add:** `tiltGain` (deg per px/frame — the reference's `1/10`) and `tiltEase` (velocity EMA rate: how
  fast the dive builds and settles).
- **Keep:** `tiltMax`, `perspective`, `staticRotate`.
- **Bump** `DRAG_DEFAULTS_VERSION` (required whenever `DEFAULTS` changes; `dragFeel.test.ts` enforces it),
  and update the removed/added keys across `DragFeel`, `DEFAULTS`, `DRAG_RANGES`, `DRAG_DESC`, and the
  `DragTuner` `SPECS`/`ORDER` so the panel and the persisted shape stay in sync.

### 3b. Locked values (dialed by eye in the preview, owner-approved 2026-08-12)

| key | value | note |
|---|---|---|
| `tiltGain` | **3.0** | deg per px/frame; with the cap below, any real motion saturates → decisive full dive |
| `tiltEase` | **1.0** | no smoothing — tilt = raw per-frame travel; snaps flat the instant the cursor stops |
| `tiltMax` | **45** | the dive ceiling |
| `perspective` | **525** | strong foreshortening / deep corner pinch (was 4000) |

`follow` stays **0.95** (unchanged position feel). The owner's preview used `follow 1`, but with the tilt
saturated at these gains the 0.95-vs-1 difference is imperceptible, and leaving it honors the "position
untouched" scope. `scale` stays **1.21** (existing hold-size knob — explicitly out of scope). `tiltEase`
is kept as a live knob (default 1) so a softer settle can be dialed later without a code change.

### 4. Build path — cheap preview first

Before touching Recruit, stand up a throwaway single-file page (in scratchpad, served over a standalone
local http server) with just a draggable card element and this exact math wired to two live sliders
(`tiltGain`, `tiltEase`) plus `tiltMax`/`perspective`. Use it to lock the **signs** ("leading edge toward
the board" on all four directions) and dial the **gain/ease** by eye. Only once it feels right, port the
*identical* math into the `.dragcard` rAF in `Recruit.tsx`. This avoids churning the real drag code while
hunting for the look.

## Scope

**In:** the tilt signal + mapping in the `.dragcard` rAF (`Recruit.tsx`), the new `.dragtilt` nested wrapper
(§2b) and the two-target transform write, the `dragFeel.ts` config surface, and the `DragTuner.tsx` panel;
the throwaway preview.

**Out:** the follow / grab-anchor / recentre / hand-grab / zoom **math** (unchanged — it just moves onto the
outer element), the drag shadow, snap/magnet-slide, and every non-tilt drag knob. No touch-path change (the
touch near-1 follow override stays; the tilt reads the same smoothed velocity regardless of input). Note the
DOM *structure* changes (the nested wrapper) even though the position math does not.

## Verification

- Preview page: drag N/S/E/W + diagonals; the leading edge dips toward the board every time, equally
  strong per direction; holding still settles the card flat within a few frames.
- In-app (owner, at 1× — never inferred): same check on real shop/board/hand drags; N/S now dives as
  strongly as E/W; no jitter; flat at rest.
- Gates: `npm run typecheck && npm run lint && npm test && npm run build:web` green (worktree gets its own
  `npm install` first so gates resolve `@game/*` against this branch).
- Perf: pure compositor transform per frame, no new layout reads — no regression expected; confirm no
  per-frame `getBoundingClientRect` was introduced.
