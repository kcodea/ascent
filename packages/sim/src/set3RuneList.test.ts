/**
 * THE SET 3 RUNE LIST (owner 2026-09-25). The owner's list IS Set 3's Runeforge: every rune named is offered in
 * Set 3, every rune not named is out of Set 3 (it keeps its other sets and is never archived, so saves and replays
 * that own one still resolve it through RUNE_INDEX).
 *
 * The list is kept below in the owner's grouping (tribe, then Basic / Epic) with the owner's word for each rune.
 * TRIBE + RARITY ALIGNMENT (owner 2026-09-25, the same day): "see here in this list how spearline and waking dreams
 * are not "neutral" tagged and are tagged to tribes? can you make sure we're aligned on tribe orientation of set 3
 * runes". The grouping now IS the game's: a rune listed under a tribe carries that tribe gate (offered only when the
 * tribe is in the run, in every set), a rune listed under Neutral carries none, and a rune's pool (RUNES / EPIC_RUNES)
 * matches its Basic / Epic heading. The one owner-ruled extra: Soul Script keeps BOTH its tribes (Undead + Celestial).
 * The first pass left eight tribe mismatches and one rarity mismatch (docs/devlog/2026-09-25-set3-rune-list.md);
 * docs/devlog/2026-09-25-set3-rune-tribes.md records the alignment.
 *
 * Three names match through the one card the rune grants: "dwarf king brill" (Rune of the High King gets a Dwarf
 * King, Brill), "spear warden" (Rune of the Warden gets a Spear Warden), "reflector" (Rune of Refraction gets a
 * Reflector). "bulk order" is Rune of Bulk Order, id `rune_scale`.
 */
import { describe, expect, it } from 'vitest';
import { ARCHIVED_RUNES, EPIC_RUNES, RUNES, RUNE_INDEX, SETS } from '@game/content';
import type { Tribe } from '@game/core';
import { runeforgePool } from './reducer';
import { createRun, type RunState } from './index';

