import { describe, expect, it } from 'vitest';
import type { CrateRarity, PackOffer } from '@game/progression';
import { affordableIds, buyKey, ownedCount, packGuarantee, packTag, shelfOffers, srLine, startIndex } from './shopModel';

const offer = (id: string, over: Partial<PackOffer> = {}, floor: CrateRarity = 'rare', name = 'Rare Pack'): PackOffer => ({
  offerId: id, look: { kind: 'rarity', id: floor, name, guaranteedFloor: floor }, price: 200, shelf: 'packs', contains: 1, ...over,
});

describe('shopModel', () => {
  it('packTag: price and floor strings; how much is new to the player is not on the card (owner 2026-11-25)', () => {
    const t = packTag(offer('a', { newToYou: { unowned: 14, total: 40 } }), 500);
    expect(t).toEqual({ price: '200 Aether', floor: '4 random cards + 1 Rare or better', short: 0, soldOut: false });
  });

  it('packTag: Free at 0, Ancient has no "or better"', () => {
    expect(packTag(offer('a', { price: 0 }), 0).price).toBe('Free');
    expect(packTag(offer('a', {}, 'ancient'), 0).floor).toBe('4 random cards + 1 Ancient');
  });

  it('packTag: a Category or style pack promises its guaranteed new fifth card, not a rarity floor (owner 2026-11-27)', () => {
    const cat = offer('h', { look: { kind: 'category', id: 'category-hero_skin', name: 'Hero Skin Pack', guaranteedFloor: 'rare' }, newToYou: { unowned: 5, total: 40 } });
    expect(packTag(cat, 500).floor).toBe('4 random cards + 1 guaranteed new Hero Skin');
    expect(packGuarantee(cat.look)).toEqual({ kind: 'category', category: 'hero_skin', label: 'Hero Skin' });
    const style = offer('s', { look: { kind: 'themed', id: 'themed-scribble', name: 'Scribble Pack', guaranteedFloor: 'rare' } });
    expect(packTag(style, 500).floor).toBe('4 random cards + 1 guaranteed new Scribble cosmetic');
    expect(srLine(style, 500)).toBe('Scribble Pack, 200 Aether, 4 random cards + 1 guaranteed new Scribble cosmetic');
    // owning the whole category: the fifth card can only be a duplicate, so the line stops promising "new"
    expect(packTag({ ...cat, newToYou: { unowned: 0, total: 40 } }, 500).floor).toBe('4 random cards + 1 Hero Skin (you own them all)');
    // themed looks with no ruling (Launch) and unknown categories keep their rarity floor
    expect(packTag(offer('l', { look: { kind: 'themed', id: 'themed-launch', name: 'Launch Pack', guaranteedFloor: 'epic' } }), 0).floor).toBe('4 random cards + 1 Epic or better');
    expect(packGuarantee({ kind: 'category', id: 'category-nope', name: 'Nope Pack', guaranteedFloor: 'rare' })).toEqual({ kind: 'rarity', rarity: 'rare' });
  });

  it('ownedCount: a themed pack shows owned/total; a Rarity pack, or a quote with no count, shows none', () => {
    const cat = offer('h', { look: { kind: 'category', id: 'category-hero_skin', name: 'Hero Skin Pack', guaranteedFloor: 'rare' }, newToYou: { unowned: 30, total: 40 } });
    expect(ownedCount(cat)).toEqual({ owned: 10, total: 40, text: '10/40' });
    expect(srLine(cat, 500)).toBe('Hero Skin Pack, 200 Aether, 4 random cards + 1 guaranteed new Hero Skin, 10 of 40 collected');
    expect(ownedCount({ ...cat, newToYou: { unowned: 0, total: 40 } })!.text).toBe('40/40');
    expect(ownedCount(offer('r', { newToYou: { unowned: 3, total: 40 } }))).toBeNull();
    expect(ownedCount({ ...cat, newToYou: undefined })).toBeNull();
  });

  it('packTag: short and soldOut', () => {
    expect(packTag(offer('a'), 150)).toMatchObject({ short: 50, soldOut: false });
    expect(packTag(offer('a', { soldOut: true }), 999)).toMatchObject({ short: 0, soldOut: true });
  });

  it('srLine: one line, box count before the price, short and sold out last', () => {
    expect(srLine(offer('a', { newToYou: { unowned: 14, total: 40 } }), 500)).toBe('Rare Pack, 200 Aether, 4 random cards + 1 Rare or better');
    expect(srLine(offer('b', { contains: 10, price: 1800 }, 'epic', 'Epic Box'), 5000)).toBe('Epic Box, 10 packs, 1800 Aether, 4 random cards + 1 Epic or better');
    expect(srLine(offer('a'), 150)).toBe('Rare Pack, 200 Aether, 4 random cards + 1 Rare or better, Need 50 more Aether');
    expect(srLine(offer('a', { soldOut: true }), 0)).toBe('Rare Pack, 200 Aether, 4 random cards + 1 Rare or better, Sold out');
  });

  it('shelfOffers: filters by shelf and keeps the given order (no featured-first sort)', () => {
    const list = [offer('a'), offer('f1', { badge: 'featured' }), offer('x', { shelf: 'boxes' }), offer('b', { badge: 'new' }), offer('f2', { badge: 'featured' })];
    expect(shelfOffers(list, 'packs').map((o) => o.offerId)).toEqual(['a', 'f1', 'b', 'f2']);
    expect(shelfOffers(list, 'none')).toEqual([]);
    expect(list).toHaveLength(5);
  });

  it('startIndex: the first featured offer, else the first new one, else the middle', () => {
    const ids = (xs: PackOffer[]): number => startIndex(xs);
    expect(ids([offer('a'), offer('b', { badge: 'new' }), offer('f1', { badge: 'featured' }), offer('c'), offer('f2', { badge: 'featured' })])).toBe(2);
    expect(ids([offer('a'), offer('b'), offer('c'), offer('n1', { badge: 'new' }), offer('n2', { badge: 'new' })])).toBe(3);
    expect(ids([offer('a'), offer('free', { badge: 'free' }), offer('c'), offer('d'), offer('e')])).toBe(2);
    expect(ids([offer('a'), offer('b'), offer('c'), offer('d')])).toBe(1);
    expect(ids([])).toBe(0);
  });

  it('buyKey changes when the price changes', () => {
    expect(buyKey(offer('a'))).toBe('a|200');
    expect(buyKey(offer('a', { price: 250 }))).not.toBe(buyKey(offer('a')));
  });

  it('affordableIds: balance covers it, free always, sold out never', () => {
    const list = [offer('a'), offer('free', { price: 0 }), offer('sold', { soldOut: true, price: 0 }), offer('dear', { price: 900 })];
    expect([...affordableIds(list, 200)].sort()).toEqual(['a', 'free']);
  });
});
