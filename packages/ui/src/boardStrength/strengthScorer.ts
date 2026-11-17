/**
 * BOARD STRENGTH, SCORED IN THE BACKGROUND (owner design 2026-09-30, R-LOBBY-09; strength v2 2026-11-16).
 *
 * Every board a rated lobby captures (one per round) is scored against the frozen reference set of its round: 160
 * seeded fights since reference set2-v2 (`createStrengthProbe`, packages/sim/src/lobby/boardStrength.ts). Measured in
 * node on the live pool: about 0.9 ms per fight, so a board is ~140 ms of work. None of it may land on a frame the
 * player is waiting for (performance is the north star), so the work is RESUMABLE and runs in idle slices, like the
 * odds probe:
 *
 *  - each slice runs `STRENGTH_SLICE_FIGHTS` fights, then keeps going only while the idle deadline has more than
 *    `STRENGTH_YIELD_MS` left (a slice is a few ms even late in a game);
 *  - `requestIdleCallback` with a timeout, so a busy combat replay cannot starve it forever;
 *  - a board is queued the moment it is captured (End Turn), so by the time the game ends every board but the last
 *    one is long done.
 *
 * CARRIED SCORES (strength v2): a run whose recording has ended keeps fielding its final board, so at run end that
 * board is also scored against every later reference round (`enqueueCarried`), up to 8 rounds x 160 fights for a
 * run that ends on round 7. That is the work the end screen's "Calculating Score" bar shows (`progress`, in real
 * fights). To keep the wait to a second or two, `rush(seed)` takes that run off the idle queue: its jobs then run in
 * short slices of at most `STRENGTH_RUSH_BUDGET_MS`, back to back with a yield in between, so no single task holds a
 * frame.
 *
 * `settled(seed, maxWaitMs)` is what the run-end block waits on before it uploads: it resolves at once when the
 * work is done, and never later than `maxWaitMs`, after which the upload goes out with what is ready (a run missing
 * a score is simply unscored). The reference set is loaded lazily on first use (its own chunk).
 */
import { createStrengthProbe, type BoardSnapshot, type StrengthProbe, type StrengthReference, type StrengthScore } from '@game/sim';

/** Fights per uninterruptible step. */
export const STRENGTH_SLICE_FIGHTS = 4;
/** Keep stepping only while the idle deadline has more than this left (ms). */
export const STRENGTH_YIELD_MS = 4;
/** rIC timeout per slice: a saturated main thread still drains one step this often. */
export const STRENGTH_SLICE_TIMEOUT_MS = 250;
/** The longest one rushed slice works before it yields (ms): well inside a 16.7 ms frame. */
export const STRENGTH_RUSH_BUDGET_MS = 6;
/** Fights assumed for a job before the reference has loaded (40 reference boards x 4 fights). */
const ASSUMED_JOB_FIGHTS = 160;

export interface IdleDeadlineLike { didTimeout: boolean; timeRemaining(): number }

export interface StrengthScorerDeps {
  loadReference(): Promise<StrengthReference>;
  /** Schedule one idle slice (rIC in the app, a fake in tests). Returns a cancel function. */
  requestSlice(fn: (deadline?: IdleDeadlineLike) => void): () => void;
  /** Schedule one RUSHED slice: as soon as the browser has had a turn (a zero timer in the app). Without it a
   *  rushed run stays on the idle queue. */
  requestRush?(fn: () => void): () => void;
  /** A plain timer for `settled`'s cap. */
  setTimer(fn: () => void, ms: number): () => void;
  /** The clock a rushed slice budgets against (ms). Default `performance.now()`. */
  now?(): number;
  /** Wrap a slice for the perf monitor (optional). */
  measure?<T>(label: string, fn: () => T): T;
}

/** `atRound` set = a CARRIED job: the final board scored against that later round. */
interface Job { seed: number; wave: number; atRound?: number; board: BoardSnapshot; probe: StrengthProbe | null }

