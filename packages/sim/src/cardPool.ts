import { inRunTribes } from '@game/core';
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
export function poolOf(state: Pick<RunState, 'setId'> & Partial<Pick<RunState, 'tribes' | 'practiceConfig'>>): CardPool {
  const base = poolFor(state.setId ?? 'set1');
  // PRACTICE TRIBES (owner 2026-09-27: "that tribe's cards plus neutral cards, and all spells associated"): a
  // Practice game played with picked tribes draws from a pool NARROWED to them, so every random pick, not only
  // the gated shop/Discover sites (a "random minion" grant, a combat-generated card), stays on those tribes plus
  // neutral. Tokens stay: they are made by specific cards, never drawn. Every other run (Normal Practice
  // included) gets the set's pool untouched, so nothing else moves.
  const picked = state.practiceConfig?.tribes;
  if (!picked || picked.length === 0 || !state.tribes || state.tribes.length === 0) return base;
  return narrowedPool(base, state.tribes);
}

const NARROWED = new Map<string, CardPool>();
function narrowedPool(base: CardPool, tribes: readonly string[]): CardPool {
  const key = `${base.setId}|${[...tribes].sort().join(',')}`;
  const hit = NARROWED.get(key);
  if (hit) return hit;
  const all = base.all.filter((c) => c.token || inRunTribes(c, tribes));
  const pool: CardPool = {
    setId: base.setId,
    all,
    buyable: all.filter((c) => !c.token && !c.spell),
    spells: all.filter((c) => c.spell && !c.token),
  };
  NARROWED.set(key, pool);
  return pool;
}

/** The set a run is pinned to, defaulted for pre-sets saves. */
export function setIdOf(state: Pick<RunState, 'setId'>): SetId {
  return state.setId ?? 'set1';
}
