import { describe, expect, it } from 'vitest';
import { advanceRollProgress, combatBuffDeltas } from './combatBuffRoll';

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
 * every frame is covered here; the loop itself is proven by Task 4's browser pass (and the live-speed
 * re-scaling this function exists for is proven by Task 6's browser pass — see that task's report for why a
 * mid-roll speed change can't be reached headlessly).
 */
describe('advanceRollProgress', () => {
  it('starts at 0 and reaches 1 over rollMs at speed 1', () => {
    expect(advanceRollProgress(0, 0, 400, 1)).toBe(0);
    expect(advanceRollProgress(0, 400, 400, 1)).toBe(1);
  });

  it('is linear in between', () => {
    expect(advanceRollProgress(0, 100, 400, 1)).toBe(0.25);
    expect(advanceRollProgress(0.25, 100, 400, 1)).toBe(0.5);
  });

  it('accumulates across frames the same as one big frame would', () => {
    let p = 0;
    p = advanceRollProgress(p, 100, 400, 1);
    p = advanceRollProgress(p, 100, 400, 1);
    p = advanceRollProgress(p, 100, 400, 1);
    p = advanceRollProgress(p, 100, 400, 1);
    expect(p).toBe(1);
  });

  it('a speed that doubles partway reaches p=1 sooner than a constant speed', () => {
    // Same total wall-clock time (400ms across 4 frames), but the second half runs at 2x.
    let steady = 0;
    steady = advanceRollProgress(steady, 100, 400, 1);
    steady = advanceRollProgress(steady, 100, 400, 1);
    steady = advanceRollProgress(steady, 100, 400, 1);
    steady = advanceRollProgress(steady, 100, 400, 1);

    let sped = 0;
    sped = advanceRollProgress(sped, 100, 400, 1);
    sped = advanceRollProgress(sped, 100, 400, 1);
    sped = advanceRollProgress(sped, 100, 400, 2); // speed doubles here
    sped = advanceRollProgress(sped, 100, 400, 2);

    expect(steady).toBe(1); // exactly finishes at the steady rate
    expect(sped).toBe(1);   // the sped-up run also finishes...
    // ...but reaches completion in FEWER equivalent ms — prove it by checking an earlier frame is already
    // ahead of the steady run at the same wall-clock point.
    let steadyMid = advanceRollProgress(0, 100, 400, 1);
    steadyMid = advanceRollProgress(steadyMid, 100, 400, 1);
    let spedMid = advanceRollProgress(0, 100, 400, 1);
    spedMid = advanceRollProgress(spedMid, 100, 400, 2);
    expect(spedMid).toBeGreaterThan(steadyMid);
  });

  it('never exceeds 1 even with a huge dt or a huge speed', () => {
    expect(advanceRollProgress(0, 99999, 400, 1)).toBe(1);
    expect(advanceRollProgress(0, 400, 400, 999)).toBe(1);
    expect(advanceRollProgress(0.9, 100, 400, 1)).toBe(1);
  });

  it('a dt of 0 does not advance', () => {
    expect(advanceRollProgress(0.4, 0, 400, 1)).toBe(0.4);
    expect(advanceRollProgress(0.4, -10, 400, 1)).toBe(0.4);
  });

  it('reveals instantly for a zero or negative rollMs, instead of dividing by zero', () => {
    expect(advanceRollProgress(0, 0, 0, 1)).toBe(1);
    expect(advanceRollProgress(0, 0, -10, 1)).toBe(1);
    expect(Number.isNaN(advanceRollProgress(0, 0, 0, 1))).toBe(false);
  });

  it('treats a non-positive speed as 1, same as the old call-time guard', () => {
    expect(advanceRollProgress(0, 100, 400, 0)).toBe(0.25);
    expect(advanceRollProgress(0, 100, 400, -5)).toBe(0.25);
  });
});
