import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState, type ShopCard } from './state';
import { reduce } from './reducer';
import { addBuff, addOfferBuff, offerBuyStats, restoreHeldOffer, rubyStatBonus, swapWithTavern } from './recruit';

/**
 * A DISPLACED MINION KEEPS THE SHOP BUFFS IT EARNS THERE (owner bug report 2026-09-21).
 *
 * "I swapped Chimerus to the Shop (Darah) and used Veinstorm and it did not buff it." Darah's Displace stashes
 * the board body INTACT on the offer as `held`; Veinstorm stamps that offer like any other (`addOfferBuff` →
 * `offer.atk/hp/buffs`). But both restore paths — the re-buy (reducer) and the swap-back (`swapWithTavern`) —
 * rebuilt the body from `held` alone and never read the offer's buffs, so every offer-level buff (Veinstorm
 * Rubies, Fortify, a rune's shop enchant) vanished on the way back; only `golden` had been patched
 * (2026-07-29). Both paths now fold through ONE helper, `restoreHeldOffer`, which lands the accrued buffs
 * through `addBuff` under their own source names — a Ruby comes back a Ruby.
 */
const mkSpell = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

/** A buffed + progressed Target Dummy: not base, so a reset-to-base would show. */
const dummy = (uid = 'm'): BoardCard => {
  const c: BoardCard = { uid, cardId: 'sandbag', tribe: 'neutral', attack: 6, health: 5, keywords: ['T'], golden: false, summonBonus: 5 };
  addBuff(c, 'Growth', 3, 3); // → 9/8, with a body buff of its own to prove the ledger merges rather than overwrites
  return c;
};

const darah = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1, 'darah'), setId: 'set2', phase: 'recruit', embers: 99, heroReady: true, ...over } as RunState);

const rubyOf = (c: { buffs?: { source: string; attack: number; health: number; count: number }[] }) =>
  c.buffs?.find((b) => b.source === 'Ruby');

/** Darah swaps `uid` out; returns the run + the held offer it landed on. */
function displace(s: RunState, uid = 'm'): { s: RunState; offer: ShopCard } {
  const next = reduce(s, { type: 'heroPower', uid });
  const offer = next.shop.find((o) => o.held)!;
  expect(offer, 'the power stashed the body on an offer').toBeDefined();
  return { s: next, offer };
}

describe('the held offer is a plain offer to the Shop (invariants)', () => {
  it('swapWithTavern builds the held offer with NO atk/hp/buffs of its own — those are reserved for accrued Shop buffs', () => {
    const s = darah({ board: [dummy()], shop: [{ uid: 's1', cardId: 'gnash' }] });
    expect(swapWithTavern(s, s.board[0]!)).toBe(true);
    const offer = s.shop.find((o) => o.held)!;
    expect(offer.atk).toBeUndefined();
    expect(offer.hp).toBeUndefined();
    expect(offer.buffs).toBeUndefined();
    expect(offer.golden).toBeUndefined();
    expect([offer.held!.attack, offer.held!.health], 'the body itself is stashed intact').toEqual([9, 8]);
  });

  it('Veinstorm stamps the held offer like any other minion offer, and the shop-gem FX signal carries its uid', () => {
    const { s, offer } = displace(darah({ board: [dummy()], shop: [{ uid: 's1', cardId: 'gnash' }], hand: [mkSpell('vs', 'veinstorm')] }));
    const next = reduce(s, { type: 'play', uid: 'vs', targetUid: undefined });
    const stamped = next.shop.find((o) => o.uid === offer.uid)!;
    expect(stamped.held, 'still held').toBeDefined();
    expect(rubyOf(stamped)).toMatchObject({ attack: 1, health: 1, count: 1 });
    expect([stamped.atk, stamped.hp]).toEqual([1, 1]);
    expect(next.veinstormFx?.uids, 'the span plays over the held offer too').toContain(offer.uid);
  });

  it('offerBuyStats reads a held offer as the body + the accrued Shop buffs (+ a Golden Touch base doubling)', () => {
    const s = darah();
    const held: BoardCard = { uid: 'h', cardId: 'gnash', tribe: 'beast', attack: 40, health: 30, keywords: [], golden: false };
    const plain: ShopCard = { uid: 'o', cardId: 'gnash', held };
    expect(offerBuyStats(s, plain)).toEqual({ attack: 40, health: 30 });
    addOfferBuff(plain, 'Ruby', 3, 3);
    expect(offerBuyStats(s, plain), 'the stamp counts').toEqual({ attack: 43, health: 33 });
    const def = CARD_INDEX['gnash']!;
    expect(offerBuyStats(s, { ...plain, golden: true }), 'a gild doubles the printed base only').toEqual({ attack: 43 + def.attack, health: 33 + def.health });
  });
});

