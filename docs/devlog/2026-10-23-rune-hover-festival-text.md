# 2026-10-23 — One preview per granted card; Traveling Festival reads as a flat +2/+2

Two owner reports, both display only. No gameplay change.

## Lantern Keeper showed two Lantern of Souls previews

Owner: "this doesnt need both previews". Lantern Keeper's reward is the Rare Goods shape, a `grant` of
Lantern of Souls now plus a `recurringGrant` of it every 2 turns. `RuneCard`'s `rewardCardIds` flat-mapped
every sub-reward, so the card came out twice and `previewIdsOf` only deduped the `previewCards` half against
it. Overture (Crescendo) had the same bug. `previewIdsOf` (now exported) dedupes by id + gilding, and
`QuestCard` dedupes its reward ids the same way. `runeCardPreview.test.tsx` walks every rune for duplicates and
checks the rendered Lantern Keeper hover.

## Traveling Festival's "+10/+10"

Owner: "this rune doesn't grow, it just gives +2 to the bonus of the revelers". The readout came from
`runeTally`, which printed `revelerX + revelerExtra` (the shared Reveler value plus the rune's 2). The shared
value rises with every Reveler sold, so the rune looked like it was growing. The rune now has no tally, like
every other flat-bonus rune. Its text already says +2/+2.

The Revelers themselves ignored the rune: `spiritText` printed only the shared value. It now takes
`revelerExtra` and prints `value x golden + extra`, exactly what `revelerSell` pays (golden doubles the value,
not the extra; a second copy does not stack, since `revelerExtra` takes the max). It is threaded through the
shop/hand/Discover/board chain (`instView`, `Recruit.tsx`) and the combat `Unit.tsx` (player side). A foe's
Reveler still prints without it: the snapshot does not carry `revelerExtra`, and a foe Reveler is never sold
mid-fight. Festival Luminary is not a Reveler and is unchanged.

Oracle: R-RUNE-PREVIEW-1023-01 and R-RUNE-FESTIVAL-1023-02 in `packages/rules/src/registry/approved/runes.ts`.
