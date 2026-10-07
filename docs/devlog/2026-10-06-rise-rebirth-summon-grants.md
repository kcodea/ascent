# 2026-10-06: Rise and Rebirth returns take the "summoned in combat" grants (R-SUMMON-RETURN-01)

Owner report: "rune of the undertow didnt proc on a rising minion. it should, it should also proc on a rebirth
minion. please fix"

## Root cause

A Rise or Rebirth return does not make a new minion. `killOrReborn` re-slots the SAME instance and emits a `reborn`
event, then runs `summonEntryEffects` (the onSummon watchers, tallies, auras, Second Litter, and so on). That half
was already right: a return has counted as a summon there since the 2026-08-12 ruling.

The other half was not. The grants that change the ARRIVING body lived inline in `summonMinion` (Rune of the
Undertow's Ward, Hatchery, Packcraft, Food Chain, Spare Chair) and `placeSummon` (Solid Ground, Containment Rune),
before the `summon` snapshot. A return never passes through either function, so all seven skipped returning bodies.
R-RUNE-06 already said Packcraft counts a Rise return; the code never did.

## Fix

- `applyCombatSummonGrants(minion, side)` in `simulate.ts` is now the one home of the five rune grants. `summonMinion`
  calls it as before. `applySolidGround` / `applyContainment` were split out of `placeSummon` the same way.
- `returnSummonGrants(minion)` runs them on a Rise and a Rebirth return in the placed-summon order (grants, Solid
  Ground, Containment), after `nextStep()` and before the `reborn` event. The rune pulse shares the return's beat and
  the `reborn` event carries the resulting body (Ward, stats, Taunt), which the replay applies verbatim.
- Spare Chair's immediate attack on a return rides the existing interrupting queue item (Ancient of War's Undying
  strike), one item even when both apply.
- Food Chain never reads the returning Demon as its own source (`m !== minion`).
- Budgets are shared: a return spends one Undertow Ward, one Solid Ground charge, one Packcraft step. A return whose
  Ward was restored (Rebirth) costs Undertow nothing. An overflowed return takes nothing.

Not changed, by their own scope: Rune of the Wrangler / Living Geode and Heart of the Mountain (named token or
summoner), Rune of Living Treasure (its Rebirth on a returning Golem would loop; R-RUNE-09 says "returns once"), and
Echo Warden (copies a summon; returns already get Ancient of Genesis copies through `summonReturnExtras`).

## Doc Bot

New class rider in `combatModScan.ts`, `summonReturnRider`: for every `QuestCombatMods` key it compares a plain Echo
summon against an Imp that Rises and one that is Reborn, armed vs unarmed. A mod that changes the summoned body but
not the returning one is a violation. On the old engine it names exactly Undertow, Hatchery, Packcraft and Solid
Ground. `ancientRallyGold` is exempt with a reason (a returning body already carries the Shop graft).

Side finding, not changed: Rune of Beastial Swarm's death block sits on the true-death path only, so a Beast's Rise
or Rebirth death does not feed it. That is the death half of the "a Rise death is a real death" rule, not a summon
grant, so it is left for an owner call.
