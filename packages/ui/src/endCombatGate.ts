/**
 * When may the player leave a finished fight? The End Combat gate, as one pure function so the combat screen's
 * `EndTurnButton` and its regression test read the same rule.
 *
 * The replay must have finished. After that:
 * - a WIN or a DRAW is ready at once;
 * - a sandbox REPLAY is ready at once (the hero-strike sequence never runs in a replay, see `Recruit.tsx`);
 * - a LOSS normally waits for the hero-strike sequence to land (`strikePhase === 'done'`), because the settle
 *   (the Resolve hit) rides its impact;
 * - a LOSS whose outcome was ALREADY SETTLED before the sequence could start is ready too. That is a fight
 *   restored by Continue after a reload: the run was saved with `combatSettled: true`, so the strike sequence
 *   early-returns (it must, or the blow would play for damage already taken) and `strikePhase` stays null
 *   forever. Before this rule the button stayed disabled and the run could not leave the screen (bug
 *   2026-09-28). Mid-sequence the phase is `'blast'` (set BEFORE the impact settles), so a live loss still
 *   waits for the blow to land.
 *
 * Nothing here dispatches; leaving still goes through `resolveCombat`, whose settle step is guarded by
 * `combatSettled`, so no damage, Armor, placement or rating is applied a second time.
 */
export type StrikePhase = null | 'tally' | 'blast' | 'done';

export interface EndCombatGateInput {
  replayDone: boolean;
  replayResult: 'win' | 'lose' | 'draw' | null;
  sandboxReplay: boolean;
  strikePhase: StrikePhase;
  combatSettled: boolean;
}

export function endCombatReady(g: EndCombatGateInput): boolean {
  if (!g.replayDone) return false;
  if (g.sandboxReplay || g.replayResult !== 'lose') return true;
  if (g.strikePhase === 'done') return true;
  // Settled before any strike began (restored after a reload): nothing is left to wait on.
  return g.strikePhase === null && g.combatSettled;
}
