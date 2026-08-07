import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState, type ShopCard } from './state';
import { reduce } from './reducer';
import { addBuff, addOfferBuff, offerBuyStats } from './recruit';

/**
 * RUBY TRANSFER (owner add 2026-08-06) — "Target a minion. It steals all Ruby buffs from adjacent minions."
 *
 * Two targeting modes, both load-bearing per the owner: a board minion steals from its BOARD neighbours, and
 * a shop offer steals from its SHOP neighbours ("it can also target shop minions and should steal ruby buffs
 * from adjacent shop minions in that instance"). The buff moves under the `Ruby` source specifically, so the
 * thief reads as a Ruby-laden minion to Gemheart Carver and every other "the Rubies on this minion" consumer.
 */
const SPELL = 'rubytransfer';
const body = (uid: string, cardId: string, attack = 3, health = 3): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });
const spellCard = (uid: string): BoardCard => body(uid, SPELL, 0, 1);
const offer = (uid: string, cardId: string): ShopCard => ({ uid, cardId });

const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1, 'runesmith'), setId: 'set2', phase: 'recruit', embers: 20, ...over } as RunState);

/** The `Ruby`-sourced share of a card's buff breakdown. */
const rubyOf = (c: { buffs?: { source: string; attack: number; health: number }[] }): { a: number; h: number } => {
  const e = c.buffs?.find((b) => b.source === 'Ruby');
  return { a: e?.attack ?? 0, h: e?.health ?? 0 };
};

describe('Ruby Transfer — on the BOARD', () => {
  it('the target steals both neighbours\' Ruby buffs, and they lose exactly that', () => {
    const left = body('l', 'pack');
    const mid = body('m', 'alley');
    const right = body('r', 'stray');
    addBuff(left, 'Ruby', 4, 4);
    addBuff(right, 'Ruby', 2, 3);
    addBuff(left, 'Growth', 5, 5); // a NON-Ruby buff on a donor — must not move
    const s = base({ board: [left, mid, right], hand: [spellCard('sp')] });
    const midBefore = { a: mid.attack, h: mid.health };
    const next = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm' });

    const nm = next.board.find((c) => c.uid === 'm')!;
    const nl = next.board.find((c) => c.uid === 'l')!;
    const nr = next.board.find((c) => c.uid === 'r')!;
    expect(rubyOf(nm), 'the thief holds both donors\' Rubies').toEqual({ a: 6, h: 7 });
    expect(nm.attack).toBe(midBefore.a + 6);
    expect(nm.health).toBe(midBefore.h + 7);
    expect(rubyOf(nl), 'the left donor is stripped').toEqual({ a: 0, h: 0 });
    expect(rubyOf(nr), 'the right donor is stripped').toEqual({ a: 0, h: 0 });
    expect(nl.buffs?.find((b) => b.source === 'Growth'), 'a non-Ruby buff stays put').toMatchObject({ attack: 5, health: 5 });
  });

  it('only ADJACENT minions are robbed', () => {
    const far = body('f', 'pack');
    addBuff(far, 'Ruby', 9, 9);
    const s = base({ board: [far, body('x', 'alley'), body('t', 'stray')], hand: [spellCard('sp')] });
    const next = reduce(s, { type: 'play', uid: 'sp', targetUid: 't' });
    expect(rubyOf(next.board.find((c) => c.uid === 'f')!), 'two slots away — untouched').toEqual({ a: 9, h: 9 });
    expect(rubyOf(next.board.find((c) => c.uid === 't')!)).toEqual({ a: 0, h: 0 });
  });

  it('with no adjacent Rubies it is a clean no-op on stats', () => {
    const t = body('t', 'pack');
    const s = base({ board: [body('a', 'alley'), t], hand: [spellCard('sp')] });
    const next = reduce(s, { type: 'play', uid: 'sp', targetUid: 't' });
    const nt = next.board.find((c) => c.uid === 't')!;
    expect([nt.attack, nt.health]).toEqual([t.attack, t.health]);
  });
});

