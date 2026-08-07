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
  // A REPEATED NARRATION rides the one before it, for the same reason those consequence beats do.
  //
  // Every repeated-trigger card logs one `sc` line per fire (`X triggers Y's Battlecry` — Ryme/Dawnclaw,
  // Thunderous Sovereign, Chorus Drake, the Deepvein cascade), and each was a full-weight beat: 720 × the
  // 1.5 tempo = 1080ms, spent saying the same thing again. A gilded Echohorn beside a Sylus procs Dawnclaw
  // four times into two Shout neighbours — eight of them, 8.6 SECONDS of pauses (owner report 2026-08-07).
  //
  // The FIRST of a run keeps its full weight, so the cascade still announces itself; only the repeats ride.
  // Nothing is cut off: a narration beat's cues are fire-and-forget (trigger pulse, log line, float), exactly
  // like the `OVERLAP_INTO` beats above, so every Shout keeps its own read.
  //
  // Keyed on the KIND rather than the `sc` event type, because `sc` is two different beats: `scCast` is a
  // genuine Start-of-Combat damage cast and each one is a different thing happening, so a run of those keeps
  // full pacing. Only narration compresses.
  if (shown && next.kind === 'scNarrate' && shown.kind === 'scNarrate') return cfg.overlapMs / spd;
  let d = beatDelay(next.primary.type) * cfg.speed;
  if (shown && RESULT_TYPES.has(shown.primary.type) && next.primary.type === 'attack') {
    d += c.attackGap * 1000; // a breather after an impact before the next swing
  }
  return d / spd;
}