const OWNER_LIST: Record<string, { basic: Record<string, string>; epic: Record<string, string> }> = {
  kobold: {
    basic: {
      'basic kobolds': 'rune_basic_kobold', engraving: 'rune_engraving', 'living geode': 'rune_living_geode', resonance: 'rune_resonance', 'engraving gems': 'rune_engraving_gems',
      // Set 3 rune batch 3 (owner 2026-09-25): the new Kobold Basics JOIN the list.
      'gemmed decisions': 'rune_gemmed_decisions', 'echoing kobolds': 'rune_echoing_kobolds', 'red storm': 'rune_red_storm',
      choices: 'rune_choices', 'combatative rubies': 'rune_combatative_rubies',
    },
    epic: {
      'epic kobolds': 'rune_epic_kobold', 'attacking gems': 'rune_attacking_gems', investment: 'rune_investment', 'gem golem': 'rune_gem_golem', motherlode: 'rune_motherlode',
      // Set 3 rune batch 3 (owner 2026-09-25): the new Kobold Epics JOIN the list.
      'storming veins': 'rune_storming_veins', 'sold choices': 'rune_sold_choices', 'aggressive golems': 'rune_aggressive_golems', 'ruptured rubies': 'rune_ruptured_rubies',
      // Set 3 rune design pass (owner 2026-09-27): re-tagged Neutral -> Kobold.
      'living treasure': 'rune_living_treasure',
    },
  },
  dwarf: {
    basic: {
      'basic dwarves': 'rune_basic_dwarf', 'full measure': 'rune_full_measure', 'compounding wages': 'rune_compounding_wages', 'heavy payroll': 'rune_heavy_payroll',
      kegheart: 'rune_kegheart', overtime: 'rune_overtime', 'first round': 'rune_first_round', brew: 'rune_brew', flagship: 'rune_flagship',
      whetstone: 'rune_whetstone', // design pass tranche 3 (owner 2026-09-27)
    },
    epic: {
      'epic dwarves': 'rune_epic_dwarf', bucky: 'rune_bucky', 'double fisting': 'rune_double_fisting', /* 'profit sharing' archived everywhere 2026-10-07 (owner balance batch) */
      'dwarf king brill': 'rune_high_king', 'muster general': 'rune_muster_general', 'shared table': 'rune_shared_table', 'sellers market': 'rune_sellers_market',
      anvil: 'rune_anvil', satchel: 'rune_satchel', // design pass tranche 3 (owner 2026-09-27)
    },
  },
  undead: {
    basic: { 'basic undead': 'rune_basic_undead', 'last rites': 'rune_last_rites', 'spear warden': 'rune_warden', 'soul script': 'rune_soul_script', 'body counting': 'rune_body_counting' /* batch 3, 2026-09-25 */,
      'crowded crypt': 'rune_crowded_crypt' /* re-tagged Neutral -> Undead, 2026-09-27 design pass */,
      // Design pass tranche 1 (owner 2026-09-27): Soul Toll replaces the doc's Unquiet.
      'lantern keeper': 'rune_lantern_keeper', wake: 'rune_wake', 'second wind': 'rune_second_wind', 'soul toll': 'rune_soul_toll', gravedigger: 'rune_gravedigger' },
    epic: { 'epic undead': 'rune_epic_undead', 'death touched apple': 'rune_deathtouched_apple', 'endless march': 'rune_endless_march', 'final gate': 'rune_final_gate', spearline: 'rune_spearline',
      overflow: 'rune_overflow', 'rising echoes': 'rune_rising_echoes' /* re-tagged Neutral -> Undead, 2026-09-27 design pass */,
      'soul furnace': 'rune_soul_furnace', restless: 'rune_restless', 'open grave': 'rune_open_grave' /* design pass tranche 1 */ },
  },
  spirit: {
    basic: {
      'basic spirit': 'rune_basic_spirit', 'deep currents': 'rune_deep_currents', 'festival wages': 'rune_festival_wages', 'chosen vessel': 'rune_chosen_vessel',
      'growing chorus': 'rune_growing_chorus', 'traveling festival': 'rune_traveling_festival',
      // Design pass tranche 3 (owner 2026-09-27): no Beckoning; its slot is the owner's pick, the Kindred Hand.
      'call and answer': 'rune_call_and_answer', encore: 'rune_encore', overture: 'rune_overture', 'kindred hand': 'rune_kindred_hand',
    },
    epic: {
      'epic spirit': 'rune_epic_spirit', 'shared revelry': 'rune_shared_revelry', 'grand procession': 'rune_grand_procession', 'handy flame': 'rune_handy_flame',
      'spirit crown': 'rune_spirit_crown', 'dream mirror': 'rune_dream_mirror', 'open hand': 'rune_open_hand', 'waking reserve': 'rune_waking_reserve', 'waking dreams': 'rune_waking_dreams',
      'dreamed graves': 'rune_dreamed_graves', // re-tagged Neutral -> Spirit (2026-09-27 design pass)
    },
  },
  celestial: {
    basic: {
      'basic celestial': 'rune_basic_celestial', accretion: 'rune_accretion', eventide: 'rune_eventide', 'falling embers': 'rune_falling_embers', 'first light': 'rune_first_light',
      // Design pass tranche 2 (owner 2026-09-27).
      'heralding star': 'rune_heralding_star', 'stellar echoes': 'rune_stellar_echoes', 'scattered light': 'rune_scattered_light', gravity: 'rune_gravity', afterglow: 'rune_afterglow',
    },
    epic: {
      'epic celestial': 'rune_epic_celestial', spellweaving: 'rune_spellweaving', 'stolen constellations': 'rune_stolen_constellations',
      'meteor shower': 'rune_meteor_shower', 'red giant': 'rune_red_giant', supernova: 'rune_supernova',
      'open constellation': 'rune_open_constellation', // RESTORED (2026-09-27 design pass)
      // Design pass tranche 2 (owner 2026-09-27). No Event Horizon; its slot went to the owner's pick the same day, the
      // Meteor Storm (the owner named it "Meteor Shower", which is already this list's `rune_meteor_shower`).
      starsong: 'rune_starsong', 'guiding star': 'rune_guiding_star', 'meteor storm': 'rune_meteor_storm',
    },
  },
  // HYBRIDS (2026-09-27 design pass): one per natural tribe pair, each gated to BOTH its tribes (HYBRID_TRIBES).
  // Soul Script predates the group and stays listed under Undead (owner 2026-09-25).
  hybrid: {
    // Design pass tranche 4 (owner 2026-09-27). No Tavern Tab: its Dwarf + Spirit slot is the owner's pick, the Last
    // Call, shipped as "Rune of Closing Time" (the Set 2 Dwarf rune `rune_last_call` already owns "Rune of Last Call").
    basic: { 'minted gems': 'rune_minted_gems', 'gem crypt': 'rune_gem_crypt', pallbearer: 'rune_pallbearer', 'star tap': 'rune_star_tap', 'closing time': 'rune_closing_time' },
    epic: { 'festival circuit': 'rune_festival_circuit' /* RESTORED */, 'grim toast': 'rune_grim_toast', 'gem star': 'rune_gem_star', 'keepsake gem': 'rune_keepsake_gem',
      // Owner add 2026-10-03: Rune of Drakko (Set 2 + Set 3, Epic), "categorize it as a dragon and/or spirit rune".
      drakko: 'rune_drakko' },
  },
  // MENAGERIE (2026-09-27 design pass, tranche 5): the Set 3 Menagerie (gated to all five tribes, MENAGERIE_TRIBES) and
  // Unity (untagged, as the Stoked Menagerie). Five Banners, Strange Caravan and the Stoked Menagerie stay listed as
  // Neutral, as the owner's list had them.
  menagerie: {
    basic: { menagerie: 'rune_menagerie_set3' },
    epic: { unity: 'rune_unity' },
  },
  neutral: {
    basic: {
      'heavy hand': 'rune_heavy_hand', // design pass tranche 5 (owner 2026-09-27): the Pummel rune
      'happy birthday': 'rune_happy_birthday', action: 'rune_action', amplification: 'rune_amplification', backbeat: 'rune_backbeat', bartering: 'rune_bartering',
      'bulk order': 'rune_scale', 'carrion coin': 'rune_carrion_coin', distillation: 'rune_distillation', duplication: 'rune_duplication',
      'echoed arrival': 'rune_echoed_arrival', 'efficient tooling': 'rune_efficient_tooling', forthcoming: 'rune_forthcoming', 'fresh pages': 'rune_fresh_pages',
      fury: 'rune_fury', gambling: 'rune_gambling', kindling: 'rune_kindling', lassoing: 'rune_lassoing', lorekeeping: 'rune_lorekeeping', 'open enrollment': 'rune_open_enrollment',
      'quick study': 'rune_quick_study', rallying: 'rune_rallying', 'rare goods': 'rune_rare_goods', recollection: 'rune_recollection', reflector: 'rune_refraction', 'resonant arms': 'rune_resonant_arms', shopkeep: 'rune_shopkeep', spellslinging: 'rune_spellslinging', spending: 'rune_spending',
      baller: 'rune_baller', 'bubble crown': 'rune_bubble_crown', catacomb: 'rune_catacomb', chorus: 'rune_chorus', coffers: 'rune_coffers', collector: 'rune_collector', 'deep feast': 'rune_deep_feast', 'epic forge': 'rune_epic_forge', 'gilded ledger': 'rune_gilded_ledger',
      'golden splinter': 'rune_golden_splinter', 'herding horn': 'rune_herding_horn', 'ornate clock': 'rune_ornate_clock', scout: 'rune_scout', 'seasoned ledger': 'rune_seasoned_ledger', showcase: 'rune_showcase', 'merchants chorus': 'rune_merchants_chorus',
      spellmarket: 'rune_spellmarket', stampede: 'rune_stampede', 'war drum': 'rune_war_drum', transcription: 'rune_transcription',
      // RESTORED (2026-09-27 design pass): the two menagerie Basics and the Hero Power rune.
      'five banners': 'rune_five_banners', 'strange caravan': 'rune_strange_caravan', wishbone: 'rune_wishbone',
    },
    epic: {
      lazarus: 'rune_lazarus', 'merry christmas': 'rune_merry_christmas', adventuring: 'rune_adventuring', cadence: 'rune_cadence', 'combat prowess': 'rune_combat_prowess',
      copies: 'rune_copies', copycat: 'rune_copycat', counterrotation: 'rune_counterrotation', dismantling: 'rune_dismantling',
      'empty hands': 'rune_empty_hands', enchantment: 'rune_enchantment', 'held strength': 'rune_held_strength', 'lasting cadence': 'rune_lasting_cadence',
      might: 'rune_might', 'ninefold commerce': 'rune_ninefold_commerce', overcharge: 'rune_overcharge',
      'perfect recall': 'rune_perfect_recall', abomination: 'rune_abomination', 'astral refrain': 'rune_astral_refrain', 'bargain bin': 'rune_bargain_bin', champion: 'rune_champion', choir: 'rune_choir',
      conductor: 'rune_conductor', 'corrupted tome': 'rune_corrupted_tome', crucible: 'rune_crucible', deep: 'rune_deep', 'grand workshop': 'rune_grand_workshop',
      'guiding candle': 'rune_guiding_candle', herald: 'rune_herald', 'long shift': 'rune_long_shift', 'last tool': 'rune_last_tool', muster: 'rune_muster',
      procession: 'rune_procession', 'second path': 'rune_second_path', 'stoked menagerie': 'rune_stoked_menagerie', 'tip jar': 'rune_tip_jar', twilight: 'rune_twilight',
      'twin gilding': 'rune_twin_gilding', yazzus: 'rune_yazzus',
    },
  },
};

