/**
 * Which runs submit a rank request (the ONLY path into `submit-rating`). A rated lobby with a final
 * placement, and never a lobby whose opponents were all generated (owner 2026-09-28: "offline = unrated").
 * Pure, so the rule is tested without the store.
 */
import { abandonPlacementOf, lobbyIsUnrated, rankedRunIdOf, type RunState } from '@game/sim';
import { ordinal } from './rankFormat';

export function rankedRunIdForFinish(run: Pick<RunState, 'mode' | 'lobby' | 'runId' | 'seed'>, placement: number | null): string | null {
  if (run.mode !== 'lobby' || placement == null) return null;
  if (run.lobby && lobbyIsUnrated(run.lobby)) return null;
  return rankedRunIdOf(run);
}

/**
 * THE ABANDON PENALTY SWITCH (R-RANK-05, DISABLED 2026-10-02). Owner, verbatim: "oh i didnt know there was an
 * abandon penalty in. can we remove that for now?" (after three Ranked wins in a row were each followed by an
 * 8th-place settlement of a fresh run he had left, so his MMR looked flat).
 *
 * While this is false, leaving or replacing an unfinished rated game (title Clear, Play / Practice / tutorial over
 * the save, a cloud save adopted over it) costs NOTHING: no rank request is queued, no `rank_results` row, no
 * Rating change, and the title tips carry no warning. The run is simply dropped. Any abandon request already
 * waiting in a player's `ascent.rankqueue` is dropped at flush instead of being sent (`rankSubmission.ts`).
 * Turn it back on by flipping this one constant: every caller and the placement rule are kept intact.
 */
export const ABANDON_PENALTY_ENABLED = false;

/**
 * QUITTING COSTS RATING (owner 2026-09-29, R-RANK-05; switched OFF 2026-10-02, see `ABANDON_PENALTY_ENABLED`).
 * A RATED lobby that is abandoned before it ends (discarded from the title, or replaced by starting a new game)
 * settles as a finish in the lowest placement still open (`abandonPlacementOf`). Returns the request to settle,
 * or null when nothing should settle: the penalty is switched off, or the run is not a rated, unfinished lobby
 * (practice, tutorial, sandbox, an all-generated lobby, a finished run). Save & Quit is not an abandon and never
 * comes through here. `enabled` exists so the kept rule can still be tested while the switch is off.
 */
export function rankedAbandonOf(
  run: Pick<RunState, 'mode' | 'lobby' | 'runId' | 'seed' | 'phase' | 'sandbox'> | null | undefined,
  enabled: boolean = ABANDON_PENALTY_ENABLED,
): { runId: string; placement: number } | null {
  if (!enabled || !run || run.sandbox) return null;
  const placement = abandonPlacementOf(run);
  const runId = rankedRunIdForFinish(run, placement);
  return runId && placement != null ? { runId, placement } : null;
}

/** The title's warning on the doors that abandon the saved run (Clear, and Play over a save): null when giving
 *  the save up costs nothing (always, while the penalty is off), else one short line naming the placement. */
export function abandonWarningOf(run: Parameters<typeof rankedAbandonOf>[0], enabled: boolean = ABANDON_PENALTY_ENABLED): string | null {
  const quit = rankedAbandonOf(run, enabled);
  return quit ? `It is a rated game, so giving it up counts as finishing ${ordinal(quit.placement)}.` : null;
}

/** A tooltip line with the abandon warning appended when the save is a rated game (and the penalty is on). */
export function withAbandonWarning(base: string, run: Parameters<typeof rankedAbandonOf>[0]): string {
  const w = abandonWarningOf(run);
  return w ? `${base} ${w}` : base;
}
