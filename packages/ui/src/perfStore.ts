import type { PerfBucket } from './perfMonitor';

/**
 * PERF RUN STORE — recorded sessions, kept on this machine.
 *
 * The monitor's ring buffer dies with the tab, which made every finding a one-shot: you could see that a run
 * was janky, but not that it was *worse than last time*, which is the question that actually matters after a
 * change. This persists a finished recording so the perf screen can show history and compare runs.
 *
 * ── Why IndexedDB and not localStorage ────────────────────────────────────────────────────────────────────
 *
 * A full run is up to 2400 buckets — roughly half a megabyte of JSON. localStorage is a ~5 MB budget SHARED
 * with `ascent.save`, so a handful of recordings would sit between the player and their save file. That is a
 * bad trade for a dev tool. IndexedDB has its own, far larger budget and stores structured values without a
 * stringify round-trip.
 *
 * ── Failure is always survivable ──────────────────────────────────────────────────────────────────────────
 *
 * Every call resolves rather than throws: private windows, disabled site data and quota exhaustion are all
 * ordinary, and none of them should break the game or even the perf screen. A read that fails returns an
 * empty list; a write that fails is dropped and reported through the return value. **A diagnostic tool must
 * never be the thing that takes the game down.**
 */

const DB_NAME = 'ascent.perf';
const DB_VERSION = 1;
const STORE = 'runs';
/** Kept recordings. Old ones are pruned oldest-first — history is for comparison, not an archive. */
export const MAX_RUNS = 25;

export interface PerfRunMeta {
  /** Sortable, unique, and human-readable in a list. */
  id: string;
  /** Epoch ms when the recording started. */
  startedAt: number;
  /** Seconds of live (non-backgrounded) recording. */
  seconds: number;
  /** Build the recording came from, so a comparison can say WHICH change moved the number. */
  build: string;
  /** What the player was doing: run mode + hero, when a run was in progress. */
  mode?: string;
  heroId?: string;
  /** Free-text the owner can type before saving — "after the sheen change". */
  note?: string;
  /** Headline numbers, denormalised so the run LIST needs no buckets loaded. */
  hz: number;
  worstFrame: number;
  jankFrames: number;
  fpsMed: number;
}

export interface PerfRun extends PerfRunMeta {
  buckets: PerfBucket[];
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
        }
      };
      req.onsuccess = () => { resolve(req.result); };
      req.onerror = () => { resolve(null); };
      // A blocked upgrade (another tab holding an old version) must not hang the caller forever.
      req.onblocked = () => { resolve(null); };
    } catch { resolve(null); }
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => { resolve(req.result); };
        req.onerror = () => { resolve(null); };
        t.oncomplete = () => { db.close(); };
      } catch { resolve(null); }
    });
  });
}

/** Every recording's metadata, newest first. Buckets are NOT loaded — the list view never needs them. */
export async function listRuns(): Promise<PerfRunMeta[]> {
  const all = await tx<PerfRun[]>('readonly', (s) => s.getAll() as IDBRequest<PerfRun[]>);
  if (!all) return [];
  return all
    .map(({ buckets: _b, ...meta }) => meta)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** One recording in full, or null if it is gone. */
export async function loadRun(id: string): Promise<PerfRun | null> {
  return (await tx<PerfRun>('readonly', (s) => s.get(id) as IDBRequest<PerfRun>)) ?? null;
}

/** Persist a recording, then prune to `MAX_RUNS`. Returns false when storage is unavailable. */
export async function saveRun(run: PerfRun): Promise<boolean> {
  const ok = await tx('readwrite', (s) => s.put(run) as IDBRequest<IDBValidKey>);
  if (ok === null) return false;
  const metas = await listRuns();
  for (const stale of metas.slice(MAX_RUNS)) await deleteRun(stale.id);
  return true;
}

export async function deleteRun(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>);
}

export async function clearRuns(): Promise<void> {
  await tx('readwrite', (s) => s.clear() as unknown as IDBRequest<undefined>);
}

/**
 * Build the stored record from a finished recording.
 *
 * Split out and exported so the denormalised headline fields are derived in ONE place — a list showing a
 * different worst-frame than the detail view would be worse than showing nothing.
 */
export function toRun(
  buckets: readonly PerfBucket[],
  meta: { id: string; startedAt: number; build: string; mode?: string; heroId?: string; note?: string },
): PerfRun {
  const live = buckets.filter((b) => !b.hidden);
  const fps = live.map((b) => b.fps).sort((a, b) => a - b);
  const hz = live.map((b) => b.hz).filter((h) => h > 0).sort((a, b) => a - b);
  return {
    ...meta,
    seconds: live.length,
    hz: hz.length ? hz[Math.floor(hz.length / 2)]! : 0,
    worstFrame: +live.reduce((a, b) => Math.max(a, b.worst), 0).toFixed(2),
    jankFrames: live.reduce((a, b) => a + b.jank, 0),
    fpsMed: fps.length ? +fps[Math.floor(fps.length / 2)]!.toFixed(1) : 0,
    buckets: [...buckets],
  };
}
