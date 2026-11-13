# 2026-11-13: Set 2 rune batch, Epic neutral slice (7 runes)

One slice of the owner's 40-rune Set 2 batch (design: `docs/design/2026-11-12-set2-rune-batch.md`, primary checkout
only). Branch `feat/set2-runes-epic-neutral`; the coordinator merges the four slices and writes the patch note.

## What shipped

All in `EPIC_RUNES`, `sets: ['set2']`, no tribe, no art (glyph fallback). Every one is a `combatFlag` reward (the
generic flag channel: `questFlags.<flag>` + `flagCopies` for Duplication), so no new reward kind or effect factory.

| Rune | Gold | Where it lives |
|---|---|---|
| Top Shelf | 3 | `offerTopShelf` (reducer.ts), the `roll` branch after Pete |
| Double Bill (was "Opening Act") | 4 | `runRuneStartOfCombat` (simulate.ts) + `socRuneReplaysOf` Shop replay |
| Bulwark Line | 3 | `runRuneStartOfCombat` + `socRuneReplaysOf`; duplicate = sweetener |
| Wholesale | 4 | `offerBuyPrice` (`wholesaleOff`) |
| Grudge | 3 | `advanceCombat` Start of Turn, its own `recordSotBeat` |
| Bastion | 4 | `registerWardRunes` (simulate.ts), `onLoseDivineShield`, keyed `shieldUp` |
| Mirror Sheen | 3 | `registerWardRunes`, `onLoseDivineShield`, `ctx.damage` sourced on the minion |

## Readings (flag to the owner if wrong)

1. **Top Shelf** fires on the Refresh button (paid or free), like Open Enrollment, not on the turn-start roll or hero /
   spell refreshes. It never grows the Shop: a full row swaps its right-most minion offer that is not already above your
   Tier, so it composes with Pete. The offer carries the `contraband` flash.
2. **Double Bill** with one Shout minion fires it once (it is both ends).
3. **Grudge** opens as the next Shop opens (a Discover cannot open mid-combat). Tier 6 Shop gives a Tier 7 Discover even
   without Tier 7 access ("Up to Tier 7"), the Summit-style fixed-tier offer.
4. **Bastion** with N copies covers the first N Ward losses (side-wide). Mirror Sheen copies hit once each.
5. **Wholesale** applies to the Starform too (it takes every regular minion discount).

## Tests

`packages/sim/src/set2RunesEpicNeutral.test.ts` (each rune, both sides where it is combat, copies, Shop replays,
Bastion with Mirror Sheen). Oracle: R-SET2RUNE-EN-01..03 in `registry/approved/runes.ts`.
