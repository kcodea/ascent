# 2026-09-24: The combat/shop screen wipe covers ultrawide screens

Owner bug (verbatim): *"the screen wipes between combat/shop seem not built for 21:9 and stop/pause here and it's
janky. can you make sure the animation fully covers the ultrawide display as well?"* The screenshot was a 21:9
RETURNING TO SHOP frame with the bright ring parked around x≈300 and combat purple still showing at the far left.

## Root cause

The wipe has two parts (Recruit's wipe state machine + `.wipecurtain` / `.wipefront` in `styles.css`):

- the **curtain**, a `clip-path: circle()` bloom out of the End Turn / End Combat gem. Its radius
  (`--wipe-r`) was already the gem-to-farthest-corner distance, so the blue itself did reach every corner;
- the **ring** riding its seam, a fixed 1000px texture scaled up by `transform` to `--wipe-front-scale`. The CSS
  comment said Recruit sets that var "with the origin". **It never did**, so the ring always grew to the `4.4`
  fallback: a bright line about 2130px from the gem.

2130px only matches the seam on some 16:9 screens. On 3440x1440 the cover radius is ~2650px, so the ring eased to
a stop ~520px short of the left edge while the blue still had ground to cover: the "stop/pause" the owner saw. On
5120x1440 it stopped even further in. On 1920x1080 the same fixed ring ran well AHEAD of the blue (the seam there
is ~1530px). Only around 2560x1440 were the two glued, as the design comment intended.

A second, smaller defect showed up in the sampled computed styles: the parked zero circle's centre is set from
the new gem measurement during the tell (`chargeIn` / `primeOut`), but the curtain still had its 450ms transition
on, so the circle's CENTRE slid from the previous origin (or the 84%/62% fallback on the first wipe) to the gem
through the first half of the bloom.

## The fix

- New `packages/ui/src/wipeGeometry.ts` (pure, DOM-free): `wipeCoverRadius` (farthest corner + 2px antialias
  pad), `wipeFrontScale` (r / (500 × 0.97), putting the texture's bright 97% stop on the seam, so its fringe
  leaves past the farthest corner), `wipeOriginFor` (gem rect or stage fallback → `{ cx, cy, r, frontScale }`).
- `Recruit.tsx`: one `measureWipeOrigin` callback, run in the tells as before and on `resize` while a wipe is on
  screen; `wipeVars` now also sets `--wipe-front-scale`. The tell states wear `settle` (transition: none) so the
  zero circle snaps to the new centre instead of sliding.
- `styles.css`: comment corrected; no rule changes. Duration (450ms) and easing untouched.
- `wipeGeometry.test.ts`: every corner covered at 7 viewports × 8 anchors (incl. corners and off-screen); ring
  line == seam and fringe beyond it; the old 4.4 falls short at 32:9.
- Oracle: `R-PRESENT-15` in `packages/rules/src/registry/approved/foundation.ts`.
- Patch note (Systems).

The hero-select launch curtain (`.hsc-curtain`, an `inset: 0` opacity fade) and the Good Luck intro overlay
(`inset: 0`) were checked and are aspect-independent. The linear reveal bar is `vw`-based and already fine. The
NOW FACING / RETURNING TO SHOP announcement is `left/top: 50%` inside the fixed curtain, so it stays centred at
21:9 and 32:9 (confirmed in the screenshots).

## Verification

Headless Chrome (CDP, `Emulation.setDeviceMetricsOverride`) against a dev server on a private port, driving a
real lobby run: pick a hero, click the gem, End Combat, capture a burst of frames through both blooms, plus
`getComputedStyle` sampling every 25ms. At 1920x1080, 2560x1080, 3440x1440 and 5120x1440 the ring now travels
with the seam and leaves the screen; full cover has no uncovered corner; the text stays centred. At 3440x1440
the sampled clip radius ends at 2654px with the ring scale at 5.47 (= 2654 / 485); before, the scale ended at 4.4.

(The built-in Browser pane cannot render viewports larger than its window, hence headless Chrome.)

## Performance

Traced at 3440x1440 before and after (devtools.timeline). The bloom is still a `clip-path` transition, a
sanctioned one-shot per CLAUDE.md. It repaints each frame: ~2 Paint records per frame at ~0.1ms, ~7 raster tiles
per frame, raster max ~6ms off the main thread. The worst rAF frame during the entry and exit blooms is ~8.3ms
both before and after (the headless 240Hz clock; the 40-60ms frames are in the covered HOLD, where the board
swaps under full blue, not in either sweep). The fix adds nothing per frame: one extra custom property, and a
resize listener that exists only while a wipe is on screen.

Not done, deliberately: rewriting the bloom as a transform-scaled circle. The curtain carries a
viewport-anchored gradient and the centred announcement, and a scaled circle would scale those with it. The
counter-scale trick rasterises the inner layer at up to 1/0.004 = 250× at the start of the bloom. The measured
cost does not justify either trade. Revisit only if a real-hardware profile shows the clip raster dropping frames
at ultrawide.
