import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ROLL_MS, HOLD_TTL_MS, anyStatHeld, heldFor, holdOrigin, holdStat,
  releaseAllStats, releaseStat, scheduleFor, statHoldKey, revealStat, stepHolds, subscribeStatHolds,
} from './statHold';

afterEach(() => {
  releaseAllStats();
  vi.useRealTimers();
});

describe('holding a stat change', () => {
  it('withholds a delta and reports it', () => {
    holdStat('a', { attack: 2, health: 1 });
    expect(heldFor('a')).toEqual({ attack: 2, health: 1 });
  });

  it('reports nothing for a unit with no hold', () => {
    expect(heldFor('nobody')).toBeNull();
  });

  it('ACCUMULATES, so two gems in one moment withhold both', () => {
    holdStat('a', { attack: 1, health: 1 });
    holdStat('a', { attack: 1, health: 1 });
    expect(heldFor('a')).toEqual({ attack: 2, health: 2 });
  });

  it('treats a missing side as zero rather than NaN', () => {
    holdStat('a', { attack: 3 });
    expect(heldFor('a')).toEqual({ attack: 3, health: 0 });
  });

  it('does not store a zero delta — nothing to withhold is not a hold', () => {
    holdStat('a', { attack: 0, health: 0 });
    expect(heldFor('a')).toBeNull();
    expect(anyStatHeld()).toBe(false);
  });
});

/**
 * THE GATE between the intrinsic badge roll and a better-informed effect.
 *
 * Several paths can watch the same stat change. `Card`'s intrinsic roll fires off the value moving, a cue
 * that computed a stagger can say when this particular minion's number is due, and a `react` layer with
 * `carries` ticked owns the moment AND the clock. Because React flushes layout effects CHILD FIRST, the
 * card's intrinsic hold always lands before a parent's — left to accumulate, a +1/+1 gem would withhold
 * +2/+2 and the badge would print a number the unit never had.
 *
 * So `origin` is a RANK: a higher-ranked hold REPLACES a live lower one (same change, better-informed
 * placer), a lower one never lands on top of a higher one, and equal ranks still accumulate — those are
 * genuinely two changes, which is the case the accumulate tests above cover.
 */
describe('origin rank — who owns a change when several paths see it', () => {
  it('a cue REPLACES an intrinsic hold instead of stacking a second copy', () => {
    holdStat('a', { attack: 1, health: 1 }, { origin: 'intrinsic' });
    holdStat('a', { attack: 1, health: 1 }, { origin: 'cue', startAt: 300 });
    expect(heldFor('a')).toEqual({ attack: 1, health: 1 });
    expect(holdOrigin('a')).toBe('cue');
    expect(scheduleFor('a')?.startAt).toBe(300);
  });

  it('an effect REPLACES a cue hold', () => {
    holdStat('a', { attack: 2, health: 0 }, { origin: 'cue', startAt: 300 });
    holdStat('a', { attack: 2, health: 0 }, { origin: 'effect' });
    expect(heldFor('a')).toEqual({ attack: 2, health: 0 });
    expect(holdOrigin('a')).toBe('effect');
  });

  it('a lower rank never lands on top of a higher one', () => {
    holdStat('a', { attack: 2, health: 2 }, { origin: 'effect' });
    holdStat('a', { attack: 2, health: 2 }, { origin: 'cue' });
    holdStat('a', { attack: 2, health: 2 }, { origin: 'intrinsic' });
    expect(heldFor('a')).toEqual({ attack: 2, health: 2 });
    expect(holdOrigin('a')).toBe('effect');
  });

  it('replaces even when the lower-ranked hold already showed part of the change', () => {
    holdStat('a', { attack: 4, health: 0 }, { origin: 'intrinsic' });
    revealStat('a', 0.5);
    holdStat('a', { attack: 4, health: 0 }, { origin: 'cue' });
    expect(heldFor('a')).toEqual({ attack: 4, health: 0 });   // the whole change again, from the top
  });

  it('SAME rank still accumulates — two genuinely separate changes', () => {
    holdStat('a', { attack: 1, health: 0 }, { origin: 'cue' });
    holdStat('a', { attack: 1, health: 0 }, { origin: 'cue' });
    expect(heldFor('a')).toEqual({ attack: 2, health: 0 });
  });

  it('defaults to effect, so every existing caller keeps its precedence', () => {
    holdStat('a', { attack: 1, health: 0 });
    expect(holdOrigin('a')).toBe('effect');
  });

  it('an EXPIRED hold does not block a later one of any rank', () => {
    holdStat('a', { attack: 2, health: 0 }, { origin: 'effect' });
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + HOLD_TTL_MS + 1);
    holdStat('a', { attack: 3, health: 0 }, { origin: 'intrinsic' });
    expect(heldFor('a')).toEqual({ attack: 3, health: 0 });
    expect(holdOrigin('a')).toBe('intrinsic');
  });

  it('reports no origin for a unit with nothing held', () => {
    expect(holdOrigin('nobody')).toBeNull();
  });
});

