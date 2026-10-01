/**
 * THE ASSET QUEUE — one priority-ordered, concurrency-limited scheduler for every byte the game pulls over the
 * network after boot (art + sampled SFX). Owner report 2026-09-29: friends on the Netlify build saw cards "pop
 * in" on every fresh shop. Measured cause (see docs/devlog/2026-09-29-art-pop-in.md): the old warm-up fired
 * ~650 image requests AND ~430 audio fetches at once, alphabetically, so the tier-1 card on screen waited behind
 * the whole bundle for its bytes. A connection is a pipe; the only lever is ORDER.
 *
 * The rules this module enforces:
 *   - At most `concurrency` tasks in flight. Everything else waits in its LANE.
 *   - Lanes drain strictly in order (`now` → `chrome` → `early` → `set` → `audio` → `idle`). Whatever is on screen
 *     RIGHT NOW (`now`) always starts next, whatever else is queued.
 *   - A key is fetched ONCE. Requesting it again only ever RAISES its lane (a queued `idle` card that appears in
 *     the shop jumps to `now`); an in-flight or finished key is left alone.
 *   - `ready(key)` is true once its task resolved. Subscribers are told whenever its state changes.
 *   - RETRY (owner report 2026-09-30, a friend's round-12 shop of blank ovals): a key requested with
 *     `retryDelays` that FAILS is not settled. It waits out the next delay OFF the pipe (holding no slot), then
 *     re-enters its lane like any other request; only after the last delay does it end `failed`. A failed key is
 *     `settled` (nobody waits on it forever) but never `ready`. `retryFailed()` (the network came back) re-queues
 *     every failed and backing-off key at once. A key without `retryDelays` settles as ready on failure, as before.
 *
 * Pure scheduling: the loader is injected, so the ordering / concurrency / dedupe contract is unit-tested
 * without a DOM (`assetQueue.test.ts`). The image flavour lives in `artPreload.ts`.
 */

/** Lanes, most urgent first. Numeric so a raise is a `<` compare. */
export const LANES = ['now', 'chrome', 'early', 'set', 'audio', 'idle'] as const;
export type Lane = (typeof LANES)[number];
const RANK: Record<Lane, number> = { now: 0, chrome: 1, early: 2, set: 3, audio: 4, idle: 5 };

/** What a task is told about the attempt it is running. `last` is the final try before the key gives up. */
export interface Attempt { attempt: number; last: boolean }

export interface RequestOptions {
  /** Backoff before each RETRY of a failed task (ms). `[1000, 3000, 8000]` = up to 4 tries. Omitted = no retry:
   *  a failure settles the key as ready (the audio bank's contract). */
  retryDelays?: readonly number[];
}

export interface AssetQueue {
  /** Queue `key` in `lane` (or raise it there). `task` runs once per key (plus its retries); later calls reuse the first. */
  request(key: string, lane: Lane, task: (lane: Lane, attempt: Attempt) => Promise<unknown>, opts?: RequestOptions): void;
  /** Mark `key` ready from OUTSIDE the queue — an on-screen <img> finished it first. Drops any queued copy. */
  resolve(key: string): void;
  /** Report a failure from OUTSIDE the queue (an on-screen <img> errored). A READY key goes back to backing off
   *  and is fetched again through the pipe (with `task`/`opts` when the queue never ran one for it, e.g. it was
   *  marked ready by `resolve`). A key already pending, backing off or failed is left alone. */
  fail(key: string, task?: (lane: Lane, attempt: Attempt) => Promise<unknown>, opts?: RequestOptions & { lane?: Lane }): void;
  /** True once `key`'s task RESOLVED (or failed with no retry policy). */
  ready(key: string): boolean;
  /** True once a retrying key used up every attempt. It stays failed until `retryFailed()`. */
  failed(key: string): boolean;
  /** Ready OR failed: nothing more will happen to it on its own. What a loading gate waits on. */
  settled(key: string): boolean;
  /** Re-queue every failed key (attempts reset) and every key backing off (now, not after its timer). */
  retryFailed(): number;
  /** Called whenever `key` changes state (ready, failed, or back to pending for a retry) until unsubscribed. A
   *  subscribe to an already settled key also fires once. Never synchronous. Returns an unsubscribe. */
  subscribe(key: string, cb: () => void): () => void;
  /** Counters for tests + the devlog numbers. */
  stats(): { queued: number; inFlight: number; done: number; failed: number; backingOff: number; retries: number; started: string[] };
  /** Change how many tasks may run at once (the boot gate opens it wider while nothing else is on screen). A raise
   *  starts queued work at once; a lower cap only stops NEW starts until the in-flight count drops under it. */
  setConcurrency(n: number): void;
}

interface Entry {
  key: string;
  lane: number;
  task: (lane: Lane, attempt: Attempt) => Promise<unknown>;
  delays: readonly number[];
  /** Failures so far = the index of the next attempt. */
  failures: number;
}

