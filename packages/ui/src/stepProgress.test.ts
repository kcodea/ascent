import { describe, it, expect } from 'vitest';
import { stepProgress } from './cardText';

describe('stepProgress', () => {
  it('Guel counts 1..4 then wraps (cyclic, per 4 spells)', () => {
    expect(stepProgress('guel', { spellProgress: 0 })).toEqual({ current: 0, total: 4 });
    expect(stepProgress('guel', { spellProgress: 1 })).toEqual({ current: 1, total: 4 });
    expect(stepProgress('guel', { spellProgress: 4 })).toEqual({ current: 4, total: 4 });
    expect(stepProgress('guel', { spellProgress: 5 })).toEqual({ current: 1, total: 4 });
  });
  it('Spirit Pup clamps up to its one-time transform threshold', () => {
    const sp = stepProgress('spiritpup', { spellProgress: 3 });
    expect(sp?.total).toBeGreaterThan(0);
    expect(sp?.current).toBe(3);
    const done = stepProgress('spiritpup', { spellProgress: 999 });
    expect(done?.current).toBe(done?.total);
  });
  it('returns null for a continuous accumulator (no threshold)', () => {
    expect(stepProgress('kennel', { summonBonus: 5 })).toBeNull();
  });
  it('returns null for an unknown card', () => {
    expect(stepProgress('not-a-card', {})).toBeNull();
  });
});
