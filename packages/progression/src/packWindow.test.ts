import { describe, expect, it } from 'vitest';
import { COSMETIC_RARITIES, type CosmeticDef } from './cosmetics';
import { rarityPackOdds } from './packEconomy';
import { STYLE_PACK_IDS, STYLE_PACK_NAMES, dealPrice, shelfOffers, windowOffers } from './packShop';

const W = '2026-11-27T12';
function item(id: string, category: CosmeticDef['category'], rarity: CosmeticDef['rarity'], extra: Partial<CosmeticDef> = {}): CosmeticDef {
  return { id, category, name: id, rarity, acquisition: { type: 'crate' }, assets: {}, active: true, ...extra };
}
/** Every rarity in emote and title; the emote items also belong to the plushie and scifi style packs. */
const catalog: CosmeticDef[] = (['emote', 'title'] as const).flatMap((cat) => COSMETIC_RARITIES.map((r) =>
  item(`${cat}-${r}`, cat, r, cat === 'emote' ? { packStyles: ['themed-plushie', 'themed-scifi'] } : {})));
const fill = (u: number) => Array.from({ length: 12 }, () => u);
const seeded = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

describe('shelfOffers', () => {
  const shelf = shelfOffers(W, catalog);
  it('lists rarity packs, then categories (COSMETIC_CATEGORIES order), then styles (STYLE_PACK_IDS order)', () => {
    expect(shelf.map((o) => o.look.id)).toEqual([
      'rarity-common', 'rarity-rare', 'rarity-epic', 'rarity-legendary', 'rarity-ancient',
      'category-title', 'category-emote', 'themed-plushie', 'themed-scifi',
    ]);
  });
  it('prices, ids, shelves, names and odds', () => {
    expect(shelf.map((o) => o.offerId)).toEqual(shelf.map((o) => `${W}:${o.look.id}`));
    expect(shelf.filter((o) => o.look.kind === 'rarity').map((o) => o.price)).toEqual([100, 175, 300, 500, 850]);
    expect(shelf.filter((o) => o.look.kind !== 'rarity').every((o) => o.price === 200 && o.shelf === 'category')).toBe(true);
    expect(shelf.filter((o) => o.look.kind === 'rarity').every((o) => o.shelf === 'rarity')).toBe(true);
    expect(shelf.find((o) => o.look.id === 'category-emote')!.look.name).toBe('Emote Pack');
    expect(shelf.find((o) => o.look.id === 'rarity-ancient')!.look.name).toBe('Ancient Pack');
    expect(shelf.find((o) => o.look.id === 'themed-scifi')!.look.name).toBe('Sci-Fi Pack');
    expect(shelf.find((o) => o.look.id === 'rarity-epic')!.odds).toEqual(rarityPackOdds('epic'));
    expect(shelf.filter((o) => o.look.kind !== 'rarity').some((o) => o.odds)).toBe(false);
  });
  it('skips packs with an empty pool, and offers no style pack from the real catalog today', () => {
    expect(shelfOffers(W, []).length).toBe(0);
    expect(shelfOffers(W, catalog.filter((c) => c.category !== 'title')).some((o) => o.look.id === 'category-title')).toBe(false);
    expect(shelfOffers(W).some((o) => o.look.kind === 'themed')).toBe(false);
  });
  it('names every style pack', () => {
    for (const id of STYLE_PACK_IDS) expect(STYLE_PACK_NAMES[id], id).toBeTruthy();
  });
});

describe('windowOffers', () => {
  it('opens with the free Rare, then four distinct deals that are never the Rare, then the shelves', () => {
    const o = windowOffers(W, fill(0), catalog);
    expect(o[0]).toMatchObject({ offerId: `${W}:free`, price: 0, badge: 'free', shelf: 'featured' });
    expect(o[0]!.look.id).toBe('rarity-rare');
    const deals = o.slice(1, 5);
    expect(deals.map((d) => d.offerId)).toEqual([0, 1, 2, 3].map((k) => `${W}:deal:${k}`));
    expect(new Set(deals.map((d) => d.look.id)).size).toBe(4);
    expect(deals.some((d) => d.look.id === 'rarity-rare')).toBe(false);
    expect(o.slice(5)).toEqual(shelfOffers(W, catalog));
  });
  it('draws at 0.999 give 60% off and top stock; draws of 0 give 20% off and 2 stock', () => {
    for (const d of windowOffers(W, fill(0.999), catalog).slice(1, 5)) { expect(d.price).toBe(dealPrice(d.fullPrice!, 60)); expect(d.stock).toBe(5); }
    for (const d of windowOffers(W, fill(0), catalog).slice(1, 5)) { expect(d.price).toBe(dealPrice(d.fullPrice!, 20)); expect(d.stock).toBe(2); }
  });
  it('picks by floor(u * left) from the shelf minus the Rare, without repeats', () => {
    // pool (8): common epic legendary ancient title emote plushie scifi; 0.5 * 8 = 4 -> category-title
    // then (7): common epic legendary ancient emote plushie scifi; 0 -> common; then (6) epic...; 0.999 * 6 -> last
    const d = windowOffers(W, [0.5, 0, 0, 0, 0, 0, 0.999, 0, 0, 0, 0, 0], catalog).slice(1, 5).map((x) => x.look.id);
    expect(d).toEqual(['category-title', 'rarity-common', 'themed-scifi', 'rarity-epic']);
  });
  it('prices: 175 at 35% off is 115, a tie rounds up, nothing is below 5, fullPrice is the shelf price', () => {
    expect(dealPrice(175, 35)).toBe(115);
    expect(dealPrice(850, 25)).toBe(640); // 127.5 steps of 5: the tie goes up
    expect(dealPrice(200, 60)).toBe(80);
    expect(dealPrice(1, 60)).toBe(5);
    const shelf = shelfOffers(W, catalog);
    const rnd = seeded(7);
    for (let n = 0; n < 200; n++) {
      for (const d of windowOffers(W, Array.from({ length: 12 }, rnd), catalog).slice(1, 5)) {
        expect(d.price).toBeGreaterThanOrEqual(5);
        expect(d.price % 5).toBe(0);
        expect(d.price).toBeLessThan(d.fullPrice!);
        expect(d.fullPrice).toBe(shelf.find((s) => s.look.id === d.look.id)!.price);
        expect(d.stock).toBeGreaterThanOrEqual(2);
        expect(d.stock).toBeLessThanOrEqual(5);
        expect(d.contains).toBe(1);
      }
    }
  });
  it('attaches odds to Rarity offers only', () => {
    for (const o of windowOffers(W, fill(0.3), catalog)) expect(!!o.odds).toBe(o.look.kind === 'rarity');
  });
  it('is deterministic', () => {
    expect(windowOffers(W, fill(0.3), catalog)).toEqual(windowOffers(W, fill(0.3), catalog));
  });
  it('refuses malformed draws', () => {
    const bad = [fill(1), fill(-0.1), fill(NaN), fill(Infinity), Array(11).fill(0), Array(13).fill(0), [...Array(11).fill(0), '0.5' as unknown as number]];
    for (const b of bad) expect(() => windowOffers(W, b, catalog)).toThrow();
  });
  it('gives an empty window for an empty catalog', () => {
    expect(windowOffers(W, fill(0), [])).toEqual([]);
  });
});
