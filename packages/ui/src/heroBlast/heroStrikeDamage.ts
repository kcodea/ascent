import { lossDamageCap, playerLossDamage, type RunState } from '@game/sim';

/**
 * THE BLOW the winning hero lands after a fight, exactly as the engine decided it (moved out of `Recruit.tsx` so
 * both hero attack styles, and their tests, read the one definition).
 *
 * A LOSS is what the player takes: `playerLossDamage`, the same function the settle uses (combat damage only,
 * owner ruling 2026-08-04), or the capped `playerDamage` outside a lobby. A WIN is what the foe takes: the sim's
 * mirror of the same formula (`enemyDamage`), capped the same way.
 */
export function heroStrikeDamage(run: Pick<RunState, 'lobby' | 'mode' | 'lastCombat' | 'wave'>, won: boolean): number {
  const cap = lossDamageCap(run.wave);
  if (won) return Math.min(run.lastCombat?.enemyDamage ?? 0, cap);
  return run.lobby && run.mode !== 'practice' && run.lastCombat
    ? playerLossDamage(run.lobby, run.lastCombat)
    : Math.min(run.lastCombat?.playerDamage ?? 0, cap);
}

/**
 * WHAT THE DAMAGE FORMATION SHOWS for this blow (owner ask 2026-09-28), every number read off the engine's result:
 *  - `hero`: the striking side's tier term, and `minions`: each surviving minion's tier, left to right, with its uid
 *    (`damageBreakdown` on a loss, `enemyDamageBreakdown` on a win);
 *  - `full`: the blow before the round cap (`playerDamageUncapped` on a loss, `enemyDamage` on a win);
 *  - `total`: the blow that lands (`heroStrikeDamage`), and `cap`: the round cap the run loop stamped (`damageCap`).
 *
 * A result recorded before those fields existed plays what it knows: no breakdown = no minion or hero numbers (just
 * the blow); no stamped cap = no cap beat, and the full number IS the blow (never a number the screen made up).
 */
export interface HeroStrikeNumbers {
  hero: number | null;
  minions: { tier: number; uid: string | null }[];
  full: number;
  total: number;
  /** Non-null only when the cap beat plays (the full blow was cut to it). */
  cap: number | null;
}

export function heroStrikeNumbers(run: Pick<RunState, 'lobby' | 'mode' | 'lastCombat' | 'wave'>, won: boolean): HeroStrikeNumbers {
  const total = heroStrikeDamage(run, won);
  const lc = run.lastCombat;
  const bd = won ? lc?.enemyDamageBreakdown : lc?.damageBreakdown;
  const stampedCap = typeof lc?.damageCap === 'number' ? lc.damageCap : null;
  const before = won ? lc?.enemyDamage : lc?.playerDamageUncapped;
  const cut = stampedCap !== null && typeof before === 'number' && before > total;
  return {
    hero: bd ? bd.oppTier : null,
    minions: bd ? bd.survivorTiers.map((tier, i) => ({ tier, uid: bd.survivorUids?.[i] ?? null })) : [],
    full: cut ? before : total,
    total,
    cap: cut ? stampedCap : null,
  };
}
