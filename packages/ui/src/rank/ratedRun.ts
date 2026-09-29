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
 * QUITTING COSTS RATING (owner 2026-09-29, R-RANK-05). A RATED lobby that is abandoned before it ends
 * (discarded from the title, or replaced by starting a new game) settles as a finish in the lowest placement
 * still open (`abandonPlacementOf`). Returns the request to settle, or null when the run is not a rated,
 * unfinished lobby: practice, tutorial, sandbox, an all-generated (unrated) lobby, or a finished run all
 * abandon for free. Save & Quit is not an abandon and never comes through here.
 */
export function rankedAbandonOf(run: Pick<RunState, 'mode' | 'lobby' | 'runId' | 'seed' | 'phase' | 'sandbox'> | null | undefined): { runId: string; placement: number } | null {
  if (!run || run.sandbox) return null;
  const placement = abandonPlacementOf(run);
  const runId = rankedRunIdForFinish(run, placement);
  return runId && placement != null ? { runId, placement } : null;
}

/** The title's warning on the doors that abandon the saved run (Clear, and Play over a save): null when giving
 *  the save up costs nothing, else one short line naming the placement it would count as. */
export function abandonWarningOf(run: Parameters<typeof rankedAbandonOf>[0]): string | null {
  const quit = rankedAbandonOf(run);
  return quit ? `It is a rated game, so giving it up counts as finishing ${ordinal(quit.placement)}.` : null;
}

/** A tooltip line with the abandon warning appended when the save is a rated game. */
export function withAbandonWarning(base: string, run: Parameters<typeof rankedAbandonOf>[0]): string {
  const w = abandonWarningOf(run);
  return w ? `${base} ${w}` : base;
}
