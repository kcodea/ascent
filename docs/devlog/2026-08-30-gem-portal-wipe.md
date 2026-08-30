# Gem-portal wipe: radial covers, linear reveals, above-curtain FX

**Branch/PR:** `feat/gem-radial-wipe`

The combat curtain's geometry changed from the two-way L→R/R→L inset sweeps to a **hybrid** (owner asks
2026-08-29): every COVER is a `clip-path: circle()` blooming out of the End Turn / End Combat gem (origin +
farthest-corner radius measured once per cover, handed to CSS as `--wipe-cx/--wipe-cy/--wipe-r`), and every
REVEAL is a linear inset sweep (entry R→L, exit L→R). The state machine, holds and timings are unchanged.

Non-obvious bits a future session would re-derive:

- **circle() and inset() can't interpolate — and never have to.** The shape switch hides in the covered
  hold (`.full.settle`, transition:none: full circle → full inset, both cover everything) and in the empty
  parked states (zero circle ↔ zero-width sliver, both cover nothing; non-interpolable changes snap with no
  transition and fire no `transitionend`). The one wrinkle: the exit bloom must START from the zero circle,
  so `primeOut` parks it there before `coverOut` — and that beat was then stretched to `WIPE_CHARGE_MS`
  (260ms) to double as the exit's charge-up tell. The entry got a matching `chargeIn` state.
- **The frame hitch at the screen edge** (owner report) came from the glow ring being sized `2×radius`
  (~4400px): its full raster weight entered the viewport exactly as the ring reached the edge. Fix: the
  ring is a fixed 1000px texture scaled up by the compositor (`--wipe-front-scale`), plus `will-change`
  hints on curtain/fronts. Pattern worth remembering: never size a scaling glow at its final pixel size.
- **`wipeFx.ts`** is the dedicated ABOVE-curtain Pixi canvas (z255 — the main FX canvas at z110 is under
  the curtain by design, so seam FX need their own layer; this is the "future dedicated layer" the retired
  board-wipe def comment reserved). One `Application`, warmed at Recruit mount, ticker stopped + canvas
  hidden whenever no particles live. Effects: `charge` (inward spiral + flare), `bloom` (stardust wake +
  40% tangential wisps emitted along the seam — tracked by numerically replicating the curtain's
  `cubic-bezier(.4,0,.2,1)`), `inhale` (motes + oriented sparks streaming into the gem, played with the
  exit bloom). Runic flickers shipped and were cut same-day: their fast fade-ins read as animation blips.
- A decisive combat still skips the curtain entirely; `wipeFx.clear()` runs when the machine snaps to
  `idle` so no motes drift over the end screen.
