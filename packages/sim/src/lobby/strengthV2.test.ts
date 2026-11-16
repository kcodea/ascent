import { describe, it, expect } from 'vitest';
import { runLongEnough, fieldedRoundsOf, earlyLateV2Of, runPeakOf } from './strengthV2';

describe('strength v2 rules', () => {
  it('a run must reach round 7', () => {
    expect(runLongEnough(6)).toBe(false);
    expect(runLongEnough(7)).toBe(true);
  });
  it('carries the final board to every later reference round', () => {
    const f = fieldedRoundsOf([1, 2, 3, 7, 8], 16);
    expect(f.filter((x) => !x.carried).map((x) => x.round)).toEqual([1, 2, 3, 7, 8]);
    expect(f.filter((x) => x.carried).map((x) => x.round)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    expect(f.filter((x) => x.carried).every((x) => x.from === 8)).toBe(true);
    expect(f.find((x) => x.round === 7)).toEqual({ round: 7, from: 7, carried: false });
  });
  it('carries nothing for a run that outlasts the reference, and ignores duplicate rounds', () => {
    expect(fieldedRoundsOf([15, 16, 17, 17], 16).map((x) => x.round)).toEqual([15, 16, 17]);
    expect(fieldedRoundsOf([], 16)).toEqual([]);
  });
  it('EARLY is rounds 1-9, LATE is rounds 10-15, later rounds count for neither', () => {
    const rounds = [...Array(9)].map((_, i) => ({ round: i + 1, value: 20 }))
      .concat([10, 11, 12, 13, 14, 15].map((r) => ({ round: r, value: 60 })), [{ round: 16, value: 100 }]);
    expect(earlyLateV2Of(rounds)).toEqual({ early: 20, late: 60 });
    expect(earlyLateV2Of([{ round: 3, value: 40 }])).toEqual({ early: 40, late: null });
  });
  it('peak is the best real board from round 3 on', () => {
    expect(runPeakOf([{ round: 1, value: 95 }, { round: 2, value: 90 }, { round: 3, value: 40 }, { round: 8, value: 70 }])).toBe(70);
    expect(runPeakOf([{ round: 1, value: 95 }, { round: 2, value: null }])).toBeNull();
  });
});
