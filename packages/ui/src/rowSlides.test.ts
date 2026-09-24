import { describe, expect, it } from 'vitest';
import { commitSlidePlan } from './rowSlides';

const lefts = (entries: [string, number][]): Map<string, number> => new Map(entries);

describe('commitSlidePlan', () => {
  it('slides every card whose layout moved since the last commit (a sell, a summon, an effect)', () => {
    const olds = lefts([['a', 100], ['b', 200], ['c', 300]]);
    const nows = lefts([['a', 150], ['c', 250]]);                    // `b` left; the row re-centred
    const cards = [{ uid: 'a', inDropRow: false }, { uid: 'c', inDropRow: false }];
    expect(commitSlidePlan(cards, olds, nows, false)).toEqual([{ uid: 'a', delta: -50 }, { uid: 'c', delta: 50 }]);
  });

  // THE BLINK (owner 2026-09-24). A drop only captured the row it was dragged in, so when the SAME commit
  // re-laid-out the OTHER row — a drag-buy completing a triple consumes copies from the warband — that row's
  // survivors jumped to their new slots. The drop row keeps its own drop-time slide; the other row slides here.
  it('on a DROP, slides the other row too, and leaves the drop row to its own slide', () => {
    const olds = lefts([['w1', 100], ['w2', 400], ['s1', 500]]);
    const nows = lefts([['w1', 150], ['w2', 350], ['s1', 540]]);
    const cards = [
      { uid: 'w1', inDropRow: false }, { uid: 'w2', inDropRow: false }, // the warband: a triple ate its copies
      { uid: 's1', inDropRow: true },                                   // the shop: the row the buy came from
    ];
    expect(commitSlidePlan(cards, olds, nows, true)).toEqual([{ uid: 'w1', delta: -50 }, { uid: 'w2', delta: 50 }]);
  });

  it('a card that did not move, or is new, does not slide', () => {
    const olds = lefts([['a', 100]]);
    const nows = lefts([['a', 100.3], ['fresh', 200]]);
    const cards = [{ uid: 'a', inDropRow: false }, { uid: 'fresh', inDropRow: false }];
    expect(commitSlidePlan(cards, olds, nows, false)).toEqual([]);
  });

  it('a card with no uid never slides (it would share one sweep entry with any other)', () => {
    const olds = lefts([['', 100]]);
    const nows = lefts([['', 300]]);
    expect(commitSlidePlan([{ uid: '', inDropRow: false }], olds, nows, false)).toEqual([]);
  });

  it('with no previous sweep there is nothing to slide from', () => {
    expect(commitSlidePlan([{ uid: 'a', inDropRow: false }], null, lefts([['a', 5]]), false)).toEqual([]);
    expect(commitSlidePlan([{ uid: 'a', inDropRow: false }], lefts([['a', 5]]), null, true)).toEqual([]);
  });
});
