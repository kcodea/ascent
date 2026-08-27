// @vitest-environment jsdom
/**
 * Regression — bug 86340900 (Bug Board round 1, 2026-08-27): with Rune of Living Growth accrued,
 * hovering Mushy showed the referenced Growth popup at its BASE +1/+1. The shop and spell-slot chains
 * threaded `growthBonus` into `spellDisplayText`, but the referenced-card popup chain (`tokenRefView`,
 * fed by `refViewsByUid` / `conjuredView`) never did — so the popup lied while the shop told the truth.
 * The live-text rule (CLAUDE.md) makes that a defect: every surface prints the current value.
 */
import { describe, expect, it } from 'vitest';
import { tokenRefView } from './Recruit';

const spellLive = (growthBonus: number) => ({
  a: 0, h: 0, ftb: 0, ftbH: 0, goldSpent: 0, goldPouchValue: 0, tier: 3, growthBonus,
});

describe('tokenRefView — referenced Growth popup pays the Rune of Living Growth accrual', () => {
  it('folds growthBonus into the previewed Growth text', () => {
    const v = tokenRefView('growth', undefined, undefined, spellLive(3));
    expect(v.text, 'popup must print the improved value (1 base + 3 accrued)').toContain('{{+4/+4}}');
  });

  it('spell power stacks on top of the accrual, matching the shop chain', () => {
    const v = tokenRefView('growth', undefined, undefined, { ...spellLive(2), a: 1, h: 1 });
    expect(v.text).toContain('{{+4/+4}}');
  });

  it('without the rune the printed base stands', () => {
    const v = tokenRefView('growth', undefined, undefined, spellLive(0));
    expect(v.text).toContain('+1/+1');
    expect(v.text).not.toContain('{{');
  });
});
