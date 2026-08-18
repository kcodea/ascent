import { describe, it, expect } from 'vitest';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * Guards the ENGINE assumptions the Learn Ascent course (R8–R9) is authored against — so retuning a card or a
 * reducer path can't silently break the tutorial's scripted lessons. These mirror the exact action sequences
 * the course steps drive (see `tutorial/learnAscent.ts`).
 */

const packstrider = (uid: string): BoardCard =>
  ({ uid, cardId: 'b2_packstrider', tribe: 'beast', attack: 2, health: 2, keywords: ['RL'], golden: false });

describe('R8 — triple → Golden → Triple Reward Discover', () => {
  it('buying the third Packstrider forms a Golden in hand', () => {
    let s: RunState = {
      ...createRun(1, 'aster', 'tutorial'),
      phase: 'recruit', embers: 10, maxEmbers: 10,
      board: [packstrider('p1'), packstrider('p2')], hand: [],
      shop: [{ uid: 's1', cardId: 'b2_packstrider' }],
    };
    s = reduce(s, { type: 'buy', uid: 's1' });
    const goldens = s.hand.filter((c) => c.cardId === 'b2_packstrider' && c.golden);
    expect(goldens.length, 'a Golden Packstrider is minted to hand').toBe(1);
    expect(s.board.filter((c) => c.cardId === 'b2_packstrider').length, 'the two board copies were consumed').toBe(0);
    expect(s.triplesMade).toBeGreaterThanOrEqual(1);
  });

  it('playing the Golden grants a Triple Reward (discoverspell) to hand', () => {
    let s: RunState = {
      ...createRun(1, 'aster', 'tutorial'),
      phase: 'recruit', embers: 10, maxEmbers: 10,
      board: [packstrider('p1'), packstrider('p2')], hand: [],
      shop: [{ uid: 's1', cardId: 'b2_packstrider' }],
    };
    s = reduce(s, { type: 'buy', uid: 's1' });
    const golden = s.hand.find((c) => c.cardId === 'b2_packstrider' && c.golden)!;
    s = reduce(s, { type: 'play', uid: golden.uid });
    expect(s.hand.some((c) => c.cardId === 'discoverspell'), 'the Triple Reward token is in hand').toBe(true);
  });

  it('playing the Triple Reward opens a Discover', () => {
    let s: RunState = {
      ...createRun(1, 'aster', 'tutorial'),
      phase: 'recruit', embers: 10, maxEmbers: 10, tier: 3,
      board: [], hand: [{ uid: 'r', cardId: 'discoverspell', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'r' });
    expect(s.discover, 'a Discover choice opens').toBeTruthy();
  });
});

describe('R9 — buy a spell from the minion row, cast it on a minion', () => {
  it('Blessing buys into hand and casts for +3/+4 twice (net +6/+8)', () => {
    let s: RunState = {
      ...createRun(1, 'aster', 'tutorial'),
      phase: 'recruit', embers: 10, maxEmbers: 10,
      board: [packstrider('p1')], hand: [],
      shop: [{ uid: 's1', cardId: 'sp_blessing' }],
    };
    s = reduce(s, { type: 'buy', uid: 's1' });
    const spell = s.hand.find((c) => c.cardId === 'sp_blessing');
    expect(spell, 'the spell buys into hand').toBeTruthy();
    const before = s.board[0]!;
    s = reduce(s, { type: 'play', uid: spell!.uid, targetUid: 'p1' });
    const after = s.board.find((c) => c.uid === 'p1')!;
    expect(after.attack - before.attack, '+3/+4 twice = +6 Attack').toBe(6); // owner balance 2026-08-18
    expect(after.health - before.health, '+8 Health').toBe(8);
    expect(s.hand.some((c) => c.cardId === 'sp_blessing'), 'the spell is spent').toBe(false);
  });
});
