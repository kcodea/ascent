# 2026-10-16 — #2119 badge regression: badges unreadable on Career / Recent Games

**Owner:** "2119 seemed to break the badges" (Career + Recent Games match cards on the menu redesign branch).

**Root cause.** #2119 (R-BADGE-FIT-01) did two things: a glyph-count shrink-to-fit for 4+ character numbers, and a
card-relative scale on the whole milestone badge (`--ms-k = --ccw / --ccw-board`). The second was the regression.
The menu strips are small cards (Career ~0.6-0.7 of a board card; Recent Games is an `.lb-tile` with a 112px card
then transform-scaled 0.78), so the number shrank twice: 26px → ~8-10px for 2-3 digits, and the 0.52 fit step
on top made "103.7k" a smudge. It also changed hand / Discover badges (ratio > 1).

**Fix.** Removed `--ms-k` / `--ccw-board` entirely: the frame, glow, tint and number are back to their pre-#2119
authored px on every surface (in-game identical to before #2119 for 1-3 digit numbers). Kept shrink-to-fit for
4+ glyphs only, with gentler steps (0.8 / 0.7 / 0.66 / 0.58) so a six-glyph number is >= 13px even on the
0.78-scaled Recent Games tile. Regression test in `bigStatBadge.test.tsx` fails on a77255d6b.

**Strip sizing (for the menu redesign).** With fixed-px badges the frames overhang the card art by ~18px each side
and ~25px below at tile scale 1 (glow on pink/blue/crystal tiers: ~26px each side, ~33px below); multiply by any
transform scale on the tile. Neighbouring tiles' badges stay clear when the card-to-card pitch is at least
card width + 36px (frames) or + 52px (glow halos too); reserve ~25-33px under the card. Keep the tile's visual
scale >= 0.78 for the numbers to stay >= 13px.
