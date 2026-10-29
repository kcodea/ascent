import type { RunState } from '@game/sim';
import { versusRefuses } from '../versus/versusHooks';

/**
 * Does the store refuse to resolve End of Turn right now (R-REPEAT-06)? The ONE predicate `preparePresentationAction`
 * guards with and `Recruit`'s End Turn asks first, so the two cannot disagree: while it holds, End Turn plays NOTHING
 * (never the legacy one-beat-per-tick runner) and Versus re-asks once the match can take it.
 *
 *  - `replaying`: the store's run is not this player's (the replay viewer, the Duos teammate view).
 *  - `versusRefuses`: a Versus match is paused (its 3-2-1 included). End Turn is a game action, so a held shop allows it.
 */
export function endTurnRefused(st: { replaying: boolean; run: RunState }): boolean {
  return st.replaying || versusRefuses(st.run, { type: 'faceOmen' });
}
