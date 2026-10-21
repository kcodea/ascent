# 2026-10-21 — All types counts as every tribe, everywhere

Owner ruling: "yes" to the list of raw-tribe sites that #2181 (Deep Delve Writ) left alone. Rule
R-ALL-TYPES-EVERYWHERE-01 (`packages/rules/src/registry/approved/targeting.ts`).

## What changed

Every remaining hand-rolled `c.tribe === t || c.tribe2 === t` membership check in sim and core now goes through the
shared predicates, so an All-types card (Paragon, Standard Bearer, an Anomaly Reactor "All" body) counts as that tribe:

- **Shop pools** (`recruit.ts`, `reducer.ts`): Dragon's Pantry grant, the top-type grant, Brill's Gold-spent grant,
  conjure / Discover by tribe, the random-tribe summons under Funeral on Loan, the Shout-Dragon grant, Tribes Choice,
  Undead Army, the tier+tribe grant, the dominant-type offer, the quest-reward tribe grant, the Basic / Epic tribe rune
  drip (`payTribeDrip`), Sigil of Kinship's refill, the Magnetic Mech pick.
- **Shop checks**: Hoardflame's Dragons-played count (effect and live text), the Beast/Dragon End-of-Turn played count,
  Rune of Spellhide's Beast, Rune of the Last Word's Dragon, Shared Reflection's Dragon neighbours, Company Rate's Dwarf
  price, the Celestial check, the Anomaly Reactor no-op, the Undead/Beast buy auras (already correct, now shared), the
  quest buy / sell / summon tribe ticks.
- **Cast gates** (`spellFizzle.ts`): Crescendo, Undead Army and Tribes Choice now agree with the pools they gate.
- **Combat** (`simulate.ts`, `factories.ts`, `arena.ts`): Ancestral Roar's Dragon, Candlelight Toll and Gemstorm's
  Kobolds, Shared Circuit and the shield-transfer Mechs, Salvage's Magnetic pool and trigger, the Ruby-play tribe
  filters, the random-tribe summon pools, the Magnetic Mech grant. New `bodyIsTribe` in `core/src/combat/tribe.ts` for
  the factories (which had no body-level helper).

Seeded order is unchanged: each pool is still `poolOf(state).buyable` in its usual order; All-types cards now pass the
filter. Seeds that used to draw from a pool without them can land on a different card.

The Doc Bot tribe ratchet pins dropped: recruit 35 to 7, reducer 12 to 5, simulate 32 to 24, factories 36 to 32,
arena 12 to 11. Its doctrine no longer exempts pool-draw filters (that was the owner-deferred question, now ruled).

## Left alone (judgement calls, flagged in the PR)

Type COUNTING sites, where All types is a wildcard rather than a member: `dominantBoardTribe`, `uncontrolledTribes`,
the distinct-type counters, Rune of the Centerline's "different types on each end" (shop and combat), Wishbone's
archived type (an archived All-types minion still records "neutral"), Tribes Choice's target type (an All-types target
still has no single type to fetch), snapshot / synthesize / bot scoring heuristics.

## Verification

`packages/sim/src/allTypesEverywhere.test.ts`: 9 tests, 8 fail on the old code (the 9th is a fixture check).
