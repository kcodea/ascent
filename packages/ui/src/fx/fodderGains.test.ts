import { describe, expect, it } from 'vitest';
import { fodderGainHolds } from './fodderGains';

const eat = (eaterUid: string, gainA: number, gainH: number) => ({ eaterUid, gainA, gainH });

describe('fodderGainHolds', () => {
  it('sums a Demon that ate several Fodder into ONE withheld delta', () => {
    // Two holds on one uid would ACCUMULATE (same rank), so the badge would step twice for one gulp.
    expect(fodderGainHolds([eat('d', 1, 1), eat('d', 2, 3)])).toEqual([{ uid: 'd', attack: 3, health: 4 }]);
  });

  it('keeps eaters separate', () => {
    expect(fodderGainHolds([eat('d1', 1, 1), eat('d2', 2, 2)]))
      .toEqual([{ uid: 'd1', attack: 1, health: 1 }, { uid: 'd2', attack: 2, health: 2 }]);
  });

  it('preserves first-seen order, so the holds land in the order the events did', () => {
    expect(fodderGainHolds([eat('b', 1, 0), eat('a', 1, 0), eat('b', 1, 0)]).map((g) => g.uid))
      .toEqual(['b', 'a']);
  });

  it('drops an eater that gained nothing — nothing to withhold is not a hold', () => {
    expect(fodderGainHolds([eat('d', 0, 0)])).toEqual([]);
  });

  it('keeps an eater that gained on only one side', () => {
    expect(fodderGainHolds([eat('d', 0, 2)])).toEqual([{ uid: 'd', attack: 0, health: 2 }]);
  });

  it('is empty for no events', () => {
    expect(fodderGainHolds([])).toEqual([]);
  });

  it('does not mutate the events it reads', () => {
    const events = [eat('d', 1, 1), eat('d', 1, 1)];
    fodderGainHolds(events);
    expect(events).toEqual([eat('d', 1, 1), eat('d', 1, 1)]);
  });
});
