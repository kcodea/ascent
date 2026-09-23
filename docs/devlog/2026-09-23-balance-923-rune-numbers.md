# 2026-09-23 — Balance 9/23, tranche 3: rune costs and pure number changes

Owner balance batch "9/23", tranche 3, on `feat/balance-923-rune-numbers`. Data only: 64 rune Gold costs and 14
rune numbers/thresholds moved. No wording changed beyond the numbers, no mechanic changed, with one owner-flagged
exception (Rune of the Bubble Crown's counter, below). Tranches 4/5 (text rewrites, Rune of the Glider) are not
here.

## Costs (Gold)

Every name in the owner's list resolved to exactly one live rune (`RUNES` / `EPIC_RUNES`); nothing was ambiguous
or missing. "Trade In" is `Rune of Trade-In`; "Muster General (the RUNE)" is `rune_muster_general`, not the
Muster General minion or Rune of the Muster; "Resonance" is `rune_resonance` (not Ruby Resonance / Resonant Arms);
"Investment" is `rune_investment` (not Reinvestment); "Crucible Choir" is `rune_crucible_choir` (not the
Crucible). Archived runes untouched.

| Rune | Was | Now |
|---|---|---|
| Rune of Ashen Payroll | 4 | 2 |
| Rune of Contraband | 6 | 3 |
| Rune of Open Enrollment | 5 | 3 |
| Rune of Pillaging | 4 | 2 |
| Rune of Rallying | 5 | 4 |
| Rune of Rebirth | 3 | 1 |
| Rune of Recollection | 3 | 2 |
| Rune of Refraction | 4 | 3 |
| Rune of Resonance | 3 | 1 |
| Rune of Restocking | 3 | 2 |
| Rune of Shared Pour | 3 | 2 |
| Rune of Summoning | 4 | 2 |
| Rune of the Aftermarket | 4 | 3 |
| Rune of the Altar | 1 | 3 |
| Rune of the Coffers | 5 | 4 |
| Rune of the Deep Feast | 5 | 4 |
| Rune of the Epic Forge | 4 | 3 |
| Rune of the First Round | 5 | 4 |
| Rune of the Flagship | 3 | 4 |
| Rune of the Last Word | 4 | 2 |
| Rune of the Living Geode | 4 | 1 |
| Rune of the Night Market | 5 | 4 |
| Rune of the Ornate Clock | 2 | 1 |
| Rune of the Pair | 5 | 3 |
| Rune of the Seasoned Ledger | 5 | 4 |
| Rune of the Stampede | 5 | 4 |
| Rune of the Strange Caravan | 3 | 2 |
| Rune of the Top Hat | 3 | 6 |
| Rune of the Treasure Map | 2 | 3 |
| Rune of Trade-In | 2 | 1 |
| Rune of Adventuring | 6 | 5 |
| Rune of Appraisal | 3 | 2 |
| Rune of Ascension | 5 | 2 |
| Rune of Borrowed Echoes | 5 | 2 |
| Rune of Bucky | 7 | 4 |
| Rune of Copycat | 5 | 4 |
| Rune of Counterpoint | 7 | 5 |
| Rune of Delayed Duplication | 5 | 4 |
| Rune of Engraving Gems | 4 | 2 |
| Rune of First Claws | 7 | 5 |
| Rune of Kobold Bebes | 6 | 4 |
| Rune of Lazarus | 5 | 3 |
| Rune of Living Growth | 5 | 3 |
| Rune of Mykel | 4 | 2 |
| Rune of Ninefold Commerce | 6 | 4 |
| Rune of Perfect Recall | 6 | 3 |
| Rune of Recurrence | 4 | 2 |
| Rune of Shared Reflection | 5 | 3 |
| Rune of the Ancient Den | 6 | 4 |
| Rune of the Bargain Bin | 7 | 6 |
| Rune of the Chef | 6 | 5 |
| Rune of the Conduit | 5 | 4 |
| Rune of the Corrupted Tome | 4 | 1 |
| Rune of the Crucible Choir | 6 | 5 |
| Rune of the Jungle | 6 | 2 |
| Rune of the Lapidary | 5 | 3 |
| Rune of the Motherlode | 5 | 4 |
| Rune of the Muster General | 5 | 4 |
| Rune of the Spellstone | 3 | 1 |
| Rune of the Stoked Menagerie | 5 | 4 |
| Rune of Investment | 3 | 5 |
| Rune of the Collector | 4 | 5 |
| Rune of Quick Study | 6 | 2 |
| Rune of Enchantment | 5 | 2 |

Each `cost:` line carries a `// balance 9/23 (was N)` note so the previous value stays greppable.

## Numbers and thresholds

| Rune | Was | Now | Where the number lives |
|---|---|---|---|
| Rune of Heavy Payroll | +12/+12 | +8/+8 | reward data (`runeHeavyPayroll`) |
| Rune of Spending | +1/+2 per Gold | +2/+3 per Gold | `recruit.ts` `runeSpending` End of Turn (hardcoded) |
| Rune of the Brew | +4/+3 | +2/+3 | `recruit.ts` `applyGoldSpent` (hardcoded) |
| Rune of the Seller's Market | +4/+3 | +6/+8 | `recruit.ts` sell path (hardcoded, times copies held) |
| Rune of the Shared Table | +2/+2 | +5/+5 | reward data (`runeSharedTable`) |
| Rune of Gemcutting | 5 Rubies at +3/+3 | 6 Rubies at +4/+4 | reward data (`mintRubies`) |
| Rune of Compounding Wages | +1/+1, improve +1/+1 | +2/+2, improve +2/+2 | reward data (threshold `buff` + `step`) |
| Rune of Blood and Coin | Avenge (5) | Avenge (4) | `simulate.ts` death counter (hardcoded modulus) |
| Rune of Carrion Coin | Avenge (4) | Avenge (3) | `simulate.ts` `runeAvenge(3, …)` + reward `amount` |
| Rune of Echoed Arrival | every 5th Echo minion | every 4th | reward data (`per`) |
| Rune of the Summit | in 3 turns, every 3 | in 2 turns, every 2 | `reducer.ts` start-of-shop tick (hardcoded modulus) + the `x/2` badge in `runeTally.ts` |
| Rune of Mountain Trade | 6 cards | 5 cards | reward data (`cardsPlayed` threshold `per`) |
| Rune of the Returning Pack | 6 Beasts | 5 Beasts | reward data (combat flag `amount`) |
| Rune of the Bubble Crown | 12 spells | 9 spells | reward data (`per`) + the meter change below |

The combat Avenge badges (`RUNE_DEATHS_PER` in `runeTally.ts`) moved with Blood and Coin (4) and Carrion Coin
(3); `tallyCoverage.test.ts` cross-checks them against the printed `Avenge (N)`. The reducer's fallback
defaults for Carrion Coin / Returning Pack (`r.amount ?? N`) follow the new numbers too.

## Bubble Crown: the counter was Shop-spells-only; it now counts every spell

Owner: "not shop spells, so rubies etc count". Finding: the rune read the `spellCast` threshold meter, which
`castSpell` advances for Shop spells and Gifts but which a Ruby only advanced through Rune of the Spellstone
(`countRubyAsShopSpell`). So a Ruby-heavy run could cast a dozen Rubies and never move the Crown. The
`spellCast` meter itself could not be widened: Rune of Infernal Ink reads it and prints "Whenever you cast a
**Shop Spell**".

Fix: a new threshold meter `anySpell` (core `QuestReward` type, content schema enum, `RunState.runeThresholds`,
`advanceRuneThresholds`), advanced once per cast from `noteSpellForCountRunes`, which is already the
every-spell chokepoint (called from `castSpell` for Shop spells and Gifts, and from the Ruby reducer branch once
per resolved cast). Bubble Crown now rides `anySpell` at 9. Spellstone does not double-count: its Ruby advances
`spellCast`, and `anySpell` is advanced exactly once per cast regardless. `questText.ts` prints the meter as
"spells you cast"; `runeTally.ts` gives it an empty unit suffix like the other cast meters.

Oracle: **R-RUNE-05** in `packages/rules/src/registry/approved/runes.ts`, enforced by the new scenario in
`runeBatchAug19.test.ts` (a Ruby played with no Spellstone advances the Crown by one; a Shop spell by one more).

## Tests moved (number pins only)

`runes.test.ts` (Pillaging cost in the can't-afford probe, Spending +2/+3, Summit every 2nd), `runeBatch4T1`
(Shared Pour / Aftermarket costs, Carrion Coin Avenge (3)), `runeBatchAug07` (Coffers / Altar / Flagship / Top
Hat / Treasure Map costs; the Altar probe funds the rune's new cost), `runeBatchAug19` (Bubble Crown 9 +
the new every-spell scenario), `runeBatchAug20` (nine costs, Compounding Wages, Echoed Arrival 4th, Heavy
Payroll +8/+8, Returning Pack 5), `runeCardKeyed` (Mountain Trade 5), `runeDupStacking` (Returning Pack 5),
`runeMinionBatchAug11` (eight costs, Seller's Market +6/+8), `set2Dwarves` (Gemcutting 6 at 4/4),
`dissipate.test.ts` (Seller's Market through the Dissipate sale). The full suite found more cost pins outside the
`runes*` glob, all moved the same way: `buckyAndGroveweaver` (Bucky 4), `epicRuneBatchAug07` (Enchantment / Lapidary /
Corrupted Tome), `quillenAllTypes` (Pillaging), `runeBatch3Aug07` (Conduit), `runeBatch4T2` (Ancient Den),
`runeBatch4T3` (Ashen Payroll / Last Word), `runeBatch4T4` (Crucible Choir), `runeBatch7` (Blood and Coin every 4th),
`runeCardKeyed2` (Shared Reflection / Living Growth), `runeChef` (Chef), `runeCombatFlags` (Stampede), `runeFinalFour`
(Counterpoint / Spellstone), `runeShopBatch` (Resonance / Investment), `set2KoboldQuests` (Recollection / First Round /
Motherlode / Adventuring). The strategist curriculum (`balance/strategy/curriculum.test.ts`) pairs each package's
affine rune with an off-package rune of EQUAL cost; six pairs no longer matched, so their off-runes were re-picked
from the generic (affine-to-no-package) runes at the new cost: Trade-In (1), Strange Caravan (2), Transcription (4).
`contracts:extract` regenerated
`extracted.generated.ts` for the drift rail (`pendingConventions.generated.ts` was left alone: its pending
drift is unrelated text from earlier PRs).