export function createAssetQueue(
  initialConcurrency = 6,
  opts: { trackStarted?: boolean; onGiveUp?: (key: string, attempts: number) => void } = {},
): AssetQueue {
  // One FIFO per lane — O(1) enqueue, and a raise just moves the entry (rare: only when art is needed sooner).
  const lanes: Entry[][] = LANES.map(() => []);
  const queued = new Map<string, Entry>();
  const inFlight = new Set<string>();
  const done = new Set<string>();
  /** Every entry with a retry policy, kept after it settles so a later failure can re-run its task. */
  const known = new Map<string, Entry>();
  const failedKeys = new Set<string>();
  const backoff = new Map<string, ReturnType<typeof setTimeout>>();
  const subs = new Map<string, Set<() => void>>();
  const started: string[] = [];
  let retries = 0;
  let concurrency = Math.max(1, initialConcurrency);

  const notify = (key: string): void => {
    const s = subs.get(key);
    if (s) for (const cb of [...s]) cb();
  };

  const enqueue = (e: Entry): void => {
    queued.set(e.key, e);
    lanes[e.lane]!.push(e);
  };

  const settle = (key: string): void => {
    inFlight.delete(key);
    const t = backoff.get(key); // an outside fail() raced this success: the success wins
    if (t !== undefined) { clearTimeout(t); backoff.delete(key); }
    failedKeys.delete(key);
    done.add(key);
    notify(key);
    pump();
  };

  /** A retrying entry failed (its own task, or an on-screen element): back off, or give up at the cap. */
  const failEntry = (e: Entry): void => {
    const delay = e.delays[e.failures];
    e.failures++;
    if (delay === undefined) {
      failedKeys.add(e.key);
      opts.onGiveUp?.(e.key, e.failures);
      notify(e.key);
      return;
    }
    retries++;
    backoff.set(e.key, setTimeout(() => {
      backoff.delete(e.key);
      if (inFlight.has(e.key) || done.has(e.key)) return;
      enqueue(e);
      pump();
    }, delay));
  };

  const pump = (): void => {
    while (inFlight.size < concurrency) {
      let next: Entry | undefined;
      for (const lane of lanes) { if (lane.length) { next = lane.shift(); break; } }
      if (!next) return;
      queued.delete(next.key);
      inFlight.add(next.key);
      if (opts.trackStarted) started.push(next.key);
      const e = next;
      const key = e.key;
      const retrying = e.delays.length > 0;
      let p: Promise<unknown>;
      try {
        p = e.task(LANES[e.lane]!, { attempt: e.failures, last: !retrying || e.failures >= e.delays.length });
      } catch (err) { p = Promise.reject(err); }
      p.then(() => settle(key), () => {
        // resolve() from outside may have finished it meanwhile; then this late failure is moot.
        if (!retrying || done.has(key)) { settle(key); return; }
        inFlight.delete(key);
        // An outside fail() already put it in backoff / gave up while this attempt ran: count it once.
        if (!backoff.has(key) && !failedKeys.has(key)) failEntry(e);
        pump();
      });
    }
  };

  return {
    request(key, lane, task, ro) {
      if (done.has(key) || inFlight.has(key) || failedKeys.has(key) || backoff.has(key)) return;
      const r = RANK[lane];
      const hit = queued.get(key);
      if (hit) {
        if (r >= hit.lane) return; // never demote
        const from = lanes[hit.lane]!;
        const i = from.indexOf(hit);
        if (i >= 0) from.splice(i, 1);
        hit.lane = r;
        lanes[r]!.push(hit);
      } else {
        const e: Entry = { key, lane: r, task, delays: ro?.retryDelays ?? [], failures: 0 };
        if (e.delays.length) known.set(key, e);
        enqueue(e);
      }
      pump();
    },
    resolve(key) {
      if (done.has(key)) return;
      const hit = queued.get(key);
      if (hit) {
        const from = lanes[hit.lane]!;
        const i = from.indexOf(hit);
        if (i >= 0) from.splice(i, 1);
        queued.delete(key);
      }
      const t = backoff.get(key);
      if (t !== undefined) { clearTimeout(t); backoff.delete(key); }
      failedKeys.delete(key);
      // An in-flight task will settle it again later; settle() is idempotent on `done`, so marking it now is safe.
      const wasInFlight = inFlight.has(key);
      done.add(key);
      notify(key);
      if (!wasInFlight) pump();
    },
    fail(key, task, fo) {
      if (!done.has(key)) return; // already pending / in flight / backing off / failed
      let e = known.get(key);
      if (!e && task && fo?.retryDelays?.length) {
        e = { key, lane: RANK[fo.lane ?? 'now'], task, delays: fo.retryDelays, failures: 0 };
        known.set(key, e);
      }
      if (!e) return;
      done.delete(key);
      failEntry(e);
      notify(key);
    },
    ready: (key) => done.has(key),
    failed: (key) => failedKeys.has(key),
    settled: (key) => done.has(key) || failedKeys.has(key),
    retryFailed() {
      let n = 0;
      for (const key of [...failedKeys]) {
        const e = known.get(key);
        failedKeys.delete(key);
        if (!e) continue;
        e.failures = 0;
        enqueue(e);
        notify(key);
        n++;
      }
      for (const [key, t] of [...backoff]) {
        clearTimeout(t);
        backoff.delete(key);
        const e = known.get(key);
        if (e) { enqueue(e); n++; }
      }
      pump();
      return n;
    },
    subscribe(key, cb) {
      let s = subs.get(key);
      if (!s) { s = new Set(); subs.set(key, s); }
      s.add(cb);
      let live = true;
      if (done.has(key) || failedKeys.has(key)) queueMicrotask(() => { if (live) cb(); });
      return () => { live = false; s!.delete(cb); if (!s!.size && subs.get(key) === s) subs.delete(key); };
    },
    stats: () => ({
      queued: queued.size, inFlight: inFlight.size, done: done.size, failed: failedKeys.size,
      backingOff: backoff.size, retries, started: [...started],
    }),
    setConcurrency(n) {
      concurrency = Math.max(1, Math.floor(n));
      pump();
    },
  };
}
