import { describe, expect, it } from 'vitest';
import { loadStrengthReference, scoreBoard, type BoardSnapshot, type StrengthReference } from '@game/sim';
import { createStrengthScorer, STRENGTH_RUSH_BUDGET_MS, type IdleDeadlineLike, type StrengthScorerDeps } from './strengthScorer';

/**
 * THE RUN-END SCORING (strength v2, owner 2026-11-16): a run's final board is also scored against every later
 * reference round (its CARRIED scores), the work reports real progress in fights (the "Calculating Score" bar), and
 * at run end it leaves the idle queue for short frame-budgeted slices so the wait is a couple of seconds, not a
 * string of idle callbacks. `settled` still never waits past its cap.
 */
const refP = loadStrengthReference();
const boardOf = (ref: StrengthReference, w: number, i: number): BoardSnapshot => ({ ...ref.waves[String(w)]![i]!, wave: w, setId: ref.setId } as BoardSnapshot);
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function harness(over: Partial<StrengthScorerDeps> = {}) {
  let idle: ((d?: IdleDeadlineLike) => void) | null = null;
  let rush: (() => void) | null = null;
  let clock = 0;
  const counts = { idle: 0, rush: 0 };
  const scorer = createStrengthScorer({
    loadReference: () => refP,
    requestSlice: (fn) => { counts.idle++; idle = fn; return () => { idle = null; }; },
    requestRush: (fn) => { counts.rush++; rush = fn; return () => { rush = null; }; },
    setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
    now: () => clock++, // every reading of the clock costs 1 ms: a slice of fights visibly spends its budget
    ...over,
  });
  return {
    scorer, counts,
    tickIdle(d?: IdleDeadlineLike): boolean { const f = idle; idle = null; if (!f) return false; f(d); return true; },
    tickRush(): boolean { const f = rush; rush = null; if (!f) return false; f(); return true; },
    clock: () => clock,
  };
}

describe('carried scores', () => {
  it('queues one job per round from the final round + 1 to the last reference round, and scores each like the one-shot probe', async () => {
    const ref = await refP;
    const h = harness();
    const final = boardOf(ref, 12, 9);
    h.scorer.enqueue(5, final);
    h.scorer.enqueueCarried(5, final, 15);
    h.scorer.enqueueCarried(5, final, 15); // again: ignored
    expect(h.scorer.pending(5)).toBe(4); // the board itself + rounds 13, 14, 15
    h.tickIdle(); await flush(); // loads the reference
    expect(h.scorer.progress(5)).toEqual({ done: 0, total: 4 * 160 });
    while (h.tickIdle({ didTimeout: false, timeRemaining: () => 50 })) { /* drain */ }
    expect(h.scorer.pending(5)).toBe(0);
    expect(h.scorer.progress(5)).toEqual({ done: 640, total: 640 });
    expect(h.scorer.scores(5).get(12)).toEqual(scoreBoard(final, ref));
    expect([...h.scorer.carried(5).keys()].sort((a, b) => a - b)).toEqual([13, 14, 15]);
    for (const round of [13, 14, 15]) expect(h.scorer.carried(5).get(round)).toBe(scoreBoard(final, ref, round)!.raw);
    // A carried score never lands in the real scores.
    expect([...h.scorer.scores(5).keys()]).toEqual([12]);
  }, 30_000);

  it('an empty final board carries zeros at once, with no fight', async () => {
    const ref = await refP;
    const h = harness();
    h.scorer.enqueueCarried(6, { ...boardOf(ref, 7, 1), minions: [] }, 15);
    expect(h.scorer.pending(6)).toBe(0);
    expect([...h.scorer.carried(6)]).toEqual([8, 9, 10, 11, 12, 13, 14, 15].map((r) => [r, 0]));
    expect(h.scorer.fightsRun()).toBe(0);
    expect((await h.scorer.settled(6, 10_000)).size).toBe(0);
  });

  it('a run that reached the last reference round carries nothing', async () => {
    const ref = await refP;
    const h = harness();
    h.scorer.enqueueCarried(8, boardOf(ref, 15, 1), 15);
    expect(h.scorer.pending(8)).toBe(0);
    expect(h.scorer.carried(8).size).toBe(0);
  });

  it('forget drops the carried scores and the progress with the rest', async () => {
    const ref = await refP;
    const h = harness();
    h.scorer.enqueueCarried(9, { ...boardOf(ref, 13, 1), minions: [] }, 15);
    h.scorer.forget(9);
    expect(h.scorer.carried(9).size).toBe(0);
    expect(h.scorer.progress(9)).toEqual({ done: 0, total: 0 });
  });
});

describe('the run-end rush', () => {
  it('moves the run off the idle queue: frame-budgeted slices, each stopping within the budget', async () => {
    const ref = await refP;
    const h = harness();
    const final = boardOf(ref, 13, 4);
    h.scorer.enqueue(11, final);
    h.scorer.enqueueCarried(11, final, 15);
    h.tickIdle(); await flush(); // the reference is loaded on the idle path
    const idleBefore = h.counts.idle;
    h.scorer.rush(11);
    expect(h.counts.rush).toBeGreaterThan(0);
    let slices = 0;
    while (h.scorer.pending(11) > 0) {
      const start = h.clock();
      const before = h.scorer.fightsRun();
      expect(h.tickRush()).toBe(true);
      slices++;
      expect(h.scorer.fightsRun()).toBeGreaterThan(before);
      expect(h.clock() - start).toBeLessThanOrEqual(STRENGTH_RUSH_BUDGET_MS + 3);
    }
    expect(slices).toBeGreaterThan(10); // 480 fights were not run in one frame
    expect(h.counts.idle).toBe(idleBefore); // nothing went back to the idle queue
    expect(h.scorer.carried(11).size).toBe(2);
    expect(h.scorer.scores(11).get(13)).toEqual(scoreBoard(final, ref));
  }, 30_000);

  it('settled resolves on its cap with whatever is done, and never hangs', async () => {
    const ref = await refP;
    const h = harness();
    h.scorer.enqueue(12, boardOf(ref, 7, 3));
    h.scorer.enqueueCarried(12, boardOf(ref, 7, 3), 15);
    h.scorer.rush(12);
    const got = await h.scorer.settled(12, 30); // nobody runs the slices
    expect(got.size).toBe(0);
    expect(h.scorer.carried(12).size).toBe(0);
    expect(h.scorer.pending(12)).toBe(9);
  });

  it('a new game\'s first board ends an older game\'s rush: the leftover work goes back to idle time', async () => {
    const ref = await refP;
    const h = harness();
    h.scorer.enqueue(21, boardOf(ref, 9, 3));
    h.scorer.enqueueCarried(21, boardOf(ref, 9, 3), 15);
    h.scorer.rush(21);
    h.tickRush(); await flush(); // loads the reference
    h.tickRush();
    const rushBefore = h.counts.rush;
    const idleBefore = h.counts.idle;
    h.scorer.enqueue(22, boardOf(ref, 1, 2)); // the next game has begun: nothing may run in rushed slices under it
    h.tickRush(); // the slice already asked for still runs once
    for (let i = 0; i < 5; i++) h.tickIdle({ didTimeout: true, timeRemaining: () => 0 });
    expect(h.counts.rush - rushBefore).toBeLessThanOrEqual(1);
    expect(h.counts.idle).toBeGreaterThan(idleBefore);
    expect(h.scorer.pending(21)).toBeGreaterThan(0); // the old game's work is kept, not dropped
  }, 30_000);
});
