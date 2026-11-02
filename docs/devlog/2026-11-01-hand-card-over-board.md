# 2026-11-01 · A lifted hand card paints over a just-landed minion

Owner bug 2026-11-01 (screenshot): a lifted hand spell sat under a board minion's tier banner, "the card art in hand
should be on top of the minion on board here". Branch `fix/hand-card-over-board`. Rule R-PRESENT-HAND-OVER-BOARD-01
(approved/foundation.ts), test `packages/ui/src/handOverBoardZ.test.ts`.

## Root cause

`puffOnBoard` (Recruit.tsx, the landing dust for a played / summoned / moved board minion) set an inline
`z-index: 111` on the landed card for 850 ms, meant to tuck the dust behind it, on the belief that `.app` is not a
stacking context. It is (`.app { z-index: 1 }`, since #418), so:

- At rest the raise never beat `.pixifx` (z110, a `#root` sibling): the dust always painted over the card anyway. It only
  lifted the card over the hand zone (z25).
- Hovering a hand card DISSOLVES `.app` (`body:not(.dragging) .app:has(.row.hand .card:hover)`, so the lifted card can
  clear the HUD) and raises the hand zone to z70. The z111 board card then sorted at the root above the hand zone.

So: play a minion, lift the next hand card within ~1 s, and the new minion's badges / banner / keyword glyph paint
across the lifted card's top edge. Reproduced headless (Playwright, God Mode Practice, dev server) on the first try once
the hover followed a play.

## Fix

Dropped the raise (and the now-unused `AURA_MARKERS`). The dust plays over the card, the look it already had at rest
and on Ward / Reborn cards. No CSS change; no per-frame work added.

## Checked

Resting, hovered, golden and spell hand cards; a 6-card fan; the drag card (z115), cast arrow and hover preview are
untouched (all above the hand). Combat units use their own ladder (`lunge` z12), and the hand never meets a raised card
there. Phones: the touch press (`tt-press`, zone z70 without dissolving `.app`) was equally beaten by the z111 card and
is fixed by the same change.
