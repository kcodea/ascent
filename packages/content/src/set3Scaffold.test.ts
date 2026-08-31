import { describe, it, expect } from 'vitest';
import { SETS, poolFor, activeSet } from './sets';
import { CARD_INDEX } from './index';

/**
 * Set 3's roster, pinned. It is still DISABLED, so these are the guards that let it be filled in safely — the
 * two ways a set under construction goes wrong are landing a real run on it and perturbing the sets that ship.
 */
describe('set 3 scaffold', () => {
  it('holds the Equip minions, the carried-over Kobolds, and the shared neutral spell toolkit', () => {
    // Grew three times, emptied, and is now being refilled. The Celestial test units (2026-08-03) were
    // replaced by the real tribe (owner roster 2026-08-05), and on 2026-08-28 the owner archived that tribe
    // too: "celestials have been extremely and completely re-worked ... leaving set 3 empty of minions now."
    //
    // The spell count still pins the DRAWABLE shared pool (the sheet's reward/gift rows — Copycat, Bloodlust,
    // Implosion, Goldcrafter — are tokens, global by doctrine and not set members).
    expect(SETS.set3).toBeDefined();
    const p = poolFor('set3');
    expect(p.setId).toBe('set3');
    // ORDER IS THE ASSERTION, not just membership: shop draws index into this list, so a card inserted in the
    // middle rather than appended would silently reseed every set-3 shop.
    //
    // The EQUIPMENT work first — Alchemist Frank (the handoff's reference card) and Titan Sculptor, which is
    // what puts two Equipment in play at once — then the NINE set-2 Kobolds set 3 keeps.
    //
    // Nine, not the eleven carried over on 2026-08-28: the owner's full set-3 Kobold roster (2026-08-30) named
    // exactly these, and anything absent from that roster leaves the set. `k_beggy` and `k_alchemist` went on
    // that basis — see the set-2 assertions below, which pin that they are still perfectly good SET 2 cards.
    expect(p.buyable.map((c) => c.id)).toEqual([
      'e3_frank', 'e3_sculptor',
      // Set 3's OWN Kobolds (the 2026-08-30 roster), appended in declaration order…
      'k3_korn', 'k3_splitpick', 'k3_forkvein', 'k3_forkroad', 'k3_veinchant', 'k3_jeweler',
      'k3_blastsurveyor',
      'k3_facetbound',
      'k3_doubletrouble',
      'k3_forksong', 'k3_forkedcrown', 'k3_rubyroach', 'k3_porkbelly',
      // …then the nine set-2 Kobolds it keeps.
      'k_chipwick', 'k_veinbreaker', 'k_gemheart', 'k_deepdelve', 'k_geode', 'k_kobabyboldies',
      'k_kobe', 'k_boulderdash', 'k_blazer',
    ]);
    // Dropped from set 3, and the ONLY thing that changed is set membership — leaving a set is not archiving.
    expect(p.all.some((c) => c.id === 'k_beggy'), 'Beggy left set 3').toBe(false);
    expect(p.all.some((c) => c.id === 'k_alchemist'), 'Brisbane left set 3').toBe(false);
    expect(CARD_INDEX['k_beggy'], 'but both still resolve by id').toBeTruthy();
    expect(CARD_INDEX['k_alchemist']).toBeTruthy();
    // The Kobolds must be reachable AS A TRIBE, not merely present: `selectRunTribes` reads this list, so a
    // pool full of Kobolds with an empty `tribes` could never roll a Kobold run.
    expect(SETS.set3.tribes).toEqual(['kobold']);
    // Their Ruby engine needs no set membership — `ruby` and the Gemheart Golem are tokens, global by the
    // same doctrine as the gift spells above, reachable only through a card that names them.
    expect(p.all.some((c) => c.id === 'ruby'), 'a token is never a set member').toBe(false);
    expect(CARD_INDEX['ruby'], 'but it must still resolve').toBeTruthy();
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
    // Set 3 taking eleven of set 2's Kobolds is a SHARED reference, not a move: set 2 keeps every one of
    // them. 22 buyable of 23 authored — Gem Sage is a token, so it is in neither set's drawable pool.
    expect(poolFor('set2').buyable.filter((c) => c.tribe === 'kobold')).toHaveLength(22);
  });
});
