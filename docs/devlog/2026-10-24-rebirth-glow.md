# 2026-10-24 — Rebirth's glow no longer ends in a straight line

**Owner report.** "rebirth cuts off with a horizontal line, can you fix that so it's the full oval/fade it better or
w/e" (Exgalloper, Inspect card).

**Root cause.** Not a container clip. The over-the-portrait half of the Rebirth look, the VEIL (`.rebirth-veil .rbv`,
image `veilSvg` in `rebirthCrown.ts`), was drawn in a box exactly the size of the portrait WINDOW (viewBox 100 x 128,
`.rbv { inset: 0 }`). Its bottom tongues are rooted ON the window's ellipse, so their rounded bases and their Gaussian
blur spill past that box, and the image edge sliced them off flat. On the oval frame the art is OVERFILLED past the
window (`--fill: 1.28`, tucked under the gold), so the strip below the box is still visible portrait: the slice showed
as a hard horizontal line across the bottom of the portrait, just above the mechanic gem, on the board tile, the Shop
tile and the hover/Inspect card alike (most obvious on the big card). On a Taunt shield the art box IS the window and
the heater clip already trims it, so the shield never showed it.

**Fix.** `VEIL_BLEED = 0.18`: the veil SVG's viewBox gains that margin on every side and `.rbv` bleeds out by the same
fraction (`inset: -18%`; top/bottom percentages resolve against the height, so the mapping stays exact under
`preserveAspectRatio="none"`). Inside the window the fire is pixel-identical; outside it, it now fades out on its own
until the portrait's oval / heater clip trims it under the gold. Static geometry only, the idle breathe is still
opacity-only. The crown on the frame was never clipped (its tongues sit well inside its 200-unit box).

**Verified.** Headless Chrome 1920x1080 before/after of the Exgalloper Inspect card (plain, gilded, Taunt) and a board
row (plain, gilded, Taunt) + a Shop tile: the line is gone on every oval card; Taunt is unchanged. Rule
`R-REBIRTH-VEIL-EDGE-01` (keywords, beside `R-REBIRTH-FX-01`), enforced by `rebirthLook.test.tsx`.
