/**
 * THE HERO RE-ROLL (owner 2026-10-15, R-HERO-REROLL-01): seeded, one use, never an offered hero, always from the pool.
 */
import { describe, expect, it } from 'vitest';
import { applyHeroReroll, canRerollHero, heroRerollCandidates, isHeroReroll, rollHeroReroll } from './heroReroll';
import { HEROES, playableHeroes } from './heroes';
import { runTribesForSeed } from './state';

const POOL = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

describe('hero re-roll (R-HERO-REROLL-01)', () => {
  it('is deterministic in (seed, offer, slot, pool), and the seed actually matters', () => {
    const offer = ['a', 'b', 'c'];
    expect(rollHeroReroll(42, offer, 1, POOL)).toEqual(rollHeroReroll(42, offer, 1, POOL));
    const draws = new Set<string>();
    for (let seed = 0; seed < 200; seed++) draws.add(rollHeroReroll(seed, offer, 1, POOL)!.to);
    expect([...draws].sort()).toEqual(['d', 'e', 'f', 'g']); // every candidate is reachable, nothing else is
  });

  it('never draws a hero already in the offer, nor the one re-rolled away', () => {
    for (let seed = 0; seed < 300; seed++) {
      const offer = ['a', 'b', 'c'];
      const slot = seed % 3;
      const r = rollHeroReroll(seed, offer, slot, POOL)!;
      expect(r.slot).toBe(slot);
      expect(r.from).toBe(offer[slot]);
      expect(offer).not.toContain(r.to);
      const next = applyHeroReroll(offer, r);
      expect(next).toHaveLength(3);
      expect(new Set(next).size).toBe(3);
      expect(next.filter((id, i) => id !== offer[i])).toEqual([r.to]); // exactly one slot changed
      expect(offer).toEqual(['a', 'b', 'c']); // the input is never mutated
    }
  });

  it('only draws from the pool: nothing to draw = no re-roll (Practice / Gauntlet show the whole pool)', () => {
    expect(heroRerollCandidates(['a', 'b'], ['a', 'b'])).toEqual([]);
    expect(rollHeroReroll(1, ['a', 'b'], 0, ['a', 'b'])).toBeNull();
    expect(canRerollHero(['a', 'b'], ['a', 'b'], null)).toBe(false);
    expect(rollHeroReroll(1, ['a', 'b', 'c'], 0, ['a', 'b', 'c', 'z'])!.to).toBe('z');
  });

  it('is one use: a spent re-roll closes the option', () => {
    const offer = ['a', 'b', 'c'];
    expect(canRerollHero(offer, POOL, null)).toBe(true);
    const r = rollHeroReroll(9, offer, 0, POOL)!;
    expect(canRerollHero(applyHeroReroll(offer, r), POOL, r)).toBe(false);
  });

  it('refuses a slot outside the offer', () => {
    expect(rollHeroReroll(1, ['a', 'b', 'c'], 3, POOL)).toBeNull();
    expect(rollHeroReroll(1, ['a', 'b', 'c'], -1, POOL)).toBeNull();
    expect(rollHeroReroll(1, ['a', 'b', 'c'], 0.5, POOL)).toBeNull();
  });

  it('respects the tribe gate: a hero whose power needs a tribe the run did not roll is never drawn', () => {
    // Some seeds roll a run without every tribe; across them a gated hero must never appear unless its tribe is in.
    const gated = HEROES.filter((h) => h.tribes);
    expect(gated.length).toBeGreaterThan(0);
    for (let seed = 1; seed < 120; seed++) {
      const tribes = runTribesForSeed(seed);
      const pool = playableHeroes(tribes).map((h) => h.id);
      const r = rollHeroReroll(seed, pool.slice(0, 3), seed % 3, pool);
      if (!r) continue;
      const hero = HEROES.find((h) => h.id === r.to)!;
      if (hero.tribes) expect(hero.tribes.some((t) => tribes.includes(t))).toBe(true);
    }
  });

  it('validates stored records', () => {
    expect(isHeroReroll({ slot: 1, from: 'a', to: 'b' })).toBe(true);
    expect(isHeroReroll({ slot: 1, from: 'a', to: 'a' })).toBe(false);
    expect(isHeroReroll({ slot: -1, from: 'a', to: 'b' })).toBe(false);
    expect(isHeroReroll(null)).toBe(false);
  });
});
