# 2026-09-19 — Settle-time buff ribbons wait for the shop reveal (the "Gangplank → Han Gover, no animation" report)

**Report.** Gangplank buffed Han Gover (Set 3 Dwarf/Undead): the stats went up, no ribbon. Owner: *"make sure
the dual type tribes can trigger their animations from the correct sources."*

**What it was NOT.** Not a tribe predicate. The whole buff-FX pipeline is uid-keyed: `captureBuffFx` diffs the
board by uid, `replayBuffFxEvents` / `fireBuffCasts` / `groupBuffCasts` resolve source and target by uid, and
Gangplank's pool goes through the arena's `isTribe` (dual types + All-types). Probed both halves: a shop buy with
Gangplank + Han Gover records the identical `gp → r` entry a plain Dwarf gets and fires `tendril-trail-dwarf`;
a combat Ale grant compiles its buff into its own `buffWave` moment with a `buffCast` for `m0 → m1`, and the live
fight fired `tendril-trail-dwarf {m0 → m1}` on Han Gover.

**What it was.** Han Gover's Ale is a COMBAT grant (40 damage dealt). It comes home at `settleCombat` via
`playerHandGrants`, where `reduce`'s hand uid-diff re-fires "a card was added to your hand" on the RUN board —
Gangplank's permanent payout — captured on `recruitBuffFx` with `recruitFxSeq` bumped **while the phase is still
`combat`**. `Recruit`'s replay effect ran under the arena: the warband is not in the DOM there, `findEl` found
nothing, the ribbon was dropped and the seq consumed. Back in the shop the recipient stood there with bigger
numbers. Any recipient, single- or dual-type, would have shown it; Han Gover is simply the card that mints Ales
out of combat, so it is where it surfaced.

**Fix (UI, `Recruit.tsx`).** A buff wave whose seq bumps while `inCombat` is parked in `settleFxRef`; a second
effect replays it once the curtain machine is back to `idle` with the phase on `recruit` (the warband measurable
again). A decisive combat (end screen) drops the parked wave. Verified live on a throwaway Scene Builder run: the
settle capture `b4 → b5` sat parked with no fire, then `tendril-trail-dwarf {b4 → b5}` fired on the reveal.

**Predicate pass (sim).** While in there, the hand-rolled def-tribe compares on the FX/trigger path were routed
through the shared predicates: `auraFxTargets`' shop branch and `fireOnGainCard`'s Heavy Payroll gate now use
`defIsTribe`; `Recruit`'s aura-preview (`undead` / `beast`) too. `defIsTribe` is now exported from `@game/sim`.
Behaviour-identical (the old compares already covered `tribe2` + `universalTribe`); DRY only.

**Tests.** `packages/sim/src/dualTribeBuffFx.test.ts` — Orin vs Han Gover record the identical FX entry; the
Undead aura wash targets a Dwarf/Undead on the board and in the shop row; a real combat Ale grant settles with the
Gangplank wave captured, seq bumped, phase still `combat` (the contract the UI parks on).

**Follow-up worth knowing.** The parked ribbon lands on a badge that already shows the new number (the stat
committed under the curtain). Holding the badge across the reveal would need the `statHold` channel to survive the
phase flip — not done here.
