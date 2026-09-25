# 2026-09-24: Cast multipliers work only on spells cast from hand

Owner ruling (verbatim): *"let's make the effect of living grimoire and yazzus/orivax etc specify spell cast from hand
so that it only doubles from spells cast from hand."* Confirmed in the same message, kept as is: *"An End-of-Turn
Lasso or Staff of Guel can now count as the turn's first or last spell. So Rune of Recurrence, Mushy, Steward of
Spells and Runesnout Archivist can remember one. - this is correct."*

## The bug

PR #1699 routed every minion cast through `castSpell()` (R-MINIONCAST-01). `castSpell` never multiplies, but its
bookkeeping (`noteSpellCast`) spent the Living Grimoire charge on EVERY cast, and every cast advanced
`spellsThisTurn`, which is what closes Orivax's first-spell window. So an End-of-Turn Lasso or a rune's recast used up
the Grimoire and Orivax without being doubled. The opposite leak existed too: a Mage-Pup's taught spell and a
Pourman's Keg pour looped `spellCasts`, so they WERE fully multiplied (the Pup also spent Spell Thesis and the Nimbus
charge).

## The gate (one choke point)

`packages/sim/src/recruit.ts`:

- `withHandCast(spellId, fn)` / `isHandCast(spellId)`: a module-scoped stack (like `castActorStack`) holding the spell
  id the player is casting from hand. The reducer's hand-play paths are its only callers: the Shop-spell play
  (targeted, offer, untargeted), Choose One spells (`resolveChooseOneSpell`), Discover spells, Gifts and Common
  Ground's second pick. Rubies keep their own hand-only count (`rubyCastCount`).
- `castsOutsideHand(state, def)`: every non-hand site that used to loop `spellCasts` now reads this. It is
  `spellCasts` while that same spell is being cast from hand (a Mirrorwing / Reflector / Runefire / Crash Course /
  Shared Reflection re-cast is "the same cast happening again", Mirrorwing ruling 2026-09-01), else 1. Sites:
  Pourman's Keg, the Mage-Pup taught cast, the four `spellCastOnThis` re-casts, Rune of Shared Reflection.
- `noteSpellCast`: spends the Grimoire only for a hand cast. A non-hand cast walks Orivax's `spellMultMark` forward
  with the count, so the window stays open for the next hand spell.
- The taught cast no longer spends Spell Thesis or the Nimbus / Comet charge (Starpath Vendor's stat bonus, not a
  multiplier, is still spent as before).
- Constellation Prime's extra primary landing reads `isHandCast('starcrash')`.

`spellCasts` itself is unchanged: it is the from-hand count, which the UI's x N badge previews.

## Texts

"from hand" added: Yazzus, Living Grimoire, Orivax (branch + both texts), Nimbus, Cometius, Comet, Edward Keg-hands,
Constellation Prime, Rune of Shared Pour, Rune of the Bottomless Cask, Rune of Hoardflame, Rune of Dragon Breath, and
the quest reward texts in `questText.ts` (Spell Thesis, Ancient Runes, Bottomless Cellar, The Endless Verse). Rune of
Resonance already said it; the Ruby quests (Gem Circuit, Unstable Riches) and the archived Prismcaster were already
hand-only in behaviour and were left alone. Rune of the Astral Draft's extra cast rides the hand card itself, so it
was already hand-only.

## Verification

- `packages/sim/src/castMultipliersFromHand.test.ts` (new): a Mage-Pup's cast and a Rune of Recurrence cast neither
  double nor spend the Grimoire, Spell Thesis, the Nimbus charge or Orivax's window, and still reach the first/last
  memory; a hand cast still doubles and spends. Six of eight failed before the fix.
- `set3Dwarves.test.ts`: Edward no longer doubles a Keg pour (flipped with the ruling).
- `docbot/recastMultiplier.test.ts`: the lane accepts `castsOutsideHand` as the multiplier read.
- Oracle: new R-MULT-06 (`approved/multipliers.ts`); R-MINIONCAST-01 (`approved/triggers.ts`) gains the owner's
  "this is correct" quote and the new test.
- GAME-RULES: new section "Cast multipliers work only on spells cast from hand".

## Judgement calls to confirm

- The Mirrorwing family keeps its multiplier when it re-casts a HAND cast (the 2026-09-01 ruling), and re-casts
  a minion's or rune's cast once. Rune of Shared Reflection follows Mirrorwing.
- The Ale multipliers (Edward, Bottomless Cask / Cellar, Shared Pour) are in scope, so a Pourman's Keg pour is no
  longer doubled.
- A Gift from hand (a Clue) still spends the Grimoire charge without being doubled, as before this change.
