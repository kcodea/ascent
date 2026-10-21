# 2026-10-20 — Versus room: the spectator hand stops flickering

Owner: "the card dragging in versus lobby is okay but the hand/spectator area can allow for really janky pop previews
similar to our old hand related bugs. make it easier to grab and not pop in/out a million times in certain spots."
Oracle rule R-VERSUS-HAND-HOVER-01 (`packages/rules/src/registry/approved/foundation.ts`), pinned in
`packages/ui/src/versus/versusSeatCard.test.tsx`.

## Why it flickered

`.vsbcard:hover` transformed the hovered element itself: up two card widths and x2.3 from its foot
(`versus.css`). A hand on the lower half of a resting card was no longer over it once it popped, so it dropped back
under the hand, re-hovered and popped again, every frame (the in-game hand's 2026-07-21 bug, fixed there with
`.handpad`).

## The fix

The slot (`.vsbcard`) never moves and takes no pointer. The card and its lift moved to `.vsbcard-lift` (no pointer
events). The hover is decided by still, transparent pads (hit-testing only, no paint, no layout change on hover):
`.vsbcard-hit` (the card's strip of the fan: its plate width, or the fan pitch once cards overlap), `.vsbcard-band`
(the strip a little wider, live only while hovered, a dead band between neighbours) and `.vsbcard-hitup` (the popped
card above the fan, live only while hovered, so the hand can travel onto it and grab it). The seat drag still starts
from the slot's `pointerdown`; while one is live the pads take no pointer.

## Verification

Headless Chromium, dev build, a fake room (no backend), slow sweeps across the fan at four heights, a still hand on
each card, a vertical reach from below and a 4 px jiggle on a boundary:

| | before | after |
| --- | --- | --- |
| hover changes per sweep, 6 cards | 100 to 128 | 7 (each card once, then off) |
| sweep, 8 / 14 / 20 cards | | each card once, none skipped |
| still hand, 600 ms | 2 to 3 toggles per card | 0 |
| reach up from below into the popped card | 22 changes | 1 (leaving the top) |
| jiggle on a boundary | | 0 |

No looping animation; the lift is the same one-shot transform transition as before.
