/** The run's seed / tribe derivations (moved verbatim from `state.ts`, 2026-10-31). Dependency-light on purpose: the
 *  Versus server bundle deals hero offers by the run's tribes (`versus/heroOffers.ts`) and must not pull the run state. */
import { makeRng, type Rng, type Tribe } from '@game/core';
import { SETS, activeSet, type SetId } from '@game/content';

/**
 * Tags that separate the run's RNG streams. The shop stream advances with the
 * player's rolls (its cursor lives in RunState); the threat/enemy/combat streams
 * are derived purely from (seed, wave) so they're identical every time a wave is
 * re-resolved — which is why the recruit-phase preview matches the actual fight.
 */
export const TAG = { THREAT: 1, ENEMY: 2, SHOP: 3, COMBAT: 4, TRIBES: 5, MAGNET: 6, ODDS: 7, GILD: 8, QUEST: 9 } as const;

/** The playable (non-neutral) tribes. Grows as tribes are added; a run draws 5 of them. */
export const PLAYABLE_TRIBES: Tribe[] = ['beast', 'dragon', 'undead', 'mech', 'demon'];
export const TRIBES_PER_RUN = 5;

/**
 * Pick a run's active tribes (handoff: only 5 tribes appear in a run at once) from `roster` — the PINNED
 * set's tribe list, so a set-2 run draws Kobolds and a set-1 run never can. Neutral glue is always available
 * on top. With exactly 5 playable tribes in set 1 this returns all of them (shuffled); it bounds the pool once
 * more are added. A smaller roster (set 2's single `kobold` today) simply returns those.
 */
export function selectRunTribes(rng: Rng, roster: readonly Tribe[] = PLAYABLE_TRIBES): Tribe[] {
  const pool = [...roster];
  const picks: Tribe[] = [];
  while (picks.length < TRIBES_PER_RUN && pool.length > 0) {
    picks.push(pool.splice(rng.int(pool.length), 1)[0]!);
  }
  return picks;
}

/** Deterministic 32-bit mix of a seed and a few small integers (FNV-1a style). */
export function mixSeed(...parts: number[]): number {
  let h = 0x811c9dc5 | 0;
  for (const part of parts) {
    h = Math.imul(h ^ (part | 0), 0x01000193);
    h ^= h >>> 13;
  }
  return h | 0;
}

/** The tribes a run created from `seed` on `setId` rolls: THE derivation `createRun` uses, exported so the hero
 *  offer can be filtered by the upcoming run's tribes BEFORE the run exists (TRIBE GATE, owner 2026-09-10). */
export function runTribesForSeed(seed: number, setId: SetId = activeSet().id): Tribe[] {
  return selectRunTribes(makeRng(mixSeed(seed, 0, TAG.TRIBES)), SETS[setId]?.tribes ?? PLAYABLE_TRIBES);
}
