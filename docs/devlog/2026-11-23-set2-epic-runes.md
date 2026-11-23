# 2026-11-23: Six Set 2 Epic runes (Deep Bond, Golden Bell, Uninvited Guests, Gilded Wings, Double Tap, Spellmaiden)

Owner-approved design 2026-11-23. Rules R-SET2-EPIC-1123-01..06. Tests: `packages/sim/src/set2EpicRunes1123.test.ts`
(engine) and `packages/ui/src/set2EpicRunes1123Text.test.tsx` (live text on every surface).

## How each one is wired

- **Deep Bond**: `grant` + the Shop-only flag `runeDeepBond`. `goldSpentEvery` (recruit.ts) is the one threshold rule:
  `applyGoldSpent` pays on it, `stepProgress` counts on it, `runeRewrittenText` prints it.
- **Golden Bell / Gilded Wings**: one mechanism. The `grant` reward's `noTripleReward` stamps the granted Gilded copy
  (`BoardCard.noTripleReward`); `grantGildedPlayRewards` returns early for it, at the one chokepoint all three Gilded
  play sites walk.
- **Uninvited Guests**: `grant` + the combat mod `runeUninvitedGuests` (rides the snapshot's `questMods`). Party Crasher's
  `avengePlayRubies` widens its recipients to Kobolds and Beasts, each body once.
- **Double Tap**: the Hunch x Bonds shape. `doubleTapCastMult` is folded, read-only, into the three hand-cast counts
  (`spellCasts`, `rubyCastCount`, `giftCastCount`) and spent beside `ancientNote*` at the same five cast sites. The
  extra cast is attributed to the rune (`runeExtraCasts`), so it presents as the rune's cast. From hand only.
- **Spellmaiden**: new recruit factory `onSellMultiplySpellPower`, on the rune-only token `n2_spellmaiden`. It multiplies
  the banked `spellBonus`; the Spell Power flourish fires off the existing before/after stamp.

`RuneTextFlags` carries the new text inputs, so the hand, board, Shop, Discover and combat chains get them through the
channel they already thread.

## Gotcha

A Triple Reward is the `discoverspell` CARD in hand, not an open Discover. A "no Discover opened" assertion passes on any
Gilded play; the test counts the card, with an unmarked copy beside it.

## Open for the owner

No art for the six runes. Spellmaiden's minion art is wired (owner ask, `n2_spellmaiden.webp`). The builder readings are listed in each rule's `currentBehaviour`.
