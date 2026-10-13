/**
 * THE END-GAME GATE (owner 2026-10-13): "when a player either loses or wins, when they hit the gem to end the combat
 * phase, i want the doors to slide closed and slam for a moment and then reopen to the end game stats screen.
 * basically the exact version we had in place yesterday before todays adjustments. do NOT touch the start match
 * screen we did today".
 *
 * So the fight that ENDS a game leaves through the gate (its `end` variant: close, slam, a one second hold, shudder,
 * open; no crystal) instead of the blue sweep every other fight leaves through, and the end screen is swapped in
 * behind the shut doors.
 *
 * KNOWING IT IS THE LAST FIGHT. Whether a game ends is decided when the fight is left: the lobby round settles then
 * (the other seats fight, seats are knocked out), and only after that is the table finished or the player out. That
 * resolution must run EXACTLY ONCE (it tells each live seat what happened, and a seat told twice plays two shops), so
 * it cannot be tried and then redone. The combat screen therefore resolves it at the press through the store's
 * prepared-action seam (`preparePresentationAction`, the one End of Turn uses: resolve now, show later), reads the
 * answer off the result, and commits that same result behind the doors (or under the blue sweep when the game goes
 * on).
 *
 * `combatMayEndGame` is the cheap question asked first, so an ordinary round is left exactly as before, with nothing
 * resolved at the press. It may say yes to a fight that does not end the game (the real answer then comes from the
 * resolution); it says no only when the game cannot end here, with one accepted miss, see `END_GATE_MAX_RIVALS`.
 */
import type { RunState } from '@game/sim';

/** With more rivals than this still standing, the table is taken not to be able to finish this round (every one of
 *  them would have to fall at once). If that ever does happen, the game ends through the blue sweep as it always did:
 *  the end screen is the same, only the doors are missed. */
export const END_GATE_MAX_RIVALS = 3;

/** An invulnerable Practice game (Unlimited health) ends at its round-15 curtain (`advanceCombat`, reducer.ts). */
const PRACTICE_CURTAIN_ROUND = 15;

/**
 * Could leaving this fight end the game? Only ever true for a live lobby game (ranked or Practice): the tutorial,
 * the Gauntlet (their own endings), a sandbox run (God Mode, the Scene Builder) and the retired course are left to
 * the blue sweep. Reads the run as it stands at the press; it resolves nothing.
 */
export function combatMayEndGame(run: RunState): boolean {
  if (run.phase !== 'combat' || !run.lastCombat || run.pendingCombatSide) return false;
  if (run.mode !== 'lobby' && run.mode !== 'practice') return false;
  const lobby = run.lobby;
  if (!lobby || run.sandbox === true) return false;
  if (lobby.finished || lobby.round >= lobby.rules.maxRounds) return true;
  const me = lobby.seats[0];
  const invulnerable = run.mode === 'practice' && run.practiceConfig?.health !== 'normal';
  if (invulnerable) {
    if (run.wave >= PRACTICE_CURTAIN_ROUND) return true;
  } else if (me) {
    // The player's seat is still at its health from before this fight (the lobby round settles on the way out), so
    // the fight's own damage against it says whether this could be the knockout. The uncapped damage, times any
    // bot table's multiplier: never less than what the settle will charge.
    const mult = Math.max(1, ...lobby.seats.map((s) => s.botDamageMult ?? 1));
    if (me.armor + me.resolve <= Math.max(0, run.lastCombat.playerDamage ?? 0) * mult) return true;
  }
  return lobby.seats.filter((s) => s.id !== 's0' && s.alive).length <= END_GATE_MAX_RIVALS;
}

/** Did resolving the fight end the game? `after` is the prepared resolution's run. A lobby never reaches `victory`
 *  (a win is placement 1 at `gameover`); it is read too so a mode that does is not missed. */
export function resolutionEndsGame(after: Pick<RunState, 'phase'> | null | undefined): boolean {
  return after?.phase === 'gameover' || after?.phase === 'victory';
}

/** The gate is skipped under reduced motion (it would be an instant swap): the fight then leaves the usual way. */
export function gateMotionAllowed(): boolean {
  return !(typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
