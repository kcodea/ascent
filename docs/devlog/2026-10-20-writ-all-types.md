# 2026-10-20 — Deep Delve Writ steals All-types minions

Owner report: "paragon/other all types should be stolen from deep delve writs".

## The cause

Deep Delve Writ (`spellStealShop` with `tribe: 'dwarf'`) has two halves. The steal's own pool in `recruit.ts`
already accepted `def.universalTribe`. The fizzle gate in `spellFizzle.ts` did not: it read only `def.tribe`,
`def.tribe2` and the run type overrides. A Shop whose only Dwarf-counting offer was Paragon or Standard Bearer
therefore refused the cast, the Writ stayed in hand, and the All-types body could never be taken. Neither half read
a displaced body's own Anomaly Reactor marks (`held.allTribes` / `held.addedTribes`).

## The fix

- New `offerIsTribe(state, offer, tribe)` in `recruit.ts`: a held body answers through `isTribeNatural`, every other
  offer through `defIsTribe` (All types, second tribe, run overrides). Neutral is never a match.
- The steal pool and the fizzle gate both call it, so they cannot disagree again.
- Test: `packages/sim/src/writAllTypes.test.ts` (fails on the old code). Rule: R-WRIT-ALL-TYPES-01.

## Not fixed here

Many other def-level filters still hand-roll `c.tribe === t || c.tribe2 === t || hasRunTribe(...)` without the
All-types case (Hoardflame's Dragon count, Sigil of Kinship's refill, the tribe pool pickers in `recruit.ts` /
`reducer.ts`, two more fizzle gates). Listed in the PR for the owner to rule on; some pool pickers may be deliberate.
