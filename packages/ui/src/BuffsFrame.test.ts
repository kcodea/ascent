import { describe, it, expect } from 'vitest';
import { createRun, type RunState } from '@game/sim';
import { gatherRunBuffs } from './runBuffs';

describe('gatherRunBuffs', () => {
  it('returns no rows on a fresh run (window stays hidden)', () => {
    expect(gatherRunBuffs(createRun(1))).toHaveLength(0);
  });

  it('surfaces each active run-wide buff with its live value', () => {
    const run: RunState = {
      ...createRun(1, 'warden'), tier: 4, spellsCast: 8,
      spellBonus: { attack: 0, health: 2 },
      undeadBuyAtk: 3,
      impBuff: { attack: 2, health: 3 },
      cardBuffs: { fred: { attack: 2, health: 2 } },
      board: [
        { uid: 'mb', cardId: 'mamabear', tribe: 'beast', attack: 5, health: 5, keywords: [], golden: false, summonBonus: 2 },
        { uid: 'gl', cardId: 'guel', tribe: 'neutral', attack: 4, health: 4, keywords: [], golden: false },
      ],
    };
    const byKey = Object.fromEntries(gatherRunBuffs(run).map((r) => [r.key, r.value]));
    expect(byKey.spell).toBe('+0/+2'); // hero amplify 0 + spellBonus health 2
    expect(byKey.undead).toBe('+3/+0'); // undeadBuyAtk 3
    expect(byKey.fodder).toBe('+2/+2');
    expect(byKey.imp).toBe('+2/+3');
    expect(byKey.mamabear).toBe('+4/+4'); // base 2 + accrued 2
    expect(byKey.guel).toBe('+3/+3'); // base 1 + floor(8/4) = 2
  });

  it('drops Mama Bear / Guel rows once they leave the board', () => {
    const run: RunState = { ...createRun(1), impBuff: { attack: 1, health: 1 }, board: [] };
    const keys = gatherRunBuffs(run).map((r) => r.key);
    expect(keys).toContain('imp');
    expect(keys).not.toContain('mamabear');
    expect(keys).not.toContain('guel');
  });
});
