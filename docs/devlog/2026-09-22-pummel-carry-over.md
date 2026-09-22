# 2026-09-22 — Pummel carries over again: the lifetime tally is back, the payout stays once per combat

Owner ruling, later on 2026-09-21 than the Pummel keyword itself (built 2026-09-22 after a PC restart paused
the branch): *"Pummel is broken / not working correctly: it is resetting to 0/X after combat. It needs to carry
over from turn to turn and combat to shop etc. It was working before."*

PR #1607 (the keyword) had set BOTH damage meters to `resetEachCombat: true` and made the shop print 0 for a
reset meter. That reversal is itself reversed here. The rule from now on is ONE rule, in
`packages/core/src/types.ts` above `DAMAGE_METER_MARKERS`:

- **The tally is lifetime per instance.** `instantiate` (`minion.ts`) seeds the combat body from the run card's
  `damageDealt` again; `settleCombat` (`reducer.ts`) writes the whole total back (`playerDamageMeters` reports
  seed + this fight's hits, dead bodies included, since the run card outlives the combat death); the served-board
  snapshot carries it; a Rise / Rebirth body is the same combat instance and keeps counting; a triple keeps the
  highest copy.
- **A payout is owed each time the tally crosses a multiple of X** — the pre-#1607 crossing math is restored in
  `noteDamageDealt` (`simulate.ts`): `Math.floor(after / every) - Math.floor(before / every) > 0`.
- **But at most one payout per combat**: the `pummelFired` latch (fresh every fight, not re-armed by Rise) is
  checked FIRST, so a second crossing in the same fight is spent silently, and one enormous hit that crosses
  several multiples pays once. Uncredited crossings are spent, not banked: 120 in one hit pays once and the
  next Ale waits for 160. One `pummelTrigger` event per body per combat, as before.
- **The readout on every surface is `total mod X`** (`damageMeterReading`): Han Gover at 47 reads 7/40 in the
  shop (`instView` passes the real run-card tally again) and in combat (`computeFrame` folds the fight's `dmg`
  events on top of the seed). Nothing clamps at X/X any more, so after this fight's payout the badge keeps
  showing live progress toward the multiple that pays next combat.

`resetEachCombat` is gone, not kept false: every consumer seeds, carries and prints the same way, so the flag
would have been a switch with no reader. `DamageMeter` is now `{ do, every }`.

## Where it landed

- Core: `types.ts` (markers, `damageMeterReading`, doc lines on `BoardMinion` / `Minion` / `MinionSnapshot` /
  `CombatResult` / the factory ids / `pummelTrigger`), `simulate.ts` (`noteDamageDealt`, the carry-back),
  `minion.ts` (the seed).
- Sim: `reducer.ts` (settle carry-back + the triple merge comment), `state.ts`, `snapshot.ts`, `recruit.ts`
  stub comments.
- UI: `instView.ts` (no reset special case), `cardText.ts` `stepProgress` comment, `Unit.tsx`,
  `useCombatReplay.ts`, `keywordGlossary.ts` (the def is now *"Pummel (X): Triggers each time this minion has
  dealt another X damage. The damage count carries over between combats."*), `renderedText.registry.ts`,
  `patchNotes.ts`.
- Content: the Han Gover / Goldvein comment blocks; card texts unchanged.
- Docs: `docs/GAME-RULES.md` Pummel section, `docs/combat-events.md`.
- Tests rewritten for carry-over: `pummelTrigger.test.ts` (seeded 35 pays on a 5 hit; 47 reads 7/40; two
  combats each pay once; 120 → next payout at 160; a second crossing in the same fight pays nothing),
  `set3Dwarves.test.ts` (the pre-#1607 carry-over expectations restored, the once-per-combat ones kept),
  `goldvein.test.ts`, `stepProgress.test.ts`, `damageMeterBadge.test.ts` (the seeded badge: 30/40 → 5/40 →
  20/40 → 35/40).
