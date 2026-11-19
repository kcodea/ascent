/**
 * THE PAGE SIDE OF THE SIM WORKER (perf pass 2026-11-18, R-PERF-SIM-WORKER-01).
 *
 * One worker for the session, created lazily (the first prewarm or the first job) and kept alive. Every caller
 * gets either a job handle or `null`; `null`, or a rejected job, means "run it yourself": the callers
 * (`backgroundOdds.ts`, `boardStrength/strengthScorer.ts`) then fall back to the idle-sliced main-thread path, so
 * nothing ever breaks where there is no Worker (tests, jsdom), where the chunk cannot load, or when a job throws.
 *
 * FAILURE IS STICKY. A worker that errors, cannot be created, or never answers the opening `hello` within
 * `readyTimeoutMs` is terminated and never retried this session: every job in flight is rejected and every later
 * call returns `null`.
 *
 * CANCELLATION is by job id: `cancel()` drops the page-side entry at once (a late reply for that id is ignored)
 * and tells the worker to drop the job between two of its chunks.
 */
import type { BoardSnapshot, CombatOdds, StrengthScore } from '@game/sim';
import type { OddsRequest, SimWorkerReply, SimWorkerRequest } from './protocol';

/** The slice of the Worker interface the client uses (a fake in tests). */
export interface SimWorkerLike {
  postMessage(msg: SimWorkerRequest): void;
  terminate(): void;
  onmessage: ((e: { data: SimWorkerReply }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror: ((e: unknown) => void) | null;
}

export interface SimJob<T> { promise: Promise<T>; cancel(): void }
export interface StrengthResult { score: StrengthScore | null; total: number }

export interface SimWorkerClient {
  /** Is the worker usable (not failed, and creatable here)? Creates nothing. */
  available(): boolean;
  /** Create the worker now and have it load the strength reference. False when there is no worker. */
  prewarm(): boolean;
  odds(req: OddsRequest): SimJob<CombatOdds> | null;
  strength(board: BoardSnapshot, atRound: number | undefined, onProgress?: (done: number, total: number) => void): SimJob<StrengthResult> | null;
  /** Jobs in flight (tests). */
  inFlight(): number;
}

export interface SimWorkerClientOptions {
  /** How long the worker has to answer the opening `hello` before it is written off (ms). */
  readyTimeoutMs?: number;
  setTimer?(fn: () => void, ms: number): () => void;
}

/** Long enough for a slow phone to fetch and compile the chunk; short enough that a dead worker is noticed
 *  within the first fight. */
export const SIM_WORKER_READY_TIMEOUT_MS = 10_000;

interface Pending { resolve(v: unknown): void; reject(e: Error): void; onProgress?: (done: number, total: number) => void }

export function createSimWorkerClient(spawn: () => SimWorkerLike | null, opts: SimWorkerClientOptions = {}): SimWorkerClient {
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number): (() => void) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
  const pending = new Map<number, Pending>();
  let worker: SimWorkerLike | null = null;
  let failed = false;
  let nextId = 1;
  let cancelReadyTimer: (() => void) | null = null;

  const fail = (why: string): void => {
    if (failed) return;
    failed = true;
    cancelReadyTimer?.();
    cancelReadyTimer = null;
    try { worker?.terminate(); } catch { /* already gone */ }
    worker = null;
    const err = new Error(`sim worker: ${why}`);
    // Said once, so a slow-combat report can be told apart from a worker that never came up.
    console.warn(`[sim worker] ${why}: background sims run on the page for the rest of this session`);
    for (const p of [...pending.values()]) p.reject(err);
    pending.clear();
  };

  const onReply = (msg: SimWorkerReply): void => {
    if (msg.t === 'ready') { cancelReadyTimer?.(); cancelReadyTimer = null; return; }
    const p = pending.get(msg.id);
    if (!p) return; // cancelled, or a reply that outlived its job
    if (msg.t === 'progress') { p.onProgress?.(msg.done, msg.total); return; }
    pending.delete(msg.id);
    if (msg.t === 'odds') p.resolve(msg.odds);
    else if (msg.t === 'strength') p.resolve({ score: msg.score, total: msg.total } satisfies StrengthResult);
    else p.reject(new Error(`sim worker job: ${msg.message}`));
  };

  const ensure = (): SimWorkerLike | null => {
    if (failed) return null;
    if (worker) return worker;
    try {
      const w = spawn();
      if (!w) { failed = true; return null; }
      worker = w;
      w.onmessage = (e) => onReply(e.data);
      w.onerror = () => fail('error event');
      w.onmessageerror = () => fail('message could not be read');
      cancelReadyTimer = setTimer(() => fail('never became ready'), opts.readyTimeoutMs ?? SIM_WORKER_READY_TIMEOUT_MS);
      w.postMessage({ t: 'hello' });
    } catch {
      fail('could not start');
    }
    return worker;
  };

  /** Post a job. Null when there is no worker or the request cannot be posted (it is then the caller's to run). */
  const submit = <T>(make: (id: number) => SimWorkerRequest, onProgress?: Pending['onProgress']): SimJob<T> | null => {
    const w = ensure();
    if (!w) return null;
    const id = nextId++;
    try { w.postMessage(make(id)); }
    catch { return null; } // not structured-cloneable: the worker is fine, this one request is not
    const promise = new Promise<T>((resolve, reject) => { pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress }); });
    return {
      promise,
      cancel: () => {
        if (!pending.delete(id)) return;
        try { worker?.postMessage({ t: 'cancel', id }); } catch { /* the worker is gone */ }
      },
    };
  };

  return {
    available: () => !failed,
    prewarm() {
      const w = ensure();
      if (!w) return false;
      try { w.postMessage({ t: 'warm' }); } catch { fail('could not post'); }
      return !failed;
    },
    odds: (req) => submit<CombatOdds>((id) => ({ t: 'odds', id, ...req })),
    strength: (board, atRound, onProgress) => submit<StrengthResult>((id) => ({ t: 'strength', id, board, ...(atRound === undefined ? {} : { atRound }) }), onProgress),
    inFlight: () => pending.size,
  };
}

/** The triage switch: `localStorage['ascent:simWorker'] = 'off'` keeps every background sim on the main thread. */
function switchedOff(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('ascent:simWorker') === 'off'; } catch { return false; }
}

let shared: SimWorkerClient | null = null;

/** The session worker. Vite bundles the entry as its own module chunk (`worker.format: 'es'`, relative `base`). */
export function simWorker(): SimWorkerClient {
  shared ??= createSimWorkerClient(() => {
    if (typeof Worker !== 'function' || switchedOff()) return null;
    return new Worker(new URL('./simWorker.entry.ts', import.meta.url), { type: 'module', name: 'ascent-sim' }) as unknown as SimWorkerLike;
  });
  return shared;
}

/** Start the worker ahead of the first fight (boot warm-up on desktop, the first shop everywhere). */
export function prewarmSimWorker(): boolean {
  return simWorker().prewarm();
}
