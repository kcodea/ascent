# 2026-10-24 — Conductor: a run-wide improvement, +3/+3 per Shout trigger

**Owner rulings (verbatim):**
- "every played conductor should buff every other conductor's buff. so if one conductor is played, the next conductor
  found gets the increases buff from it"
- "no, it improves by +3/+3 each trigger of the shout."
- "so if it gets triggered in combat, those stats won't be permanently granted, but the improvement would be."

**What shipped.** Conductor (`n2_conductor`) now reads "**Shout:** give adjacent minions **+3/+3**. Improve all
Conductors by **+3/+3** this game." Its Shout grants `(3 + N) x golden` to the adjacent minions, then raises the
RUN-WIDE `RunState.conductorBuff` (N) by `step` (3) x Rune of Mastery. Every trigger steps it: the play, a shop re-fire
(Moira, Ryme, Dawnclaw, a hero power) and a combat re-fire (Parting Cry, Rune of Shared Scripture). Sequence:
+3/+3, +6/+6, +9/+9, ... Gilded doubles the applied grant, never the step. Oracle: R-CONDUCTOR-RUNWIDE-01 (triggers.ts).

This revives the dormant 2026-08-21 `conductorBuff` plumbing (run state, snapshot capture, `CombatSideState`,
`enemyScalers`, the instView live field) instead of adding a parallel system. It replaces the 2026-09-23 per-copy
`summonBonus` accrual, which is no longer written; a copy that already carries one (an in-flight run, an old recorded
board) still pays it on top, so nothing a player built is lost.

**How it is wired (one body, both phases).**
- `ARENA_EFFECTS.battlecryConductorAdjacent` reads `arena.conductorTally()` and calls `arena.growConductor(step)`.
- Shop arena: reads/writes `state.conductorBuff`.
- Combat: `simulate` keeps a per-side live value (`conductorLive`, seeded from each side's `conductorBuff`), and the
  growth rides `ShoutCarry.conductorBuff`; settle folds the PLAYER's carry into `conductorBuff` (the enemy's goes
  nowhere). The adjacent grant is a plain combat buff, so it is gone after the fight (buff permanence by phase).
- The combat factory logs `improve { conductor, side }`; `combatPreviewFold` folds it per side and Recruit publishes it
  through the existing `combatScoutPreview` bridge (`fxConductorPreview`), so every Conductor's text, either side,
  climbs on the beat. `conductorBuffLive(run)` is the player read; Unit.tsx adds the foe's `enemyScalers.conductorBuff`.
- `conductorText(cardId, golden, improvement, reps)` rewrites the grant (and the step under Mastery).

**Readings taken (flag to the owner if wrong):** the text wording; Rune of Mastery doubles the step (as it did before);
re-triggers outside a play step it too (per the 2026-10-24 correction).

**After merge:** content changed, so redeploy versus-resolve (and run parity).
