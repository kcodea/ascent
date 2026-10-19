# Great Pot and Rune of the Shared Table skipped All-types minions

**Owner report (2026-10-18):** "i used great pot here and it didnt buff my all type - that's a bug".

**Cause.** Great Pot (`buffOnePerTribe`) and Rune of the Shared Table (in `noteSpellCast`) each had their own copy of the
"one friendly minion of each type" walk, and both read only the card def's `tribe` / `tribe2`. An All-types card
(Paragon, Standard Bearer, ...) is printed `tribe: 'neutral'` with `universalTribe: true`, so it looked typeless and was
skipped. The Anomaly Reactor's `allTribes` mark and spell-added tribes were invisible to it too.

**Fix.** One shared helper, `onePerTribeTargets` in `packages/sim/src/recruit.ts`, used by both. It follows the
Fatecarver / Paragon convention from `arena.ts`: an All-types body always takes its OWN slot; a dual-tribe body fills
both its slots and is never counted twice; spell-added tribes count; neutrals are skipped.

**Pinned by** `packages/sim/src/onePerTribeAllTypes.test.ts` and oracle rule R-ONE-PER-TRIBE-ALL-01
(`packages/rules/src/registry/approved/targeting.ts`).
