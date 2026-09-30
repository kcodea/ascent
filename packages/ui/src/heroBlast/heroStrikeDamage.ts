import { playerLossDamage, playerOpponent, runLossCap, type RunState } from '@game/sim';

/**
 * THE BLOW the winning hero lands after a fight, exactly as the engine decided it (moved out of `Recruit.tsx` so
 * both hero attack styles, and their tests, read the one definition).
 *
 * A LOSS is what the player takes: `playerLossDamage`, the same function the settle uses (combat damage only,
 * owner ruling 2026-08-04), or the capped `playerDamage` outside a lobby. A WIN is what the foe takes: the sim's
 * mirror of the same formula (`enemyDamage`), capped the same way.
 */
export function heroStrikeDamage(run: Pick<RunState, 'lobby' | 'mode' | 'lastCombat' | 'wave'>, won: boolean): number {
  const cap = runLossCap(run); // the run's own cap table (the Gauntlet has its own)
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

/**
 * DOES THIS BLOW KNOCK THE STRUCK PLAYER OUT? (owner ask 2026-09-29: "if a player knocks someone out, it always plays
 * the huge animation"). Read at the start of the post-combat sequence, BEFORE the settle, off the state the engine
 * settles from, with the engine's own charge rules: the blow (`heroStrikeDamage`) through Armor, then Resolve, and a
 * seat whose Resolve + Armor reaches 0 is out (`hitSeat` + `knockOutIfDead` in `@game/sim`'s run lobby). Nothing is
 * decided here that the settle does not decide the same way:
 *  - YOUR LOSS: your pools going in are the run's (`settleCombat` re-seeds seat 0 from them before charging it).
 *    Invulnerable Practice (any health but `normal`) never knocks you out: the settle restores the seat.
 *  - YOUR WIN: the paired foe seat's pools. A GHOST (a bye, or a stand-in for a seat with no board) is already out and
 *    is never charged, so it is never a knockout; outside a lobby there is no seat to knock out. An INVULNERABLE seat
 *    (the Gauntlet opponent, R-GAUNTLET-02) takes no damage and is never eliminated, so it is never a knockout either.
 * Presentation only: it picks which version of the attack plays (`attackTier` in `../heroAttack/tiers.ts`).
 */
export function heroStrikeKnockout(
  run: Pick<RunState, 'lobby' | 'mode' | 'lastCombat' | 'wave' | 'resolve' | 'armor' | 'practiceConfig'>,
  won: boolean,
): boolean {
  const dmg = heroStrikeDamage(run, won);
  if (!(dmg > 0)) return false;
  if (!won) {
    if (run.mode === 'practice' && run.practiceConfig?.health !== 'normal') return false;
    return Math.max(0, run.resolve) + Math.max(0, run.armor) <= dmg;
  }
  if (!run.lobby) return false;
  const foe = playerOpponent(run.lobby);
  if (!foe || foe.ghost || !foe.seat.alive || foe.seat.invulnerable) return false;
  return Math.max(0, foe.seat.resolve) + Math.max(0, foe.seat.armor) <= dmg;
}