describe('re-buy (the reducer path)', () => {
  it('(a) Darah swaps the body out → Veinstorm → re-buy: the hand minion carries the Rubies as a Ruby buff', () => {
    const { s, offer } = displace(darah({ board: [dummy()], shop: [{ uid: 's1', cardId: 'gnash' }], hand: [mkSpell('vs', 'veinstorm')] }));
    let next = reduce(s, { type: 'play', uid: 'vs', targetUid: undefined });
    next = reduce(next, { type: 'buy', uid: offer.uid });
    const back = next.hand.find((c) => c.cardId === 'sandbag')!;
    expect(back, 'the body came back to hand').toBeDefined();
    expect([back.attack, back.health], '9/8 + the Ruby').toEqual([10, 9]);
    expect(rubyOf(back), 'labelled Ruby, so Ruby readers and Ruby Transfer see it').toMatchObject({ attack: 1, health: 1, count: 1 });
    expect(back.buffs?.find((b) => b.source === 'Growth'), "the body's own ledger survives").toMatchObject({ attack: 3, health: 3 });
    expect(back.summonBonus, 'progression preserved').toBe(5);
    expect(back.keywords).toContain('T');
  });

  it('(a′) with Rubies on the run the stamp is the live Ruby value, and so is what comes back', () => {
    const { s, offer } = displace(darah({ board: [dummy()], shop: [{ uid: 's1', cardId: 'gnash' }], hand: [mkSpell('vs', 'veinstorm')], rubyBonus: { attack: 2, health: 2 } }));
    const rb = rubyStatBonus(s);
    expect([rb.attack, rb.health]).toEqual([2, 2]);
    let next = reduce(s, { type: 'play', uid: 'vs', targetUid: undefined });
    expect(rubyOf(next.shop.find((o) => o.uid === offer.uid)!)).toMatchObject({ attack: 3, health: 3 });
    next = reduce(next, { type: 'buy', uid: offer.uid });
    const back = next.hand.find((c) => c.cardId === 'sandbag')!;
    expect([back.attack, back.health]).toEqual([12, 11]);
    expect(rubyOf(back)).toMatchObject({ attack: 3, health: 3, count: 1 });
  });

  it('(c) a Golden Touch gild on the held offer still applies, together with the buffs (base doubled once, buffs single)', () => {
    const { s, offer } = displace(darah({ board: [dummy()], shop: [{ uid: 's1', cardId: 'gnash' }], hand: [mkSpell('vs', 'veinstorm')] }));
    let next = reduce(s, { type: 'play', uid: 'vs', targetUid: undefined });
    next.shop.find((o) => o.uid === offer.uid)!.golden = true; // Golden Touch landed on the held offer
    next = reduce(next, { type: 'buy', uid: offer.uid });
    const back = next.hand.find((c) => c.cardId === 'sandbag')!;
    const def = CARD_INDEX['sandbag']!;
    expect(back.golden).toBe(true);
    expect([back.attack, back.health]).toEqual([9 + 1 + def.attack, 8 + 1 + def.health]);
    expect(rubyOf(back)).toMatchObject({ attack: 1, health: 1 });
    expect(back.buffs?.find((b) => b.source === 'Gild')).toMatchObject({ attack: def.attack, health: def.health });
  });

  it('(d) any generic offer buff (Fortify via addOfferBuff) restores too, under its own name', () => {
    const { s, offer } = displace(darah({ board: [dummy()], shop: [{ uid: 's1', cardId: 'gnash' }] }));
    addOfferBuff(s.shop.find((o) => o.uid === offer.uid)!, 'Fortify', 2, 2);
    addOfferBuff(s.shop.find((o) => o.uid === offer.uid)!, 'Growth', 1, 0); // same source as a body buff: merges
    const next = reduce(s, { type: 'buy', uid: offer.uid });
    const back = next.hand.find((c) => c.cardId === 'sandbag')!;
    expect([back.attack, back.health]).toEqual([12, 10]);
    expect(back.buffs?.find((b) => b.source === 'Fortify')).toMatchObject({ attack: 2, health: 2, count: 1 });
    expect(back.buffs?.find((b) => b.source === 'Growth'), 'one Growth line, summed').toMatchObject({ attack: 4, health: 3, count: 2 });
  });

  it('a held offer with legacy atk/hp but no breakdown lands under the generic label (the normal buy fallback)', () => {
    const s = darah();
    const offer: ShopCard = { uid: 'o', cardId: 'sandbag', held: dummy('h'), atk: 2, hp: 1 };
    const back = restoreHeldOffer(s, offer);
    expect([back.attack, back.health]).toEqual([11, 9]);
    expect(back.buffs?.find((b) => b.source === 'Tavern buff')).toMatchObject({ attack: 2, health: 1 });
  });

  it('a keyword the offer gained in the Shop rides back too; nothing else about the restore changed (no applyOnBuy, flat price)', () => {
    const { s, offer } = displace(darah({ board: [dummy()], shop: [{ uid: 's1', cardId: 'gnash' }], tavernBuyBonus: { atk: 5, hp: 5 } }));
    const o = s.shop.find((x) => x.uid === offer.uid)!;
    o.keywords = ['DS'];
    const before = s.embers;
    const next = reduce(s, { type: 'buy', uid: offer.uid });
    const back = next.hand.find((c) => c.cardId === 'sandbag')!;
    expect(back.keywords).toEqual(expect.arrayContaining(['T', 'DS']));
    expect([back.attack, back.health], 'the run-wide Shop channel is NOT baked — a restoration, not a purchase').toEqual([9, 8]);
    expect(before - next.embers, 'flat minion price').toBe(3);
  });
});

