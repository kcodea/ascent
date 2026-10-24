# 2026-10-23 — Mirrorwing re-casts in the Shop

Player report (Lemon, Discord, relayed by the owner): "when in shop mirrorwing doesnt procc". A Spirit Fire cast on a
Mirrorwing **shop offer** buffed it once (+6/+6) instead of twice.

## Root cause

`castSpellOnOffer` runs the spell on a throwaway `BoardCard` built from the offer and folds the stat delta back.
`castSpell` only dispatches `spellCastOnThis` (`fireOnSpellCastOnThis`) when the target is **on the board**, so the
throwaway never told Mirrorwing a spell had landed on it. The whole `spellCastOnThis` family was board-only in the
Shop, against the cross-phase-by-default rule.

## Fix

- `castSpellOnOffer` now fires `fireOnSpellCastOnThis` on the offer's stand-in after folding the cast. The re-cast
  factories (Mirrorwing's `onSpellCastOnThisRecast`, Crash Course's `onSpellCastOnThisRecastNamed`) re-cast through
  a new `recastOn` helper: a board body gets `castSpell`, an offer stand-in gets a fresh `castSpellOnOffer`, so each
  re-cast folds and ledgers as its own cast (Inspect shows "Spirit Fire x2").
- `ShopCard` gains `spellsOnThisTurn` / `namedSpreadUsedThisTurn` (a held Displacement body keeps them on itself),
  reset at Start of Turn with the board's counters.
- The stand-in now carries the offer's gilding, so a Gilded Mirrorwing offer casts 2 additional times.
- Rune of Shared Reflection is guarded to a board Mirrorwing (an offer's `indexOf` is -1, which would have spread to
  board slot 0).

## Readings (flag to owner if wrong)

- **Buy after a shop re-cast:** the offer's count rides onto the bought body, so a Mirrorwing that already re-cast in
  the Shop this turn does NOT re-cast again on the board that turn. One "first Shop spell each turn" per instance,
  wherever it sits, which is how the board version already counts. An untouched offer bought then targeted re-casts
  normally.
- **Siblings:** Crash Course rides the same path (but Star Crash is a friendly-only spell, so it can't target a Crash
  Course offer today). Reflector (a token, reachable in the Shop only via Displacement) also hears offer casts and
  spreads to a random board minion. Tamby keeps its explicit board-only guard. Runefire is archived.

Oracle: `R-SPELLONTHIS-SHOP-01` (triggers). Tests: `packages/sim/src/mirrorwingShopOffer.test.ts`.
