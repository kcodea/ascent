# 2026-09-29: A knockout always plays the Huge hero attack

Owner ask (2026-09-29): "add logic so that if a player knocks someone out, it always plays the "huge" animation."
Oracle R-PROG-ATTACK-20. It is numbered 20, not 15, so it stays clear of the numbers the styles landing in parallel may take.

## What changed

Every hero attack style picks a damage tier I..IV from the blow (I 1-5, II 6-11, III 12-19, IV 20+). When the blow
ELIMINATES the struck player, the attack now always plays Tier IV, whatever the number. That covers every style
(Classic, Blast, Quake, Arcana, Phantom Blades, Enraged Strike, Venom Volley, Frost Nova, Consecration) and the damage
formation, which reads the tier's `k` off the style's plan. It works in both directions: your blow that knocks the foe
out, and the foe's blow that knocks you out. It is presentation only. The number shown and the consequence are
unchanged.

## How

- **One rule, one place.** `attackTier(total, ctx, thresholds)` in `packages/ui/src/heroAttack/tiers.ts` returns
  `KNOCKOUT_TIER` (4) when `ctx.knockout`, else the shared `tierOf`. Every style's `*PlanInput` now `extends
  AttackTierContext` (`{ knockout?: boolean }`) and its plan does `const tier = attackTier(total, input, c)`. Classic's
  runner does `attackTier(o.total, o)`.
- **The shared options carry it.** `HeroAttackOptions.knockout` (`heroAttack/options.ts`). Each runner passes
  `knockout: o.knockout` into its plan call.
- **Where knockout is read.** `heroStrikeKnockout(run, won)` in `packages/ui/src/heroBlast/heroStrikeDamage.ts`,
  next to `heroStrikeDamage`. The lobby settles the round later, at `resolveCombat`, so at the moment the attack starts
  no elimination is recorded yet. So the helper reads the pools the engine settles FROM, with the engine's own charge
  rules: the blow (`heroStrikeDamage`, the same number the settle charges) goes through Armor, then Resolve, and a seat
  at 0 is out (`hitSeat` + `knockOutIfDead`).
  - On your loss it reads the run's `resolve + armor`, because `settleCombat` re-seeds seat 0 from the run before it
    charges. Invulnerable Practice (health not `normal`) is never a knockout, because the settle restores the seat.
  - On your win it reads the paired foe seat's pools (`playerOpponent`). A ghost (a bye, or a stand-in for a seat with
    no board) is never charged, so it never counts.
- **Replays and Match details** use the same code path. Replay playback renders a synthetic run through the same
  `Recruit.tsx` post-combat effect. Its lobby and pools come from the recorded shop view before the fight, so it plays
  what the live fight played.
- **Tuners and the Collection preview** have no Knockout toggle. That would mean a button in nine tuners, so it was
  skipped as not trivial. `playAttackDemo` could forward `knockout` later if the owner wants to preview it.

## Merging with the in-flight styles (fire, bleed, undead, beast, banana; PRs #1839-#1847)

Each new style needs these one-line changes when it lands on top of this. Otherwise its knockout blow plays by damage
alone.

1. In its `*Config.ts` plan: change `const tier = tierOf(total, c);` to
   `const tier = attackTier(total, input, c);`, and import `attackTier, type AttackTierContext` from
   `../heroAttack/tiers` (and drop `tierOf` from that import if nothing else uses it).
2. On its plan input interface, add `extends AttackTierContext` (`export interface FirePlanInput extends
   AttackTierContext {`).
3. In its runner's plan call, add `knockout: o.knockout` (`firePlan({ total: o.total, knockout: o.knockout, ... })`).
4. Add it to the `tiered` list in `packages/ui/src/heroAttack/knockoutTier.test.ts`.

`Recruit.tsx` already passes `knockout` to every runner through the shared options, so a new branch in the style
dispatch picks it up with no change there.

## Tests

`packages/ui/src/heroAttack/knockoutTier.test.ts` covers four things:

- The helper.
- Every style's runner: a knockout blow of 3 plays Tier IV, and a non-lethal 3 stays Tier I. Classic is checked
  through its plan's `k`.
- `heroStrikeKnockout` in both directions.
- The Practice-invulnerable and zero-blow exclusions.
