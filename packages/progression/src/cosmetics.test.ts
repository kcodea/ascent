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

  it('every handoff category exists with its weight; title, the two skin slots and hero attacks are switched on', () => {
    expect([...COSMETIC_CATEGORIES].sort()).toEqual(['announcer', 'board', 'hero_attack', 'hero_skin', 'minion_skin', 'music', 'title']);
    expect(COSMETIC_CATEGORIES.map((c) => [c, COSMETIC_CATEGORY_DEFS[c].weight])).toEqual([
      ['announcer', 10], ['hero_skin', 20], ['minion_skin', 35], ['title', 10], ['hero_attack', 15], ['board', 5], ['music', 5],
    ]);
    // Owner 2026-09-28: "the new blast attack is going to be a cosmetic unlock, not a new default" (hero_attack on).
    expect(COSMETIC_CATEGORIES.filter((c) => COSMETIC_CATEGORY_DEFS[c].enabled)).toEqual(['hero_skin', 'minion_skin', 'title', 'hero_attack']);
    expect(CRATE_RARITY_ODDS).toEqual({ common: 50, rare: 30, epic: 15, legendary: 5 });
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

  it('the rarity is rolled FIRST at the fixed odds: Common [0, .5), Rare [.5, .8), Epic [.8, .95), Legendary [.95, 1)', () => {
    expect(rollCrateRarity(0)).toEqual({ rarity: 'common', frac: 0 });
    expect(rollCrateRarity(0.4999).rarity).toBe('common');
    expect(rollCrateRarity(0.5)).toEqual({ rarity: 'rare', frac: 0 });
    expect(rollCrateRarity(0.7999).rarity).toBe('rare');
    expect(rollCrateRarity(0.8).rarity).toBe('epic');
    expect(rollCrateRarity(0.9499).rarity).toBe('epic');
    expect(rollCrateRarity(0.95).rarity).toBe('legendary');
    expect(rollCrateRarity(0.975).frac).toBeCloseTo(0.5, 9);
    // out-of-range draws clamp
    expect(rollCrateRarity(-5).rarity).toBe('common');
    expect(rollCrateRarity(1e9)).toEqual({ rarity: 'legendary', frac: 1 });
    expect(crateOddsLine()).toBe('Common 50%, Rare 30%, Epic 15%, Legendary 5%');
  });

  it('a first crate (everything eligible) lands EXACTLY 50 / 30 / 15 / 5 at the rarity level, whatever the catalog holds', () => {
    const all = eligibleCrateCosmetics([]);
    for (const r of COSMETIC_RARITIES) expect(all.some((c) => c.rarity === r), r).toBe(true);
    const n = 20000;
    const wins = sweep(all, n);
    const rarity = Object.fromEntries(all.map((c) => [c.id, c.rarity]));
    const byRarity: Record<string, number> = {};
    for (const [id, w] of Object.entries(wins)) byRarity[rarity[id]!] = (byRarity[rarity[id]!] ?? 0) + w;
    expect(COSMETIC_RARITIES.map((r) => byRarity[r])).toEqual([0.5 * n, 0.3 * n, 0.15 * n, 0.05 * n]);
    // and crateChances (the exact analytic split) agrees
    expect(rarityShares(all)).toEqual([50, 30, 15, 5]);
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
    expect(ch.get('attack_arcana')).toBeCloseTo(ch.get('skin_blackbelt_3')!, 12);
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
  it('the per-item chances of a first crate (2026-09-29 catalog): each item = its rarity\'s odds / that rarity\'s item count', () => {
    const all = eligibleCrateCosmetics([]);
    const count = (r: string): number => all.filter((c) => c.rarity === r).length;
    expect(COSMETIC_RARITIES.map(count)).toEqual([9, 19, 14, 17]); // 2026-09-29: Nothing But Net (attack_basketball) made Legendary 17. 2026-09-29 (skins batch 3): Armourer Frank made Common 9; Stencil Sylus and Mace Urchin made Rare 19; Rooks Oona and Magician Buddy Buddy made Epic 14. Before that, 2026-09-29: Inferno, Grave Call, the Stampede, Oona's Banana Cannon and Hemorrhage made Legendary 16; the first Epic attacks, Card Shark and Storm Call, made Epic 12; the four Rare hero attacks (coin, boomerang, bubble, backstab) made Rare 17
    const ch = crateChances(all);
    const pct = (id: string): number => Math.round(100000 * ch.get(id)!) / 1000;
    expect(pct('skin_blackbelt_4')).toBe(5.556);      // Common: 50 / 9
    expect(pct('title_board_builder')).toBe(5.556);
    expect(pct('skin_frank_1')).toBe(5.556);
    expect(pct('skin_blackbelt_1')).toBe(1.579);      // Rare: 30 / 19
    expect(pct('title_grave_whisperer')).toBe(1.579);
    expect(pct('skin_sylus_3')).toBe(1.579);
    expect(pct('skin_seaurchin_1')).toBe(1.579);
    expect(pct('attack_coin')).toBe(1.579);
    expect(pct('attack_backstab')).toBe(1.579);
    expect(pct('skin_bellringer_1')).toBe(1.071);      // Epic: 15 / 14
    expect(pct('skin_albus_1')).toBe(1.071);
    expect(pct('skin_oona_1')).toBe(1.071);
    expect(pct('skin_buddy_1')).toBe(1.071);
    expect(pct('title_kingbreaker')).toBe(1.071);
    expect(pct('attack_cards')).toBe(1.071);
    expect(pct('attack_storm')).toBe(1.071);
    expect(pct('skin_blackbelt_3')).toBe(0.294);      // Legendary: 5 / 17
    expect(pct('attack_arcana')).toBe(0.294);
    expect(pct('attack_fire')).toBe(0.294);
    expect(pct('attack_undead')).toBe(0.294);
    expect(pct('attack_beast')).toBe(0.294);
    expect(pct('attack_banana')).toBe(0.294);
    expect(pct('attack_bleed')).toBe(0.294);
    expect(pct('attack_basketball')).toBe(0.294);
    expect(pct('title_the_unbroken')).toBe(0.294);
    const cat = (k: string): number => Math.round(1000 * all.filter((c) => c.category === k).reduce((a, c) => a + ch.get(c.id)!, 0)) / 10;
    expect([cat('title'), cat('minion_skin'), cat('hero_skin'), cat('hero_attack')]).toEqual([49.2, 30.5, 7.7, 12.6]); // fourteen Legendary attacks x 5 / 17 (Nothing But Net joined 2026-09-29; was 12.5 with thirteen x 5 / 16) + the two Epic attacks x 15 / 14 (Card Shark, Storm Call) + the four Rare attacks x 30 / 19 (2026-09-29, re-pinned for skins batch 3; was 55.4 / 28.5 / 2.5 / 13.6)
    expect([...ch.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('an EMPTY rarity falls to the NEAREST one with something left, ties toward the MORE COMMON one', () => {
    expect(crateRarityFallback('common')).toEqual(['common', 'rare', 'epic', 'legendary']);
    expect(crateRarityFallback('rare')).toEqual(['rare', 'common', 'epic', 'legendary']);
    expect(crateRarityFallback('epic')).toEqual(['epic', 'rare', 'legendary', 'common']);
    expect(crateRarityFallback('legendary')).toEqual(['legendary', 'epic', 'rare', 'common']);
    const all = eligibleCrateCosmetics([]);
    const without = (...rs: string[]): CosmeticDef[] => all.filter((c) => !rs.includes(c.rarity));
    // Epic empty: its 15 goes to Rare (not Legendary)
    expect(rarityShares(without('epic'))).toEqual([50, 45, 0, 5]);
    // Common empty: its 50 goes to Rare
    expect(rarityShares(without('common'))).toEqual([0, 80, 15, 5]);
    // Legendary empty: its 5 goes to Epic
    expect(rarityShares(without('legendary'))).toEqual([50, 30, 20, 0]);
    // Rare AND Epic empty: Rare's 30 goes to Common (nearest), Epic's 15 to Legendary (nearest with something left)
    expect(rarityShares(without('rare', 'epic'))).toEqual([80, 0, 0, 20]);
    // only Legendary left: every draw gives a Legendary
    expect(rarityShares(without('common', 'rare', 'epic'))).toEqual([0, 0, 0, 100]);
    // the pick itself follows the same fallback
    expect(pickCrateReward(without('common'), 0)!.rarity).toBe('rare');
    expect(pickCrateReward(without('epic'), 0.85)!.rarity).toBe('rare');
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
    const legendaries = all.filter((c) => c.rarity === 'legendary');
    expect(pickCrateReward(all, -5)!.id).toBe(commons[0]!.id);
    expect(pickCrateReward(all, 1e9)!.id).toBe(legendaries[legendaries.length - 1]!.id);
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
