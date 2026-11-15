# 2026-11-15 — Cinderchef feeds on Shop spells; Earthbreaker +2/+2

Owner change, both in `packages/content/src/cards/set2/dragons.ts`.

- **Cinderchef** (`d2_cinderchef`): "Rally: gain +1/+1 for each Shop spell cast this turn." Gilded +2/+2 each.
  Same factory, new `perShopSpell` param on `rallyBuffSelf` (one `ARENA_EFFECTS` body, both phases). Rule R-CINDERCHEF-01.
- **Earthbreaker** (`d2_scalechanter`): Dragons +2/+2 per Shop spell (was +2/+1), gilded +4/+4.

## The new tally

`spellsThisTurn` counts Gifts (Clues) and Spellstone Rubies, so it is not "Shop spells". Added
`RunState.shopSpellsThisTurn` (R-SHOPSPELL-01 via `isShopPoolSpell`, ticked in `noteSpellCast`, reset in the
turn flip) and threaded it per side: `CombatSideState.shopSpellsThisTurn`, the board snapshot, `boardSide`,
`EnemyScalers`, and `EffectArena.shopSpellsThisTurn()`.

**Real time in combat:** `simulate`'s `spellResolved` (the per-cast chokepoint, after the Shop-pool gate) bumps a
live per-side counter and emits a new presentation-only `shopSpellTally { side, count }` event (silent, zero hold,
absorbed into the windup like `runeSequence`). `useCombatReplay` stamps the latest count on each unit
(`shopSpellsLive`), and `Unit.tsx` feeds it to `liveCardText`. Combat Shop casts are not carried back into the run
tally (the turn ends at combat anyway).

Live text follows Humphry's lump style: printed rate + `{{(+N/+N)}}`, shown at zero too.

## Judgement calls

- A Spellstone Ruby does NOT count (R-SHOPSPELL-01 says Rubies never do, as for Goldilox), though Earthbreaker
  itself does fire on Spellstone Rubies and Gifts through the generic `spellCast` watchers. Pre-existing, untouched.
- `(+0/+0)` is printed when nothing has been cast.
