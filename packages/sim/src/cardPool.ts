import type { CardPool, SetId } from '@game/content';
import { poolFor } from '@game/content';
import type { RunState } from './state';

/**
 * The card pool a RUN draws from — resolved from the set pinned on the run, never from the live registry.
 *
 * This is the single seam between "which set is switched on right now" and "which set this run is being
 * played under". Every draw site goes through it, so flipping the active set mid-session can never change
 * what an in-flight or replayed run rolls. `activeSet()` is for creating a NEW run and nothing else.
 *
 * Saves written before sets existed carry no `setId`; they resolve to `set1`, which is exactly the pool
 * they were played under, so old saves and replays keep working untouched.
 */
export function poolOf(state: Pick<RunState, 'setId'>): CardPool {
  return poolFor(state.setId ?? 'set1');
}

/** The set a run is pinned to, defaulted for pre-sets saves. */
export function setIdOf(state: Pick<RunState, 'setId'>): SetId {
  return state.setId ?? 'set1';
}
