import type { Moment } from './compile';
import { RESULT_TYPES } from '../combatBeats';
import { getLungeConfig } from '../lungeConfig';
import { getChoreoConfig, beatDelay } from './choreoConfig';

/**
 * The replay clock (choreographer phase 2) — the pure hold formula that decides how long the moment currently
 * ON SCREEN (`shown`) lingers before `next` shows. Extracted verbatim from the former inline scheduler so the
 * pacing is byte-identical; unit-tested against the legacy numbers. Reads choreoConfig (tempo + per-type holds)
 * + lungeConfig (the attack wind-up is welded to the lunge connection so damage always lands ON contact).
 * `combatSpeed` is the player's in-combat multiplier — the lunge timeScale divides the same connection time,
 * so they stay in sync.
 */
export function holdMs(next: Moment, shown: Moment | undefined, combatSpeed: number): number {
  const cfg = getChoreoConfig();
  const c = getLungeConfig();
  let d = beatDelay(next.primary.type) * cfg.speed;
  if (shown?.primary.type === 'attack') {
    // Hand off the wind-up the instant the lunge CONNECTS (windup+strike−smackLead, GSAP seconds), so the
    // damage moment lands right on contact — independent of tempo.
    d = Math.max(120, (c.windupDur + c.strikeDur - c.smackLead) * 1000);
  } else if (shown && RESULT_TYPES.has(shown.primary.type) && next.primary.type === 'attack') {
    d += c.attackGap * 1000; // a breather after an impact before the next swing
  }
  return d / (combatSpeed > 0 ? combatSpeed : 1);
}
