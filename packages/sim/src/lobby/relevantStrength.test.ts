import { describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import {
  STRENGTH_REF_VERSION, boardPctAtRound, percentileOf, strengthWindowWeights, windowStrengthOf,
  type StrengthHistogram,
} from './boardStrength';

const board = (over: Partial<BoardSnapshot>): BoardSnapshot => ({ wave: 7, ...over }) as BoardSnapshot;
const hist: StrengthHistogram = {
  '7': [{ raw: 10, count: 5 }, { raw: 20, count: 5 }],
  '8': [{ raw: 10, count: 5 }, { raw: 20, count: 5 }],
  '15': [{ raw: 10, count: 5 }, { raw: 20, count: 5 }],
};

describe('relevant strength', () => {
  it('weights: one round is 100%, two rounds are 50/50', () => {
    expect(strengthWindowWeights(1)).toEqual([1]);
    expect(strengthWindowWeights(2)).toEqual([0.5, 0.5]);
    expect(strengthWindowWeights(0)).toEqual([]);
  });

  it('weights: later rounds heavier from three rounds', () => {
    expect(strengthWindowWeights(8).map((w) => Math.round(w * 100))).toEqual([3, 3, 7, 10, 14, 17, 21, 24]);
    for (let n = 1; n <= 20; n++) {
      const w = strengthWindowWeights(n);
      expect(w).toHaveLength(n);
      expect(Math.abs(w.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-9);
      for (let i = 1; i < n; i++) expect(w[i]).toBeGreaterThanOrEqual(w[i - 1]);
    }
  });

  it('window strength renormalises over missing rounds', () => {
    expect(windowStrengthOf([{ round: 3, value: 80 }, { round: 4, value: 100 }], 4)).toBe(92);
  });

  it('window strength needs half the rounds', () => {
    expect(windowStrengthOf([{ round: 4, value: 50 }, { round: 5, value: 50 }], 5)).toBeNull();
    expect(typeof windowStrengthOf([{ round: 3, value: 50 }, { round: 4, value: 50 }, { round: 5, value: 50 }], 5)).toBe('number');
  });

  it('carried rounds and the last reference round', () => {
    const b = board({
      poolScore: { ref: STRENGTH_REF_VERSION, raw: 10, wave: 7 },
      poolCarried: { ref: STRENGTH_REF_VERSION, rounds: { '8': 20, '15': 10 } },
    });
    expect(boardPctAtRound(b, 7, hist)).toBe(percentileOf(10, hist['7'], true));
    expect(boardPctAtRound(b, 8, hist)).toBe(percentileOf(20, hist['8'], true));
    expect(boardPctAtRound(b, 18, hist)).toBe(percentileOf(10, hist['15'], true));
    expect(boardPctAtRound(b, 6, hist)).toBeNull();
  });

  it('another reference version is ignored', () => {
    const b = board({ poolScore: { ref: 'set2-v1', raw: 10, wave: 7 } });
    expect(boardPctAtRound(b, 7, hist)).toBeNull();
  });

  it('an empty or missing bucket, a carried ref mismatch or a missing round value is null', () => {
    const carried = (ref: string, rounds: Record<string, number>) =>
      board({ poolCarried: { ref, rounds } });
    expect(boardPctAtRound(carried(STRENGTH_REF_VERSION, { '9': 10 }), 9, hist)).toBeNull();
    expect(boardPctAtRound(carried(STRENGTH_REF_VERSION, { '9': 10 }), 9, { ...hist, '9': [] })).toBeNull();
    expect(boardPctAtRound(carried(STRENGTH_REF_VERSION, { '9': 10 }), 9, { ...hist, '9': [{ raw: 10, count: 0 }] })).toBeNull();
    expect(boardPctAtRound(carried('set2-v1', { '8': 20 }), 8, hist)).toBeNull();
    expect(boardPctAtRound(carried(STRENGTH_REF_VERSION, { '15': 10 }), 8, hist)).toBeNull();
  });
});
