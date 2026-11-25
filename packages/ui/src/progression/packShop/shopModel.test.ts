import { describe, expect, it } from 'vitest';
import type { CrateRarity, PackOffer } from '@game/progression';
import { affordableIds, buyKey, packTag, shelfOffers, srLine, startIndex } from './shopModel';

const offer = (id: string, over: Partial<PackOffer> = {}, floor: CrateRarity = 'rare', name = 'Rare Pack'): PackOffer => ({
  offerId: id, look: { kind: 'rarity', id: floor, name, guaranteedFloor: floor }, price: 200, shelf: 'packs', contains: 1, ...over,
});

describe('shopModel', () => {
  it('packTag: price and floor strings; how much is new to the player is not on the card (owner 2026-11-25)', () => {
    const t = packTag(offer('a', { newToYou: { unowned: 14, total: 40 } }), 500);
    expect(t).toEqual({ price: '200 Aether', floor: 'Guaranteed Rare or better', short: 0, soldOut: false });
  });

  it('packTag: Free at 0, Ancient has no "or better"', () => {
    expect(packTag(offer('a', { price: 0 }), 0).price).toBe('Free');
    expect(packTag(offer('a', {}, 'ancient'), 0).floor).toBe('Guaranteed Ancient');
  });

  it('packTag: short and soldOut', () => {
    expect(packTag(offer('a'), 150)).toMatchObject({ short: 50, soldOut: false });
    expect(packTag(offer('a', { soldOut: true }), 999)).toMatchObject({ short: 0, soldOut: true });
  });

  it('srLine: one line, box count before the price, short and sold out last', () => {
    expect(srLine(offer('a', { newToYou: { unowned: 14, total: 40 } }), 500)).toBe('Rare Pack, 200 Aether, Guaranteed Rare or better');
    expect(srLine(offer('b', { contains: 10, price: 1800 }, 'epic', 'Epic Box'), 5000)).toBe('Epic Box, 10 packs, 1800 Aether, Guaranteed Epic or better');
    expect(srLine(offer('a'), 150)).toBe('Rare Pack, 200 Aether, Guaranteed Rare or better, Need 50 more Aether');
    expect(srLine(offer('a', { soldOut: true }), 0)).toBe('Rare Pack, 200 Aether, Guaranteed Rare or better, Sold out');
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
