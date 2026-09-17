# FX: `medallion` anchor part lands on the settled board minion (not card centre / drop point)

Two related medallion-anchoring fixes, both in `anchorParts.ts`.

## Fix 2 — parts resolve at the RESTING slot, not mid-slide
A Shout played from hand fires `shout-icon-effect` (a `burst` on `source` + `anchorPart: medallion`). The base
anchor was correct (the recruit path measures with `restingCenterOf`, which corrects for the slide transform),
but the **medallion part was read off raw `getBoundingClientRect`** in `readUnitPartPoints` — which, while the
card is still sliding into its warband slot, is the **drop position**. So the burst emerged from where the card
was *released*, not where it *landed* (owner report 2026-09-17).

`readUnitPartPoints` now transform-corrects every part rect to its resting position (`restingDelta`, the same
offset `restingCenterOf` computes), so a part lands on the settled slot. No-op when nothing is transformed
(combat) or for test stubs (no `offsetParent`).

Combined with Fix 1 below, a Shout on a board minion (no tribe plate) now emerges from the **settled warband
card's bottom-centre**.

---

# Fix 1 — `medallion` on board minions (no tribe plate) falls to bottom-centre, not card centre

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
