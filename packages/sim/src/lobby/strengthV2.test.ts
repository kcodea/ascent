import { describe, it, expect } from 'vitest';
import { runLongEnough, fieldedRoundsOf, earlyLateV2Of, runPeakOf, runCompleteV2 } from './strengthV2';

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
  it('peak is the best real board from round 4 on: rounds 1, 2 and 3 never count', () => {
    expect(runPeakOf([{ round: 1, value: 95 }, { round: 2, value: 90 }, { round: 3, value: 99 }, { round: 4, value: 40 }, { round: 8, value: 70 }])).toBe(70);
    expect(runPeakOf([{ round: 3, value: 99 }, { round: 4, value: 41 }])).toBe(41);
    expect(runPeakOf([{ round: 1, value: 95 }, { round: 3, value: 99 }])).toBeNull();
    expect(runPeakOf([{ round: 1, value: 95 }, { round: 2, value: null }])).toBeNull();
  });
});

describe('runCompleteV2: a run is scored only when complete', () => {
  const real = (last: number, ref: string | null = 'set2-v2'): { round: number; minions: number; ref: string | null }[] =>
    Array.from({ length: last }, (_, i) => ({ round: i + 1, minions: 3, ref }));
  const carriedTo15 = (last: number): number[] => Array.from({ length: 15 - last }, (_, i) => last + 1 + i);
  it('a fully scored run with every carried round is complete', () => {
    expect(runCompleteV2({ realRounds: real(7), carried: carriedTo15(7) }, 15)).toBe(true);
  });
  it('one real board on the old reference version makes it incomplete', () => {
    const rounds = real(7); rounds[3] = { ...rounds[3]!, ref: 'set2-v1' };
    expect(runCompleteV2({ realRounds: rounds, carried: carriedTo15(7) }, 15)).toBe(false);
    rounds[3] = { ...rounds[3]!, ref: null };
    expect(runCompleteV2({ realRounds: rounds, carried: carriedTo15(7) }, 15)).toBe(false);
  });
  it('a missing carried round makes it incomplete', () => {
    expect(runCompleteV2({ realRounds: real(7), carried: carriedTo15(7).slice(0, -1) }, 15)).toBe(false);
  });
  it('a run that reached the last reference round needs no carried score', () => {
    expect(runCompleteV2({ realRounds: real(15), carried: [] }, 15)).toBe(true);
    expect(runCompleteV2({ realRounds: real(18), carried: [] }, 15)).toBe(true);
  });
  it('an empty board needs no score', () => {
    const rounds = real(9); rounds[8] = { round: 9, minions: 0, ref: null };
    expect(runCompleteV2({ realRounds: rounds, carried: carriedTo15(9) }, 15)).toBe(true);
  });
  it('a run with no rounds is not scored', () => {
    expect(runCompleteV2({ realRounds: [], carried: [] }, 15)).toBe(false);
  });
});
