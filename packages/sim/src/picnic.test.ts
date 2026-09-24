import { describe, it, expect } from 'vitest';
import { CARD_INDEX, SETS } from '@game/content';
import { createRun, reduce, spellDisplayText, isStatSpell, type BoardCard, type RunState } from './index';
import { isStatGrantingSpell } from './recruit';
import { spellFizzles } from './spellFizzle';

/**
 * PICNIC (owner add 2026-09-23, Balance 9/23) — Tier 5, 1 Gold, untargeted:
 * "Give the right-most Shop minion +8/+8 permanently."
 *
 * Pinned here:
 *  - the +8/+8 lands on the RIGHT-MOST MINION offer now (a spell offer is skipped) — and PERMANENTLY, Market
 *    Tormentor's way: `rightmostSlotBuff` grows by +8/+8, so the next roll's right-most minion wears it too and it
 *    stacks across casts;
 *  - spell power folds on both stats (the shop-buff family's rule) and the printed number goes live with it;
 *  - with no minion in the Shop the cast is REFUSED outright (card kept, no Gold);
 *  - it is a stat spell for Rune of Thrift (discounted) but NOT a board stat spell (the Gilded Ledger never casts it);
 *  - it lives in BOTH set 2 (its own spell) and set 3 (shared by id).
 */

const body = (uid: string, cardId: string, attack: number, health: number, over: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack, health, keywords: [], golden: false, ...over });
const inHand = (uid = 'pic'): BoardCard => body(uid, 'sp_picnic', 0, 1);

describe('Picnic', () => {
  it('is a T5, 1-Gold untargeted spell that exists in set 2 and set 3', () => {
    const def = CARD_INDEX['sp_picnic']!;
    expect(def.spell).toBe(true);
    expect(def.tier).toBe(5);
    expect(def.cost).toBe(1);
    expect(def.target).toBeUndefined();
    expect(def.text).toBe('Give the right-most Shop minion **+8/+8** permanently.');
    expect(SETS.set2.own.some((c) => c.id === 'sp_picnic')).toBe(true);
    expect(SETS.set3.own.some((c) => c.id === 'sp_picnic')).toBe(true);
    // Rune of Thrift discounts it (a stat spell); the Gilded Ledger never casts it (an offer buff, not a board grant).
    expect(isStatSpell(def)).toBe(true);
    expect(isStatGrantingSpell(def)).toBe(false);
  });

  it('gives the right-most MINION offer +8/+8 now, skipping a spell offer, and enchants the slot for the run', () => {
    let s: RunState = {
      ...createRun(1), embers: 4,
      board: [body('keep', 'sandbag', 1, 1)],
      hand: [inHand()],
      shop: [{ uid: 'o1', cardId: 'alley' }, { uid: 'o2', cardId: 'alley' }, { uid: 'sp', cardId: 'growth' }], // spell last
    };
    s = reduce(s, { type: 'play', uid: 'pic' });
    expect(s.hand.some((c) => c.cardId === 'sp_picnic')).toBe(false); // consumed
    expect(s.board).toHaveLength(1); // nothing on the board moved
    const o2 = s.shop.find((o) => o.uid === 'o2')!;
    expect([o2.atk, o2.hp]).toEqual([8, 8]); // the right-most MINION, not the spell
    expect(o2.buffs?.some((b) => b.source === 'Picnic')).toBe(true);
    expect(s.shop.find((o) => o.uid === 'o1')!.atk).toBeUndefined();
    expect(s.shop.find((o) => o.uid === 'sp')!.atk).toBeUndefined();
    expect(s.rightmostSlotBuff).toEqual({ attack: 8, health: 8 }); // the slot remembers
  });

  it('is PERMANENT: the next roll’s right-most minion wears the +8/+8 too, and a second cast stacks to +16/+16', () => {
    let s: RunState = {
      ...createRun(2), embers: 10, tier: 3,
      hand: [inHand('p1'), inHand('p2')],
      shop: [{ uid: 'o1', cardId: 'alley' }],
    };
    s = reduce(s, { type: 'play', uid: 'p1' });
    s = reduce(s, { type: 'play', uid: 'p2' });
    expect(s.rightmostSlotBuff).toEqual({ attack: 16, health: 16 });
    expect([s.shop[0]!.atk, s.shop[0]!.hp]).toEqual([16, 16]);
    const before = s.embers;
    s = reduce(s, { type: 'roll' });
    expect(s.embers).toBe(before - 1); // the roll happened
    const minions = s.shop.filter((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; });
    expect(minions.length).toBeGreaterThan(0);
    const right = minions[minions.length - 1]!;
    expect([right.atk, right.hp]).toEqual([16, 16]); // re-landed on the fresh roll's right-most minion
  });

  it('folds spell power on both stats, and the printed number goes live with it', () => {
    let s: RunState = {
      ...createRun(1), embers: 4,
      hand: [inHand()],
      shop: [{ uid: 'o1', cardId: 'alley' }],
      spellBonus: { attack: 1, health: 2 },
    };
    s = reduce(s, { type: 'play', uid: 'pic' });
    expect([s.shop[0]!.atk, s.shop[0]!.hp]).toEqual([9, 10]);
    expect(s.rightmostSlotBuff).toEqual({ attack: 9, health: 10 });
    expect(spellDisplayText('sp_picnic', 1, 0, 2)).toContain('{{+9/+10}}');
    expect(spellDisplayText('sp_picnic', 0, 0, 0)).toBe(CARD_INDEX['sp_picnic']!.text); // no power → the printed base
  });

  it('is REFUSED outright when the Shop holds no minion: card kept, no Gold spent', () => {
    const start: RunState = {
      ...createRun(1), embers: 4,
      hand: [inHand()],
      shop: [{ uid: 'sp', cardId: 'growth' }], // a spell is not a recipient
    };
    expect(spellFizzles(start, CARD_INDEX['sp_picnic']!)).toBe(true);
    const s = reduce(start, { type: 'play', uid: 'pic' });
    expect(s).toBe(start); // untouched state — the "refused outright" convention
    expect(s.hand.some((c) => c.cardId === 'sp_picnic')).toBe(true);
    expect(s.rightmostSlotBuff).toBeUndefined();
  });
});