const LISTED: string[] = Object.values(OWNER_LIST).flatMap((g) => [...Object.values(g.basic), ...Object.values(g.epic)]);
const LIVE = [...RUNES, ...EPIC_RUNES];
const inSet3 = (r: { sets?: readonly string[] }): boolean => !r.sets || r.sets.includes('set3');

/** Runes that were Set-3-only before the list: leaving Set 3 leaves them offered in NO set (`sets: []`), not
 *  archived. The owner decides whether to archive or re-home them. */
const NOWHERE = ['rune_charted_skies',
  // Set-3-only runes cut on 2026-09-27 (design pass): now offered in no set. (Festival Circuit and Open
  // Constellation left this list the same day: restored to Set 3.)
  'rune_rubywire', 'rune_astral_draft', 'rune_quick_release'];

/** The menagerie group's tribe gates (2026-09-27 design pass, tranche 5). */
const MENAGERIE_TRIBES: Record<string, readonly Tribe[]> = {
  rune_menagerie_set3: ['kobold', 'dwarf', 'undead', 'spirit', 'celestial'],
  rune_unity: [],
};

/** The hybrid group's tribe gates (2026-09-27 design pass). */
const HYBRID_TRIBES: Record<string, readonly Tribe[]> = {
  rune_festival_circuit: ['spirit', 'celestial'],
  // tranche 4 (2026-09-27)
  rune_minted_gems: ['kobold', 'dwarf'], rune_gem_crypt: ['kobold', 'undead'], rune_pallbearer: ['undead', 'spirit'],
  rune_star_tap: ['dwarf', 'celestial'], rune_closing_time: ['dwarf', 'spirit'], rune_grim_toast: ['dwarf', 'undead'],
  rune_gem_star: ['kobold', 'celestial'], rune_keepsake_gem: ['kobold', 'spirit'],
  rune_drakko: ['dragon', 'spirit'], // owner 2026-10-03 (Set 3 fields no Dragons; the Spirit half gates it here)
};

