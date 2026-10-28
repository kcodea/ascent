/**
 * THE OPPONENT POOL, CACHED BY RUN (Supabase cleanup P1.5, owner ruling 2026-10-28: "yes, cache them").
 *
 * `pool_runs_sample` re-sent up to 150 WHOLE runs (~3.45 MB) on every session start and every between-runs refresh,
 * although each device already held most of them. This module answers the SAME `sample(args)` call the pool fetch
 * makes (`PoolApi.sample`, `poolFetch.ts`), from two smaller server reads plus a local cache:
 *
 *   1. `pool_runs_sample_keys(args)`: the server's draw, exactly as `pool_runs_sample` draws it (the same SQL picking
 *      block, pinned by `poolRunsDelta.db.test.ts`), but each row carries the run's id and content `rev` instead of
 *      its boards;
 *   2. the cache: a run whose key AND rev it holds is served from it (the boards exactly as the server once sent
 *      them, kept as JSON text and parsed fresh on every use, so no caller ever shares or mutates a cached object);
 *   3. `pool_runs_boards(ids)`: only the runs it lacks (or whose rev moved), in chunks.
 *
 * The rows come back in the keys answer's order with the keys answer's strength / wave count / owner, and the boards a
 * run had at that rev: the same `SampleRow[]` `pool_runs_sample` would have returned for that draw. `rev` covers every
 * board row of the run at its row version, so a run that gains, loses or changes a board is downloaded again: a cached
 * run can never serve a stale or a future board (R-LOBBY-08, owner bar "exact recorded state").
 *
 * Feature-detected: until the owner runs supabase/migrations/2026-11-08-pool-runs-delta.sql the keys RPC answers
 * "function not found" and the session calls `pool_runs_sample` exactly as before (`session.deltaMissing`). A boards
 * read that fails returns the error, so the loader's retry policy is unchanged. A cache that cannot open (no
 * IndexedDB, private mode) is a cache that always misses.
 */
import type { BoardSnapshot } from '@game/sim';
import { isMissingFunction, type ApiError, type SampleArgs, type SampleRow } from './poolFetch';

/** Bump to drop every cached run (a change to how a run is stored or keyed). */
export const POOL_RUN_CACHE_VERSION = 1;
/** Runs kept per device. The live pool is ~411 runs (~24 KB each); least recently used go first. */
export const POOL_RUN_CACHE_MAX = 600;
/** Run ids per `pool_runs_boards` request (the server refuses more than 300). */
export const POOL_BOARDS_CHUNK = 100;

export interface KeyRow {
  run_id: number | string; run_key: string; author: string; user_id: string | null; wave_count: number;
  strength?: number | string | null; strength_early?: number | string | null; strength_late?: number | string | null;
  rev: string;
}
export interface RunBoardsRow { run_id: number | string; run_key: string; rev: string; boards: BoardSnapshot[] | null }

type Res<T> = Promise<{ data: T | null; error: ApiError | null }>;
export interface DeltaRpc {
  keys(args: SampleArgs, signal: AbortSignal): Res<KeyRow[]>;
  boards(ids: number[], signal: AbortSignal): Res<RunBoardsRow[]>;
  /** The original whole-run sample: the fallback until the delta SQL is run. */
  sample(args: SampleArgs, signal: AbortSignal): Res<SampleRow[]>;
}

/** One cached run: the boards as the server sent them for `rev`, as JSON text. */
export interface CachedRun { v: number; key: string; rev: string; text: string; usedAt: number }
export interface RunCacheStore {
  getMany(keys: readonly string[]): Promise<Map<string, CachedRun>>;
  /** Write new runs and touch the hits' `usedAt`, then trim to `POOL_RUN_CACHE_MAX` (least recently used first). */
  putMany(runs: readonly CachedRun[]): Promise<void>;
}

export interface DeltaSession { deltaMissing?: boolean }
/** DEV / tests: what the cache did. */
export interface DeltaStats { calls: number; runs: number; hits: number; fetched: number; fallbacks: number }

