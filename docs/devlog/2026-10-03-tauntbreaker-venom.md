# 2026-10-03: Tauntbreaker gets Pummel (25); Venom prints Execute

Owner changes (verbatim):

- "Tauntbreaker -> Rally: Remove Taunt and Rise from the target. Pummel (25): Get a random Shop Spell."
- "Venom -> Execute. just needs the text keyword added to body"
- "wire new tauntbreaker art"

## Tauntbreaker (`tauntbreaker`, set 1 neutral def, drawn by set 1 and set 2)

- The Rally strip (`onAttackStripKeywords`, Taunt + Rise) was already the card's behaviour; unchanged.
- New Pummel marker `dealtDamageGetRandomSpell` on the shared damage meter (`noteDamageDealt` in
  `packages/core/src/combat/simulate.ts`). The payout is `ctx.grantRandomSpell` (the run's set pool, at or below
  the shop tier, never a token), a live `toHand` mid-fight, settled via `playerHandGrants`. Registered in the
  `EffectFactoryId` union, `DAMAGE_METER_MARKERS`, the schema whitelist, the presentation policy registry, the
  core factory + recruit no-ops, and `stepProgress` (the live `n/25` badge on every surface).
- **Repeat decision:** the owner text prints no per-combat rider, unlike every other Pummel card ("(Once per
  combat)", "(Twice per combat)", "(Max 5 per combat.)"). The keyword's glossary definition is "Triggers each time
  this minion has dealt another X damage", and the hero Pummel that prints no rider (Ancient of War x Gorr) repeats.
  So Tauntbreaker pays every multiple of 25 with no cap. Implemented as `maxPerCombat: 'unlimited'` (the default
  stays 1, so no other card moves). R-PUMMEL-01's statement now names this case; R-PUMMEL-03 pins it.
- **Gilded:** "Get **2** random **Shop Spells**", threshold unchanged (the Pummel convention: Kobe, Maestro Lux, Han
  Gover double the payout, never the X). The Rally strip has no gilded variant (it already strips both keywords).
- Shop phase: the meter only advances on landed hits, so it moves in combat; the tally carries combat to shop to
  combat and the shop badge prints it. A Shop Rally replay (Rune of Lasting Cadence) has no target and no-ops.
- Art: the new master `Set 2 Minions/Neutral/Tauntbreaker.png` wired with `art:wire --only=minions`; every other
  file the tool re-encoded was reverted.

## Venom (`venom`)

Already had the Execute behaviour (keyword `V`, R-EXECUTE-01). Text was empty; now `**Execute.**` so the pill and
glossary show. No behaviour change. Oracle R-EXECUTE-03.

## Noticed, not fixed

Kobe (`k_kobe`, `dealtDamageGetRandomRuby`) is missing from the `stepProgress` meter literal list in
`packages/ui/src/cardText.ts`, so its Pummel badge does not show. Separate fix.
