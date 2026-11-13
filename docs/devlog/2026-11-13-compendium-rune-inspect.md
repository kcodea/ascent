# 2026-11-13: Compendium rune inspect lines its cards up in one row

Owner report: "this is in the compendium, inspecting a rune. fix this view please" (Guel's Apprentice: the Staff of Guel
preview lapped over the rune, hung lower than it, the pair sat off centre). Branch `fix/compendium-rune-inspect`, PR #2692.
Oracle: R-RUNE-INSPECT-01 (`registry/approved/foundation.ts`). Test: `packages/ui/src/runeInspectLayout.test.ts`.

## Why it broke

`RuneInspect` lays the rune and its named cards out with the card Inspect's flex row (`align-items: center`). A plated
card PAINTS far past its layout box (the plate about a quarter card width each side, ~37px above, the "Shop Spell" label
~150px below), so flex spacing could not keep it off the rune, centring the boxes left the painted plate low, and two
named cards could land on one spot (Living Geode showed its two cards stacked).

## What it does now

- Sizes are exactly as before (the Inspect's scale; the touch sizes too). Only positions change.
- `lineUp` (RuneInspect.tsx) measures what each piece paints once per open and on window resize, before the first paint.
  `planRuneInspect` (runeInspectLayout.ts, pure) puts each named card a 16px gap (before the Inspect scale) right of the
  one before, plate top level with the rune card top, and moves the whole row so its painted centre sits on the
  backdrop's centre (a little higher when the touch Pick pill shows). Written as `translate` on the row and the cards.
- Rects map to layout px by probing two known moves of the row, so the Inspect scale, a scaled stage, a zoomed page or
  the sideways phone stage need no assumptions.

## Owner iteration

A first pass also resized the group (fit-to-window scale, named cards at the hover reveal's larger ratio, stacking on
narrow windows). Owner verdict: "the compendium inspect looks worse there. revert that and just line them up so they are
in line together". Reverted to the original sizes; only the line-up remains.