describe("the owner's Set 3 rune list (2026-09-25)", () => {
  it('names 203 distinct runes, every one a live (non-archived) rune def', () => {
    // 163 + 11 from Set 3 rune batch 3 (2026-09-25) = 174; the 2026-09-27 design pass: tranche 0 cut 10, restored 5 (169);
    // tranche 1 added 8 Undead (177); tranche 2 added 8 Celestial (185); tranche 3 added 4 Spirit + 3 Dwarf (192); tranche 4 added 8 hybrids (200); tranche 5 added the Set 3 Menagerie, Unity and the Heavy Hand (203); Rune of Drakko 2026-10-03 (204); Profit Sharing archived everywhere 2026-10-07 (203).
    expect(LISTED).toHaveLength(203);
    expect(new Set(LISTED).size, 'no rune named twice').toBe(LISTED.length);
    for (const id of LISTED) {
      expect(LIVE.some((r) => r.id === id), `${id} is a live rune`).toBe(true);
      expect(ARCHIVED_RUNES.some((r) => r.id === id), `${id} is not archived`).toBe(false);
    }
  });

  it('the Set 3 static rune pool is EXACTLY the list, by id', () => {
    expect(LIVE.filter(inSet3).map((r) => r.id).sort()).toEqual([...LISTED].sort());
  });

  it('a Set 3 Runeforge with every Set 3 tribe rolled can offer exactly the list (Basic forge + Epic forge)', () => {
    const offered = new Set<string>();
    // Keshi joins 2026-09-27: her power doubles, so the restored Wishbone (requiresDoublePower) is reachable.
    for (const hero of ['warden', 'runesmith', 'keshi']) {
      for (const epic of [false, true]) {
        const s = { ...createRun(7, hero, 'ascent', undefined, 'set3'), tribes: [...SETS.set3.tribes] as Tribe[], ownedRunes: [], runeforgeEpic: epic || undefined } as RunState;
        for (const id of runeforgePool(s)) offered.add(id);
      }
    }
    expect([...offered].sort()).toEqual([...LISTED].sort());
  });

  it('counts: 109 Basic / 94 Epic, after Profit Sharing left 2026-10-07 (91 / 83 on 2026-09-25; 2026-09-27 tranche 0: 87 / 82; tranche 1: + 5 / + 3 Undead; tranche 2: + 5 / + 3 Celestial; tranche 3: + 5 / + 2 Spirit + Dwarf; tranche 4: + 5 / + 3 hybrids; tranche 5: + 2 / + 1 Menagerie + Heavy Hand)', () => {
    expect(LISTED.filter((id) => RUNES.some((r) => r.id === id))).toHaveLength(109);
    expect(LISTED.filter((id) => EPIC_RUNES.some((r) => r.id === id))).toHaveLength(94); // 95 → 94 on 2026-10-07 (Profit Sharing archived); 94 → 95 on 2026-10-03 (Rune of Drakko)
  });

  it('every rune NOT named is out of Set 3, still resolves, and keeps its other sets (never archived)', () => {
    const out = LIVE.filter((r) => !LISTED.includes(r.id));
    for (const r of out) {
      expect(inSet3(r), `${r.id} left set 3`).toBe(false);
      expect(RUNE_INDEX[r.id], `${r.id} still resolves`).toBe(r);
      if (!NOWHERE.includes(r.id)) expect(r.sets!.length, `${r.id} keeps another set`).toBeGreaterThan(0);
    }
    for (const id of NOWHERE) expect(RUNE_INDEX[id]!.sets, `${id} was Set-3-only: now offered in no set`).toEqual([]);
  });

  it('RARITY: every rune sits in the pool its Basic / Epic heading names (zero mismatches)', () => {
    for (const [group, g] of Object.entries(OWNER_LIST)) {
      for (const id of Object.values(g.basic)) {
        expect(RUNES.some((r) => r.id === id), `${id} (${group} Basic) is in RUNES`).toBe(true);
        expect(RUNE_INDEX[id]!.epic, `${id} (${group} Basic) carries no Epic kicker`).toBeFalsy();
      }
      for (const id of Object.values(g.epic)) {
        expect(EPIC_RUNES.some((r) => r.id === id), `${id} (${group} Epic) is in EPIC_RUNES`).toBe(true);
        expect(RUNE_INDEX[id]!.epic, `${id} (${group} Epic) carries the Epic kicker`).toBe(true);
      }
    }
  });

  it('TRIBE: a tribe-listed rune carries that tribe gate, a Neutral-listed rune carries none (zero mismatches)', () => {
    // The only owner-ruled extra tribe: Soul Script ("Starforms count as Undead") keeps Celestial beside Undead.
    const EXTRA: Record<string, readonly Tribe[]> = { rune_soul_script: ['celestial'] };
    for (const [group, g] of Object.entries(OWNER_LIST)) {
      for (const id of [...Object.values(g.basic), ...Object.values(g.epic)]) {
        const tribes = [...(RUNE_INDEX[id]!.tribes ?? [])].sort();
        if (group === 'neutral') expect(tribes, `${id} is Neutral: no tribe gate`).toEqual([]);
        else if (group === 'hybrid') expect(tribes, `${id} is a hybrid`).toEqual([...HYBRID_TRIBES[id]!].sort());
        else if (group === 'menagerie') expect(tribes, `${id} is a menagerie rune`).toEqual([...MENAGERIE_TRIBES[id]!].sort());
        else expect(tribes, `${id} is gated to ${group}`).toEqual([group as Tribe, ...(EXTRA[id] ?? [])].sort());
      }
    }
  });

  it('the rulings of 2026-09-25 hold at the forge: newly gated runes need their tribe, Lazarus is open to any run', () => {
    const forge = (setId: 'set2' | 'set3', tribes: Tribe[], epic: boolean): string[] =>
      runeforgePool({ ...createRun(7, 'warden', 'ascent', undefined, setId), tribes, ownedRunes: [], runeforgeEpic: epic || undefined } as RunState);
    const GATED: [string, Tribe][] = [
      ['rune_sellers_market', 'dwarf'], ['rune_spearline', 'undead'], ['rune_dream_mirror', 'spirit'],
      ['rune_open_hand', 'spirit'], ['rune_waking_reserve', 'spirit'], ['rune_waking_dreams', 'spirit'],
    ];
    for (const [id, tribe] of GATED) {
      const others = SETS.set3.tribes.filter((t) => t !== tribe) as Tribe[];
      expect(forge('set3', others, true), `${id} without ${tribe}`).not.toContain(id);
      expect(forge('set3', [tribe, ...others.slice(0, 2)], true), `${id} with ${tribe}`).toContain(id);
    }
    // Lazarus: no Undead needed, in Set 3 or Set 2 (which fields no Undead at all).
    expect(forge('set3', ['kobold', 'dwarf', 'spirit'], true)).toContain('rune_lazarus');
    expect(forge('set2', ['kobold', 'dwarf', 'beast'], true)).toContain('rune_lazarus');
    // Engraving Gems: now a BASIC-forge Kobold rune, never at an Epic forge.
    expect(forge('set3', ['kobold', 'dwarf', 'undead'], false)).toContain('rune_engraving_gems');
    expect(forge('set3', ['kobold', 'dwarf', 'undead'], true)).not.toContain('rune_engraving_gems');
    expect(forge('set3', ['dwarf', 'undead', 'spirit'], false)).not.toContain('rune_engraving_gems');
  });
});