export function cachedSample(rpc: DeltaRpc, store: RunCacheStore, session: DeltaSession, now: () => number, stats?: DeltaStats) {
  return async (args: SampleArgs, signal: AbortSignal): Res<SampleRow[]> => {
    if (stats) stats.calls++;
    if (!session.deltaMissing) {
      const k = await rpc.keys(args, signal);
      if (k.error && isMissingFunction(k.error)) session.deltaMissing = true;
      else if (k.error) return { data: null, error: k.error };
      else return assemble(k.data ?? []);
    }
    if (stats) stats.fallbacks++;
    return rpc.sample(args, signal);

    async function assemble(rows: KeyRow[]): Res<SampleRow[]> {
      const cached = await store.getMany(rows.map((r) => r.run_key)).catch(() => new Map<string, CachedRun>());
      const text = new Map<string, string>();
      const missing: number[] = [];
      for (const r of rows) {
        const c = cached.get(r.run_key);
        if (c && c.v === POOL_RUN_CACHE_VERSION && c.rev === r.rev && typeof c.text === 'string') text.set(r.run_key, c.text);
        else missing.push(Number(r.run_id));
      }
      const fresh: CachedRun[] = [];
      for (let i = 0; i < missing.length; i += POOL_BOARDS_CHUNK) {
        const b = await rpc.boards(missing.slice(i, i + POOL_BOARDS_CHUNK), signal);
        if (b.error) {
          // A server with the keys read but not the boards read (half a migration): use the old sample this session.
          if (isMissingFunction(b.error)) { session.deltaMissing = true; if (stats) stats.fallbacks++; return rpc.sample(args, signal); }
          return { data: null, error: b.error };
        }
        for (const row of b.data ?? []) {
          // The boards as sent, kept as text. If the run changed between the two reads, this newer answer (and its rev)
          // is the one served and cached: the same as asking pool_runs_sample a moment later.
          const t = JSON.stringify(Array.isArray(row.boards) ? row.boards : []);
          text.set(row.run_key, t);
          fresh.push({ v: POOL_RUN_CACHE_VERSION, key: row.run_key, rev: row.rev, text: t, usedAt: now() });
        }
      }
      const at = now();
      const touched: CachedRun[] = [];
      for (const r of rows) { const c = cached.get(r.run_key); if (c && text.get(r.run_key) === c.text && c.rev === r.rev) touched.push({ ...c, usedAt: at }); }
      void store.putMany([...fresh, ...touched]).catch(() => {});
      if (stats) { stats.runs += rows.length; stats.hits += rows.length - missing.length; stats.fetched += fresh.length; }
      // The keys answer's order and fields; a run deleted between the two reads is simply absent (as it would be from
      // the sample). `boards` is parsed fresh from the text for every call.
      const out: SampleRow[] = [];
      for (const r of rows) {
        const t = text.get(r.run_key);
        if (t === undefined) continue;
        out.push({
          run_key: r.run_key, author: r.author, user_id: r.user_id, wave_count: r.wave_count,
          ...(r.strength !== undefined ? { strength: r.strength } : {}),
          ...(r.strength_early !== undefined ? { strength_early: r.strength_early } : {}),
          ...(r.strength_late !== undefined ? { strength_late: r.strength_late } : {}),
          boards: JSON.parse(t) as BoardSnapshot[],
        });
      }
      return { data: out, error: null };
    }
  };
}

// ── IndexedDB store ───────────────────────────────────────────────────────────────────────────────────────────
const DB_NAME = 'ascent.poolruns';
const DB_VERSION = 1;
const STORE = 'runs';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' }).createIndex('usedAt', 'usedAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

export function idbRunCache(max = POOL_RUN_CACHE_MAX): RunCacheStore {
  let db: Promise<IDBDatabase | null> | null = null;
  const getDb = () => (db ??= openDb());
  return {
    async getMany(keys) {
      const out = new Map<string, CachedRun>();
      const d = await getDb();
      if (!d || keys.length === 0) return out;
      return new Promise((resolve) => {
        try {
          const tx = d.transaction(STORE, 'readonly');
          const st = tx.objectStore(STORE);
          for (const k of keys) {
            const req = st.get(k);
            req.onsuccess = () => { const v = req.result as CachedRun | undefined; if (v) out.set(k, v); };
          }
          tx.oncomplete = () => resolve(out);
          tx.onerror = () => resolve(out);
          tx.onabort = () => resolve(out);
        } catch { resolve(out); }
      });
    },
    async putMany(runs) {
      const d = await getDb();
      if (!d || runs.length === 0) return;
      await new Promise<void>((resolve) => {
        try {
          const tx = d.transaction(STORE, 'readwrite');
          const st = tx.objectStore(STORE);
          for (const r of runs) st.put(r);
          // Trim: count, then delete the least recently used beyond the cap.
          const count = st.count();
          count.onsuccess = () => {
            let extra = count.result - max;
            if (extra <= 0) return;
            const cur = st.index('usedAt').openCursor();
            cur.onsuccess = () => {
              const c = cur.result;
              if (!c || extra <= 0) return;
              c.delete();
              extra--;
              c.continue();
            };
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch { resolve(); }
      });
    },
  };
}

/** In-memory store (tests, and a stand-in where IndexedDB is missing). Same contract, same trim. */
export function memoryRunCache(max = POOL_RUN_CACHE_MAX): RunCacheStore & { map: Map<string, CachedRun> } {
  const map = new Map<string, CachedRun>();
  return {
    map,
    async getMany(keys) { const out = new Map<string, CachedRun>(); for (const k of keys) { const v = map.get(k); if (v) out.set(k, { ...v }); } return out; },
    async putMany(runs) {
      for (const r of runs) map.set(r.key, { ...r });
      if (map.size <= max) return;
      const lru = [...map.values()].sort((a, b) => a.usedAt - b.usedAt);
      for (const r of lru.slice(0, map.size - max)) map.delete(r.key);
    },
  };
}
