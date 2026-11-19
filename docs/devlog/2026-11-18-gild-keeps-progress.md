# Gilding keeps progress (2026-11-18)

Owner report: "minions that track anything like spend etc should not reset when gilded. aka a Billings at 9/10 when
gilded should be at the furthest progress of the cards that tripled."

- ONE merge path makes a Gilded minion out of several instances: `combineIntoGolden` (every triple route, and the 2-copy
  gilds under Midas' Touch / Twin Gilding / Gilded Shortcut, funnel through `checkTriples`). Every other gild (`gildMinion`,
  the Start of Combat gilds, Auric Runemaster) flips the SAME instance, so its counters were never lost. There is no
  combat-time merge.
- The combine already carried spell progress, ascend progress, the Pummel tally, Hatcher's tick and the End of Turn
  cadence. It minted everything else unset. `packages/sim/src/gildProgress.ts` (`gildProgressCarry`) now carries the
  rest from one table keyed on the FIELD and the printed effect that owns it, never a card id: `goldTick`, `buyTick`
  (only on a `cardsBought` meter; Ninefold reuses the field as a charges-used count and is left alone), `playTick`,
  `rubyCastTick`, `shoutTick`, `orbitTick`, `soldProgress`, `spiritTally`, `eotTick` (cycle position on an End of Turn
  cadence, as before; the raw count on a Refresh meter).
- The rule is the highest copy, not the sum. Reduced cadence meters are clamped to `every - 1`, so a merge can never
  land on a threshold: it never pays out and the next step pays once.
- No UI change: `stepProgress` and the live text read the instance fields, so the Gilded card prints the carried count
  the moment it exists.
- Judgement call, flagged for the owner: `soldProgress` (Leeds), `spiritTally` (Aspect, Forest Colossus) and `eotTick`
  (Rosey, Vineweaver Drake) are counts whose level also sets a magnitude. They now take the highest copy (they restarted
  at 0). Sum of the two best (R-GILD-SUM-01) is the alternative.
- Left alone, for an owner call: per-turn latches; the accumulated values that still restart on a triple (`eotBonus`
  Ritualist, `sellBonus` Trail Forager, `rallySpreadAtk` Sunmane Herald, `attachments`, `grantedEffects`, `impBank`);
  Flowing Monk's countdown (fresh by its 2026-07-03 ruling).
- Rule: R-GILD-PROGRESS-01. Test: `packages/sim/src/gildKeepsProgress1118.test.ts`.
