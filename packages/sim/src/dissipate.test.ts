import { describe, it, expect } from 'vitest';
import { CARD_INDEX, SETS } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { spellFizzles } from './spellFizzle';

/**
 * DISSIPATE (owner add 2026-09-18) — Tier 5, 4 Gold, aimed at a friendly board minion:
 * "Sell a minion and give its stats to the right-most minion in the Shop."
 *
 * Pinned here:
 *  - the target is SOLD through the FULL sale path (`settleMinionSale`, the same rituals the manual sell walks):
 *    the Gold, the body's own `onSell` effect, the `soldThisTurn` record + `minionSold` notification, and the sell runes;
 *  - its CURRENT stats (buffs included) land on the RIGHT-MOST MINION offer — spell offers are skipped;
 *  - with no minion in the Shop the cast is REFUSED outright (card kept, no Gold, board untouched);
 *  - Yazzus never multiplies it (`singleCast`) — the target is gone after the first sale, so a second cast would be a
 *    no-op at best; the card resolves exactly once (the Fodder Treatment ruling);
 *  - it lives in BOTH set 2 (its own spell) and set 3 (shared by id).
 */

const body = (uid: string, cardId: string, attack: number, health: number, over: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack, health, keywords: [], golden: false, ...over });
const inHand = (uid = 'dis'): BoardCard => body(uid, 'sp_dissipate', 0, 1);

describe('Dissipate', () => {
  it('is a T5, 4-Gold aimed spell that exists in set 2 and set 3', () => {
    const def = CARD_INDEX['sp_dissipate']!;
    expect(def.spell).toBe(true);
    expect(def.tier).toBe(5);
    expect(def.cost).toBe(4);
    expect(def.target).toBe('friendly');
    expect(def.singleCast).toBe(true);
    expect(def.text).toBe('Sell a minion and give its stats to the right-most minion in the Shop.');
    expect(SETS.set2.own.some((c) => c.id === 'sp_dissipate')).toBe(true);
    expect(SETS.set3.own.some((c) => c.id === 'sp_dissipate')).toBe(true);
  });

  it('sells the target (+Gold) and gives its CURRENT stats to the right-most MINION offer, skipping a spell offer', () => {
    let s: RunState = {
      ...createRun(1), embers: 4,
      // Buffed 4/5 body: the LIVE stats travel, not the printed ones.
      board: [body('keep', 'sandbag', 1, 1), body('fodder', 'sandbag', 4, 5, { buffs: [{ source: 'Apples', attack: 3, health: 4, count: 1 }] })],
      hand: [inHand()],
      shop: [{ uid: 'o1', cardId: 'alley' }, { uid: 'o2', cardId: 'alley' }, { uid: 'sp', cardId: 'growth' }], // spell last
    };
    s = reduce(s, { type: 'play', uid: 'dis', targetUid: 'fodder' });
    expect(s.hand.some((c) => c.cardId === 'sp_dissipate')).toBe(false); // consumed
    expect(s.board.map((c) => c.uid)).toEqual(['keep']); // sold
    expect(s.embers).toBe(5); // 4 + the 1-Gold sale (a hand spell is already paid for; `cost` is its Shop price)
    const o2 = s.shop.find((o) => o.uid === 'o2')!;
    expect([o2.atk, o2.hp]).toEqual([4, 5]); // the right-most MINION, not the spell
    expect(o2.buffs?.some((b) => b.source === 'Dissipate')).toBe(true);
    expect(s.shop.find((o) => o.uid === 'o1')!.atk).toBeUndefined();
    expect(s.shop.find((o) => o.uid === 'sp')!.atk).toBeUndefined();
    expect(s.soldThisTurn).toEqual(['sandbag']); // recorded as a sale
  });

  it('walks the FULL sale path: the on-sell effect, Robin-style counters and the sell runes all fire', () => {
    let s: RunState = {
      ...createRun(1), embers: 4,
      board: [body('w', 'hoardwhelp', 3, 2), body('other', 'sandbag', 1, 1)], // Hoard Whelp: Sell → 6 Gold
      hand: [inHand()],
      shop: [{ uid: 'o1', cardId: 'alley' }],
      runeSellersMarket: true, runeStacks: { rune_sellers_market: 1 },
    };
    s = reduce(s, { type: 'play', uid: 'dis', targetUid: 'w' });
    expect(s.board.map((c) => c.uid)).toEqual(['other']);
    // 4 + 1 (sell value) + 6 (Hoard Whelp's Sell) = 11
    expect(s.embers).toBe(11);
    // Rune of the Seller's Market pumped the REMAINING board (+4/+3) — a manual-sale rune, fired by the spell too.
    const other = s.board[0]!;
    expect([other.attack, other.health]).toEqual([5, 4]);
    expect(s.shop[0]!.atk).toBe(3);
    expect(s.shop[0]!.hp).toBe(2);
  });

  it('is REFUSED outright when the Shop holds no minion: card kept, no Gold spent, nothing sold', () => {
    const start: RunState = {
      ...createRun(1), embers: 4,
      board: [body('fodder', 'sandbag', 4, 5)],
      hand: [inHand()],
      shop: [{ uid: 'sp', cardId: 'growth' }], // a spell is not a recipient
    };
    expect(spellFizzles(start, CARD_INDEX['sp_dissipate']!, start.board[0])).toBe(true);
    const s = reduce(start, { type: 'play', uid: 'dis', targetUid: 'fodder' });
    expect(s).toBe(start); // untouched state — the "refused outright" convention
    expect(s.hand.some((c) => c.cardId === 'sp_dissipate')).toBe(true);
    expect(s.board).toHaveLength(1);
    expect(s.embers).toBe(4); // nothing sold, nothing gained
  });

  it('Yazzus never multiplies it: the target is sold ONCE and the stats land ONCE', () => {
    let s: RunState = {
      ...createRun(1), embers: 4,
      board: [body('fodder', 'sandbag', 4, 5), body('y', 'yazzus', 6, 8)],
      hand: [inHand()],
      shop: [{ uid: 'o1', cardId: 'alley' }],
    };
    s = reduce(s, { type: 'play', uid: 'dis', targetUid: 'fodder' });
    expect(s.board.map((c) => c.uid)).toEqual(['y']);
    expect([s.shop[0]!.atk, s.shop[0]!.hp]).toEqual([4, 5]); // once, not twice
    expect(s.embers).toBe(5); // one sale's Gold (4 + 1), not two
    expect(s.soldThisTurn).toEqual(['sandbag']);
  });
});