export interface StrengthScorer {
  /** Queue a board of the run `seed` (one per wave; a wave already queued or scored is ignored). */
  enqueue(seed: number, board: BoardSnapshot): void;
  /** Queue the run's FINAL board against every round after its own, up to `toRound` (the last reference round).
   *  An empty final board carries 0 for each, at once, with no fight. */
  enqueueCarried(seed: number, finalBoard: BoardSnapshot, toRound: number): void;
  /** The scores so far, by wave. */
  scores(seed: number): ReadonlyMap<number, StrengthScore>;
  /** The carried raw scores so far, by round. */
  carried(seed: number): ReadonlyMap<number, number>;
  /** Boards and carried rounds of this run still waiting or in progress. */
  pending(seed: number): number;
  /** Fights done and fights in all for this run (real boards and carried rounds), for a progress bar. */
  progress(seed: number): { done: number; total: number };
  /** Run this run's remaining work in short back-to-back slices instead of idle time (the run has ended). */
  rush(seed: number): void;
  /** Resolve with the run's scores once nothing is pending, or after `maxWaitMs`, whichever comes first. */
  settled(seed: number, maxWaitMs: number): Promise<ReadonlyMap<number, StrengthScore>>;
  /** Drop a finished run's work and results. */
  forget(seed: number): void;
  /** Fights run since creation (tests, the perf note). */
  fightsRun(): number;
}

const NO_SCORES: ReadonlyMap<number, StrengthScore> = new Map();
const NO_CARRIED: ReadonlyMap<number, number> = new Map();

