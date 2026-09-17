# FX: `medallion` anchor part now lands on board minions (not card centre)

## Symptom
In the FX workbench (realBoard scenario, a real minion), a layer anchored to the **medallion** part played
from the card **centre** instead of the tribe plate.

## Root cause
The `medallion` anchor part resolves by querying `.plate-tribe` on the anchored unit
(`anchorParts.ts` → `PART_SELECTOR.medallion`). But `.plate-tribe` is rendered by `Card.tsx` **only on hand
cards** — `usePlate = !!plated && plateOk`, and `plated` is passed true solely for a hand / dragged-from-hand
card ("Board / shop / combat cards are never plated"). So **every board/combat minion lacks `.plate-tribe`**,
`querySelector` returns null, and `partPointFromRects` fell back to the card centre.

This was not workbench-only: the shipped `embermouth` and `shout-icon-effect` defs use `anchorPart: medallion`
and had been centring on the real board too.

## Fix
`partPointFromRects` now resolves `medallion` to a **bottom-centre** point when there's no usable plate rect —
`{ x: centre.x, y: card.top + card.height * MEDALLION_BOARD_Y_FRAC }` (0.9), where the hand card's plate gem
visually sits — instead of the card centre. With a real `.plate-tribe` (a hand card) it still uses that rect's
centre, unchanged. Only `medallion` changed; every other missing part still falls back to the centre.

`MEDALLION_BOARD_Y_FRAC` is a named constant so the exact height is easy to nudge (owner picked "bottom-centre"
2026-09-17).

Scope: one function + its test. `endPoint` (the *other* fallback, for when parts were never resolved at all —
synthetic scenarios) is untouched.

File: `packages/ui/src/fx/anchorParts.ts` (+ `anchorParts.test.ts`).
