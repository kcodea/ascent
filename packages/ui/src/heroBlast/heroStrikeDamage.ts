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
