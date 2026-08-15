import { describe, it, expect } from 'vitest';
import { createRun, type RunState } from '@game/sim';
import { gatherRunBuffs } from './runBuffs';

/** Owner report 2026-08-15: the Buffs panel never showed the SHOP-SLOT enchants, and it showed a "Fodder Aura"
 *  row in set 2 — a set with no Fodder in it at all. */

const run = (over: Partial<RunState>): RunState => ({ ...createRun(5), ...over } as RunState);

describe('Buffs panel — shop-slot enchants', () => {
  it('shows the right-most slot buff (Market Tormentor / Vhal / Right Hand Hank)', () => {
    const rows = gatherRunBuffs(run({ rightmostSlotBuff: { attack: 7, health: 6 } }));
    const row = rows.find((r) => r.key === 'shopright');
    expect(row, 'the right-most Shop slot has a row').toBeTruthy();
    expect(row!.value).toBe('+7/+6');
  });

  it('shows the left-most slot buff (Rune of the Display Case)', () => {
    const rows = gatherRunBuffs(run({ leftmostSlotBuff: { attack: 4, health: 4 } }));
    expect(rows.find((r) => r.key === 'shopleft')?.value).toBe('+4/+4');
  });

  it('stays quiet when no slot enchant is banked', () => {
    const rows = gatherRunBuffs(run({}));
    expect(rows.some((r) => r.key === 'shopright' || r.key === 'shopleft')).toBe(false);
  });
});

describe('Buffs panel — the Fodder row is set-aware', () => {
  it('is hidden in set 2, which has no Fodder', () => {
    // A stale value can ride a save; the SET decides whether the row means anything.
    const rows = gatherRunBuffs(run({ setId: 'set2', cardBuffs: { fred: { attack: 5, health: 5 } } } as Partial<RunState>));
    expect(rows.some((r) => r.key === 'fodder'), 'no Fodder row in a set without Fodder').toBe(false);
  });

  it('still shows in set 1, where Fodder exists', () => {
    const rows = gatherRunBuffs(run({ setId: 'set1', cardBuffs: { fred: { attack: 5, health: 5 } } } as Partial<RunState>));
    expect(rows.find((r) => r.key === 'fodder')?.value, 'set 1 keeps its Fodder row').toBe('+5/+5');
  });
});
