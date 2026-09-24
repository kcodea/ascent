import { describe, expect, it } from 'vitest';
import { commitFlipDeltas, type CommitSweep } from './commitFlip';
import { commitSlidePlan } from './rowSlides';

const sweep = (key: string, entries: [string, number][]): CommitSweep => ({ key, lefts: new Map(entries) });
/** The whole commit decision as RowFlip runs it: how far (R-PRESENT-14), then which row (R-SLIDE-01). */
const plan = (prev: CommitSweep | null, now: CommitSweep, cards: { uid: string; inDropRow: boolean }[], isDrop: boolean) =>
  commitSlidePlan(cards, commitFlipDeltas(prev, now), isDrop);

describe('commitSlidePlan', () => {
  it('slides every card that moved when a row changed (a sell, a summon, an effect)', () => {
    const prev = sweep('a,b,c', [['a', 100], ['b', 200], ['c', 300]]);
    const now = sweep('a,c', [['a', 150], ['c', 250]]);                // `b` left; the row re-centred
    const cards = [{ uid: 'a', inDropRow: false }, { uid: 'c', inDropRow: false }];
    expect(plan(prev, now, cards, false)).toEqual([{ uid: 'a', delta: -50 }, { uid: 'c', delta: 50 }]);
  });

  // THE BLINK (owner 2026-09-24). A drop only captured the row it was dragged in, so when the SAME commit
  // re-laid-out the OTHER row — a drag-buy completing a triple consumes copies from the warband — that row's
  // survivors jumped to their new slots. The drop row keeps its own drop-time slide; the other row slides here.
  it('on a DROP, slides the other row too, and leaves the drop row to its own slide', () => {
    const prev = sweep('s1|w1,wX,wY,w2', [['w1', 100], ['w2', 400], ['s1', 500]]);
    const now = sweep('|w1,w2', [['w1', 150], ['w2', 350], ['s1', 540]]);
    const cards = [
      { uid: 'w1', inDropRow: false }, { uid: 'w2', inDropRow: false }, // the warband: a triple ate its copies
      { uid: 's1', inDropRow: true },                                   // the shop: the row the buy came from
    ];
    expect(plan(prev, now, cards, true)).toEqual([{ uid: 'w1', delta: -50 }, { uid: 'w2', delta: 50 }]);
  });

  // R-PRESENT-14 still holds on a drop: when no row changed, a layout shift is not a move.
  it('slides nothing when the rows did not change, drop or not', () => {
    const prev = sweep('a,b', [['a', 100], ['b', 200]]);
    const now = sweep('a,b', [['a', 180], ['b', 280]]);               // a resize re-centred the row
    const cards = [{ uid: 'a', inDropRow: false }, { uid: 'b', inDropRow: false }];
    expect(plan(prev, now, cards, false)).toEqual([]);
    expect(plan(prev, now, cards, true)).toEqual([]);
  });

  it('a card with no uid never slides (it would share one delta with any other)', () => {
    expect(commitSlidePlan([{ uid: '', inDropRow: false }], new Map([['', 40]]), false)).toEqual([]);
  });

  it('with no previous sweep there is nothing to slide from', () => {
    expect(plan(null, sweep('a', [['a', 5]]), [{ uid: 'a', inDropRow: false }], true)).toEqual([]);
  });
});
