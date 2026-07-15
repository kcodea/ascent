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
  it('returns null for a continuous accumulator with no threshold (Grim — tally, no cap)', () => {
    // NB Kennelmaster (`kennel`) is NOT a pure accumulator — it also has Avenge (3), so it now shows the avenge
    // 0/N counter. Grim's Deathrattle tally has no threshold at all, so it stays null.
    expect(stepProgress('grim', { summonBonus: 5 })).toBeNull();
  });
  it('returns null for an unknown card', () => {
    expect(stepProgress('not-a-card', {})).toBeNull();
  });
  it('Flowing Monk counts overflows 1..5 then wraps (cyclic, improveEvery 5)', () => {
    expect(stepProgress('monk', { summonBonus: 0 })).toEqual({ current: 0, total: 5 });
    expect(stepProgress('monk', { summonBonus: 3 })).toEqual({ current: 3, total: 5 });
    expect(stepProgress('monk', { summonBonus: 5 })).toEqual({ current: 5, total: 5 });
    expect(stepProgress('monk', { summonBonus: 6 })).toEqual({ current: 1, total: 5 });
  });
  it('Crypt Drake counts ally attacks 1..2 then wraps (cyclic, every 2)', () => {
    expect(stepProgress('cryptdrake', { attackSeen: 0 })).toEqual({ current: 0, total: 2 });
    expect(stepProgress('cryptdrake', { attackSeen: 1 })).toEqual({ current: 1, total: 2 });
    expect(stepProgress('cryptdrake', { attackSeen: 2 })).toEqual({ current: 2, total: 2 });
    expect(stepProgress('cryptdrake', { attackSeen: 3 })).toEqual({ current: 1, total: 2 });
  });
  it('Cadence cards (endOfTurn + every) count turns then wrap (cyclic)', () => {
    // Frontdrake: every 3 turns.
    expect(stepProgress('frontdrake', { eotTick: 0 })).toEqual({ current: 0, total: 3 });
    expect(stepProgress('frontdrake', { eotTick: 2 })).toEqual({ current: 2, total: 3 });
    expect(stepProgress('frontdrake', { eotTick: 3 })).toEqual({ current: 3, total: 3 });
    expect(stepProgress('frontdrake', { eotTick: 4 })).toEqual({ current: 1, total: 3 });
    // Money Maker: every 2 turns.
    expect(stepProgress('moneymaker', { eotTick: 1 })).toEqual({ current: 1, total: 2 });
    expect(stepProgress('moneymaker', { eotTick: 2 })).toEqual({ current: 2, total: 2 });
    expect(stepProgress('moneymaker', { eotTick: 3 })).toEqual({ current: 1, total: 2 });
  });
  it('Tara clamps at her one-time ascend threshold (ascendAt 15)', () => {
    expect(stepProgress('tara', { ascendProgress: 10 })).toEqual({ current: 10, total: 15 });
    expect(stepProgress('tara', { ascendProgress: 15 })).toEqual({ current: 15, total: 15 });
    expect(stepProgress('tara', { ascendProgress: 25 })).toEqual({ current: 15, total: 15 });
  });
});
