/**
 * SIZE EACH ODDS-PROBE STEP BY ITS MEASURED COST (mobile perf pass, 2026-10-18).
 *
 * The Combat Summary's odds are a 200-sim Monte Carlo that `Recruit.tsx` runs in idle-time slices
 * (`createOddsProbe`, 2026-09-16). A step cannot be interrupted, and every step was a fixed 10 sims. A late-game
 * 7v7 sim costs far more than an early one, and a phone is several times slower than the owner's desktop, so a
 * single 10-sim step measured 59 ms on the headless 4x-throttled iPhone run (the `odds:deferred` worst call in
 * the combat warm-up) and was a long task on its own. On the 240 Hz desktop the same step was several frame
 * budgets. A step that the rIC timeout forces mid-replay is the worst case: it lands inside a busy frame.
 *
 * The stepper learns the per-sim cost from the steps it has run and sizes the next one to about `targetMs`, never
 * fewer than one sim (a single sim is the smallest unit of work) and never more than `maxSims`. The sims, their
 * seeds and their fold order are untouched, so the result is byte-identical to the one-shot probe however it is
 * sliced (pinned in `packages/sim/src/odds.test.ts`).
 */
export interface SteppableProbe {
  step(n: number): boolean;
}

export interface OddsStepper {
  /** Run one cost-sized step. True when the probe has finished. */
  step(): boolean;
  /** The size the next step will be (sims). */
  nextSize(): number;
}

export function createOddsStepper(
  probe: SteppableProbe,
  now: () => number,
  targetMs = 2,
  maxSims = 10,
): OddsStepper {
  let perSimMs = 0; // smoothed measured cost of one sim; 0 = unknown yet
  const nextSize = (): number => {
    if (perSimMs <= 0) return 1; // first step: measure on the smallest unit
    return Math.max(1, Math.min(maxSims, Math.floor(targetMs / perSimMs)));
  };
  return {
    nextSize,
    step(): boolean {
      const n = nextSize();
      const t = now();
      const done = probe.step(n);
      const per = (now() - t) / n;
      if (Number.isFinite(per) && per >= 0) perSimMs = perSimMs > 0 ? perSimMs * 0.5 + per * 0.5 : per;
      return done;
    },
  };
}
