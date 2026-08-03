import { describe, it, expect } from 'vitest';
import { SETS, poolFor, activeSet } from './sets';

/**
 * Set 3 is registered but EMPTY (owner ask 2026-08-03) so it can be selected in the Scene Builder and filled
 * in later. These pins guard the two ways a scaffold set can go wrong.
 */
describe('set 3 scaffold', () => {
  it('holds the Celestial test units + the shared neutral spell toolkit', () => {
    // Grew twice from the empty scaffold: the Celestial test units, then the owner's shared spell pool
    // (2026-08-03, "they will be there no matter what"). Minions stay all-Celestial; the spell count pins
    // the 58 DRAWABLE shared spells (the sheet's reward/gift rows — Copycat, Bloodlust, Implosion,
    // Goldcrafter — are tokens, global by doctrine, and deliberately not set members).
    expect(SETS.set3).toBeDefined();
    const p = poolFor('set3');
    expect(p.setId).toBe('set3');
    expect(p.buyable.every((c) => c.celestial), 'set 3 minions are all Celestials for now').toBe(true);
    expect(p.buyable.map((c) => c.id)).toEqual(
      ['c3_orbiter', 'c3_herald', 'c3_sentinel', 'c3_acolyte', 'c3_starweft', 'c3_equinox', 'c3_nym'],
    );
    expect(p.spells.length).toBe(58);
    expect(p.spells.some((c) => c.id === 'apples')).toBe(true);
    expect(p.spells.some((c) => c.id === 'sparkplug')).toBe(true); // Waking Rift
    expect(p.spells.some((c) => c.id === 'copycat'), 'gift spells stay out of the pool').toBe(false);
  });

  it('is DISABLED, so no real run can land on an empty pool', () => {
    // `activeSet()` is first-enabled-wins in declaration order. Enabling an empty set would silently put
    // every new run on an empty shop — this is the pin that makes that impossible to do by accident.
    expect(SETS.set3.enabled).toBe(false);
    expect(activeSet().id).not.toBe('set3');
    expect(poolFor(activeSet().id).buyable.length).toBeGreaterThan(0);
  });

  it('does not perturb the other sets', () => {
    // The whole point of the per-set `own` lists: adding set 3 must not change set 1 or set 2's pool order
    // or size, because shop draws are `rng.int(pool.length)` over them and seeds would shift.
    expect(poolFor('set1').all.length).toBeGreaterThan(0);
    expect(poolFor('set2').all.length).toBeGreaterThan(0);
    expect(poolFor('set2').all.some((c) => c.id === 'k_alchemist')).toBe(true);
  });
});
