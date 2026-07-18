import type { Moment } from './compile';
import { RESULT_TYPES } from '../combatBeats';
import { getLungeConfig } from '../lungeConfig';
import { getChoreoConfig, holdMsForKind } from './choreoConfig';

/**
 * The replay clock (choreographer phase 2, weld retired in phase 3b) — the pure hold formula that decides
 * how long the moment currently ON SCREEN (`shown`) lingers before `next` shows, for every moment kind
 * EXCEPT the attack-wind-up → its impact transition (that one is now driven by the choreo engine's GSAP
 * timeline — see `engine.ts` + `useCombatReplay.ts`'s scheduler guard — anchored at the lunge's real
 * `contact` position instead of a separately-computed formula here). Reads choreoConfig (tempo + per-type
 * holds) + lungeConfig (only for the post-impact `attackGap` breather, unrelated to the old weld).
 * `combatSpeed` is the player's in-combat multiplier.
 */
/** Consequence beats that RIDE on the preceding action instead of waiting their full linger — a summon
 *  appearing, a Reborn re-forming, or an aura strengthening (`improve`: Kennelmaster's Avenge bump, Tara's
 *  ascend tally, Baby Cub's Rally, …). When one of these is the NEXT beat (and there is a beat on screen), it
 *  starts after `overlapMs` instead of `beatDelay × speed`, so e.g. the death → summon → reborn chain (and a
 *  death → aura-improve pulse) plays nearly in tandem. The preceding beat's FX are fire-and-forget (skull,
 *  aura burst, summon pop, ✦ pulse), so nothing is cut off — only the next beat starts sooner. Attacks never
 *  appear here (their advance is engine-driven; see useCombatReplay's scheduler guard), so swing pacing is
 *  untouched. */
const OVERLAP_INTO = new Set<string>(['summon', 'reborn', 'improve']);

export function holdMs(next: Moment, shown: Moment | undefined, combatSpeed: number): number {
  const cfg = getChoreoConfig();
  const c = getLungeConfig();
  const spd = combatSpeed > 0 ? combatSpeed : 1;
  if (shown && OVERLAP_INTO.has(next.primary.type)) return cfg.overlapMs / spd; // ride on the preceding FX
  // Hold by the moment's KIND (2026-07-18 audit): `holdMsForKind` routes through the exhaustive
  // `KIND_TO_KEY` table, so every kind has a deliberate hold — the old raw-type lookup silently gave
  // `ascend` (and any future type) the 300ms fallback and bypassed the mapping entirely.
  let d = holdMsForKind(next.kind) * cfg.speed;
  if (shown && RESULT_TYPES.has(shown.primary.type) && next.primary.type === 'attack') {
    d += c.attackGap * 1000; // a breather after an impact before the next swing
  }
  return d / spd;
}
