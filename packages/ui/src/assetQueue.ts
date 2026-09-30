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
 *   - `ready(key)` is true once its task resolved. Subscribers are told once, when it flips.
 *
 * Pure scheduling: the loader is injected, so the ordering / concurrency / dedupe contract is unit-tested
 * without a DOM (`assetQueue.test.ts`). The image flavour lives in `artPreload.ts`.
 */

/** Lanes, most urgent first. Numeric so a raise is a `<` compare. */
export const LANES = ['now', 'chrome', 'early', 'set', 'audio', 'idle'] as const;
export type Lane = (typeof LANES)[number];
const RANK: Record<Lane, number> = { now: 0, chrome: 1, early: 2, set: 3, audio: 4, idle: 5 };

export interface AssetQueue {
  /** Queue `key` in `lane` (or raise it there). `task` runs at most once per key; later calls reuse the first. */
  request(key: string, lane: Lane, task: (lane: Lane) => Promise<unknown>): void;
  /** Mark `key` ready from OUTSIDE the queue — an on-screen <img> finished it first. Drops any queued copy. */
  resolve(key: string): void;
  /** True once `key`'s task has SETTLED (resolved or failed — a failed asset must never hold a card hidden). */
  ready(key: string): boolean;
  /** Called once when `key` becomes ready. Returns an unsubscribe. Fires synchronously-never (always async). */
  subscribe(key: string, cb: () => void): () => void;
  /** Counters for tests + the devlog numbers. */
  stats(): { queued: number; inFlight: number; done: number; started: string[] };
}

interface Entry { key: string; lane: number; task: (lane: Lane) => Promise<unknown> }

export function createAssetQueue(concurrency = 6, opts: { trackStarted?: boolean } = {}): AssetQueue {
  // One FIFO per lane — O(1) enqueue, and a raise just moves the entry (rare: only when art is needed sooner).
  const lanes: Entry[][] = LANES.map(() => []);
  const queued = new Map<string, Entry>();
  const inFlight = new Set<string>();
  const done = new Set<string>();
  const subs = new Map<string, Set<() => void>>();
  const started: string[] = [];

  const settle = (key: string): void => {
    inFlight.delete(key);
    done.add(key);
    const s = subs.get(key);
    if (s) { subs.delete(key); for (const cb of s) cb(); }
    pump();
  };

  const pump = (): void => {
    while (inFlight.size < concurrency) {
      let next: Entry | undefined;
      for (const lane of lanes) { if (lane.length) { next = lane.shift(); break; } }
      if (!next) return;
      queued.delete(next.key);
      inFlight.add(next.key);
      if (opts.trackStarted) started.push(next.key);
      const key = next.key;
      let p: Promise<unknown>;
      try { p = next.task(LANES[next.lane]!); } catch { p = Promise.resolve(); }
      p.then(() => settle(key), () => settle(key));
    }
  };

  return {
    request(key, lane, task) {
      if (done.has(key) || inFlight.has(key)) return;
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
        const e: Entry = { key, lane: r, task };
        queued.set(key, e);
        lanes[r]!.push(e);
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
      // An in-flight task will settle it again later; settle() is idempotent on `done`, so marking it now is safe.
      const wasInFlight = inFlight.has(key);
      done.add(key);
      const s = subs.get(key);
      if (s) { subs.delete(key); for (const cb of s) cb(); }
      if (!wasInFlight) pump();
    },
    ready: (key) => done.has(key),
    subscribe(key, cb) {
      if (done.has(key)) { queueMicrotask(cb); return () => {}; }
      let s = subs.get(key);
      if (!s) { s = new Set(); subs.set(key, s); }
      s.add(cb);
      return () => { s!.delete(cb); };
    },
    stats: () => ({ queued: queued.size, inFlight: inFlight.size, done: done.size, started: [...started] }),
  };
}
