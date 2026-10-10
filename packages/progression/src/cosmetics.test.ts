import { describe, expect, it } from 'vitest';
import {
  ALPHA_TESTER_TITLE_ID, COSMETICS, COSMETIC_CATEGORIES, COSMETIC_CATEGORY_DEFS, COSMETIC_RARITIES, CRATE_RARITY_ODDS, crateChances, crateName, crateOddsLine,
  crateRarityFallback, eligibleCrateCosmetics, parseCrate, parseOpenCrateResult, pickCrateReward,
  rollCrateRarity, type CosmeticDef, HERO_TITLE_COSMETICS, HERO_TITLE_NAMES, heroMasterTitleId, heroTitleId, heroTitleInfo, isMasterTitle, titleShelf,
} from './cosmetics';
import { ACHIEVEMENT_HEROES, ACHIEVEMENT_INDEX } from './achievements';
import { cratesEarnedThrough, cratesForSettlement, titleName, titlesForLevel } from './rules';

/**
 * THE COSMETIC CATALOG + THE CRATE ROLL (2026-09-28). The catalog's shape (15 crate titles, every handoff
 * category present and only titles switched on, Alpha Tester a level milestone outside the crate pool, player
 * text rules), and the roll (FIXED rarity odds since 2026-09-29, owner: "go to C", then "make it 50/30/15/5
 * though"): a rarity at the published odds, then an unowned item of it, each equally likely ("yeah equal chance"), the nearest rarity with
 * something left when the rolled one is empty, never an owned item, null only when nothing is left.
 */

const crateTitles = COSMETICS.filter((c) => c.category === 'title' && c.acquisition.type === 'crate');
/** Everything a crate can give (titles + skins since 2026-09-28). */
const crateItems = COSMETICS.filter((c) => c.acquisition.type === 'crate');

