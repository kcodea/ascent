import type { Moment } from './compile';
import { RESULT_TYPES } from '../combatBeats';
import { getLungeConfig } from '../lungeConfig';
import { getChoreoConfig, beatDelay } from './choreoConfig';

/**
 * The replay clock (choreographer phase 2, weld retired in phase 3b) — the pure hold formula that decides
 * how long the moment currently ON SCREEN (`shown`) lingers before `next` shows, for every moment kind
 * EXCEPT the attack-wind-up → its impact transition (that one is now driven by the choreo engine's GSAP
 * timeline — see `engine.ts` + `useCombatReplay.ts`'s scheduler guard — anchored at the lunge's real
 * `contact` position instead of a separately-computed formula here). Reads choreoConfig (tempo + per-type
 * holds) + lungeConfig (only for the post-impact `attackGap` breather, unrelated to the old weld).
 * `combatSpeed` is the player's in-combat multiplier.
 */
export function holdMs(next: Moment, shown: Moment | undefined, combatSpeed: number): number {
  const cfg = getChoreoConfig();
  const c = getLungeConfig();
  let d = beatDelay(next.primary.type) * cfg.speed;
  if (shown && RESULT_TYPES.has(shown.primary.type) && next.primary.type === 'attack') {
    d += c.attackGap * 1000; // a breather after an impact before the next swing
  }
  return d / (combatSpeed > 0 ? combatSpeed : 1);
}
