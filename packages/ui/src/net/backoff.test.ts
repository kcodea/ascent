import { describe, expect, it } from 'vitest';
import { keyedBackoff } from './backoff';
import { committedRound } from '../versus/versusStore';

/**
 * R-NET-BACKOFF-01: a polling loop asks at its old pace while the situation is new (so a deadline lands on the same tick
 * as before), then backs off while the answer keeps changing nothing, and starts fresh the moment the key changes.
 */
describe('R-NET-BACKOFF-01: keyed backoff', () => {
  it('a new key is ready at once; the first tries keep the base pace; then the wait doubles to the cap', () => {
    const g = keyedBackoff({ base: 500, fastTries: 10, max: 15_000 });
    let t = 0;
    const asks: number[] = [];
    while (t <= 120_000) {
      if (g.ready('m|7', t)) { g.asked('m|7', t); asks.push(t); }
      t += 500;
    }
    expect(asks.slice(0, 11)).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000]);
    // 1 s, 2 s, 4 s, 8 s, then 15 s apart: two minutes cost ~20 asks instead of 240.
    expect(asks.length).toBeLessThan(25);
    const gaps = asks.slice(1).map((a, i) => a - asks[i]!);
    expect(Math.max(...gaps)).toBe(15_000);
  });

  it('a changed key (the match moved on) is asked at once and at base pace again', () => {
    const g = keyedBackoff({ base: 500, fastTries: 2, max: 15_000 });
    for (let i = 0; i < 8; i++) g.asked('a', i * 100_000);
    expect(g.ready('a', 700_001)).toBe(false);
    expect(g.ready('b', 700_001)).toBe(true);
    g.asked('b', 700_001);
    expect(g.ready('b', 700_501)).toBe(true);
  });

  it('a hidden tab waits at least the hidden floor once past the fast tries', () => {
    const g = keyedBackoff({ base: 500, fastTries: 1, max: 15_000, hiddenFloor: 5_000 });
    g.asked('k', 0, true);
    expect(g.ready('k', 500)).toBe(true); // still a fast try
    g.asked('k', 500, true);
    expect(g.ready('k', 1500)).toBe(false);
    expect(g.ready('k', 5500)).toBe(true);
  });
});

/** R-NET-ROUNDS-01: rounds are read only once the server has committed them. */
describe('R-NET-ROUNDS-01: committedRound', () => {
  it('the current round once its fight is in, else the one before', () => {
    expect(committedRound({ phase: 'shop', round: 4 })).toBe(3);
    expect(committedRound({ phase: 'resolving', round: 4 })).toBe(3);
    expect(committedRound({ phase: 'combat', round: 4 })).toBe(4);
    expect(committedRound({ phase: 'complete', round: 9 })).toBe(9);
    expect(committedRound({ phase: 'hero_select', round: 0 })).toBe(-1);
  });
});
