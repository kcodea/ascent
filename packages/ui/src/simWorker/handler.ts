/**
 * THE BRAIN OF THE SIM WORKER (perf pass 2026-11-18, R-PERF-SIM-WORKER-01): a plain function of messages, with no
 * Worker global in it, so the parity test runs it directly in Node.
 *
 * It runs the SAME pure probes the main thread used to run in idle slices (`createOddsProbe`,
 * `createStrengthProbe`), with the same seeds, so every result is byte-identical to the one-shot functions
 * (`computeCombatOdds`, `scoreBoard`). Pinned in `handler.test.ts`.
 *
 * A worker cannot be interrupted while it computes, so the work is cut into short chunks with a yield in between:
 * that is what lets a `cancel` (a new fight began, the run ended) get in. The odds go first (the player reads them);
 * boards are scored in the order they were asked for.
 */
import { createOddsProbe, createStrengthProbe, type OddsProbe, type StrengthProbe, type StrengthReference } from '@game/sim';
import type { SimWorkerReply, SimWorkerRequest } from './protocol';

/** The longest one chunk computes before it yields to the message queue (ms). */
export const SIM_WORKER_CHUNK_MS = 8;
/** A board's progress is posted at most this often (ms): the end screen's bar reads it ten times a second. */
export const SIM_WORKER_PROGRESS_MS = 50;

export interface SimWorkerHandlerDeps {
  post(reply: SimWorkerReply): void;
  /** Run `fn` as a later task, after any message already waiting. */
  defer(fn: () => void): void;
  now(): number;
  loadReference(): Promise<StrengthReference>;
  chunkMs?: number;
}

type Job =
  | { kind: 'odds'; id: number; probe: OddsProbe }
  | { kind: 'strength'; id: number; req: Extract<SimWorkerRequest, { t: 'strength' }>; probe: StrengthProbe | null; posted: number };

export interface SimWorkerHandler {
  onMessage(msg: SimWorkerRequest): void;
  /** Jobs waiting or in progress (tests). */
  pending(): number;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createSimWorkerHandler(deps: SimWorkerHandlerDeps): SimWorkerHandler {
  const jobs: Job[] = [];
  const chunkMs = deps.chunkMs ?? SIM_WORKER_CHUNK_MS;
  let ref: StrengthReference | null = null;
  let refFailed: string | null = null;
  let refLoading = false;
  let scheduled = false;

  const loadRef = (): void => {
    if (ref || refFailed !== null || refLoading) return;
    refLoading = true;
    deps.loadReference().then((r) => { ref = r; }, (e) => { refFailed = messageOf(e); }).finally(() => { refLoading = false; schedule(); });
  };
  const drop = (job: Job): void => { const i = jobs.indexOf(job); if (i >= 0) jobs.splice(i, 1); };

  /** The job to work on now: the first odds probe, else the first board (once the reference is in). */
  const next = (): Job | null => {
    const odds = jobs.find((j) => j.kind === 'odds');
    if (odds) return odds;
    const board = jobs.find((j) => j.kind === 'strength');
    if (!board) return null;
    if (ref) return board;
    if (refFailed !== null) {
      for (const j of jobs.filter((x) => x.kind === 'strength')) { drop(j); deps.post({ t: 'error', id: j.id, message: `strength reference: ${refFailed}` }); }
      return null;
    }
    loadRef();
    return null;
  };

  const pump = (): void => {
    scheduled = false;
    const job = next();
    if (!job) return;
    try {
      const start = deps.now();
      if (job.kind === 'odds') {
        let done = job.probe.done();
        while (!done) { done = job.probe.step(1); if (deps.now() - start >= chunkMs) break; }
        if (done) { drop(job); deps.post({ t: 'odds', id: job.id, odds: job.probe.result() }); }
      } else {
        const probe = (job.probe ??= createStrengthProbe(job.req.board, ref!, job.req.atRound));
        let done = probe.done();
        while (!done) { done = probe.step(1); if (deps.now() - start >= chunkMs) break; }
        if (done) { drop(job); deps.post({ t: 'strength', id: job.id, score: probe.result(), total: probe.total() }); }
        else if (deps.now() - job.posted >= SIM_WORKER_PROGRESS_MS) { job.posted = deps.now(); deps.post({ t: 'progress', id: job.id, done: probe.progress(), total: probe.total() }); }
      }
    } catch (e) {
      drop(job);
      deps.post({ t: 'error', id: job.id, message: messageOf(e) });
    }
    schedule();
  };

  function schedule(): void {
    if (scheduled || jobs.length === 0) return;
    scheduled = true;
    deps.defer(pump);
  }

  return {
    onMessage(msg) {
      switch (msg.t) {
        case 'hello': deps.post({ t: 'ready' }); return;
        case 'warm': loadRef(); return;
        case 'cancel': { const job = jobs.find((j) => j.id === msg.id); if (job) drop(job); return; }
        case 'odds':
          try { jobs.push({ kind: 'odds', id: msg.id, probe: createOddsProbe(msg.input, msg.seed, msg.wave, msg.sims, msg.cap) }); }
          catch (e) { deps.post({ t: 'error', id: msg.id, message: messageOf(e) }); }
          schedule();
          return;
        case 'strength':
          jobs.push({ kind: 'strength', id: msg.id, req: msg, probe: null, posted: deps.now() });
          schedule();
          return;
      }
    },
    pending: () => jobs.length,
  };
}
