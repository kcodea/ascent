# Roomworks fires End of Turn live in combat

Owner 2026-11-07: "This trigger should happen in combat in real time", then "Make sure all relevant animations fire too".

Dawnclaw (or any combat re-trigger) firing Roomworks used to print a line and land the End of Turn when the Shop opened,
because Roomworks sat on `SHOP_ONLY_SHOUTS`. No End of Turn effect could run in combat at all.

- `replayCombatEndOfTurn` in `factories.ts` is the one combat End of Turn chokepoint. `COMBAT_END_OF_TURN` holds the combat
  bodies. `SHOP_ONLY_END_OF_TURN` lists the effects that need the Shop or the run card; `combatEndOfTurn.test.ts` fails when
  an End of Turn id is in neither place.
- Those Shop-only effects (Consume, Orbit, a cast of a spell with no combat body like Lasso) do NOTHING when fired in combat.
  A first cut deferred them to the next Shop; owner 2026-11-07: "should do nothing and not fire at start of turn".
- New side facts `cardsPlayedThisTurn` and `unusedEquipment` are snapshot-captured, so served boards read their own run.
- A fire is a `shout` event with `eot: true`, not an `sc` line: narration has no beat of its own. Reusing the event gives it the
  existing moment, tendril and parked swing. `score.ts` swaps the Shout burst for the target's End of Turn flourish.

Consequence worth remembering: stats from these fires are now combat-only (owner rule 2026-10-10), where they used to be
permanent because they landed in the Shop. That is a real nerf to Roomworks with permanent End of Turn scalers.
