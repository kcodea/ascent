import { afterEach, describe, expect, it } from 'vitest';
import {
  COSMETICS, COSMETIC_CATEGORIES, COSMETIC_CATEGORY_DEFS, COSMETIC_RARITIES, CRATE_RARITY_ODDS, crateChances, eligibleCrateCosmetics, pickCrateReward, setServerCatalogState,
  type CosmeticDef,
} from './cosmetics';
import { CRATE_TIERS, DEFAULT_AETHER_ECONOMY } from './aether';
import {
  CRATE_TIER_FLOOR, CRATE_TIER_LABELS, NON_FOCUSABLE_CATEGORIES, atOrAbove, availableFocusCategories, eligibleForCrate, focusFeePercent, isFocusableCategory, normalizeFocus,
  pickTieredCrateReward, quoteCrate, tierOddsPercent, tieredCrateChances,
} from './crateShop';

/**
 * TIERED CRATES + FOCUS PRICING (owner 2026-10-18). A tier sets the rarity FLOOR of a crate; the odds inside are the
 * published CRATE_RARITY_ODDS restricted to the floor and renormalized; an optional category focus narrows the pool
 * and costs a percent of the crate's price. A floor of Common with no focus must be the version-4 draw FOR DRAW.
 */

const crateItems = COSMETICS.filter((c) => c.acquisition.type === 'crate' && c.active && COSMETIC_CATEGORY_DEFS[c.category].enabled);
const allIds = crateItems.map((c) => c.id);
const rank = (c: CosmeticDef): number => COSMETIC_RARITIES.indexOf(c.rarity);