describe('releasing', () => {
  it('drops the hold so the badge shows the truth', () => {
    holdStat('a', { attack: 2, health: 0 });
    releaseStat('a');
    expect(heldFor('a')).toBeNull();
  });

  it('is safe when nothing is held', () => {
    expect(() => releaseStat('a')).not.toThrow();
  });

  it('releases only the unit named', () => {
    holdStat('a', { attack: 1, health: 0 });
    holdStat('b', { attack: 1, health: 0 });
    releaseStat('a');
    expect(heldFor('a')).toBeNull();
    expect(heldFor('b')).toEqual({ attack: 1, health: 0 });
  });

  it('clears everything on a scene change', () => {
    holdStat('a', { attack: 1, health: 0 });
    holdStat('b', { attack: 1, health: 0 });
    releaseAllStats();
    expect(anyStatHeld()).toBe(false);
  });
});

describe('a hold nobody claims must not be permanent', () => {
  it('expires on its own, so an unclaimed hold fails OPEN', () => {
    // The case this guards: a def with no "carries the number" layer, which is every effect authored
    // before this existed. Without the TTL the badge would show a stale stat forever.
    vi.useFakeTimers();
    const t0 = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => t0);
    holdStat('a', { attack: 5, health: 5 });
    expect(heldFor('a')).not.toBeNull();

    vi.spyOn(performance, 'now').mockImplementation(() => t0 + HOLD_TTL_MS + 1);
    expect(heldFor('a')).toBeNull();
  });

  it('sweeps the expired entry rather than leaking it', () => {
    vi.useFakeTimers();
    const t0 = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => t0);
    holdStat('a', { attack: 5, health: 5 });
    vi.spyOn(performance, 'now').mockImplementation(() => t0 + HOLD_TTL_MS + 1);
    heldFor('a');
    expect(anyStatHeld()).toBe(false);
  });

  it('a fresh hold after expiry starts from zero, not from the dead delta', () => {
    vi.useFakeTimers();
    const t0 = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => t0);
    holdStat('a', { attack: 5, health: 0 });
    vi.spyOn(performance, 'now').mockImplementation(() => t0 + HOLD_TTL_MS + 1);
    holdStat('a', { attack: 2, health: 0 });
    expect(heldFor('a')).toEqual({ attack: 2, health: 0 });
  });

  /**
   * The header promises "a hold nobody claims must not be permanent". Until now that was enforced only by
   * `heldFor` sweeping on READ — and nothing re-reads a badge on a shop that isn't being touched, so a hold
   * whose effect never released it froze the number until some unrelated re-render happened to sweep it.
   *
   * Reachable for real: pull the `carries` layer off a def in the workbench and the cue still holds, but
   * nothing is left to deliver. The owner's report was a gem apply that didn't update until they clicked
   * again. So expiry NOTIFIES on its own now, rather than waiting to be asked.
   */
  it('an unclaimed hold releases ITSELF at the TTL, and tells subscribers', async () => {
    vi.useFakeTimers();
    let notified = 0;
    const stop = subscribeStatHolds(() => { notified++; });
    holdStat('a', { attack: 3, health: 3 }, { ttlMs: 50 });
    expect(notified).toBe(1);          // the hold itself
    expect(anyStatHeld()).toBe(true);
    await vi.advanceTimersByTimeAsync(60);
    expect(anyStatHeld()).toBe(false); // gone WITHOUT anyone reading it
    expect(notified).toBe(2);          // and the badge was told to re-render
    stop();
  });

  it('a hold released on time does not also fire its expiry', async () => {
    vi.useFakeTimers();
    holdStat('a', { attack: 3, health: 0 }, { ttlMs: 50 });
    releaseStat('a');
    let notified = 0;
    const stop = subscribeStatHolds(() => { notified++; });
    await vi.advanceTimersByTimeAsync(60);
    expect(notified).toBe(0);          // no stray emit for a hold that is already gone
    stop();
  });

  it('a re-hold restarts the clock rather than inheriting the old deadline', async () => {
    vi.useFakeTimers();
    holdStat('a', { attack: 2, health: 0 }, { ttlMs: 100 });
    await vi.advanceTimersByTimeAsync(80);
    holdStat('a', { attack: 2, health: 0 }, { ttlMs: 100 });
    await vi.advanceTimersByTimeAsync(40);   // past the FIRST deadline, inside the second
    expect(anyStatHeld()).toBe(true);
    await vi.advanceTimersByTimeAsync(70);
    expect(anyStatHeld()).toBe(false);
  });
});

