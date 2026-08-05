import { describe, expect, it } from 'vitest';
import { combatBuffDeltas, rollElapsedToProgress } from './combatBuffRoll';

const frame = { player: [{ uid: 'a', attack: 5, health: 6 }], enemy: [] } as never;

describe('combatBuffDeltas', () => {
  it('sums a beat\'s buff events per target and returns the DELTA, not the absolute', () => {
    const events = [
      { type: 'buff', target: 'a', attack: 2, health: 1 },
      { type: 'buff', target: 'a', attack: 1, health: 0 },
    ] as never[];
    expect(combatBuffDeltas({ start: 0, end: 2 }, events, frame)).toEqual([{ uid: 'a', attack: 3, health: 1 }]);
  });

  it('skips a zero net delta and a target not on the frame', () => {
    const events = [{ type: 'buff', target: 'ghost', attack: 2, health: 0 }] as never[];
    expect(combatBuffDeltas({ start: 0, end: 1 }, events, frame)).toEqual([]);
  });
});

/**
 * `driveRoll` itself is a live `requestAnimationFrame` loop wrapped around this arithmetic — not driven
 * headlessly under vitest, same as `fx/statHold.ts`'s own `ensureTicking` rAF loop, whose tests drive
 * `stepHolds()` directly rather than mock rAF. This is the equivalent split: the math `driveRoll` calls on
 * every frame is covered here; the loop itself is proven by Task 4's browser pass.
 */
describe('rollElapsedToProgress', () => {
  it('starts at 0 and lands at 1', () => {
    expect(rollElapsedToProgress(0, 400)).toBe(0);
    expect(rollElapsedToProgress(400, 400)).toBe(1);
  });

  it('is linear in between', () => {
    expect(rollElapsedToProgress(100, 400)).toBe(0.25);
    expect(rollElapsedToProgress(200, 400)).toBe(0.5);
  });

  it('clamps negative elapsed to 0 rather than going backwards', () => {
    expect(rollElapsedToProgress(-50, 400)).toBe(0);
  });

  it('clamps an overshoot to 1 rather than exceeding it', () => {
    expect(rollElapsedToProgress(9999, 400)).toBe(1);
  });

  it('reveals instantly for a zero or negative duration, instead of dividing by zero', () => {
    expect(rollElapsedToProgress(0, 0)).toBe(1);
    expect(rollElapsedToProgress(0, -10)).toBe(1);
    expect(Number.isNaN(rollElapsedToProgress(0, 0))).toBe(false);
  });
});
