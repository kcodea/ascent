import { describe, it, expect } from 'vitest';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { mintRubies, RUBY_ID } from './recruit';
import { CARD_INDEX } from '@game/content';

const mk = (uid: string, cardId: string, tribe = 'neutral', attack = 3, health = 3): BoardCard =>
  ({ uid, cardId, tribe: tribe as never, attack, health, keywords: [], golden: false });

describe('Cupcakes targets Demons only (owner report 2026-08-03)', () => {
  const withCupcakes = (target: BoardCard): RunState => {
    const s: RunState = { ...createRun(1), board: [target], hand: [], embers: 20 };
    s.hand.push(mk('cc', 'cupcakes'));
    return s;
  };

  it('FIZZLES on a non-Demon: kept in hand, nothing consumed', () => {
    const s = withCupcakes(mk('t', 'sandbag', 'neutral'));
    const shopBefore = s.shop.length;
    const after = reduce(reduce(s, { type: 'play', uid: 'cc', targetUid: 't' }), { type: 'resolveShopDeath' });
    expect(after, 'the cast must be refused outright').toBe(s);
    expect(s.hand.some((c) => c.uid === 'cc')).toBe(true);
    expect(s.shop.length).toBe(shopBefore);
  });

  it('still casts on a Demon (the eater consumes from the shop)', () => {
    const s = withCupcakes(mk('t', 'impoverseer', 'demon'));
    const shopBefore = s.shop.filter((o) => !CARD_INDEX[o.cardId]?.spell).length;
    const after = reduce(reduce(s, { type: 'play', uid: 'cc', targetUid: 't' }), { type: 'resolveShopDeath' });
    expect(after).not.toBe(s);
    expect(after.hand.some((c) => c.uid === 'cc')).toBe(false);
    const shopAfter = after.shop.filter((o) => !CARD_INDEX[o.cardId]?.spell).length;
    expect(shopAfter, 'the Demon ate from the shop').toBeLessThan(shopBefore);
  });
});

describe('Resonance Idol bounce does NOT chain into another Idol (ruling pin)', () => {
  it('a Ruby on Idol A bounces to Idol B as a plain buff — B does not re-bounce', () => {
    // [idolA, idolB, bystander]: play a Ruby on A. A's bounce (random pick) lands on B and/or the bystander
    // as addBuff — NOT via fireOnRubyPlayed — so B's own bounce must never fire. If it chained, the total
    // stat gain would exceed one Ruby + A's bounces.
    const idol = (uid: string): BoardCard => mk(uid, 'k_resonance', 'kobold', 3, 4);
    let s: RunState = { ...createRun(1), board: [idol('a'), idol('b'), mk('by', 'sandbag')], hand: [], embers: 20 };
    mintRubies(s, 1);
    const ruby = s.hand.find((c) => c.cardId === RUBY_ID)!;
    const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    s = reduce(reduce(s, { type: 'play', uid: ruby.uid, targetUid: 'a' }), { type: 'resolveShopDeath' }); // the real hand-cast Ruby path
    const gained = s.board.reduce((n, c) => n + c.attack + c.health, 0) - before;
    // One 1/1 Ruby on A (+2) + A's bounce: 2 random others × 1/1 (+2 each) = +6 TOTAL. A chain through B
    // would add B's own bounces on top (> 6). Pinned exact so any future chain regresses loudly.
    expect(gained, 'bounces are addBuff — they must not re-trigger onRubyPlayed').toBe(6);
  });
});

describe("Lastlight's Echo works in the SHOP (Funeral on Loan) — owner report 2026-08-03", () => {
  it('destroying a borrowed Lastlight grants Ward to 2 friendly minions', () => {
    // The real borrowed-play path: Funeral on Loan marks the discovered card `borrowed`; playing it that
    // turn destroys it and triggers its Echo via triggerBorrowedEcho → fireRecruitDeathrattles. Before the
    // fix, deathrattleGrantWardRandom had NO recruit factory, so the Echo silently did nothing.
    const s: RunState = {
      ...createRun(1),
      board: [mk('a', 'venom'), mk('b', 'bronzewarden')],
      hand: [{ ...mk('ll', 'n2_lastlight'), borrowed: true } as never],
      embers: 20,
    };
    const after = reduce(reduce(s, { type: 'play', uid: 'll' }), { type: 'resolveShopDeath' });
    expect(after.board.some((c) => c.uid === 'll'), 'the borrowed body was destroyed on play').toBe(false);
    const warded = after.board.filter((c) => c.keywords.includes('DS'));
    expect(warded.length, 'the Echo must grant Ward to 2 friendly minions').toBe(2);
  });

  it('golden doubles the grant (capped by board size)', () => {
    const s: RunState = {
      ...createRun(1),
      board: [mk('a', 'venom'), mk('b', 'bronzewarden'), mk('c', 'tara')],
      hand: [{ ...mk('ll', 'n2_lastlight'), golden: true, borrowed: true } as never],
      embers: 20,
    };
    const after = reduce(reduce(s, { type: 'play', uid: 'll' }), { type: 'resolveShopDeath' });
    // golden count 4, but only 3 bodies exist — all of them get Ward.
    expect(after.board.filter((c) => c.keywords.includes('DS')).length).toBe(3);
  });
});
