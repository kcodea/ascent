# 2026-10-08 — Runeforge: the guaranteed slot is tribe-aligned

**Owner report:** a tester with 4 Dragons + 3 Dwarves at the Epic forge was offered Rune of the Broodpit, Rune of
the Wild Hunt, Rune of the Food Chain and Rune of Gemstorm (Demon, Beast, Demon, Kobold). Owner: "he should have
at least 1 rune that is tribe aligned here for one of those".

## Root cause (`packages/sim/src/reducer.ts` `drawRuneOffer`)

The board-fit thresholds (2 Basic / 3 Epic, All types count as every tribe, board only) were implemented correctly
in #1647. The guarantee was not tribe-aware:

1. **Any tag overlap satisfied it.** `matches` asked whether a rune shared ANY tag with the board. Mechanic tags
   are presence tags, so a Dragon/Dwarf board almost always carries `shout`, `spells`, `gold`, `echo`, `rally` or
   `summon`. Broodpit ("summon 2 Imps") and Food Chain ("the first minion you summon") are tagged `summon`, so
   the offer already "followed the board" and the swap never fired.
2. **Gate-only tribe runes were invisible.** Rune tags came only from the text. A rune gated to a tribe whose text
   never prints the tribe word (Set 2 Epic: Baal, Mykel, Bucky, Seller's Market, Muster General for Dwarves;
   Stormcalling, Chimerus, the Whelps for Dragons) was not a tribe rune to the forge, so it was also discounted as a
   "pivot" on a board it fits.

The live build before #1977 has the same logic: `drawRuneOffer` / `boardSynergyTags` are unchanged since #1647
(2026-09-22); #1977 was UI polish plus the DEV `devOpenRuneforge` action.

## Fix

- `runeFitTags(rn)` = text tags + the rune's `tribes` gate. Used for both the guarantee and the pivot discount.
- When the board has a tribe at the forge's threshold, the guarantee pool is the runes of those tribes, and only a
  tribe rune satisfies it. A board with no tribe at the threshold keeps the old mechanic guarantee (same RNG
  consumption, so those offers are unchanged).

## Numbers (Set 2, real `devOpenRuneforge` opener, % of forges with at least one Dragon or Dwarf rune)

| Board | Before | After |
|---|---|---|
| Epic, 4 Dragon + 3 Dwarf | 67.3% | 100% |
| Epic, 3 Dragon + 3 Dwarf + 1 neutral | 68.2% | 100% |
| Epic, 2 Dragon + 2 Dwarf (below threshold) | 65.1% | 65.1% (random by ruling) |
| Basic, 2 Dragon + 2 Dwarf | 54.0% | 100% |

Test: `packages/sim/src/runeforgeTribeFitGuarantee.test.ts`. Oracle: `R-RUNE-FORGEFIT-01`.