describe('swap-back (the swapWithTavern path)', () => {
  it('(b) the same stamp comes back onto the BOARD when the power swaps it home', () => {
    const { s, offer } = displace(darah({ board: [dummy()], shop: [{ uid: 's1', cardId: 'gnash' }], hand: [mkSpell('vs', 'veinstorm')] }));
    let next = reduce(s, { type: 'play', uid: 'vs', targetUid: undefined });
    // Only the held offer is a minion in the row, so the power's random pick is it; the swapped-in Gnash goes out.
    next = { ...next, heroReady: true, shop: next.shop.filter((o) => o.uid === offer.uid) };
    const gnash = next.board.find((c) => c.cardId === 'gnash')!;
    next = reduce(next, { type: 'heroPower', uid: gnash.uid });
    const home = next.board.find((c) => c.cardId === 'sandbag')!;
    expect(home, 'the body is back on the board').toBeDefined();
    expect([home.attack, home.health]).toEqual([10, 9]);
    expect(rubyOf(home)).toMatchObject({ attack: 1, health: 1, count: 1 });
    expect(home.buffs?.find((b) => b.source === 'Growth')).toMatchObject({ attack: 3, health: 3 });
    expect(home.summonBonus).toBe(5);
    // …and Gnash went into the Shop as a fresh held offer, with nothing accrued on it.
    const out = next.shop.find((o) => o.cardId === 'gnash')!;
    expect(out.held).toBeDefined();
    expect([out.atk, out.hp, out.buffs]).toEqual([undefined, undefined, undefined]);
  });

  it('(c′) swap-back re-gilds a Golden Touched held offer AND folds its buffs', () => {
    const { s, offer } = displace(darah({ board: [dummy()], shop: [{ uid: 's1', cardId: 'gnash' }] }));
    const o = s.shop.find((x) => x.uid === offer.uid)!;
    addOfferBuff(o, 'Fortify', 2, 2);
    o.golden = true;
    const gnash = s.board.find((c) => c.cardId === 'gnash')!;
    const next = reduce({ ...s, heroReady: true, shop: [o] }, { type: 'heroPower', uid: gnash.uid });
    const home = next.board.find((c) => c.cardId === 'sandbag')!;
    const def = CARD_INDEX['sandbag']!;
    expect(home.golden).toBe(true);
    expect([home.attack, home.health]).toEqual([9 + 2 + def.attack, 8 + 2 + def.health]);
    expect(home.buffs?.find((b) => b.source === 'Fortify')).toMatchObject({ attack: 2, health: 2 });
  });

  it('the restored body shares no ledger entry with the offer it came from', () => {
    const s = darah();
    const held = dummy('h');
    const offer: ShopCard = { uid: 'o', cardId: 'sandbag', held };
    addOfferBuff(offer, 'Ruby', 1, 1);
    const back = restoreHeldOffer(s, offer);
    addBuff(back, 'Growth', 1, 1);
    expect(held.buffs?.find((b) => b.source === 'Growth'), 'the stash is untouched by a later buff on the restored body').toMatchObject({ attack: 3, health: 3 });
    expect(back.keywords).not.toBe(held.keywords);
  });
});

describe('Ruby Transfer sees a held offer like any other stamped offer', () => {
  it('steals the Veinstorm Rubies off a held shop neighbour', () => {
    const l: ShopCard = { uid: 'o1', cardId: 'sandbag', held: dummy('h') };
    addOfferBuff(l, 'Ruby', 3, 3);
    const target: ShopCard = { uid: 'o2', cardId: 'alley' };
    const s = darah({ heroId: 'runesmith', shop: [l, target], hand: [mkSpell('sp', 'rubytransfer')] });
    const next = reduce(s, { type: 'play', uid: 'sp', targetUid: 'o2' });
    expect(rubyOf(next.shop.find((o) => o.uid === 'o1')!)?.attack ?? 0, 'the held offer is stripped of its accrued Rubies').toBe(0);
    expect(rubyOf(next.shop.find((o) => o.uid === 'o2')!)).toMatchObject({ attack: 5, health: 5 }); // stolen 3 + the 2 played
    expect(next.shop.find((o) => o.uid === 'o1')!.held!.attack, "the held BODY's stats are not what was robbed").toBe(9);
  });
});
