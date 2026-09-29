import { describe, expect, it } from 'vitest';
import {
  ALPHA_TESTER_TITLE_ID, COSMETICS, COSMETIC_CATEGORIES, COSMETIC_CATEGORY_DEFS, RARITY_WEIGHTS, crateName, crateTotalWeight, crateWeightOf,
  eligibleCrateCosmetics, parseCrate, parseOpenCrateResult, pickCrateReward, type CosmeticDef,
} from './cosmetics';
import { cratesEarnedThrough, cratesForSettlement, titleName, titlesForLevel } from './rules';

/**
 * THE COSMETIC CATALOG + THE CRATE ROLL (2026-09-28). The catalog's shape (15 crate titles, every handoff
 * category present and only titles switched on, Alpha Tester a level milestone outside the crate pool, player
 * text rules), and the roll: weighted over what actually REMAINS (no rarity rolled first), exact to the weights,
 * never an owned item, null only when nothing is left.
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
    expect(new Set(COSMETICS.map((c) => c.name)).size).toBe(COSMETICS.length);
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
    expect(RARITY_WEIGHTS).toEqual({ common: 55, rare: 30, epic: 12, legendary: 3 });
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

  it('every roll in [0, total) lands on an item, and each item wins EXACTLY its weight share (normalized over what remains)', () => {
    for (const owned of [[], crateTitles.filter((c) => c.rarity === 'common').map((c) => c.id), crateTitles.slice(0, 14).map((c) => c.id)]) {
      const eligible = eligibleCrateCosmetics(owned);
      const total = crateTotalWeight(eligible);
      const wins: Record<string, number> = {};
      for (let r = 0; r < total; r++) {
        const pick = pickCrateReward(eligible, r);
        expect(pick).not.toBeNull();
        expect(owned).not.toContain(pick!.id);
        wins[pick!.id] = (wins[pick!.id] ?? 0) + 1;
      }
      for (const c of eligible) expect(wins[c.id], c.id).toBe(crateWeightOf(c));
    }
  });

  it('never rolls a rarity first: with every Common owned, a crate still always gives an item', () => {
    const noCommons = eligibleCrateCosmetics(crateItems.filter((c) => c.rarity !== 'legendary').map((c) => c.id));
    // 2026-09-28: the Legendary Black Belt Brian skin joined the one Legendary title, then the Legendary Blast hero
    // attack (owner: "make it a legendary reward"), then (2026-09-28) the Legendary Quake, Arcana, Phantom Blades,
    // Enraged Strike, Poison Darts ("Venom Volley"), Frost ("Frost Nova") and Consecration (attack_holy) hero attacks, so ten remain.
    expect(noCommons.map((c) => c.id)).toEqual(['attack_arcana', 'attack_blades', 'attack_blast', 'attack_enraged', 'attack_frost', 'attack_holy', 'attack_poison', 'attack_quake', 'skin_blackbelt_3', 'title_the_unbroken']);
    expect(pickCrateReward(noCommons, 0)!.id).toBe('attack_arcana');
    expect(pickCrateReward(noCommons, crateTotalWeight(noCommons) - 1)!.id).toBe('title_the_unbroken');
  });

  it('an exhausted pool gives nothing (the crate stays sealed); out-of-range rolls clamp', () => {
    const none = eligibleCrateCosmetics(crateItems.map((c) => c.id));
    expect(none).toEqual([]);
    expect(pickCrateReward(none, 0)).toBeNull();
    const all = eligibleCrateCosmetics([]);
    expect(pickCrateReward(all, -5)!.id).toBe(all[0]!.id);
    expect(pickCrateReward(all, 1e9)!.id).toBe(all[all.length - 1]!.id);
  });

  // Re-pinned 2026-09-28 when the Legendary Black Belt Brian and the Epic Bellringer Voss skins joined (was Common
  // 50.9 / Rare 33.7 / Epic 15.1 / Legendary 0.4 / skin 25.8), and AGAIN on 2026-09-28 when the first hero attack
  // (Arcane Barrage, `attack_blast`) joined: was Common 47.6 / Rare 31.5 / Epic 19.3 / Legendary 1.7 / non-title 30.6
  // of 8095. It first landed as Epic (weight 12 x 15 = 180); re-pinned the same day when the owner made it LEGENDARY
  // ("make it a legendary reward"): weight 3 x 15 = 45. Weights of the full pool now: Common 3850, Rare 2550, Epic
  // 1560, Legendary 180 (the Unbroken 30 + Grandmaster Brian 105 + the attack 45) of 8140; non-title 2520; the attack 0.6%.
  // Re-pinned AGAIN 2026-09-28 when the second hero attack, Quake (`attack_quake`, "Tectonic Slam", Legendary, weight
  // 3 x 15 = 45) joined: was Common 47.3 / Rare 31.3 / Epic 19.2 / Legendary 2.2 / non-title 31.0 of 8140. Now
  // Legendary 225 of 8185; non-title 2565; the two attacks together 1.1% (each 0.55%).
  // Re-pinned AGAIN 2026-09-28 when the third hero attack, Arcana (`attack_arcana`, Legendary, weight 3 x 15 = 45)
  // joined: was Common 47.0 / Rare 31.2 / Epic 19.1 / Legendary 2.7 / non-title 31.3 / attacks 1.1 of 8185. Now
  // Legendary 270 of 8230; non-title 2610; the three attacks together 1.6% (each about 0.55%).
  // Re-pinned AGAIN 2026-09-28 when the fourth hero attack, Phantom Blades (`attack_blades`, Legendary, weight 3 x 15 =
  // 45) joined: was Common 46.8 / Rare 31.0 / Epic 19.0 / Legendary 3.3 / non-title 31.7 / attacks 1.6 of 8230. Now
  // Legendary 315 of 8275; non-title 2655; the four attacks together 2.2% (each 0.54%).
  // Re-pinned AGAIN 2026-09-28 when the fifth hero attack, Enraged Strike (`attack_enraged`, Legendary, weight 3 x 15 =
  // 45) joined: was Common 46.5 / Rare 30.8 / Epic 18.9 / Legendary 3.8 / non-title 32.1 / attacks 2.2 of 8275. Now
  // Legendary 360 of 8320; non-title 2700; the five attacks together 2.7% (each 0.54%).
  // Re-pinned AGAIN 2026-09-28 when the sixth hero attack, Poison Darts (`attack_poison`, "Venom Volley", Legendary, weight
  // 3 x 15 = 45) joined: was Common 46.3 / Rare 30.6 / Epic 18.8 / Legendary 4.3 / non-title 32.5 / attacks 2.7 of 8320.
  // Now Legendary 405 of 8365; non-title 2745; the six attacks together 3.2% (each 0.54%).
  // Re-pinned AGAIN 2026-09-28 when the seventh hero attack, Frost (`attack_frost`, "Frost Nova", Legendary, weight 3 x 15
  // = 45) joined after Poison: was Common 46.0 / Rare 30.5 / Epic 18.6 / Legendary 4.8 / non-title 32.8 / attacks 3.2 of
  // 8365. Now Legendary 450 of 8410; non-title 2790; the seven attacks together 3.7% (each 0.54%).
  // Re-pinned AGAIN 2026-09-28 when the eighth hero attack, Consecration (`attack_holy`, Legendary, weight 3 x 15 = 45)
  // joined after Frost: was Common 45.8 / Rare 30.3 / Epic 18.5 / Legendary 5.4 / non-title 33.2 / attacks 3.7 of 8410.
  // Now Legendary 495 of 8455; non-title 2835; the eight attacks together 4.3% (each 0.53%).
  it('the odds of a first crate with the skins and all eight Legendary hero attacks in (2026-09-28): Common 45.5%, Rare 30.2%, Epic 18.5%, Legendary 5.9%; a non-title 33.5%', () => {
    const all = eligibleCrateCosmetics([]);
    const total = crateTotalWeight(all);
    const pct = (xs: typeof all): number => Math.round((1000 * xs.reduce((s, c) => s + crateWeightOf(c), 0)) / total) / 10;
    const share = (r: string): number => pct(all.filter((c) => c.rarity === r));
    expect([share('common'), share('rare'), share('epic'), share('legendary')]).toEqual([45.5, 30.2, 18.5, 5.9]);
    expect(pct(all.filter((c) => c.category !== 'title'))).toBe(33.5);
    expect(pct(all.filter((c) => c.category === 'hero_attack'))).toBe(4.3);
    expect(total).toBe(8455);
    // the titles-only launch odds are unchanged when the skins are switched off (the kill switch path)
    const titlesOnly = all.filter((c) => c.category === 'title');
    const t = crateTotalWeight(titlesOnly);
    const tShare = (r: string): number => Math.round((1000 * titlesOnly.filter((c) => c.rarity === r).reduce((s, c) => s + crateWeightOf(c), 0)) / t) / 10;
    expect([tShare('common'), tShare('rare'), tShare('epic'), tShare('legendary')]).toEqual([68.5, 26.7, 4.3, 0.5]);
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
