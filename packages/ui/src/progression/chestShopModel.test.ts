import { describe, expect, it } from 'vitest';
import {
  availableFocusCategories, COSMETICS, CRATE_TIER_FLOOR, DEFAULT_AETHER_ECONOMY, eligibleForCrate, quoteCrate,
  type CosmeticCategory, type CrateTier,
} from '@game/progression';
import { focusReceipt, leftByCategory, oddsSlices, SHOP_FOCUS_ORDER, shopFocusCategories } from './chestShopModel';

/**
 * THE CHEST SHOP'S PURE MODEL (docs/superpowers/specs/2026-10-20-chest-shop-screen-design.md): the category order, the
 * receipt rows (the focus cost, then each extra category's discount) and the odds slices. The receipt must always add up
 * to exactly what `quoteCrate` (the mirror of the server's price) charges, so these tests compare against it.
 */
const TIERS = Object.keys(CRATE_TIER_FLOOR) as CrateTier[];
const emptyOwned: string[] = [];
// One partially-owned set: every other unowned cosmetic of a few categories, so some tiers/categories thin out.
const partialOwned: string[] = COSMETICS.filter((c, i) => i % 2 === 0 && (c.category === 'hero_skin' || c.category === 'emote')).map((c) => c.id);
const inShopOrder = (cats: readonly CosmeticCategory[]) => SHOP_FOCUS_ORDER.filter((c) => cats.includes(c));

describe('shop category order', () => {
  it('is the spec order and never offers Announcers', () => {
    expect(SHOP_FOCUS_ORDER).toEqual(['hero_skin', 'minion_skin', 'card_plate', 'portrait_frame', 'hero_attack', 'emote', 'title']);
    expect(shopFocusCategories()).not.toContain('announcer');
    for (const c of shopFocusCategories()) expect(SHOP_FOCUS_ORDER).toContain(c);
  });
});

describe('focusReceipt', () => {
  it('is null when nothing is ticked', () => {
    expect(focusReceipt({ price: 400, ticked: [], available: 7 })).toBeNull();
  });

  for (const [label, owned] of [['empty', emptyOwned], ['partial', partialOwned]] as const) {
    it(`adds up to quoteCrate's fee and total for every tier and tick count (${label} owned)`, () => {
      for (const tier of TIERS) {
        const floor = CRATE_TIER_FLOOR[tier];
        const avail = inShopOrder(availableFocusCategories(owned, floor));
        const price = DEFAULT_AETHER_ECONOMY.cratePrice[tier];
        for (let k = 1; k <= avail.length; k++) {
          const ticked = avail.slice(0, k);
          const quote = quoteCrate({ tier, focus: ticked, owned });
          if (!quote) continue;
          const receipt = focusReceipt({ price, ticked, available: avail.length })!;
          const sum = receipt.rows.reduce((s, r) => s + r.amount, 0);
          expect(sum, `${tier} k=${k}`).toBe(quote.fee);
          expect(price + sum, `${tier} k=${k}`).toBe(quote.total);
          expect(receipt.rows.map((r) => r.category)).toEqual(ticked);
          expect(receipt.rows.slice(1).every((r) => r.amount <= 0)).toBe(true);
        }
      }
    });
  }

  it('prices an Epic chest focused on Heroes + Minions + Emotes (7 available) as [400, -160, -80]', () => {
    const r = focusReceipt({ price: DEFAULT_AETHER_ECONOMY.cratePrice.epic, ticked: ['hero_skin', 'minion_skin', 'emote'], available: 7 })!;
    expect(r.rows.map((x) => x.amount)).toEqual([400, -160, -80]);
    expect(r.noFocus).toBe(false);
  });

  it('is no focus, and free, when every available category is ticked', () => {
    const ticked = [...SHOP_FOCUS_ORDER];
    const r = focusReceipt({ price: 400, ticked, available: ticked.length })!;
    expect(r.noFocus).toBe(true);
    expect(r.rows.reduce((s, x) => s + x.amount, 0)).toBe(0);
  });

  it('is no focus when the one available category is ticked', () => {
    const r = focusReceipt({ price: 400, ticked: ['title'], available: 1 })!;
    expect(r.noFocus).toBe(true);
    expect(r.rows.map((x) => x.amount)).toEqual([0]);
  });
});

describe('oddsSlices', () => {
  it("shows today's pinned Epic-floor odds, lowest rarity first", () => {
    const slices = oddsSlices([], 'epic', null);
    expect(slices.map((s) => s.percent)).toEqual([64.7, 26.5, 8.8]);
    expect(slices.map((s) => s.rarity)).toEqual(['epic', 'legendary', 'ancient']);
  });

  it("each slice's count is the sum of its per-category counts, all positive", () => {
    for (const owned of [emptyOwned, partialOwned]) for (const floor of ['common', 'epic', 'ancient'] as const) {
      for (const s of oddsSlices(owned, floor, null)) {
        expect(s.count).toBe(s.byCategory.reduce((n, c) => n + c.count, 0));
        expect(s.byCategory.every((c) => c.count > 0)).toBe(true);
      }
    }
  });

  it('lists only the focused category when focused', () => {
    const slices = oddsSlices([], 'common', ['hero_skin']);
    expect(slices.length).toBeGreaterThan(0);
    for (const s of slices) expect(s.byCategory.map((c) => c.category)).toEqual(['hero_skin']);
  });

  it('orders categories by the shop order, with any others (Announcers) last', () => {
    for (const s of oddsSlices([], 'common', null)) {
      const idx = s.byCategory.map((c) => SHOP_FOCUS_ORDER.indexOf(c.category));
      const named = idx.filter((i) => i >= 0);
      expect(named).toEqual([...named].sort((a, b) => a - b));
      expect(idx.indexOf(-1) === -1 || idx.slice(idx.indexOf(-1)).every((i) => i === -1)).toBe(true);
    }
  });
});

describe('leftByCategory', () => {
  it('sums to the unfocused pool', () => {
    for (const owned of [emptyOwned, partialOwned]) for (const floor of ['common', 'epic', 'ancient'] as const) {
      let sum = 0;
      for (const n of leftByCategory(owned, floor).values()) sum += n;
      expect(sum).toBe(eligibleForCrate(owned, floor, null).length);
    }
  });
});
