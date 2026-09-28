import { describe, it, expect } from 'vitest';
import type { RunState } from '@game/sim';
import { runeTally } from './runeTally';

/**
 * Set 3 rune design pass, tranche 4 (owner 2026-09-27): the live values the rune badges print (the live-value rule).
 * The Grim Toast shows the Undead Aura your Dwarves get right now; the Gem Star shows this turn's Rubies out of 4.
 */
const base = { questFlags: {}, undeadAttackBonus: 0, undeadBuyAtk: 0, undeadHealthBonus: 0 } as unknown as RunState;

describe('tranche 4 rune badges', () => {
  it('the Grim Toast prints the whole live Aura (Lantern + buy Attack, the Aura Health)', () => {
    const run = { ...base, questFlags: { runeGrimToast: true }, undeadAttackBonus: 5, undeadBuyAtk: 2, undeadHealthBonus: 4 } as unknown as RunState;
    expect(runeTally(run, 'rune_grim_toast')).toBe('+7/+4');
    expect(runeTally({ ...run, undeadAttackBonus: 6 } as RunState, 'rune_grim_toast'), 'it follows the Aura').toBe('+8/+4');
  });
  it('the Gem Star counts this turn\'s Rubies toward its cap', () => {
    const run = { ...base, questFlags: { runeGemStar: true } } as unknown as RunState;
    expect(runeTally(run, 'rune_gem_star')).toBe('0/4');
    expect(runeTally({ ...run, gemStarThisTurn: 3 } as RunState, 'rune_gem_star')).toBe('3/4');
    expect(runeTally({ ...run, gemStarThisTurn: 4 } as RunState, 'rune_gem_star')).toBe('4/4');
  });
});
