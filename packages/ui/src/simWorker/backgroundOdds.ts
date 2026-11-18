/**
 * THE ODDS PROBE, IN THE BACKGROUND (perf pass 2026-11-18, R-PERF-SIM-WORKER-01).
 *
 * The Combat Summary's odds are a 200-sim Monte Carlo of the fight that is about to play. It used to run on the
 * main thread in idle slices, during the combat replay: 40-125 ms a round early, 190-790 ms from round 6 on. It now
 * runs in the sim worker; the page only posts the input and receives the six numbers.
 *
 * THE FALLBACK is the old idle-sliced path (no Worker here, the worker failed, or this job threw in it), with one
 * change: a slice the browser had to FORCE (`didTimeout`: no idle time for the whole timeout) runs nothing and
 * asks again. The odds are read after the fight, and the moment the replay leaves a gap the probe runs in it, so
 * nothing is ever pushed into a busy frame. Steps stay sized by measured cost (`oddsStepper.ts`).
 *
 * Either path gives the same numbers, byte for byte: the same probe, the same seeds, the same fold order.
 */
import { COMBAT_ODDS_SIMS, createOddsProbe, type CombatOdds } from '@game/sim';
import { createOddsStepper } from '../oddsStepper';
import { perfMonitor } from '../perfMonitor';
import { simWorker, type SimWorkerClient } from './client';
import type { OddsRequest } from './protocol';

const ODDS_STEP_TARGET_MS = 2;     // aim each main-thread step at ~2 ms (one sim minimum, ten maximum)
const ODDS_YIELD_MS = 4;           // keep stepping only while the idle deadline has more than this left
const ODDS_SLICE_TIMEOUT_MS = 200; // how long an idle callback waits before the browser forces it (it then runs nothing)
const ODDS_FALLBACK_MS = 32;       // no requestIdleCallback at all: one step every couple of frames

export interface BackgroundOddsOptions {
  /** The worker client (default: the session worker). */
  client?: Pick<SimWorkerClient, 'odds'> | null;
  /** The probe could not run at all (content this build can no longer instantiate). */
  onError?(e: unknown): void;
}

/** Run the probe off the main thread and hand the result to `onDone`. Returns a cancel function. */
export function runBackgroundOdds(req: Omit<OddsRequest, 'sims'> & { sims?: number }, onDone: (odds: CombatOdds) => void, opts: BackgroundOddsOptions = {}): () => void {
  const full: OddsRequest = { ...req, sims: req.sims ?? COMBAT_ODDS_SIMS };
  let cancelled = false;
  let cancelCurrent: (() => void) | null = null;

  const runLocal = (): void => {
    let probe: ReturnType<typeof createOddsProbe>;
    try { probe = createOddsProbe(full.input, full.seed, full.wave, full.sims, full.cap); }
    catch (e) { queueMicrotask(() => { if (!cancelled) opts.onError?.(e); }); return; } // never before this function has returned
    const stepper = createOddsStepper(probe, () => performance.now(), ODDS_STEP_TARGET_MS);
    const hasRIC = typeof requestIdleCallback === 'function';
    let idleId = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const schedule = (): void => {
      if (hasRIC) idleId = requestIdleCallback(slice, { timeout: ODDS_SLICE_TIMEOUT_MS });
      else timerId = setTimeout(() => slice(), ODDS_FALLBACK_MS);
    };
    const slice = (deadline?: IdleDeadline): void => {
      if (cancelled) return;
      // Forced by the timeout: the thread is busy (a replay is playing). Never work in that frame.
      if (deadline?.didTimeout) { schedule(); return; }
      let done = false;
      try {
        done = perfMonitor.measure('odds:deferred', () => {
          let finished = stepper.step();
          while (!finished && deadline && deadline.timeRemaining() > ODDS_YIELD_MS) finished = stepper.step();
          return finished;
        });
      } catch (e) { opts.onError?.(e); return; }
      if (done) { onDone(probe.result()); return; }
      schedule();
    };
    cancelCurrent = () => {
      if (idleId && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleId);
      if (timerId !== null) clearTimeout(timerId);
    };
    schedule();
  };

  const client = opts.client === undefined ? simWorker() : opts.client;
  const job = client?.odds(full) ?? null;
  if (job) {
    cancelCurrent = job.cancel;
    job.promise.then(
      (odds) => { if (!cancelled) onDone(odds); },
      () => { if (!cancelled) runLocal(); }, // the worker failed or this job threw there: the page runs it
    );
  } else runLocal();

  return () => { cancelled = true; cancelCurrent?.(); };
}