describe('the launch catalog', () => {
  it('owner 2026-09-27: 15 crate titles (7 Common, 5 Rare, 2 Epic, 1 Legendary), unique permanent ids', () => {
    expect(crateTitles).toHaveLength(15);
    const byRarity = (r: string): number => crateTitles.filter((c) => c.rarity === r).length;
    expect([byRarity('common'), byRarity('rare'), byRarity('epic'), byRarity('legendary')]).toEqual([7, 5, 2, 1]);
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(COSMETICS.length);
    // Names are unique, except that a hero title's golden MASTER version shares its base title's name (owner
    // 2026-09-29: the mastery upgrades the same title in place).
    const distinct = COSMETICS.filter((c) => !isMasterTitle(c.id));
    expect(new Set(distinct.map((c) => c.name)).size).toBe(distinct.length);
    for (const c of COSMETICS.filter((x) => isMasterTitle(x.id))) expect(c.name).toBe(COSMETICS.find((b) => b.id === heroTitleInfo(c.id)!.baseId)!.name);
    for (const c of COSMETICS) expect(c.id, c.id).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('player text: short plain names, no em dash, no ranked medal words', () => {
    const medals = /\b(bronze|silver|gold|golden|platinum|diamond|ascendant|ascend\w*|legendary|champion)\b/i;
    for (const c of COSMETICS) {
      expect(c.name, c.id).not.toMatch(/[—–]|--/);
      expect(c.name, c.id).not.toMatch(medals);
      expect(c.name.length, c.id).toBeLessThanOrEqual(20);
      expect(c.name.split(' ').length, c.id).toBeLessThanOrEqual(4);
    }
  });

  it('Alpha Tester stays the Level 2 grant and is NOT in the crate pool', () => {
    const alpha = COSMETICS.find((c) => c.id === ALPHA_TESTER_TITLE_ID)!;
    expect(alpha.acquisition).toEqual({ type: 'level_milestone', level: 2 });
    expect(eligibleCrateCosmetics([]).map((c) => c.id)).not.toContain(ALPHA_TESTER_TITLE_ID);
    expect(titlesForLevel(2)).toEqual([ALPHA_TESTER_TITLE_ID]);
    expect(titleName(ALPHA_TESTER_TITLE_ID)).toBe('Alpha Tester');
    expect(titleName('title_the_unbroken')).toBe('The Unbroken');
  });

  it('every handoff category exists with its weight; title, the two skin slots, hero attacks and portrait frames are switched on', () => {
    expect([...COSMETIC_CATEGORIES].sort()).toEqual(['announcer', 'board', 'hero_attack', 'hero_skin', 'minion_skin', 'music', 'portrait_frame', 'title']);
    expect(COSMETIC_CATEGORIES.map((c) => [c, COSMETIC_CATEGORY_DEFS[c].weight])).toEqual([
      ['announcer', 10], ['hero_skin', 20], ['minion_skin', 35], ['title', 10], ['hero_attack', 15], ['board', 5], ['music', 5], ['portrait_frame', 10],
    ]);
    // Owner 2026-09-28: "the new blast attack is going to be a cosmetic unlock, not a new default" (hero_attack on).
    // Owner 2026-10-01: "we're adding portrait skins" (portrait_frame on, account-wide like the hero attack).
    expect(COSMETIC_CATEGORIES.filter((c) => COSMETIC_CATEGORY_DEFS[c].enabled)).toEqual(['hero_skin', 'minion_skin', 'title', 'hero_attack', 'portrait_frame']);
    expect(COSMETIC_CATEGORY_DEFS.portrait_frame).toEqual({ id: 'portrait_frame', label: 'Portrait Frames', weight: 10, enabled: true, target: 'global' });
    // Owner 2026-10-02: Ancient ("these will be a 3% drop rate") above Legendary; the odds moved 50/30/15/5 -> 35/31/22/9/3.
    expect(CRATE_RARITY_ODDS).toEqual({ common: 35, rare: 31, epic: 22, legendary: 9, ancient: 3 });
    expect(COSMETIC_RARITIES).toEqual(['common', 'rare', 'epic', 'legendary', 'ancient']);
  });
});

describe('the roll', () => {
  it('draws only eligible items: active, crate-sourced, enabled category, not owned', () => {
    // an item in a category that is still switched OFF (announcers) never drops
    const skin: CosmeticDef = { id: 'skin_x', category: 'announcer', name: 'X', rarity: 'common', acquisition: { type: 'crate' }, assets: {}, active: true };
    const retired: CosmeticDef = { ...crateTitles[0]!, id: 'title_retired', active: false };
    const feat: CosmeticDef = { ...crateTitles[0]!, id: 'title_feat', acquisition: { type: 'achievement', id: 'a' } };
    const ids = eligibleCrateCosmetics(['title_wanderer'], [...COSMETICS, skin, retired, feat]).map((c) => c.id);
    expect(ids).toHaveLength(crateItems.length - 1);
    expect(ids).not.toContain('title_wanderer');
    for (const bad of ['skin_x', 'title_retired', 'title_feat', ALPHA_TESTER_TITLE_ID]) expect(ids).not.toContain(bad);
    expect(ids).toEqual([...ids].sort());
  });

  /** Every draw k/N for k in [0, N): an even sweep of [0, 1), how the tests measure exact shares. */
  const sweep = (eligible: readonly CosmeticDef[], n = 20000): Record<string, number> => {
    const wins: Record<string, number> = {};
    for (let k = 0; k < n; k++) {
      const pick = pickCrateReward(eligible, k / n);
      expect(pick).not.toBeNull();
      wins[pick!.id] = (wins[pick!.id] ?? 0) + 1;
    }
    return wins;
  };
  const rarityShares = (eligible: readonly CosmeticDef[]): number[] => {
    const ch = crateChances(eligible);
    return COSMETIC_RARITIES.map((r) => Math.round(1000 * eligible.filter((c) => c.rarity === r).reduce((a, c) => a + ch.get(c.id)!, 0)) / 10);
  };

  it('the rarity is rolled FIRST at the fixed odds: Common [0, .35), Rare [.35, .66), Epic [.66, .88), Legendary [.88, .97), Ancient [.97, 1)', () => {
    expect(rollCrateRarity(0)).toEqual({ rarity: 'common', frac: 0 });
    expect(rollCrateRarity(0.3499).rarity).toBe('common');
    expect(rollCrateRarity(0.35)).toEqual({ rarity: 'rare', frac: 0 });
    expect(rollCrateRarity(0.6599).rarity).toBe('rare');
    expect(rollCrateRarity(0.66).rarity).toBe('epic');
    expect(rollCrateRarity(0.8799).rarity).toBe('epic');
    expect(rollCrateRarity(0.88).rarity).toBe('legendary');
    expect(rollCrateRarity(0.9699).rarity).toBe('legendary');
    expect(rollCrateRarity(0.97).rarity).toBe('ancient');
    expect(rollCrateRarity(0.985).frac).toBeCloseTo(0.5, 9);
    // out-of-range draws clamp
    expect(rollCrateRarity(-5).rarity).toBe('common');
    expect(rollCrateRarity(1e9)).toEqual({ rarity: 'ancient', frac: 1 });
    expect(crateOddsLine()).toBe('Common 35%, Rare 31%, Epic 22%, Legendary 9%, Ancient 3%');
  });

  it('a first crate (everything eligible) lands EXACTLY 35 / 31 / 22 / 9 / 3 at the rarity level, whatever the catalog holds', () => {
    const all = eligibleCrateCosmetics([]);
    for (const r of COSMETIC_RARITIES) expect(all.some((c) => c.rarity === r), r).toBe(true);
    const n = 20000;
    const wins = sweep(all, n);
    const rarity = Object.fromEntries(all.map((c) => [c.id, c.rarity]));
    const byRarity: Record<string, number> = {};
    for (const [id, w] of Object.entries(wins)) byRarity[rarity[id]!] = (byRarity[rarity[id]!] ?? 0) + w;
    expect(COSMETIC_RARITIES.map((r) => byRarity[r])).toEqual([0.35 * n, 0.31 * n, 0.22 * n, 0.09 * n, 0.03 * n]);
    // and crateChances (the exact analytic split) agrees
    expect(rarityShares(all)).toEqual([35, 31, 22, 9, 3]);
  });

  it('within a rarity, EVERY item is equally likely (owner 2026-09-29: "yeah equal chance"); category weight plays no part', () => {
    const all = eligibleCrateCosmetics([]);
    const n = 50000;
    const wins = sweep(all, n);
    const ch = crateChances(all);
    for (const c of all) expect(Math.abs(wins[c.id]! / n - ch.get(c.id)!), c.id).toBeLessThan(0.001);
    for (const r of COSMETIC_RARITIES) {
      const items = all.filter((c) => c.rarity === r);
      for (const c of items) expect(ch.get(c.id), c.id).toBeCloseTo(CRATE_RARITY_ODDS[r] / 100 / items.length, 12);
    }
    // inside Legendary a hero attack (category weight 15) and a minion skin (35) are equally likely
    expect(ch.get('attack_blast')).toBeCloseTo(ch.get('skin_blackbelt_3')!, 12);
    // and inside Ancient too (a hero attack and a portrait frame)
    expect(ch.get('attack_arcana')).toBeCloseTo(ch.get('frame_bonds')!, 12);
    // the category weights are still in the catalog, kept for later (unused by the roll)
    expect(COSMETIC_CATEGORY_DEFS.minion_skin.weight).toBe(35);
  });

  // Pinned 2026-09-29 (fixed odds 50/30/15/5, equal chance within a rarity: roll version 3). Earlier the same day the
  // split inside a rarity was by category weight (roll version 2: Common minion skin 16.667 / title 4.762, Legendary
  // attack 0.375 / minion skin 0.875 / title 0.25). The catalog then: Common 8 items, Rare 13, Epic 10, Legendary 11.
  // Adding an item only re-splits its OWN rarity's share; the four rarity numbers never move. Re-pinned the same day when
  // the ninth to thirteenth hero attacks, Inferno (attack_fire), Grave Call (attack_undead), the Stampede (attack_beast),
  // Oona's Banana Cannon (attack_banana) and Hemorrhage (attack_bleed), all Legendary, joined: Legendary 11 -> 16 items
  // (each 5 / 16). The four Rare hero attacks
  // (attack_coin, attack_boomerang, attack_bubble, attack_backstab) made Rare 13 -> 17 (each 30 / 17). The fourteenth
  // Legendary attack, Nothing But Net (attack_basketball), made Legendary 16 -> 17 (each 5 / 17).
  // 2026-10-02 (the Ancient rarity, odds 35/31/22/9/3, roll version 4): Common 38, Rare 39, Epic 39, Legendary 34
  // (Tee Time Sylus, Edward Colada Hands, Consecration and Arcana moved up), Ancient 10 (those four + six frames).
  // So each Ancient item (3 / 10 = 0.3%) is a touch likelier than each Legendary one (9 / 34 = 0.265%).
  // 2026-10-02: Soul Stitch (attack_soul_stitch), the first attack BUILT at Ancient, made Ancient 11 (each 3 / 11 = 0.273%).
  // 2026-10-03 (skins batch 8 + frames batch 7): Common 38, Rare 40, Epic 44, Legendary 37, Ancient 21. Each Ancient item
  // (3 / 21 = 0.143%) is now rarer than each Legendary one (9 / 37 = 0.243%) again.
  it('the per-item chances of a first crate (2026-10-01 catalog): each item = its rarity\'s odds / that rarity\'s item count', () => {
    const all = eligibleCrateCosmetics([]);
    const count = (r: string): number => all.filter((c) => c.rarity === r).length;
    expect(COSMETIC_RARITIES.map(count)).toEqual([38, 45, 48, 37, 21]); // 2026-10-10: the Fatecarver skin (Astral Fatecarver, Rare, from its retired alt art) made Rare 45. Before that: 2026-10-07 frames batch 9: Color Doodle and Neon Ring (Rare) made Rare 44; Blossom, Neonpunk and Solar Flare (Epic) made Epic 48. Before that: 2026-10-07 skins batch 9: Canyon Drake and Thunderchorus Drake (Chorus Drake, Rare) made Rare 42. Before that: 2026-10-06 frames batch 8: Cosmic Glass (Epic) made Epic 45. Before that: 2026-10-03 skins batch 8 + frames batch 7: Young Tradesman made Rare 40; Cream, Crystal, Disco, Econ and Snare made Epic 44; Author Quillen, Goth Rayse, Lord of Death, Midas and Melon and Chromatic Scale joined Legendary while Leg Day Darah and Dance Night Hunch moved up to Ancient, making Legendary 37; Auctioneer Sweeney, Goth Nadja, Lord Callen, Merrin Sweeney, Nadja Sweeney, Rayse Sweeney, Reflective and those two made Ancient 21. Before that: 2026-10-02 Timebreak (attack_bullet_time, Ancient) made Ancient 12. Before that: 2026-10-02 Soul Stitch (attack_soul_stitch, Ancient) made Ancient 11. Before that: 2026-10-02 the Ancient rarity: Tee Time Sylus, Edward Colada Hands, Consecration and Arcana moved Legendary to Ancient and the six Ancient frames (Bonds, Death, Fortune, Genesis, Time, War) joined, making Legendary 34 and Ancient 10. Before that: 2026-10-02 frames batch 6: Cherry Blossom (Epic) joined; by the owner's folders Burnished, Sterling, Gilded and Seaglass moved Rare to Common and Shard and Prism Epic to Rare (Blue Energy stays Epic: Mike's #1898 setting wins), making Common 38, Rare 39, Epic 39, Legendary 38. Before that: 2026-10-02 frames batch 5: Simple Ring and Void (Rare) made Rare 41. Before that: 2026-10-01 frames batch 4: Multichrome Energy, Blue Energy, Crackling Ruby, Topaz and Jade (Epic) made Epic 40 after two left; Gilt Scale (Common), Dark Cloud and Venom (Epic) moved to Legendary 38 (owner). Before that: 2026-10-01 skins + frames batch 3: Ale, Ruby, Steel, Wood, Dark Scale and Gilt Scale frames made Common 35; Robin Hood and the Magic frame made Rare 39; Goth Merrin, Iron Guardian and the Dark Cloud, Venom and Wedding frames made Epic 37. Before that, merged with portrait frames batch 2 (+1 Common, +7 Rare, +8 Epic, +5 Legendary frames). Before that: 2026-10-01 (skins batch 6, rarity from the art folders): Amber Deepvein, Static Deepvein, Frost Wardkeeper and Infernal Wayfinder made Common 28; Sea Dragon Wayfinder, Timeworn Spellsword and Frost Commander made Rare 30; Nature Commander made Epic 24; Cybernetic Warpath made Legendary 30. 2026-10-01 (skin rarity now comes from the owner's art folders, R-PROG-SKINS-11): forty skins changed rarity, making Common 24, Rare 27, Epic 23, Legendary 29. 2026-09-30 (skins batch 5): Cotton Candy Nimbus, Smog Nimbus and Mime Joker made Common 17; Influencer Indy and seven Rare minion skins made Rare 40; Star Urchin made Epic 26. 2026-09-30 (skins batch 4): Waitress Ayse, Mastered Soren, Young Brakkus, Ninja Robin and Beefy Arnold made Common 14; thirteen Rare skins made Rare 32; eleven Epic skins made Epic 25; Edward Colada Hands, Portal Buddy and Sketch Buddy made Legendary 20. 2026-09-29: Nothing But Net (attack_basketball) made Legendary 17. 2026-09-29 (skins batch 3): Armourer Frank made Common 9; Stencil Sylus and Mace Urchin made Rare 19; Rooks Oona and Magician Buddy Buddy made Epic 14. Before that, 2026-09-29: Inferno, Grave Call, the Stampede, Oona's Banana Cannon and Hemorrhage made Legendary 16; the first Epic attacks, Card Shark and Storm Call, made Epic 12; the four Rare hero attacks (coin, boomerang, bubble, backstab) made Rare 17
    const ch = crateChances(all);
    const pct = (id: string): number => Math.round(100000 * ch.get(id)!) / 1000;
    expect(pct('title_board_builder')).toBe(0.921);      // Common: 35 / 38
    expect(pct('skin_frank_1')).toBe(0.921);
    expect(pct('skin_arnold_1')).toBe(0.921);
    expect(pct('skin_blackbelt_1')).toBe(0.921);
    expect(pct('skin_frank_3')).toBe(0.921);
    expect(pct('skin_wardkeeper_1')).toBe(0.921);
    expect(pct('skin_keshi_1')).toBe(0.921);
    expect(pct('skin_deepvein_1')).toBe(0.921);
    expect(pct('skin_wayfinder_2')).toBe(0.921);
    expect(pct('skin_blackbelt_4')).toBe(0.689);      // Rare: 31 / 45 = 0.689 (2026-10-10 the Fatecarver skin; 31 / 44 = 0.705 after 2026-10-07 frames batch 9; 31 / 42 = 0.738 after skins batch 9; was 31 / 40 = 0.775)
    expect(pct('skin_robin_1')).toBe(0.689);
    expect(pct('skin_joker_2')).toBe(0.689);
    expect(pct('title_grave_whisperer')).toBe(0.689);
    expect(pct('skin_sylus_3')).toBe(0.689);
    expect(pct('skin_baal_1')).toBe(0.689);
    expect(pct('attack_coin')).toBe(0.689);
    expect(pct('attack_backstab')).toBe(0.689);
    expect(pct('skin_seaurchin_2')).toBe(0.689);
    expect(pct('skin_wayfinder_3')).toBe(0.689);
    expect(pct('skin_blazingkeeper_1')).toBe(0.689);
    expect(pct('skin_seaurchin_1')).toBe(0.458);      // Epic: 22 / 48 (2026-10-07 frames batch 9; 22 / 45 = 0.489 after Cosmic Glass; was 22 / 44 = 0.5)
    expect(pct('skin_indy_1')).toBe(0.458);
    expect(pct('skin_bellringer_1')).toBe(0.458);
    expect(pct('skin_albus_1')).toBe(0.458);
    expect(pct('skin_oona_1')).toBe(0.458);
    expect(pct('title_kingbreaker')).toBe(0.458);
    expect(pct('attack_cards')).toBe(0.458);
    expect(pct('attack_storm')).toBe(0.458);
    expect(pct('skin_buddy_3')).toBe(0.458);
    expect(pct('skin_blazingkeeper_2')).toBe(0.458);
    expect(pct('skin_nimbus_2')).toBe(0.243);      // Legendary: 9 / 37
    expect(pct('skin_blazingkeeper_3')).toBe(0.243);
    expect(pct('skin_buddy_1')).toBe(0.243);
    expect(pct('skin_pimm_2')).toBe(0.243);
    expect(pct('skin_blackbelt_3')).toBe(0.243);
    expect(pct('attack_fire')).toBe(0.243);
    expect(pct('attack_undead')).toBe(0.243);
    expect(pct('attack_beast')).toBe(0.243);
    expect(pct('attack_banana')).toBe(0.243);
    expect(pct('attack_bleed')).toBe(0.243);
    expect(pct('attack_basketball')).toBe(0.243);
    expect(pct('title_the_unbroken')).toBe(0.243);
    expect(pct('frame_honey')).toBe(0.921);
    expect(pct('frame_bronze')).toBe(0.921);
    expect(pct('frame_vines')).toBe(0.689);
    expect(pct('frame_ice')).toBe(0.458);
    expect(pct('frame_nimbus')).toBe(0.458);
    expect(pct('frame_fire')).toBe(0.243);
    expect(pct('frame_wind')).toBe(0.243);
    expect(pct('frame_ale')).toBe(0.921);
    expect(pct('frame_wood')).toBe(0.921);
    expect(pct('frame_magic')).toBe(0.689);
    expect(pct('frame_simple_ring')).toBe(0.689);
    expect(pct('frame_void')).toBe(0.689);
    expect(pct('skin_robin_2')).toBe(0.689);
    expect(pct('skin_merrin_1')).toBe(0.458);
    expect(pct('skin_runeguard_1')).toBe(0.458);
    expect(pct('frame_golden_dragonscale')).toBe(0.243);
    expect(pct('frame_wedding')).toBe(0.458);
    expect(pct('frame_jade')).toBe(0.458);
    expect(pct('frame_dark_cloud')).toBe(0.243);
    expect(pct('frame_venom')).toBe(0.243);
    expect(pct('frame_platinum')).toBe(0.921);   // frames batch 6: moved Rare -> Common
    expect(pct('frame_dark_diamond')).toBe(0.689); // moved Epic -> Rare
    expect(pct('frame_diamond')).toBe(0.689);
    expect(pct('frame_blue_energy')).toBe(0.458); // stays Epic (Mike's setting)
    expect(pct('frame_cherry_blossom')).toBe(0.458);
    // skins batch 8 + frames batch 7 (2026-10-03)
    expect(pct('skin_hermithank_1')).toBe(0.689);
    for (const id of ['frame_cream', 'frame_crystal', 'frame_disco', 'frame_econ', 'frame_snare']) expect(pct(id), id).toBe(0.458);
    expect(pct('frame_cosmic_glass')).toBe(0.458); // frames batch 8 (2026-10-06, Mike)
    for (const id of ['skin_chorus_2', 'skin_chorus_3']) expect(pct(id), id).toBe(0.689); // skins batch 9 (2026-10-07)
    for (const id of ['frame_blossom', 'frame_neonpunk', 'frame_solar_flare']) expect(pct(id), id).toBe(0.458); // frames batch 9 (2026-10-07, Mike)
    for (const id of ['frame_color_doodle', 'frame_neon_ring']) expect(pct(id), id).toBe(0.689);
    for (const id of ['skin_quillen_1', 'skin_rayse_1', 'skin_risen_1', 'skin_midas_1', 'frame_chromatic_dragonscale']) expect(pct(id), id).toBe(0.243);
    // Ancient: 3 / 21 (2026-10-03, skins batch 8 + frames batch 7; 3 / 12 = 0.25 after Timebreak; 3 / 11 = 0.273 after Soul Stitch; was 3 / 10 = 0.3)
    for (const id of ['skin_sylus_2', 'skin_edward_1', 'attack_holy', 'attack_arcana', 'attack_soul_stitch', 'attack_bullet_time', 'frame_bonds', 'frame_death', 'frame_fortune', 'frame_genesis', 'frame_time', 'frame_war',
      'skin_darah_1', 'skin_hunch_1', 'skin_myra_1', 'skin_nadja_1', 'skin_risen_2', 'skin_merrin_2', 'skin_nadja_2', 'skin_rayse_2', 'frame_reflective']) expect(pct(id), id).toBe(0.143);
    const cat = (k: string): number => Math.round(1000 * all.filter((c) => c.category === k).reduce((a, c) => a + ch.get(c.id)!, 0)) / 10;
    expect([cat('title'), cat('minion_skin'), cat('hero_skin'), cat('hero_attack'), cat('portrait_frame')]).toEqual([11.1, 36.7, 15.7, 7.2, 29.4]); // the Fatecarver skin (2026-10-10; was 11.1 / 36.3 / 15.8 / 7.2 / 29.5 after frames batch 9); frames batch 9 (2026-10-07; was 11.4 / 37.4 / 16.2 / 7.4 / 27.6 after skins batch 9); skins batch 9, Canyon Drake + Thunderchorus Drake (2026-10-07; was 11.5 / 36.6 / 16.4 / 7.6 / 27.9); frames batch 8, Cosmic Glass (2026-10-06; was 11.6 / 36.7 / 16.5 / 7.6 / 27.6); skins batch 8 + frames batch 7 (2026-10-03; was 11.8 / 38.3 / 14.8 / 8.5 / 26.5); Timebreak joined Ancient (2026-10-02; was 11.8 / 38.4 / 14.8 / 8.3 / 26.7); Soul Stitch joined Ancient (2026-10-02; was 11.8 / 38.4 / 14.8 / 8.1 / 26.8); the Ancient rarity (2026-10-02; was 14 / 40 / 15 / 5.7 / 25.4 after frames batch 6); frames batch 6 (2026-10-02; was 14.8 / 41.6 / 15.7 / 5.5 / 22.4 after frames batch 5); frames batch 5 (2026-10-02; was 15 / 42.2 / 15.8 / 5.7 / 21.3 after frames batch 4); frames batch 4 (2026-10-01; was 14.8 / 42.1 / 15.9 / 5.9 / 21.3 after skins + frames batch 3; before that 17.2 / 48.1 / 16.6 / 6.2 / 11.9 after skins batch 6 + portrait frames batch 2); // re-pinned 2026-10-01 for skins batch 6 (was 21.6 / 49.1 / 21.1 / 8.2 when skin rarities moved to the owner's art folders, 25.7 / 42 / 24.6 / 7.7 after skins batch 5, 31.1 / 32.1 / 28.3 / 8.5 after batch 4, 49.2 / 30.5 / 7.7 / 12.6 before it): fourteen Legendary attacks x 5 / 20 (Nothing But Net joined 2026-09-29) + the two Epic attacks x 15 / 26 (Card Shark, Storm Call) + the four Rare attacks x 30 / 40 (2026-09-29, re-pinned for skins batch 3; was 55.4 / 28.5 / 2.5 / 13.6)
    expect([...ch.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('an EMPTY rarity falls to the NEAREST one with something left, ties toward the MORE COMMON one', () => {
    expect(crateRarityFallback('common')).toEqual(['common', 'rare', 'epic', 'legendary', 'ancient']);
    expect(crateRarityFallback('rare')).toEqual(['rare', 'common', 'epic', 'legendary', 'ancient']);
    expect(crateRarityFallback('epic')).toEqual(['epic', 'rare', 'legendary', 'common', 'ancient']);
    expect(crateRarityFallback('legendary')).toEqual(['legendary', 'epic', 'ancient', 'rare', 'common']);
    expect(crateRarityFallback('ancient')).toEqual(['ancient', 'legendary', 'epic', 'rare', 'common']);
    const all = eligibleCrateCosmetics([]);
    const without = (...rs: string[]): CosmeticDef[] => all.filter((c) => !rs.includes(c.rarity));
    // Epic empty: its 22 goes to Rare (not Legendary)
    expect(rarityShares(without('epic'))).toEqual([35, 53, 0, 9, 3]);
    // Common empty: its 35 goes to Rare
    expect(rarityShares(without('common'))).toEqual([0, 66, 22, 9, 3]);
    // Legendary empty: its 9 goes to Epic (the tie with Ancient goes to the more common one)
    expect(rarityShares(without('legendary'))).toEqual([35, 31, 31, 0, 3]);
    // Ancient empty: its 3 goes to Legendary
    expect(rarityShares(without('ancient'))).toEqual([35, 31, 22, 12, 0]);
    // Rare AND Epic empty: Rare's 31 goes to Common (nearest), Epic's 22 to Legendary (nearest with something left)
    expect(rarityShares(without('rare', 'epic'))).toEqual([66, 0, 0, 31, 3]);
    // only Ancient left: every draw gives an Ancient
    expect(rarityShares(without('common', 'rare', 'epic', 'legendary'))).toEqual([0, 0, 0, 0, 100]);
    // the pick itself follows the same fallback
    expect(pickCrateReward(without('common'), 0)!.rarity).toBe('rare');
    expect(pickCrateReward(without('epic'), 0.75)!.rarity).toBe('rare');
    expect(pickCrateReward(without('ancient'), 0.99)!.rarity).toBe('legendary');
  });

  it('never an owned item, and a crate always gives something while anything remains', () => {
    for (const owned of [[], crateTitles.filter((c) => c.rarity === 'common').map((c) => c.id), crateItems.slice(0, 30).map((c) => c.id)]) {
      const wins = sweep(eligibleCrateCosmetics(owned), 2000);
      for (const id of Object.keys(wins)) expect(owned).not.toContain(id);
    }
    const one = eligibleCrateCosmetics(crateItems.map((c) => c.id).filter((id) => id !== 'title_kingbreaker'));
    expect(one.map((c) => c.id)).toEqual(['title_kingbreaker']);
    for (const u of [0, 0.3, 0.6, 0.9, 0.99]) expect(pickCrateReward(one, u)!.id).toBe('title_kingbreaker');
  });

  it('an exhausted pool gives nothing (the crate stays sealed); out-of-range draws clamp', () => {
    const none = eligibleCrateCosmetics(crateItems.map((c) => c.id));
    expect(none).toEqual([]);
    expect(pickCrateReward(none, 0)).toBeNull();
    expect(crateChances(none).size).toBe(0);
    const all = eligibleCrateCosmetics([]);
    const commons = all.filter((c) => c.rarity === 'common');
    const ancients = all.filter((c) => c.rarity === 'ancient');
    expect(pickCrateReward(all, -5)!.id).toBe(commons[0]!.id);
    expect(pickCrateReward(all, 1e9)!.id).toBe(ancients[ancients.length - 1]!.id);
  });
});

describe('crates per level (rules.ts)', () => {
  it('an account at Level L has earned L crates; a settlement creates one per level gained, plus the Welcome Crate when enrolling', () => {
    expect(cratesEarnedThrough(1)).toBe(1);
    expect(cratesEarnedThrough(12)).toBe(12);
    expect(cratesForSettlement(1, 1, true)).toBe(1);
    expect(cratesForSettlement(1, 2, true)).toBe(2);
    expect(cratesForSettlement(3, 3, false)).toBe(0);
    expect(cratesForSettlement(3, 7, false)).toBe(4);
  });
  it('crate names', () => {
    expect(crateName(1)).toBe('Welcome Crate');
    expect(crateName(7)).toBe('Level 7 Crate');
  });
});

describe('parsing the server shapes', () => {
  const crate = { crateId: 'c-1', earnedLevel: 3, state: 'opened', rewardId: 'title_ironbeard', earnedAt: 't0', openedAt: 't1' };
  it('a crate from the SQL JSON or a table read', () => {
    expect(parseCrate(crate)).toEqual(crate);
    expect(parseCrate({ crate_id: 'c-2', earned_level: 1, state: 'sealed', reward_cosmetic_id: null, earned_at: 't0', opened_at: null }))
      .toEqual({ crateId: 'c-2', earnedLevel: 1, state: 'sealed', rewardId: null, earnedAt: 't0', openedAt: null });
    expect(parseCrate({ ...crate, state: 'cracked' })).toBeNull();
    expect(parseCrate({ ...crate, earnedLevel: 0 })).toBeNull();
  });
  it('an open result: opened / already_opened need a reward; pool_exhausted never has one', () => {
    expect(parseOpenCrateResult({ status: 'opened', crate, rewardId: 'title_ironbeard', sealedRemaining: 2 }))
      .toMatchObject({ status: 'opened', rewardId: 'title_ironbeard', sealedRemaining: 2 });
    expect(parseOpenCrateResult({ status: 'opened', crate, rewardId: null, sealedRemaining: 2 })).toBeNull();
    expect(parseOpenCrateResult({ status: 'pool_exhausted', crate: { ...crate, state: 'sealed', rewardId: null }, rewardId: null, sealedRemaining: 1 }))
      .toMatchObject({ status: 'pool_exhausted', rewardId: null });
    expect(parseOpenCrateResult({ status: 'weird', crate, rewardId: 'x', sealedRemaining: 0 })).toBeNull();
  });
});

describe(`hero titles (owner 2026-09-29: "the hero's title is granted at 3 wins with a hero, then the mastery of that title is after 10 wins")`, () => {
  it('two achievement-sourced titles per playable hero: the title (Epic) and its golden master (Legendary), same name', () => {
    expect(HERO_TITLE_COSMETICS).toHaveLength(ACHIEVEMENT_HEROES.length * 2);
    // one title per playable hero, in the same order (the hero list lives in achievements.ts)
    expect(HERO_TITLE_NAMES.map(([id]) => id)).toEqual(ACHIEVEMENT_HEROES.map((h) => h.id));
    for (const { id } of ACHIEVEMENT_HEROES) {
      const h = { id, title: HERO_TITLE_NAMES.find(([x]) => x === id)![1] };
      const base = COSMETICS.find((c) => c.id === heroTitleId(h.id))!;
      const master = COSMETICS.find((c) => c.id === heroMasterTitleId(h.id))!;
      expect(base).toMatchObject({ category: 'title', name: h.title, rarity: 'epic', acquisition: { type: 'achievement', id: `hero.${h.id}.titled` }, active: true });
      expect(master).toMatchObject({ category: 'title', name: h.title, rarity: 'legendary', acquisition: { type: 'achievement', id: `hero.${h.id}.mastery` }, active: true });
      expect(ACHIEVEMENT_INDEX[`hero.${h.id}.titled`]!.target).toBe(3);
      expect(ACHIEVEMENT_INDEX[`hero.${h.id}.mastery`]!.target).toBe(10);
      expect([isMasterTitle(base.id), isMasterTitle(master.id)]).toEqual([false, true]);
      expect(heroTitleInfo(master.id)).toEqual({ heroId: h.id, master: true, baseId: base.id, masterId: master.id });
    }
    // the owner's own examples
    expect(['warden', 'gambler', 'albus'].map((id) => COSMETICS.find((c) => c.id === heroTitleId(id))!.name)).toEqual(['Warded', 'Gambling Addict', 'Albus Student']);
    expect(isMasterTitle('title_the_unbroken')).toBe(false);
    expect(isMasterTitle(null)).toBe(false);
  });

  it('never in the crate pool', () => {
    const pool = eligibleCrateCosmetics([]).map((c) => c.id);
    for (const c of HERO_TITLE_COSMETICS) expect(pool).not.toContain(c.id);
  });

  it('the master supersedes the base (upgraded in place); an unowned master stays out of the lists', () => {
    const ids = ['title_wanderer', heroTitleId('warden'), heroMasterTitleId('warden'), heroTitleId('indy'), heroMasterTitleId('indy')];
    expect(titleShelf(ids, new Set())).toEqual(['title_wanderer', heroTitleId('warden'), heroTitleId('indy')]);
    expect(titleShelf(ids, new Set([heroTitleId('warden')]))).toEqual(['title_wanderer', heroTitleId('warden'), heroTitleId('indy')]);
    expect(titleShelf(ids, new Set([heroTitleId('warden'), heroMasterTitleId('warden')]))).toEqual(['title_wanderer', heroMasterTitleId('warden'), heroTitleId('indy')]);
  });
});
