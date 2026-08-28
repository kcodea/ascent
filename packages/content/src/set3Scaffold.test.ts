import { describe, it, expect } from 'vitest';
import { SETS, poolFor, activeSet } from './sets';
import { CARD_INDEX } from './index';

/**
 * Set 3 is registered but EMPTY (owner ask 2026-08-03) so it can be selected in the Scene Builder and filled
 * in later. These pins guard the two ways a scaffold set can go wrong.
 */
describe('set 3 scaffold', () => {
  it('holds only the Equipment reference card, and the shared neutral spell toolkit', () => {
    // Grew three times, then emptied. The Celestial test units (2026-08-03) were replaced by the real tribe
    // (owner roster 2026-08-05), and on 2026-08-28 the owner archived that tribe too: "celestials have been
    // extremely and completely re-worked ... leaving set 3 empty of minions now."
    //
    // So set 3 is a spell-only scaffold again. The spell count still pins the DRAWABLE shared pool (the
    // sheet's reward/gift rows — Copycat, Bloodlust, Implosion, Goldcrafter — are tokens, global by doctrine
    // and not set members), because that half was never part of the rework.
    expect(SETS.set3).toBeDefined();
    const p = poolFor('set3');
    expect(p.setId).toBe('set3');
    // The Celestial rework has not landed; the one minion here is the EQUIPMENT vertical slice (owner handoff
    // 2026-08-28: "Implement only Alchemist Frank as the reference card").
    expect(p.buyable.map((c) => c.id)).toEqual(['e3_frank']);
    // EVERY Celestial — both the 2026-08-03 test units and the 2026-08-05 tribe — is gone from the POOL but
    // still resolvable by id, which is the whole point of archiving rather than deleting: a saved run, a
    // replay or a captured board from either fortnight still loads.
    const archived = [
      'c3_orbiter', 'c3_herald', 'c3_sentinel', 'c3_acolyte', 'c3_starweft', 'c3_equinox', 'c3_nym',
      'c3_courier', 'c3_familiar', 'c3_vendor', 'c3_twilight', 'c3_cartographer', 'c3_tender',
      'c3_shopkeeper', 'c3_gardener', 'c3_channeler', 'c3_binary', 'c3_weaver', 'c3_collector',
      'c3_relay', 'c3_crucible', 'c3_broker', 'c3_orrery',
    ];
    for (const id of archived) {
      expect(p.all.some((c) => c.id === id), id + ' should be archived, not in the set').toBe(false);
      expect(CARD_INDEX[id], id + ' must still resolve').toBeTruthy();
    }
    expect(p.spells.length).toBe(59); // 58 + Power Shifter (2026-08-22)
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
