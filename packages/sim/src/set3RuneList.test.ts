/**
 * THE SET 3 RUNE LIST (owner 2026-09-25). The owner's list IS Set 3's Runeforge: every rune named is offered in
 * Set 3, every rune not named is out of Set 3 (it keeps its other sets and is never archived, so saves and replays
 * that own one still resolve it through RUNE_INDEX).
 *
 * The list is kept below in the owner's grouping (tribe, then Basic / Epic) with the owner's word for each rune.
 * That grouping is the OWNER'S; the game stays the source of truth for rarity and tribe gates. Where they differ
 * (Engraving Gems is Epic, several "tribe" runes are untribed, Lazarus is Undead-gated, Soul Script is also
 * Celestial) the game was NOT changed; the mismatches are reported in docs/devlog/2026-09-25-set3-rune-list.md.
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
    basic: { 'basic kobolds': 'rune_basic_kobold', engraving: 'rune_engraving', 'living geode': 'rune_living_geode', resonance: 'rune_resonance', 'engraving gems': 'rune_engraving_gems' },
    epic: { 'epic kobolds': 'rune_epic_kobold', 'attacking gems': 'rune_attacking_gems', investment: 'rune_investment', 'gem golem': 'rune_gem_golem', motherlode: 'rune_motherlode' },
  },
  dwarf: {
    basic: {
      'basic dwarves': 'rune_basic_dwarf', 'full measure': 'rune_full_measure', 'compounding wages': 'rune_compounding_wages', 'heavy payroll': 'rune_heavy_payroll',
      kegheart: 'rune_kegheart', overtime: 'rune_overtime', 'first round': 'rune_first_round', brew: 'rune_brew', flagship: 'rune_flagship',
    },
    epic: {
      'epic dwarves': 'rune_epic_dwarf', bucky: 'rune_bucky', 'double fisting': 'rune_double_fisting', 'profit sharing': 'rune_profit_sharing',
      'dwarf king brill': 'rune_high_king', 'muster general': 'rune_muster_general', 'shared table': 'rune_shared_table', 'sellers market': 'rune_sellers_market',
    },
  },
  undead: {
    basic: { 'basic undead': 'rune_basic_undead', 'last rites': 'rune_last_rites', 'spear warden': 'rune_warden', 'soul script': 'rune_soul_script' },
    epic: { 'epic undead': 'rune_epic_undead', 'death touched apple': 'rune_deathtouched_apple', 'endless march': 'rune_endless_march', 'final gate': 'rune_final_gate', spearline: 'rune_spearline' },
  },
  spirit: {
    basic: {
      'basic spirit': 'rune_basic_spirit', 'deep currents': 'rune_deep_currents', 'festival wages': 'rune_festival_wages', 'chosen vessel': 'rune_chosen_vessel',
      'growing chorus': 'rune_growing_chorus', 'traveling festival': 'rune_traveling_festival',
    },
    epic: {
      'epic spirit': 'rune_epic_spirit', 'shared revelry': 'rune_shared_revelry', 'grand procession': 'rune_grand_procession', 'handy flame': 'rune_handy_flame',
      'spirit crown': 'rune_spirit_crown', 'dream mirror': 'rune_dream_mirror', 'open hand': 'rune_open_hand', 'waking reserve': 'rune_waking_reserve', 'waking dreams': 'rune_waking_dreams',
    },
  },
  celestial: {
    basic: { 'basic celestial': 'rune_basic_celestial', accretion: 'rune_accretion', eventide: 'rune_eventide', 'falling embers': 'rune_falling_embers', 'first light': 'rune_first_light' },
    epic: {
      'epic celestial': 'rune_epic_celestial', spellweaving: 'rune_spellweaving', 'stolen constellations': 'rune_stolen_constellations',
      'meteor shower': 'rune_meteor_shower', 'red giant': 'rune_red_giant', supernova: 'rune_supernova',
    },
  },
  neutral: {
    basic: {
      'happy birthday': 'rune_happy_birthday', action: 'rune_action', amplification: 'rune_amplification', backbeat: 'rune_backbeat', bartering: 'rune_bartering',
      'bulk order': 'rune_scale', 'carrion coin': 'rune_carrion_coin', distillation: 'rune_distillation', duplication: 'rune_duplication',
      'echoed arrival': 'rune_echoed_arrival', 'efficient tooling': 'rune_efficient_tooling', forthcoming: 'rune_forthcoming', 'fresh pages': 'rune_fresh_pages',
      fury: 'rune_fury', gambling: 'rune_gambling', 'grave refreshment': 'rune_grave_refreshment', kindling: 'rune_kindling', lassoing: 'rune_lassoing',
      'living magic': 'rune_living_magic', lorekeeping: 'rune_lorekeeping', 'open enrollment': 'rune_open_enrollment', 'quick release': 'rune_quick_release',
      'quick study': 'rune_quick_study', rallying: 'rune_rallying', 'rare goods': 'rune_rare_goods', recollection: 'rune_recollection', reflector: 'rune_refraction',
      refrain: 'rune_refrain', 'resonant arms': 'rune_resonant_arms', shopkeep: 'rune_shopkeep', spellslinging: 'rune_spellslinging', spending: 'rune_spending',
      baller: 'rune_baller', 'bubble crown': 'rune_bubble_crown', catacomb: 'rune_catacomb', chorus: 'rune_chorus', coffers: 'rune_coffers', collector: 'rune_collector',
      'crowded crypt': 'rune_crowded_crypt', 'deep feast': 'rune_deep_feast', 'epic forge': 'rune_epic_forge', 'gilded ledger': 'rune_gilded_ledger',
      'golden splinter': 'rune_golden_splinter', 'herding horn': 'rune_herding_horn', 'hunting bell': 'rune_hunting_bell', 'ornate clock': 'rune_ornate_clock',
      pair: 'rune_pair', scout: 'rune_scout', 'seasoned ledger': 'rune_seasoned_ledger', showcase: 'rune_showcase', 'merchants chorus': 'rune_merchants_chorus',
      spellmarket: 'rune_spellmarket', stampede: 'rune_stampede', 'war drum': 'rune_war_drum', transcription: 'rune_transcription',
    },
    epic: {
      lazarus: 'rune_lazarus', 'merry christmas': 'rune_merry_christmas', adventuring: 'rune_adventuring', cadence: 'rune_cadence', 'combat prowess': 'rune_combat_prowess',
      copies: 'rune_copies', copycat: 'rune_copycat', counterrotation: 'rune_counterrotation', dismantling: 'rune_dismantling', 'dreamed graves': 'rune_dreamed_graves',
      'empty hands': 'rune_empty_hands', enchantment: 'rune_enchantment', 'held strength': 'rune_held_strength', 'lasting cadence': 'rune_lasting_cadence',
      'living treasure': 'rune_living_treasure', might: 'rune_might', 'ninefold commerce': 'rune_ninefold_commerce', overcharge: 'rune_overcharge', overflow: 'rune_overflow',
      'perfect recall': 'rune_perfect_recall', recurrence: 'rune_recurrence', 'rising echoes': 'rune_rising_echoes', sylus: 'rune_sylus', abomination: 'rune_abomination',
      'astral draft': 'rune_astral_draft', 'astral refrain': 'rune_astral_refrain', 'bargain bin': 'rune_bargain_bin', champion: 'rune_champion', choir: 'rune_choir',
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
const NOWHERE = ['rune_charted_skies', 'rune_festival_circuit', 'rune_open_constellation'];

describe("the owner's Set 3 rune list (2026-09-25)", () => {
  it('names 163 distinct runes, every one a live (non-archived) rune def', () => {
    expect(LISTED).toHaveLength(163);
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
    for (const hero of ['warden', 'runesmith']) {
      for (const epic of [false, true]) {
        const s = { ...createRun(7, hero, 'ascent', undefined, 'set3'), tribes: [...SETS.set3.tribes] as Tribe[], ownedRunes: [], runeforgeEpic: epic || undefined } as RunState;
        for (const id of runeforgePool(s)) offered.add(id);
      }
    }
    expect([...offered].sort()).toEqual([...LISTED].sort());
  });

  it('counts: 83 Basic / 80 Epic (the game rarity, not the list grouping)', () => {
    expect(LISTED.filter((id) => RUNES.some((r) => r.id === id))).toHaveLength(83);
    expect(LISTED.filter((id) => EPIC_RUNES.some((r) => r.id === id))).toHaveLength(80);
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

  it('the list changed no rune rarity: every Basic-grouped / Epic-grouped mismatch is reported, not "fixed"', () => {
    const basicListed = Object.values(OWNER_LIST).flatMap((g) => Object.values(g.basic));
    const epicListed = Object.values(OWNER_LIST).flatMap((g) => Object.values(g.epic));
    expect(basicListed.filter((id) => EPIC_RUNES.some((r) => r.id === id))).toEqual(['rune_engraving_gems']);
    expect(epicListed.filter((id) => RUNES.some((r) => r.id === id))).toEqual([]);
  });
});