export function createStrengthScorer(deps: StrengthScorerDeps): StrengthScorer {
  const queue: Job[] = [];
  const results = new Map<number, Map<number, StrengthScore>>();
  const carriedBy = new Map<number, Map<number, number>>();
  const done = new Map<number, Set<string>>(); // jobs finished (scored or unscorable), per run
  const fightsDone = new Map<number, number>(); // fights of FINISHED jobs, per run
  const rushed = new Set<number>();
  const waiters = new Set<{ seed: number; resolve: () => void }>();
  let ref: StrengthReference | null = null;
  let refFailed = false;
  let refLoading: Promise<void> | null = null;
  let scheduled = false;
  let scheduledRush = false;
  let cancelScheduled: (() => void) | null = null;
  let fights = 0;
  const now = deps.now ?? ((): number => performance.now());

  const keyOf = (wave: number, atRound?: number): string => (atRound === undefined ? `w${wave}` : `c${atRound}`);
  const has = (seed: number, key: string): boolean =>
    !!done.get(seed)?.has(key) || queue.some((j) => j.seed === seed && keyOf(j.wave, j.atRound) === key);
  const markDone = (seed: number, key: string): void => {
    const d = done.get(seed) ?? new Set<string>();
    d.add(key);
    done.set(seed, d);
  };
  const pending = (seed: number): number => queue.filter((j) => j.seed === seed).length;
  const wake = (): void => {
    for (const w of [...waiters]) if (pending(w.seed) === 0) { waiters.delete(w); w.resolve(); }
  };
  const probeOf = (job: Job): StrengthProbe => (job.probe ??= createStrengthProbe(job.board, ref!, job.atRound));
  const rushing = (): boolean => !!deps.requestRush && queue.some((j) => rushed.has(j.seed));

  /** Step the job a few fights. True when it finished (and was taken off the queue). */
  const stepJob = (job: Job): boolean => {
    const probe = probeOf(job);
    const before = probe.progress();
    const finished = probe.step(STRENGTH_SLICE_FIGHTS);
    fights += probe.progress() - before;
    if (!finished) return false;
    queue.splice(queue.indexOf(job), 1);
    const score = probe.result();
    if (score) {
      if (job.atRound === undefined) {
        const m = results.get(job.seed) ?? new Map<number, StrengthScore>();
        m.set(job.wave, score);
        results.set(job.seed, m);
      } else {
        const m = carriedBy.get(job.seed) ?? new Map<number, number>();
        m.set(job.atRound, score.raw);
        carriedBy.set(job.seed, m);
      }
    }
    fightsDone.set(job.seed, (fightsDone.get(job.seed) ?? 0) + probe.total());
    markDone(job.seed, keyOf(job.wave, job.atRound));
    return true;
  };

  /** The reference, or false while it loads (the load reschedules). Null jobs when it cannot load. */
  const ready = (): boolean => {
    if (ref) return true;
    if (refFailed) {
      for (const j of queue.splice(0)) markDone(j.seed, keyOf(j.wave, j.atRound));
      wake();
      return false;
    }
    refLoading ??= deps.loadReference().then((r) => { ref = r; }, () => { refFailed = true; }).finally(() => { refLoading = null; schedule(); });
    return false;
  };

  const slice = (deadline?: IdleDeadlineLike): void => {
    scheduled = false;
    if (!ready()) return;
    const run = (): void => {
      let budget = true;
      while (queue.length > 0 && budget) {
        const job = queue[0]!;
        let finished = stepJob(job);
        while (!finished && deadline && !deadline.didTimeout && deadline.timeRemaining() > STRENGTH_YIELD_MS) finished = stepJob(job);
        // One step per timed-out (or deadline-less) slice; otherwise continue into the next board while idle lasts.
        budget = !!deadline && !deadline.didTimeout && deadline.timeRemaining() > STRENGTH_YIELD_MS;
      }
    };
    if (deps.measure) deps.measure('strength:slice', run); else run();
    wake();
    schedule();
  };

  /** A rushed slice: the rushed runs' jobs only, for at most the budget. */
  const rushSlice = (): void => {
    scheduled = false;
    if (!ready()) return;
    const run = (): void => {
      const start = now();
      for (;;) {
        const job = queue.find((j) => rushed.has(j.seed));
        if (!job) break;
        stepJob(job);
        if (now() - start >= STRENGTH_RUSH_BUDGET_MS) break;
      }
    };
    if (deps.measure) deps.measure('strength:rush', run); else run();
    wake();
    schedule();
  };

  function schedule(): void {
    if (scheduled || queue.length === 0 || refLoading) return;
    scheduled = true;
    scheduledRush = rushing();
    cancelScheduled = scheduledRush ? deps.requestRush!(rushSlice) : deps.requestSlice(slice);
  }

  return {
    enqueue(seed, board) {
      // An empty board has nothing to score (and is never uploaded): never queue it, so it can never hold up the
      // run end either.
      if (!board || typeof board.wave !== 'number' || !board.minions?.length || has(seed, keyOf(board.wave))) return;
      queue.push({ seed, wave: board.wave, board, probe: null });
      schedule();
    },
    enqueueCarried(seed, finalBoard, toRound) {
      if (!finalBoard || typeof finalBoard.wave !== 'number') return;
      for (let round = finalBoard.wave + 1; round <= toRound; round++) {
        const key = keyOf(finalBoard.wave, round);
        if (has(seed, key)) continue;
        if (!finalBoard.minions?.length) {
          // An empty board loses every fight: raw 0, no fight run.
          const m = carriedBy.get(seed) ?? new Map<number, number>();
          m.set(round, 0);
          carriedBy.set(seed, m);
          markDone(seed, key);
          continue;
        }
        queue.push({ seed, wave: finalBoard.wave, atRound: round, board: finalBoard, probe: null });
      }
      schedule();
    },
    scores: (seed) => results.get(seed) ?? NO_SCORES,
    carried: (seed) => carriedBy.get(seed) ?? NO_CARRIED,
    pending,
    progress(seed) {
      let doneFights = fightsDone.get(seed) ?? 0;
      let total = doneFights;
      for (const j of queue) {
        if (j.seed !== seed) continue;
        const probe = ref ? probeOf(j) : null;
        doneFights += probe ? probe.progress() : 0;
        total += probe ? probe.total() : ASSUMED_JOB_FIGHTS;
      }
      return { done: doneFights, total };
    },
    rush(seed) {
      rushed.add(seed);
      // A slice already waiting on the idle queue could sit there for a while: take it back and ask for a rushed one.
      if (scheduled && !scheduledRush && rushing()) { cancelScheduled?.(); scheduled = false; }
      schedule();
    },
    settled(seed, maxWaitMs) {
      if (pending(seed) === 0) return Promise.resolve(results.get(seed) ?? NO_SCORES);
      return new Promise((resolve) => {
        const w = { seed, resolve: () => { cancel(); resolve(results.get(seed) ?? NO_SCORES); } };
        const cancel = deps.setTimer(() => { if (waiters.delete(w)) resolve(results.get(seed) ?? NO_SCORES); }, maxWaitMs);
        waiters.add(w);
      });
    },
    forget(seed) {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.seed === seed) queue.splice(i, 1);
      results.delete(seed);
      carriedBy.delete(seed);
      done.delete(seed);
      fightsDone.delete(seed);
      rushed.delete(seed);
      wake();
    },
    fightsRun: () => fights,
  };
}