describe('tiers', () => {
  it('each tier maps to the rarity of the same name (standard = common) with a player label', () => {
    expect(CRATE_TIER_FLOOR).toEqual({ standard: 'common', rare: 'rare', epic: 'epic', legendary: 'legendary', ancient: 'ancient' });
    expect(CRATE_TIER_LABELS).toEqual({ standard: 'Standard', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', ancient: 'Ancient' });
    expect(Object.keys(CRATE_TIER_FLOOR)).toEqual([...CRATE_TIERS]);
  });

  it('atOrAbove compares rarity order', () => {
    expect(atOrAbove('epic', 'rare')).toBe(true);
    expect(atOrAbove('rare', 'rare')).toBe(true);
    expect(atOrAbove('common', 'rare')).toBe(false);
  });
});

describe('the tiered roll', () => {
  it('standard + no focus equals the version-4 pick draw for draw', () => {
    const owned = crateItems.slice(0, 40).map((c) => c.id);
    const eligible = eligibleForCrate(owned, 'common', null);
    expect(eligible.map((c) => c.id)).toEqual(eligibleCrateCosmetics(owned).map((c) => c.id));
    for (let i = 0; i < 2000; i++) {
      const u = i / 2000;
      expect(pickTieredCrateReward(eligible, 'common', u)?.id, `u=${u}`).toBe(pickCrateReward(eligibleCrateCosmetics(owned), u)?.id);
    }
    expect(pickTieredCrateReward(eligible, 'common', 1)?.id).toBe(pickCrateReward(eligibleCrateCosmetics(owned), 1)?.id);
    const a = tieredCrateChances(eligible, 'common');
    const b = crateChances(eligibleCrateCosmetics(owned));
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [id, p] of b) expect(a.get(id)).toBeCloseTo(p, 12);
  });

  it('tier odds renormalize over the rarities at or above the floor', () => {
    expect(tierOddsPercent('common')).toEqual({ common: 35, rare: 31, epic: 22, legendary: 9, ancient: 3 });
    expect(tierOddsPercent('rare')).toEqual({ common: 0, rare: 47.7, epic: 33.8, legendary: 13.8, ancient: 4.6 });
    expect(tierOddsPercent('epic')).toEqual({ common: 0, rare: 0, epic: 64.7, legendary: 26.5, ancient: 8.8 });
    expect(tierOddsPercent('legendary')).toEqual({ common: 0, rare: 0, epic: 0, legendary: 75, ancient: 25 });
    expect(tierOddsPercent('ancient')).toEqual({ common: 0, rare: 0, epic: 0, legendary: 0, ancient: 100 });
  });

  it('never falls below the floor', () => {
    const owned = crateItems.filter((c) => rank(c) >= COSMETIC_RARITIES.indexOf('legendary')).map((c) => c.id);
    const eligible = eligibleForCrate(owned, 'legendary', null);
    expect(eligible).toEqual([]);
    for (const u of [0, 0.1, 0.5, 0.99, 1]) expect(pickTieredCrateReward(eligible, 'legendary', u)).toBeNull();
    // Even with lower rarities still unowned, a floor-legendary pick over a floor-respecting pool stays at or above it.
    for (let i = 0; i < 500; i++) {
      const got = pickTieredCrateReward(eligibleForCrate([], 'epic', null), 'epic', i / 500);
      expect(rank(got!)).toBeGreaterThanOrEqual(COSMETIC_RARITIES.indexOf('epic'));
    }
  });

  it('an empty rolled rarity falls to the nearest rarity at or above the floor, never below it', () => {
    // Only Epic and Ancient left at an Epic floor: a Legendary roll falls to Epic (nearer, more common on a tie) and never to Rare.
    const owned = crateItems.filter((c) => c.rarity === 'legendary').map((c) => c.id);
    const eligible = eligibleForCrate(owned, 'epic', null);
    const got = pickTieredCrateReward(eligible, 'epic', 0.75);
    expect(got?.rarity).toBe('epic');
    const chances = tieredCrateChances(eligible, 'epic');
    expect([...chances.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    for (const id of chances.keys()) expect(rank(COSMETICS.find((c) => c.id === id)!)).toBeGreaterThanOrEqual(COSMETIC_RARITIES.indexOf('epic'));
  });

  it('u = 1 lands on the last rarity and u is clamped', () => {
    const eligible = eligibleForCrate([], 'epic', null);
    expect(pickTieredCrateReward(eligible, 'epic', 1)?.rarity).toBe('ancient');
    expect(pickTieredCrateReward(eligible, 'epic', 5)?.rarity).toBe('ancient');
    expect(pickTieredCrateReward(eligible, 'epic', -3)?.rarity).toBe('epic');
  });

  it('chances sum to 1 and use the renormalized odds', () => {
    const eligible = eligibleForCrate([], 'rare', null);
    const chances = tieredCrateChances(eligible, 'rare');
    expect([...chances.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const ancient = eligible.filter((c) => c.rarity === 'ancient');
    expect(chances.get(ancient[0]!.id)).toBeCloseTo((CRATE_RARITY_ODDS.ancient / 65) / ancient.length, 12);
  });
});

describe('focus', () => {
  it('focus restricts categories', () => {
    const got = eligibleForCrate([], 'epic', ['card_plate']);
    expect(got.length).toBeGreaterThan(0);
    for (const c of got) {
      expect(c.category).toBe('card_plate');
      expect(['epic', 'legendary', 'ancient']).toContain(c.rarity);
    }
    expect(got.map((c) => c.id)).toEqual([...got.map((c) => c.id)].sort());
  });

  it('available categories are the enabled ones with an eligible item at the floor', () => {
    const expected = COSMETIC_CATEGORIES.filter((cat) => COSMETIC_CATEGORY_DEFS[cat].enabled
      && COSMETICS.some((c) => c.category === cat && c.active && c.acquisition.type === 'crate' && c.rarity === 'ancient'));
    const got = availableFocusCategories([], 'ancient');
    expect(got).toEqual(expected);
    for (const none of ['title', 'emote', 'announcer'] as const) expect(got).not.toContain(none);
    // Owning a category's last item at the floor removes it.
    const owned = crateItems.filter((c) => c.category === 'card_plate').map((c) => c.id);
    expect(availableFocusCategories(owned, 'common')).not.toContain('card_plate');
  });

  it('normalizeFocus sorts, de-duplicates and collapses', () => {
    const all = availableFocusCategories([], 'common');
    expect(normalizeFocus(['emote', 'emote'], all)).toEqual(['emote']);
    expect(normalizeFocus(['hero_skin', 'emote'], all)).toEqual(['emote', 'hero_skin']);
    expect(normalizeFocus(null, all)).toBeNull();
    expect(normalizeFocus([], all)).toBeNull();
    expect(normalizeFocus([...all], all)).toBeNull();
    expect(normalizeFocus(['title'], availableFocusCategories([], 'ancient'))).toBe('bad');
    expect(normalizeFocus(['nonsense'], all)).toBe('bad');
  });

  it('focus fee: percent ladder by categories ticked among those available', () => {
    expect(focusFeePercent(1, 8)).toBe(100);
    expect(focusFeePercent(2, 8)).toBe(60);
    expect(focusFeePercent(3, 8)).toBe(40);
    expect(focusFeePercent(7, 8)).toBe(5);
    expect(focusFeePercent(8, 8)).toBe(0);
    expect(focusFeePercent(0, 8)).toBe(0);
    expect(focusFeePercent(5, 5)).toBe(0);
    expect(focusFeePercent(4, 5)).toBe(25);
    expect(focusFeePercent(8, 10)).toBe(5);
    expect(focusFeePercent(9, 10)).toBe(5);
    expect(focusFeePercent(2, 8, { ...DEFAULT_AETHER_ECONOMY, focusFeePercent: [90, 50, 30, 20, 10, 5, 1] })).toBe(50);
  });
});

describe('quotes', () => {
  it('a focused Epic crate costs the crate plus a 100% single-category fee', () => {
    expect(quoteCrate({ tier: 'epic', focus: ['card_plate'], owned: [] })).toMatchObject({
      tier: 'epic', floor: 'epic', focus: ['card_plate'], crate: 400, fee: 400, total: 800,
    });
  });

  it('a milestone crate is free; only the Legendary-priced fee is charged', () => {
    const q = quoteCrate({ tier: 'legendary', focus: ['card_plate'], owned: [], milestone: true });
    expect(q).toMatchObject({ tier: 'legendary', floor: 'legendary', crate: 0, fee: 600, total: 600 });
    // The tier passed is ignored in milestone mode.
    expect(quoteCrate({ tier: 'standard', focus: ['card_plate'], owned: [], milestone: true })).toMatchObject({ floor: 'legendary', crate: 0, fee: 600, total: 600 });
    expect(quoteCrate({ tier: 'legendary', focus: null, owned: [], milestone: true })).toMatchObject({ crate: 0, fee: 0, total: 0 });
  });

  it('an unfocused Standard crate is just the price and counts what is left', () => {
    const q = quoteCrate({ tier: 'standard', focus: null, owned: [] })!;
    expect(q).toMatchObject({ tier: 'standard', floor: 'common', focus: null, crate: 100, fee: 0, total: 100 });
    expect(q.remaining).toBe(eligibleCrateCosmetics([]).length);
    const f = quoteCrate({ tier: 'rare', focus: ['card_plate'], owned: [] })!;
    expect(f.remaining).toBe(eligibleForCrate([], 'rare', ['card_plate']).length);
  });

  it('ticking every available category is no focus and costs nothing', () => {
    const all = availableFocusCategories([], 'epic');
    expect(quoteCrate({ tier: 'epic', focus: [...all].reverse(), owned: [] })).toMatchObject({ focus: null, fee: 0, total: 400 });
  });

  it('a focus that names an unavailable category is refused', () => {
    expect(quoteCrate({ tier: 'ancient', focus: ['title'], owned: [] })).toBeNull();
  });

  it('sold out is null', () => {
    expect(quoteCrate({ tier: 'standard', focus: null, owned: allIds })).toBeNull();
    const owned = crateItems.filter((c) => rank(c) >= COSMETIC_RARITIES.indexOf('legendary')).map((c) => c.id);
    expect(quoteCrate({ tier: 'legendary', focus: null, owned })).toBeNull();
    expect(quoteCrate({ tier: 'rare', focus: null, owned })).not.toBeNull();
  });

  it('prices come from the economy passed in', () => {
    const eco = { ...DEFAULT_AETHER_ECONOMY, cratePrice: { ...DEFAULT_AETHER_ECONOMY.cratePrice, epic: 500 } };
    expect(quoteCrate({ tier: 'epic', focus: ['card_plate'], owned: [], economy: eco })).toMatchObject({ crate: 500, fee: 500, total: 1000 });
  });
});

describe('Announcers are never a focus (owner 2026-10-20, R-PROG-AETHER-06)', () => {
  const testDef = (id: string, category: CosmeticDef['category'], rarity: CosmeticDef['rarity']): CosmeticDef =>
    ({ id, category, name: id, rarity, acquisition: { type: 'crate' }, assets: {}, active: true });

  it('announcer is non-focusable and every other category is focusable', () => {
    expect(NON_FOCUSABLE_CATEGORIES).toEqual(['announcer']);
    expect(isFocusableCategory('announcer')).toBe(false);
    expect(isFocusableCategory('hero_skin')).toBe(true);
  });

  it('the focus chips never offer announcer, at any floor', () => {
    expect(availableFocusCategories(new Set(), 'common')).not.toContain('announcer');
    for (const tier of CRATE_TIERS) expect(availableFocusCategories([], CRATE_TIER_FLOOR[tier])).not.toContain('announcer');
    // …though the unfocused pool still holds them.
    expect(eligibleForCrate([], 'legendary', null).some((c) => c.category === 'announcer')).toBe(true);
  });

  it('a focus on announcer is a bad focus', () => {
    expect(quoteCrate({ tier: 'standard', focus: ['announcer'], owned: [] })).toBeNull();
    expect(quoteCrate({ tier: 'legendary', focus: ['announcer', 'hero_skin'], owned: [] })).toBeNull();
  });

  it('ticking every focusable category is unfocused: free, and the pool keeps the Announcers', () => {
    const owned: string[] = [];
    const all = availableFocusCategories(owned, 'legendary');
    const q = quoteCrate({ tier: 'legendary', focus: all, owned })!;
    expect(q.focus).toBeNull();
    expect(q.fee).toBe(0);
    expect(q.remaining).toBe(eligibleForCrate(owned, 'legendary', null).length);
    expect(q.remaining).toBeGreaterThan(eligibleForCrate(owned, 'legendary', all).length);
  });

  it('when the only focusable category left is the one ticked, the chest is unfocused and free', () => {
    const catalog = [testDef('t_skin', 'hero_skin', 'legendary'), testDef('t_ann', 'announcer', 'legendary')];
    expect(availableFocusCategories([], 'legendary', catalog)).toEqual(['hero_skin']);
    const q = quoteCrate({ tier: 'legendary', focus: ['hero_skin'], owned: [], catalog })!;
    expect(q.focus).toBeNull();
    expect(q.fee).toBe(0);
    expect(q.remaining).toBe(2);
  });
});

describe('the server catalog switch (admin_off)', () => {
  afterEach(() => setServerCatalogState(null));

  it('a server-retired item and a server-disabled category leave the pool, the chips and the quote', () => {
    const plates = eligibleForCrate([], 'epic', ['card_plate']);
    const retired = plates[0]!;
    const all = availableFocusCategories([], 'epic');
    const others = all.filter((c) => c !== 'card_plate' && c !== retired.category);
    const disabled = others[0]!;
    const rest = all.filter((c) => c !== disabled);
    expect(rest.length).toBeGreaterThan(1);
    const before = quoteCrate({ tier: 'epic', focus: ['card_plate'], owned: [] })!;

    setServerCatalogState({ retiredIds: [retired.id], disabledCategories: [disabled] });
    // The retired item never drops; the count drops with it.
    expect(eligibleForCrate([], 'epic', null).map((c) => c.id)).not.toContain(retired.id);
    expect(quoteCrate({ tier: 'epic', focus: ['card_plate'], owned: [] })!.remaining).toBe(before.remaining - 1);
    // The disabled category offers no chip, contributes nothing, and naming it is refused like the server's bad_focus.
    expect(availableFocusCategories([], 'epic')).toEqual(rest);
    expect(eligibleForCrate([], 'epic', null).some((c) => c.category === disabled)).toBe(false);
    expect(quoteCrate({ tier: 'epic', focus: [disabled], owned: [] })).toBeNull();
    // Ticking every OTHER category is every available one: no focus, no fee (what the server prices).
    expect(quoteCrate({ tier: 'epic', focus: rest, owned: [] })).toMatchObject({ focus: null, fee: 0, total: 400 });

    setServerCatalogState(null);
    expect(availableFocusCategories([], 'epic')).toEqual(all);
    expect(quoteCrate({ tier: 'epic', focus: ['card_plate'], owned: [] })!.remaining).toBe(before.remaining);
  });
});
