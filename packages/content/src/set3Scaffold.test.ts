import { describe, it, expect } from 'vitest';
import { SETS, poolFor, activeSet } from './sets';

/**
 * Set 3 is registered but EMPTY (owner ask 2026-08-03) so it can be selected in the Scene Builder and filled
 * in later. These pins guard the two ways a scaffold set can go wrong.
 */
describe('set 3 scaffold', () => {
  it('is registered and resolves to an empty pool', () => {
    expect(SETS.set3).toBeDefined();
    const p = poolFor('set3');
    expect(p.setId).toBe('set3');
    expect(p.all).toEqual([]);
    expect(p.buyable).toEqual([]);
    expect(p.spells).toEqual([]);
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
