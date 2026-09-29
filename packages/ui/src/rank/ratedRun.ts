/**
 * Which finished runs submit a rank request (the ONLY path into `submit-rating`). A rated lobby with a final
 * placement, and never a lobby whose opponents were all generated (owner 2026-09-28: "offline = unrated").
 * Pure, so the rule is tested without the store.
 */
import { lobbyIsUnrated, rankedRunIdOf, type RunState } from '@game/sim';

export function rankedRunIdForFinish(run: Pick<RunState, 'mode' | 'lobby' | 'runId' | 'seed'>, placement: number | null): string | null {
  if (run.mode !== 'lobby' || placement == null) return null;
  if (run.lobby && lobbyIsUnrated(run.lobby)) return null;
  return rankedRunIdOf(run);
}
