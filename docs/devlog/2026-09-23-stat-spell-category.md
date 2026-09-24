# 2026-09-23 — One stat-granting spell category; targeted spells cast at a random minion

Owner ruling (verbatim): *"no this is wrong and needs to fixed for all 'stat granting spells' texts etc. all
targeted spells should be castable and fit this category, just with random targets chosen. the shop based ones
i'm iffy on. but definitely targeted and board wide stat buff spells"*

Refined on the PR the same day (verbatim): *"common ground should not be in the grouping, that's a combat related
buff. it should only be stat granting spells that give stats immediately basically. i think common ground is the
only one in the list that's wrong, that's more a utility thing."*

**The test for any future spell:** does casting it GIVE your minions stats they did not have, right now? A spell
that redistributes, swaps or sets existing stats, buffs a later combat, or buffs the Shop / future cards is out.

## What was wrong

Rune of the Gilded Ledger ("Every 7 Gold spent, cast a random stat-granting Shop spell") filtered its pool to
`isBoardStatSpell(c) && c.target !== 'friendly' && c.target !== 'any' && !ALE_IDS.includes(c.id)`. In Set 2 that
left four spells (Growth T2, Might of Aeon T3, Dragonflame T5, Waking Rift T6): **nothing at Tier 1**, and every
targeted stat spell and every Ale shut out. `isBoardStatSpell` also read `def.effects` alone, so it was blind to
Choose One branches.

The Ale exclusion had no stated reason: it was copied from the neighbouring `grantSpell` line in the 2026-08-20
rune batch (#1122), where Ales are excluded because `grantAle` is their own reward. Ales are drawable Tier 3
Shop spells (`runSpells`), so they are back in.

## The contract (`packages/sim/src/recruit.ts`)

- **`isStatGrantingSpell(def)`** is THE category. In: a drawable Shop spell (not a token, Gift or Ruby) with a
  stat-factory cast effect (`isStatSpellFactory`) and no off-board stat effect. Out: `OFF_BOARD_STAT_FACTORIES`
  (the shop-buff family, Facetwright's Ruby gain, and Common Ground's `spellAverageStats`). Replaces `isBoardStatSpell`.
- **`isStatSpell(def)`** (Rune of Thrift's discount) now reads the same `isStatSpellFactory`, so the category is
  always a subset of it. The old `STAT_SPELL_EXTRAS` list is gone; the one difference it hid was Great Pot's
  `buffOnePerTribe`, which Thrift now discounts.
- **`castSpellWithoutAim(state, def)`** is the shared no-aim cast. A Choose One takes one seeded branch; a
  targeted spell lands on a seeded-random legal friendly (`pickRandomSpellTarget`); no legal target fizzles (returns false, no cast counted, no Gold moved). Every path
  goes through `castSpell` → `applyCastEffects`, so the cast preview (#1665) sees it once it lands.
- **`pickRandomSpellTarget`** is the old `pickTaughtTarget` (Mage-Pup), extended with the aim's legality: the
  spell's tribe restriction after runes (`effectiveTargetTribe`) and `targetNoGolden`. Side effect: a Pup that
  teaches a tribe-restricted spell now fizzles instead of landing it off-tribe.

A shop offer is never picked for an `any` spell: that half is the shop aim the owner is iffy on, and the
Ledger's payout is for the board.

## Set 2 membership

| Tier | Before (Ledger pool) | After (category) |
| --- | --- | --- |
| 1 | none | Bulwark, Lantern Light, Crest of the Climb |
| 2 | Growth | Growth, Spirit Fire |
| 3 | Might of Aeon | Might of Aeon, Shatter, Patch Job, Champion's Ale, Defensive Ale, Bloody Ale |
| 4 | none | Front to Back, Hoardflame, Great Pot, Blessing, Flutter |
| 5 | Dragonflame | Dragonflame |
| 6 | Waking Rift | Waking Rift, Beefy |

Set 3 (not live): Bulwark, Aspect's Blessing (T1); Growth, Shared Spirit (T2); Shatter, the three stat Ales,
Star Crash (T3, Celestial-only aim); Front to Back, Stellar Chorus, Hand Soap (T4); Waking Rift, Crescendo (T6).

Checked and left out: Common Ground (averages: "more a utility thing", owner), Turnabout (swaps), Perfect Vision (sets 20/20), Fleeting Vigor and Solid Ground (next
combat only), Ruby Excavation / Ruby Transfer (Ruby channel), Cupcakes (consume). None is a stat-family factory.

## Consumers

- **Rune of the Gilded Ledger** (`payRuneThreshold`, `castStatSpell`): pool is now the category at or below the
  shop tier, cast through `castSpellWithoutAim`. Its text ("stat-granting Shop spell") stays true: every member
  is a drawable Shop spell.
- **Rune of Thrift** (`spellCostReduction`): unchanged predicate (`isStatSpell`), which now also covers Great Pot.
- **Mage-Pup's taught cast**: uses `pickRandomSpellTarget` (now tribe-legal).
- Not changed: Spellhide / Spellmarket / Spellweaving measure the actual stat delta at the cast, not a list.
  The combat pickers `randomStatSpellBuff` (Spell Drummer, Spark Capacitor) are dormant: neither card fires them
  any more (Spell Drummer left the pool 2026-07-08; Spark Capacitor was reworked to add Waking Rifts).

## Open question for the owner

The shop-buff spells (Apples, Staff of Guel, Facetwright's Choice, Veinstorm, Picnic) stay OUT of the category
("the shop based ones i'm iffy on"). Rune of Thrift still discounts them. If they should be castable, drop their
factories from `OFF_BOARD_STAT_FACTORIES` and update the pinned table in `statSpellCategory.test.ts`.

Crest of the Climb was listed as a shop spell in the brief, but it is a targeted Choose One ("give a minion +4
Attack, or +4 Health"), the same shape as Spirit Fire. It is IN, and casts a random branch.

Oracle: R-RUNE-15. Tests: `packages/sim/src/statSpellCategory.test.ts`.
