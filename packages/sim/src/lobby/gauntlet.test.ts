import { describe, expect, it } from 'vitest';
import { lossDamageCap, roundLossCap } from '../reducer';

describe('roundLossCap', () => {
  it('falls back to the normal game table when the lobby sets no caps', () => {
    for (const r of [1, 3, 4, 7, 8, 11, 12, 15, 16, 40]) expect(roundLossCap(undefined, r)).toBe(lossDamageCap(r));
    for (const r of [1, 5, 16]) expect(roundLossCap({}, r)).toBe(lossDamageCap(r));
  });

  it('reads a per-round table, null and past-the-end meaning uncapped', () => {
    const rules = { lossCaps: [5, 5, 5, 10, 10, 10, 15, 15, null, null] };
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((r) => roundLossCap(rules, r)))
      .toEqual([5, 5, 5, 10, 10, 10, 15, 15, Infinity, Infinity, Infinity]);
  });
});
