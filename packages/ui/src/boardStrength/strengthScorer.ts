/**
 * BOARD STRENGTH, SCORED IN THE BACKGROUND (owner design 2026-09-30, R-LOBBY-09).
 *
 * Every board a rated lobby captures (one per round) is scored against the frozen reference set of its wave: ~60
 * seeded fights (`createStrengthProbe`, packages/sim/src/lobby/boardStrength.ts). Measured in node on the live pool:
 * 0.42 ms per fight on average (0.6-0.9 ms in the busiest middle waves), so a board is ~25-50 ms of work and a whole
 * run ~0.5 s. None of it may land on a frame the player is waiting for (performance is the north star), so the work
 * is RESUMABLE and runs in idle slices, like the odds probe:
 *
 *  - each slice runs `STRENGTH_SLICE_FIGHTS` fights, then keeps going only while the idle deadline has more than
 *    `STRENGTH_YIELD_MS` left (a slice is a few ms even late in a game);
 *  - `requestIdleCallback` with a timeout, so a busy combat replay cannot starve it forever;
 *  - a board is queued the moment it is captured (End Turn), so by the time the game ends every board but the last
 *    one is long done, and the last one was scored during its own combat animation.
 *
 * `settled(seed, maxWaitMs)` is what the run-end block waits on before it uploads: it resolves at once when the
 * work is done, and never later than `maxWaitMs`, after which the upload goes out with what is ready (a board with
 * no score is simply unscored). The reference set is loaded lazily on first use (its own chunk).
 */
import { createStrengthProbe, type BoardSnapshot, type StrengthProbe, type StrengthReference, type StrengthScore } from '@game/sim';

/** Fights per uninterruptible step. */
export const STRENGTH_SLICE_FIGHTS = 4;
/** Keep stepping only while the idle deadline has more than this left (ms). */
export const STRENGTH_YIELD_MS = 4;
/** rIC timeout per slice: a saturated main thread still drains one step this often. */
export const STRENGTH_SLICE_TIMEOUT_MS = 250;

export interface IdleDeadlineLike { didTimeout: boolean; timeRemaining(): number }

export interface StrengthScorerDeps {
  loadReference(): Promise<StrengthReference>;
  /** Schedule one idle slice (rIC in the app, a fake in tests). Returns a cancel function. */
  requestSlice(fn: (deadline?: IdleDeadlineLike) => void): () => void;
  /** A plain timer for `settled`'s cap. */
  setTimer(fn: () => void, ms: number): () => void;
  /** Wrap a slice for the perf monitor (optional). */
  measure?<T>(label: string, fn: () => T): T;
}

interface Job { seed: number; wave: number; board: BoardSnapshot; probe: StrengthProbe | null }

export interface StrengthScorer {
  /** Queue a board of the run `seed` (one per wave; a wave already queued or scored is ignored). */
  enqueue(seed: number, board: BoardSnapshot): void;
  /** The scores so far, by wave. */
  scores(seed: number): ReadonlyMap<number, StrengthScore>;
  /** Boards of this run still waiting or in progress. */
  pending(seed: number): number;
  /** Resolve with the run's scores once nothing is pending, or after `maxWaitMs`, whichever comes first. */
  settled(seed: number, maxWaitMs: number): Promise<ReadonlyMap<number, StrengthScore>>;
  /** Drop a finished run's work and results. */
  forget(seed: number): void;
  /** Fights run since creation (tests, the perf note). */
  fightsRun(): number;
}

export function createStrengthScorer(deps: StrengthScorerDeps): StrengthScorer {
  const queue: Job[] = [];
  const results = new Map<number, Map<number, StrengthScore>>();
  const done = new Map<number, Set<number>>(); // waves finished (scored or unscorable), per run
  const waiters = new Set<{ seed: number; resolve: () => void }>();
  let ref: StrengthReference | null = null;
  let refFailed = false;
  let refLoading: Promise<void> | null = null;
  let scheduled = false;
  let fights = 0;

  const has = (seed: number, wave: number): boolean =>
    !!done.get(seed)?.has(wave) || queue.some((j) => j.seed === seed && j.wave === wave);
  const markDone = (seed: number, wave: number): void => {
    const d = done.get(seed) ?? new Set<number>();
    d.add(wave);
    done.set(seed, d);
  };
  const pending = (seed: number): number => queue.filter((j) => j.seed === seed).length;
  const wake = (): void => {
    for (const w of [...waiters]) if (pending(w.seed) === 0) { waiters.delete(w); w.resolve(); }
  };

  const slice = (deadline?: IdleDeadlineLike): void => {
    scheduled = false;
    if (!ref) {
      if (refFailed) { for (const j of queue.splice(0)) markDone(j.seed, j.wave); wake(); return; }
      refLoading ??= deps.loadReference().then((r) => { ref = r; }, () => { refFailed = true; }).finally(() => { refLoading = null; schedule(); });
      return;
    }
    const run = (): void => {
      let budget = true;
      while (queue.length > 0 && budget) {
        const job = queue[0]!;
        job.probe ??= createStrengthProbe(job.board, ref!);
        const before = job.probe.progress();
        let finished = job.probe.step(STRENGTH_SLICE_FIGHTS);
        fights += job.probe.progress() - before;
        while (!finished && deadline && !deadline.didTimeout && deadline.timeRemaining() > STRENGTH_YIELD_MS) {
          const b = job.probe.progress();
          finished = job.probe.step(STRENGTH_SLICE_FIGHTS);
          fights += job.probe.progress() - b;
        }
        if (finished) {
          queue.shift();
          const score = job.probe.result();
          if (score) {
            const m = results.get(job.seed) ?? new Map<number, StrengthScore>();
            m.set(job.wave, score);
            results.set(job.seed, m);
          }
          markDone(job.seed, job.wave);
        }
        // One step per timed-out (or deadline-less) slice; otherwise continue into the next board while idle lasts.
        budget = !!deadline && !deadline.didTimeout && deadline.timeRemaining() > STRENGTH_YIELD_MS;
      }
    };
    if (deps.measure) deps.measure('strength:slice', run); else run();
    wake();
    schedule();
  };

  function schedule(): void {
    if (scheduled || queue.length === 0 || refLoading) return;
    scheduled = true;
    deps.requestSlice(slice);
  }

  return {
    enqueue(seed, board) {
      // An empty board has nothing to score (and is never uploaded): never queue it, so it can never hold up the
      // run end either.
      if (!board || typeof board.wave !== 'number' || !board.minions?.length || has(seed, board.wave)) return;
      queue.push({ seed, wave: board.wave, board, probe: null });
      schedule();
    },
    scores: (seed) => results.get(seed) ?? new Map(),
    pending,
    settled(seed, maxWaitMs) {
      if (pending(seed) === 0) return Promise.resolve(results.get(seed) ?? new Map());
      return new Promise((resolve) => {
        const w = { seed, resolve: () => { cancel(); resolve(results.get(seed) ?? new Map()); } };
        const cancel = deps.setTimer(() => { if (waiters.delete(w)) resolve(results.get(seed) ?? new Map()); }, maxWaitMs);
        waiters.add(w);
      });
    },
    forget(seed) {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.seed === seed) queue.splice(i, 1);
      results.delete(seed);
      done.delete(seed);
      wake();
    },
    fightsRun: () => fights,
  };
}
