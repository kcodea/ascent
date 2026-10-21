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
      'k3_korn', 'k3_splitpick', 'k3_jeweler', // Delver (k3_veinchant) archived 2026-10-13; // Gem Bus (k3_forkroad) archived 2026-09-09; Gemsmith (k3_forkvein) 2026-09-24
      'k3_blastsurveyor', // Shardluck (k3_facetbound) archived 2026-10-13
      'k3_doubletrouble',
      'k3_forksong', 'k3_rubyroach', 'k3_porkbelly', 'k3_prismpick', 'k3_runespark', 'k3_kaura', // Double Dealer (k3_forkedcrown) archived 2026-09-24
      'k3_kurse', // appended 2026-09-19 (owner handoff 2026-09-18)
      'k3_goldvein', // appended 2026-09-19 (owner handoff)
      'k3_legionnaire', // appended 2026-09-24 (owner Ruby batch)
      'k3_dealski', // appended 2026-09-24 (owner Ruby batch)
      // …then the six set-2 Kobolds it keeps (Chipwick Prospector left 2026-09-19 — owner handoff; still a set-2 card).
      'k_gemheart', 'k_kobabyboldies',
      'k_kobe', 'k_boulderdash', 'k_blazer', // Geode Guardian + Beggy left set 3 2026-10-13 (owner Set 3 batch; still set-2 cards)
      // …then the DWARVES (owner roster 2026-09-09): set 3's eight new ones, appended AFTER the Kobolds so no
      // Kobold moved, then the fourteen set-2 Dwarves it keeps (shared definitions, same as the Kobolds).
      'dw3_shiftbroker', /* Striker left set 3 2026-10-21 (owner Dwarf rework; still a set-2 card) */ 'dw3_pourman', 'dw3_hankpepe', 'dw3_tromboneer', 'dw3_kneel',
      'dw3_thymes', 'dw3_tankerchief', 'dw3_hangover', // Han Gover appended 2026-09-18
      'dw3_goldilox', // Goldilox appended 2026-09-24 (owner batch)
      'dw3_coincounter', 'dw3_kegrunner', 'dw3_championinu', 'dw3_foamguard', // owner batch 2026-10-21
      'dw3_salezarsails', 'dw3_marketing', 'dw3_valyou', 'dw3_leeds', // owner Sell batch 2026-10-21
      // Kringle, Blade Thrower, Pimm, Mountainbond and Gangplank left set 3 2026-10-13 (owner Set 3 batch; still set-2 cards)
      // Coinfire, Lieutenant Thane and Billings left set 3 2026-10-21 (owner Dwarf rework; still set-2 cards)
      'dw_brunni', 'dw_brakka', 'dw_dorrin', 'dw_brewer', 'dw_tapkeeper',
      'dw_edward',
      'dw_brill', // Dwarf King, Brill joined 2026-10-21 (owner: buyable in set 3, its rune left set 3)
      // …then the UNDEAD (owner roster 2026-09-09): set 3's eleven new ones (+ Bicycle Bob, 2026-09-18), then the ten set-1 Undead it keeps
      // (shared definitions; four re-specced in place because set 1 is disabled). Ossuary Colossus was pulled.
      // Wolves Den joined 2026-09-10 (owner ask). Pillager left set 3 on 2026-09-18 (owner balance pass; it stays
      // in set 1 and stays a rune reward — CARD_INDEX is global).
      'u3_poochy', 'u3_noggin', 'u3_robinson', 'u3_adeptus', 'u3_ems', 'u3_cagebreaker', 'u3_revenant',
      'u3_risingtide', 'u3_squatimus', 'u3_rodrick', 'u3_hierophant',
      'u3_bicyclebob', // the twelfth new Undead (owner handoff 2026-09-18), appended after the file's token
      'profgreg', 'knit', 'deathlesshand', 'deathsayer', 'deathswarmer', 'mumi', 'sergeant',
      'forsakenweaver', 'wolvesden', 'soulsman', // Anubis left set 3 2026-10-13 (owner Set 3 batch)
      // …then the NEUTRALS (owner roster 2026-09-09, tranche 1): set 3's own — Blaster back from the archive,
      // Splitboon Adept — then Yazzus (the ONE shared Yazzus since 2026-09-16, pinned to the slot its set-3 fork
      // held) — then the carried set-1 and set-2 neutrals (shared definitions). Shredder, Calibration Master and
      // Rig joined the own list 2026-09-18 (owner handoff); Tauntbreaker left the carry-over the same day. Yeti
      // joined 2026-09-19 (owner handoff).
      'blaster', 'n3_defender', 'n3_pell', 'n3_hustler', 'n3_recruiter', 'n3_charger', 'n3_splitboon', 'n3_shredder', 'n3_calibration', 'n3_rig', 'n3_indy', 'n3_agnus', 'yazzus', // Yeti archived, Indy + Agnus added 2026-10-13
      'drummer', 'sylus', 'chronos', 'joker', 'venom', 'blackbelt', 'jenkins', 'stewardofspells',
      'arenaheckler', 'wayfinder', 'salvatore',
      'n2_spellsword', 'n2_bellringer', 'k_pouchpincher', 'n2_paragon',
      // …then the SPIRITS (owner roster 2026-09-09) — a brand-new tribe, all set 3's own: the seven hand-summon cards
      // (tranche 2, declared first in the file), then tranche 1.
      'sp3_hearthwhisperer', 'sp3_seedling', 'sp3_slumbering', 'sp3_dreamtide', 'sp3_flamebanner', 'sp3_handboundtitan', // Dreaming Deep archived 2026-10-13
      'sp3_kindled', 'sp3_tidebud', 'sp3_flamereveler', 'sp3_tidereveler', 'sp3_grovereveler', 'sp3_bondweaver',
      'sp3_festivalkeeper', 'sp3_nurturer', 'sp3_dreamcurrent', 'sp3_paradeartificer', 'sp3_gatheringguide', 'sp3_aspect',
      'sp3_treasurer', 'sp3_revelator', 'sp3_luminary', 'sp3_forestcolossus', 'sp3_grandprocession',
      // …then the WHISPER DRAGONS (from Set 4, owner swap 2026-10-14), in the slot the Celestials held until they moved
      // to Set 4 the same day. Every earlier minion keeps its position.
      'd4_galas', 'd4_tolan', 'd4_tamby', 'd4_whisp',
      'd3_whaloo', 'd3_falx', 'd3_morro', 'd3_shush', // the first Set 3-authored Dragons (owner 2026-10-14), appended after the swapped-in four
      'd3_gatherer', 'd3_gravus', 'd3_wellwatcher', 'd3_matriarch', 'd3_woozy', 'd3_iggy', 'd3_hum', 'd3_gardener', // Dragon batch 2 (owner 2026-10-15)
      'd3_baitbrood', 'd3_hatcher', 'd3_whispwarder', // owner additions on #2097 (2026-10-15)
      'd2_chorus', 'd2_transcendence', 'd2_flutterdrake', // the three carried Set 2 Dragons (2026-10-15), by reference
    ]);
    // The set-1 Undead NOT on the roster stay out (owner confirmation 2026-09-09), still resolvable.
    for (const id of ['spore', 'karthus', 'ryme', 'gravebody', 'thunderingabomination', 'steadfast', 'gravewarden', 'cryptscribe', 'watcher', 'graverobber', 'bonetaxer', 'cryptbroker', 'gravetwin']) {
      expect(p.all.some((c) => c.id === id), id + ' left out of set 3').toBe(false);
      expect(CARD_INDEX[id], id + ' still resolves').toBeTruthy();
    }
    // Gem Bus ARCHIVED (owner 2026-09-09): in no set, still resolvable.
    expect(p.all.some((c) => c.id === 'k3_forkroad'), 'Gem Bus archived').toBe(false);
    expect(CARD_INDEX['k3_forkroad']?.name).toBe('Gem Bus');
    // The set-2 Dwarves NOT on the roster stay set-2-only (owner confirmation 2026-09-09), still resolvable.
    for (const id of ['dw_orin', 'dw_ironlung', 'dw_wardkeeper', 'dw_runemaster', 'dw_anvilshade', 'dw_chef', 'dw_bucky', 'dw_kegheart']) {
      expect(p.all.some((c) => c.id === id), id + ' left out of set 3').toBe(false);
      expect(CARD_INDEX[id], id + ' still resolves').toBeTruthy();
    }
    // Dropped from set 3, and the ONLY thing that changed is set membership — leaving a set is not archiving.
    // Beggy came BACK on 2026-09-24 (owner kobold/dwarf batch) as a shared set-2 definition; Brisbane stays out.
    expect(p.all.some((c) => c.id === 'k_beggy'), 'Beggy left set 3 again 2026-10-13').toBe(false);
    expect(poolFor('set2').all.some((c) => c.id === 'k_beggy'), '…and still a set-2 card').toBe(true);
    expect(p.all.some((c) => c.id === 'k_alchemist'), 'Brisbane left set 3').toBe(false);
    expect(CARD_INDEX['k_alchemist'], 'but still resolves by id').toBeTruthy();
    // Gemsmith + Double Dealer ARCHIVED (owner 2026-09-24): in no set, still resolvable.
    for (const [id, name] of [['k3_forkvein', 'Gemsmith'], ['k3_forkedcrown', 'Double Dealer']] as const) {
      expect(p.all.some((c) => c.id === id), name + ' archived').toBe(false);
      expect(CARD_INDEX[id]?.name).toBe(name);
    }
    // The Kobolds must be reachable AS A TRIBE, not merely present: `selectRunTribes` reads this list, so a
    // pool full of Kobolds with an empty `tribes` could never roll a Kobold run.
    expect(SETS.set3.tribes).toEqual(['kobold', 'dwarf', 'undead', 'spirit', 'dragon']); // Celestial -> Set 4, Dragon <- Set 4 (owner swap 2026-10-14)
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
    // 58 + Power Shifter (2026-08-22) + the five Dwarven Ales (2026-09-09). The Ales are drawable set-2 spells,
    // not tokens, so — unlike the Ruby — the Dwarves' Ale engine DOES need them opted in.
    expect(p.spells.length).toBe(57); // Star Crash + Black Hole moved to Set 4 with the Celestials 2026-10-14 (-2); Veinstorm left set 3 2026-10-13 (-1); Turnabout archived everywhere 2026-10-10, spell batch (-1); Dissipate + Rival's Reflection archived everywhere 2026-10-10 (-2); Hourglass Reserve archived everywhere 2026-10-07 (-1); 42 neutral toolkit (Common Ground out 2026-09-14, Gamble in 2026-09-17, Dissipate in 2026-09-18, Picnic in 2026-09-23) + 7 tribe spells + 5 Ales + 9 set-3 spells (owner sheet 2026-09-10) + Black Hole (Accretion, 2026-09-12)
    expect(p.spells.filter((c) => c.name.includes('Ale')).map((c) => c.id).sort()).toEqual(['wo_attack', 'wo_champion', 'wo_health', 'wo_mine', 'wo_reinforcement']);
    expect(p.spells.some((c) => c.id === 'apples')).toBe(true);
    expect(p.spells.some((c) => c.id === 'sparkplug')).toBe(true); // Waking Rift
    expect(p.spells.some((c) => c.id === 'copycat'), 'gift spells stay out of the pool').toBe(false);
    // The 2026-10-14 swap: NOTHING Celestial is left in Set 3 — no Celestial card, no Starform token, no Celestial spell.
    expect(p.all.filter((c) => c.tribe === 'celestial' || c.id.startsWith('ce3_')).map((c) => c.id)).toEqual([]);
    expect(p.spells.some((c) => c.id === 'starcrash' || c.id === 'accretion')).toBe(false);
    // …and the Whispers stay Gift-class: granted by the Dragons, resolvable, never set members.
    for (const id of ['w4_tome', 'w4_runebind']) {
      expect(p.all.some((c) => c.id === id), id + ' is not a set member').toBe(false);
      expect(CARD_INDEX[id]?.whisper, id + ' resolves as a Whisper').toBe(true);
    }
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
    // +1 on 2026-10-07: Jewel (a set-3 Kobold) joined set 2 (owner), appended at the end of set 2.
    // -1 on 2026-10-10: Cavern Fiend (k_gemgorge, a Kobold/Demon) archived (owner).
    // -1 on 2026-10-13: Mineral Master (k_mineralmaster) archived (owner).
    expect(poolFor('set2').buyable.filter((c) => c.tribe === 'kobold')).toHaveLength(21);
  });
});