describe('the render subscription', () => {
  it('gives a PRIMITIVE snapshot, so getSnapshot is referentially stable', () => {
    holdStat('a', { attack: 2, health: 1 });
    expect(typeof statHoldKey('a')).toBe('number');
    expect(statHoldKey('a')).toBe(statHoldKey('a'));
  });

  it('reads 0 for an untouched unit, so its card never re-renders', () => {
    holdStat('a', { attack: 2, health: 1 });
    expect(statHoldKey('b')).toBe(0);
  });

  it('changes when the hold changes, and returns to 0 on release', () => {
    const before = statHoldKey('a');
    holdStat('a', { attack: 2, health: 1 });
    expect(statHoldKey('a')).not.toBe(before);
    releaseStat('a');
    expect(statHoldKey('a')).toBe(0);
  });

  it('distinguishes attack from health — a 2/0 hold is not a 0/2 hold', () => {
    holdStat('a', { attack: 2, health: 0 });
    const atkOnly = statHoldKey('a');
    releaseStat('a');
    holdStat('a', { attack: 0, health: 2 });
    expect(statHoldKey('a')).not.toBe(atkOnly);
  });

  it('notifies subscribers on hold and on release', () => {
    const fn = vi.fn();
    const off = subscribeStatHolds(fn);
    holdStat('a', { attack: 1, health: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
    releaseStat('a');
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    holdStat('b', { attack: 1, health: 0 });
    expect(fn).toHaveBeenCalledTimes(2); // unsubscribed
  });

  it('does not notify when a release changes nothing', () => {
    const fn = vi.fn();
    const off = subscribeStatHolds(fn);
    releaseStat('never-held');
    expect(fn).not.toHaveBeenCalled();
    off();
  });
});

describe('rolling the counter', () => {
  it('shows the OLD number at 0 revealed', () => {
    holdStat('a', { attack: 4, health: 0 });
    revealStat('a', 0);
    expect(heldFor('a')).toEqual({ attack: 4, health: 0 });
  });

  it('steps through whole numbers as it rolls', () => {
    holdStat('a', { attack: 4, health: 0 });
    revealStat('a', 0.25);
    expect(heldFor('a')).toEqual({ attack: 3, health: 0 });
    revealStat('a', 0.5);
    expect(heldFor('a')).toEqual({ attack: 2, health: 0 });
    revealStat('a', 0.75);
    expect(heldFor('a')).toEqual({ attack: 1, health: 0 });
  });

  it('shows the NEW number at 1, leaving no entry behind', () => {
    holdStat('a', { attack: 4, health: 0 });
    revealStat('a', 1);
    expect(heldFor('a')).toBeNull();
    expect(anyStatHeld()).toBe(false);
  });

  it('is MONOTONIC — a counter never ticks backwards', () => {
    // Two effects can be mid-flight on one unit. A number that went forward then back would read as a bug
    // in the game's arithmetic, not as an animation.
    holdStat('a', { attack: 4, health: 0 });
    revealStat('a', 0.75);
    revealStat('a', 0.25);
    expect(heldFor('a')).toEqual({ attack: 1, health: 0 });
  });

  it('rolls a DEBUFF down as happily as a buff up', () => {
    holdStat('a', { attack: -4, health: 0 });
    revealStat('a', 0.5);
    expect(heldFor('a')).toEqual({ attack: -2, health: 0 });
  });

  it('reads as fully revealed once rounding leaves nothing — a +1 never sticks mid-step', () => {
    holdStat('a', { attack: 1, health: 0 });
    revealStat('a', 0.6);
    expect(heldFor('a')).toBeNull();
  });

  it('clamps out-of-range progress instead of inverting the roll', () => {
    holdStat('a', { attack: 4, health: 0 });
    revealStat('a', -5);
    expect(heldFor('a')).toEqual({ attack: 4, health: 0 });
    revealStat('a', 99);
    expect(heldFor('a')).toBeNull();
  });

  it('a NEW delta mid-roll restarts the reveal rather than carrying the fraction', () => {
    // The badge is now behind by the full new total; keeping the old fraction would silently reveal part of
    // a change nobody animated.
    holdStat('a', { attack: 4, health: 0 });
    revealStat('a', 0.5);
    holdStat('a', { attack: 4, health: 0 });
    expect(heldFor('a')).toEqual({ attack: 6, health: 0 }); // 2 still owed + 4 new, none revealed
  });

  it('is a no-op for a unit with nothing held', () => {
    expect(() => revealStat('nobody', 0.5)).not.toThrow();
    expect(heldFor('nobody')).toBeNull();
  });
});

describe('the reel', () => {
  it('gives a +1 change something to spin through', () => {
    // The case that made the honest roll invisible: nothing sits between 4 and 5, so the counter had two
    // states however long it ran. With a reel it moves.
    holdStat('a', { attack: 1, health: 0 });
    const seen = new Set<number>();
    for (let i = 1; i < 20; i++) {
      revealStat('a', i / 20, 6);
      seen.add(heldFor('a')?.attack ?? 0);
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it('still STARTS on the old number — the wobble is zero at t=0', () => {
    holdStat('a', { attack: 3, health: 0 });
    revealStat('a', 0.0001, 8);
    expect(heldFor('a')).toEqual({ attack: 3, health: 0 });
  });

  it('still LANDS on the new number, however wild the reel', () => {
    holdStat('a', { attack: 3, health: 0 });
    revealStat('a', 1, 12);
    expect(heldFor('a')).toBeNull();
  });

  it('reel 0 is the honest odometer — only values between old and new', () => {
    holdStat('a', { attack: 4, health: 0 });
    for (let i = 1; i < 10; i++) {
      revealStat('a', i / 10, 0);
      const r = heldFor('a')?.attack ?? 0;
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(4);
    }
  });

  it('a negative reel is treated as none rather than inverting the swing', () => {
    holdStat('a', { attack: 3, health: 0 });
    revealStat('a', 0.5, -9);
    expect(heldFor('a')?.attack).toBe(2); // the plain odometer value at halfway
  });
});

describe('a delivery schedule', () => {
  it('defaults to delivering immediately, with the standard roll', () => {
    holdStat('a', { attack: 2, health: 0 });
    expect(scheduleFor('a')).toEqual({ startAt: 0, rollMs: DEFAULT_ROLL_MS });
  });

  it('records a startAt as an offset from now', () => {
    holdStat('a', { attack: 2, health: 0 }, { startAt: 300, rollMs: 500 });
    expect(scheduleFor('a')).toEqual({ startAt: 300, rollMs: 500 });
  });

  /**
   * The TTL is what force-delivers a hold nobody claimed. A flat 1200ms would fire BEFORE the tail of a
   * long cascade was due — the failsafe undoing the feature it is protecting.
   */
  it('extends the TTL to cover a scheduled delivery', () => {
    holdStat('a', { attack: 2, health: 0 }, { startAt: 2000, rollMs: 500 });
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1500);
    expect(heldFor('a')).toEqual({ attack: 2, health: 0 });   // still alive past the old flat TTL
  });

  it('keeps the 1200ms floor for an unscheduled hold, so a react layer still has room to claim it', () => {
    holdStat('a', { attack: 2, health: 0 }, { startAt: 0, rollMs: 0 });
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1000);
    expect(heldFor('a')).toEqual({ attack: 2, health: 0 });
  });

  it('does expire once the schedule plus grace has passed', () => {
    holdStat('a', { attack: 2, health: 0 }, { startAt: 400, rollMs: 400 });
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + HOLD_TTL_MS + 1);
    expect(heldFor('a')).toBeNull();
  });
});

describe('the shared ticker', () => {
  /** rAF does not run under vitest, so the tests drive the exported step directly.
   *
   *  These holds are all explicitly `intrinsic` — the ticker's actual job is Card's fallback roll (Step 5
   *  gives it exactly this origin), and `holdStat`'s bare default is `effect`, which the ticker deliberately
   *  skips (see the "never advances" test below). Relying on the default here would test the wrong path —
   *  every one of these would silently no-op against the origin check rather than the startAt/rollMs math
   *  they're named for. */
  it('reveals nothing before startAt', () => {
    const t0 = performance.now();
    holdStat('a', { attack: 4, health: 0 }, { origin: 'intrinsic', startAt: 500, rollMs: 200 });
    vi.spyOn(performance, 'now').mockReturnValue(t0 + 100);
    stepHolds();
    expect(heldFor('a')).toEqual({ attack: 4, health: 0 });   // untouched
  });

  it('walks the reveal once startAt has passed', () => {
    const t0 = performance.now();
    holdStat('a', { attack: 4, health: 0 }, { origin: 'intrinsic', startAt: 100, rollMs: 400 });
    vi.spyOn(performance, 'now').mockReturnValue(t0 + 300);   // 200ms into a 400ms roll
    stepHolds();
    expect(heldFor('a')).toEqual({ attack: 2, health: 0 });
  });

  it('releases when the roll completes', () => {
    const t0 = performance.now();
    holdStat('a', { attack: 4, health: 0 }, { origin: 'intrinsic', startAt: 0, rollMs: 200 });
    vi.spyOn(performance, 'now').mockReturnValue(t0 + 200);
    stepHolds();
    expect(heldFor('a')).toBeNull();
    expect(anyStatHeld()).toBe(false);
  });

  /** A `cue` hold has no player of its own — unlike `effect`, nothing ever calls `revealStat` for it, so
   *  the ticker is the ONLY thing that can carry it from placed to delivered. Two production call sites
   *  now bet on that: the ruby cascade (`Recruit.tsx` ~884) and the fodder tendril (`Recruit.tsx` ~3032),
   *  both of which withhold at `origin: 'cue'` with no authored layer required to release them. This
   *  mirrors the `intrinsic` walk-the-reveal case above but on the origin those call sites actually use,
   *  so a future change that special-cased `cue` out of the ticker's path would fail here instead of only
   *  in the harness. */
  it('drives a cue hold to completion on its own — the automatic floor has no player behind it', () => {
    const t0 = performance.now();
    holdStat('a', { attack: 4, health: 0 }, { origin: 'cue', startAt: 300, rollMs: 200 });
    vi.spyOn(performance, 'now').mockReturnValue(t0 + 100);   // before startAt
    stepHolds();
    expect(heldFor('a')).toEqual({ attack: 4, health: 0 });   // untouched
    vi.spyOn(performance, 'now').mockReturnValue(t0 + 300 + 200);   // startAt + the full roll
    stepHolds();
    expect(heldFor('a')).toBeNull();   // delivered and released, with no react layer anywhere
    expect(anyStatHeld()).toBe(false);
  });

  /** An effect layer drives its own reveal off the player's clock; two clocks on one counter stutter.
   *
   *  The jump is 1000ms (well past the 200ms roll) rather than something past `HOLD_TTL_MS` (1200ms): past
   *  the floor, `heldFor`'s own expiry sweep deletes the hold independently of the ticker, and the test
   *  would pass for the wrong reason — a hold that's gone reads the same as one the ticker declined to
   *  touch. Staying under the floor isolates the claim this test actually makes. */
  it('never advances an effect-origin hold', () => {
    const t0 = performance.now();
    holdStat('a', { attack: 4, health: 0 }, { origin: 'effect', startAt: 0, rollMs: 200 });
    vi.spyOn(performance, 'now').mockReturnValue(t0 + 1000);
    stepHolds();
    expect(heldFor('a')).toEqual({ attack: 4, health: 0 });
  });

  it('emits once per step, not once per hold', () => {
    let notified = 0;
    holdStat('a', { attack: 4, health: 0 }, { origin: 'intrinsic', rollMs: 400 });
    holdStat('b', { attack: 4, health: 0 }, { origin: 'intrinsic', rollMs: 400 });
    const t0 = performance.now();
    const stop = subscribeStatHolds(() => { notified++; });
    vi.spyOn(performance, 'now').mockReturnValue(t0 + 200);
    stepHolds();
    expect(notified).toBe(1);
    stop();
  });
});
