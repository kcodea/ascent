import { describe, expect, it } from 'vitest';
import { buildShopViews, viewSignature, type ShopViewCacheEntry } from './shopViewCache';

/**
 * The per-offer view memo (perf 2026-09-17): the same offer with the same opts must hand back the SAME view
 * object without rebuilding it; a changed offer (or changed opts) rebuilds exactly that one; and a rebuilt
 * view that is value-equal to its predecessor keeps its identity through `stabilize`.
 */
interface Offer { uid: string; cardId: string; atk?: number }
interface View { id: string; n: number }

describe('buildShopViews', () => {
  it('same offer + same opts → the same view object, and no build', () => {
    let builds = 0;
    const build = (o: Offer, opts: { bonus: number }): View => { builds++; return { id: o.cardId, n: (o.atk ?? 0) + opts.bonus }; };
    const offers: Offer[] = [{ uid: 'a', cardId: 'x', atk: 1 }, { uid: 'b', cardId: 'y' }];
    const first = buildShopViews(offers, () => ({ bonus: 2 }), build, new Map());
    expect(builds).toBe(2);
    expect(first.misses).toBe(2);
    // The reducer clones the run: new offer OBJECTS, identical contents.
    const cloned = offers.map((o) => ({ ...o }));
    const second = buildShopViews(cloned, () => ({ bonus: 2 }), build, first.cache);
    expect(builds).toBe(2);
    expect(second.hits).toBe(2);
    expect(second.views.get('a')).toBe(first.views.get('a'));
    expect(second.views.get('b')).toBe(first.views.get('b'));
  });

  it('a changed offer rebuilds only itself; a changed opts value rebuilds all', () => {
    let builds = 0;
    const build = (o: Offer, opts: { bonus: number }): View => { builds++; return { id: o.cardId, n: (o.atk ?? 0) + opts.bonus }; };
    const offers: Offer[] = [{ uid: 'a', cardId: 'x', atk: 1 }, { uid: 'b', cardId: 'y' }];
    const first = buildShopViews(offers, () => ({ bonus: 2 }), build, new Map());
    const buffed: Offer[] = [{ uid: 'a', cardId: 'x', atk: 3 }, { uid: 'b', cardId: 'y' }];
    const second = buildShopViews(buffed, () => ({ bonus: 2 }), build, first.cache);
    expect(builds).toBe(3);
    expect(second.views.get('a')).not.toBe(first.views.get('a'));
    expect(second.views.get('b')).toBe(first.views.get('b'));
    const third = buildShopViews(buffed, () => ({ bonus: 5 }), build, second.cache);
    expect(builds).toBe(5);
    expect(third.misses).toBe(2);
  });

  it('a rebuilt view that is value-equal keeps its identity through stabilize; a departed uid leaves the cache', () => {
    const build = (o: Offer): View => ({ id: o.cardId, n: 0 });
    const eq = (fresh: View, prev: View): View => (fresh.id === prev.id && fresh.n === prev.n ? prev : fresh);
    const first = buildShopViews([{ uid: 'a', cardId: 'x' }], (o) => ({ tag: o.uid }), build, new Map(), eq);
    // opts differ (a new signature) but the built view is equal → the previous object survives
    const second = buildShopViews([{ uid: 'a', cardId: 'x' }], () => ({ tag: 'other' }), build, first.cache, eq);
    expect(second.misses).toBe(1);
    expect(second.views.get('a')).toBe(first.views.get('a'));
    const third = buildShopViews([{ uid: 'c', cardId: 'z' }], () => ({}), build, second.cache, eq);
    expect([...third.cache.keys()]).toEqual(['c']);
  });

  it('viewSignature drops undefined fields (they build the same view) and separates offer from opts', () => {
    expect(viewSignature({ a: 1, b: undefined }, { c: 2 })).toBe(viewSignature({ a: 1 }, { c: 2 }));
    expect(viewSignature({ a: 1 }, { c: 2 })).not.toBe(viewSignature({ a: 1, c: 2 }, {}));
    const cache: Map<string, ShopViewCacheEntry<View>> = new Map();
    expect(cache.size).toBe(0);
  });
});