describe('Ruby Transfer — on a SHOP offer (the owner\'s second mode)', () => {
  it('steals from the SHOP neighbours, and the offer\'s buy stats reflect it', () => {
    const l = offer('o1', 'pack');
    const mid = offer('o2', 'alley');
    const r = offer('o3', 'stray');
    addOfferBuff(l, 'Ruby', 3, 3);
    addOfferBuff(r, 'Ruby', 5, 1);
    const s = base({ shop: [l, mid, r], hand: [spellCard('sp')] });
    const next = reduce(s, { type: 'play', uid: 'sp', targetUid: 'o2' });

    const nm = next.shop.find((o) => o.uid === 'o2')!;
    expect(rubyOf(nm), 'the shop target holds both neighbours\' Rubies').toEqual({ a: 8, h: 4 });
    expect(rubyOf(next.shop.find((o) => o.uid === 'o1')!)).toEqual({ a: 0, h: 0 });
    expect(rubyOf(next.shop.find((o) => o.uid === 'o3')!)).toEqual({ a: 0, h: 0 });
    // The stolen stats are real buy stats, not just a breakdown entry.
    const def = CARD_INDEX['alley']!;
    const buy = offerBuyStats(next, nm);
    expect(buy.attack).toBe(def.attack + 8);
    expect(buy.health).toBe(def.health + 4);
  });

  it('carries onto the minion when bought — still labelled Ruby', () => {
    const l = offer('o1', 'pack');
    const target = offer('o2', 'alley');
    addOfferBuff(l, 'Ruby', 6, 6);
    let s = base({ shop: [l, target], hand: [spellCard('sp')], embers: 20 });
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'o2' });
    s = reduce(s, { type: 'buy', uid: 'o2' });
    const bought = s.hand.find((c) => c.cardId === 'alley');
    expect(bought, 'the offer was bought').toBeTruthy();
    expect(rubyOf(bought!), 'the stolen Rubies travel with the card as Rubies').toEqual({ a: 6, h: 6 });
  });

  it('does not try to rob the spell slot or a Ruby offer', () => {
    // A spell offer beside the target has nothing to give and must not throw or absorb anything.
    const s = base({ shop: [offer('o1', 'growth'), offer('o2', 'alley')], hand: [spellCard('sp')] });
    const next = reduce(s, { type: 'play', uid: 'sp', targetUid: 'o2' });
    expect(rubyOf(next.shop.find((o) => o.uid === 'o2')!)).toEqual({ a: 0, h: 0 });
  });
});

describe('the card data itself', () => {
  it('ships as specced (T5, 1 Gold, set-2, targetable anywhere)', () => {
    const def = CARD_INDEX[SPELL]!;
    expect(def.name).toBe('Ruby Transfer');
    expect(def.tier).toBe(5);
    expect(def.cost).toBe(1);
    expect(def.spell).toBe(true);
    expect(def.target, 'must reach shop offers too').toBe('any');
  });
});

describe("the owner's combo: Veinstorm → Ruby Transfer → Gemheart (2026-08-06)", () => {
  it("Veinstorm's grant is a REAL per-offer Ruby buff, so Ruby Transfer can move it", () => {
    // This is the case the owner hit in Scene Builder: Veinstorm used to write the run-wide TAVERN channel,
    // so the shop showed "Tavern" and Ruby Transfer found nothing to steal. It now stamps each current offer
    // with a genuine `Ruby` buff (and keeps the run channel for FUTURE offers).
    let s = base({
      shop: [offer('o1', 'pack'), offer('o2', 'alley'), offer('o3', 'stray')],
      hand: [body('vs', 'veinstorm', 0, 1)],
      embers: 20,
    });
    s = reduce(s, { type: 'play', uid: 'vs' });
    const stamped = s.shop.map((o) => rubyOf(o));
    expect(stamped.every((r) => r.a > 0 && r.h > 0), 'every offer carries a real Ruby buff').toBe(true);

    // …and no double-count: the offer's buy stats equal base + exactly one grant.
    const oneGrant = stamped[0]!.a;
    const buy = offerBuyStats(s, s.shop[0]!);
    expect(buy.attack, 'the run channel must not be added on top of the stamp').toBe(CARD_INDEX['pack']!.attack + oneGrant);

    // Now transfer the row's Rubies onto the middle offer.
    s = { ...s, hand: [spellCard('sp')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'o2' });
    expect(rubyOf(s.shop.find((o) => o.uid === 'o2')!).a, 'the middle offer now holds all three grants').toBe(oneGrant * 3);
    expect(rubyOf(s.shop.find((o) => o.uid === 'o1')!).a, 'the donor is stripped').toBe(0);
  });

  it("a REROLLED minion carries none — you rolled away the bodies that held the Rubies", () => {
    let s = base({ shop: [offer('o1', 'pack')], hand: [body('vs', 'veinstorm', 0, 1)], embers: 40 });
    s = reduce(s, { type: 'play', uid: 'vs' });
    expect(rubyOf(s.shop[0]!).a, "the offer present at cast time was Rubied").toBeGreaterThan(0);
    s = reduce(s, { type: 'roll' });
    for (const o of s.shop) {
      const d = CARD_INDEX[o.cardId]!;
      if (d.spell || d.ruby) continue;
      expect(rubyOf(o).a, "a fresh minion was never Rubied").toBe(0);
    }
  });
});
