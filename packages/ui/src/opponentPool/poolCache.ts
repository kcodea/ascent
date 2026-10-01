/**
 * The last-good opponent pool, persisted (fix 2026-09-28). IndexedDB, not localStorage: a set's pool is up
 * to a megabyte or two of JSON, and localStorage is synchronous and small (the same reasoning as the replay
 * drafts in `replay/replayDraft.ts`). ONE record per set, overwritten on every write, so the store can never
 * grow past one bounded pool per set. Every call resolves; a browser that refuses IndexedDB simply has no
 * cache, which is exactly today's behaviour.
 *
 * Since 2026-09-29 (R-LOBBY-08) the record holds WHOLE RUNS keyed by run key under `POOL_CACHE_VERSION`. A
 * record is returned raw (`unknown`) and the loader validates it (`usableCache`), so an older per-wave record,
 * which could hold cut-down runs, is simply ignored and overwritten by the next write.
 */
import type { SetId } from '@game/content';
import type { CachedPool, PoolCacheStore } from './poolLoader';

const DB_NAME = 'ascent.pool';
const DB_VERSION = 1;
const STORE = 'lastGoodPool';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'setId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

export function idbPoolCache(): PoolCacheStore {
  let db: Promise<IDBDatabase | null> | null = null;
  const getDb = () => (db ??= openDb());
  return {
    async load(setId) {
      const d = await getDb();
      if (!d) return null;
      return new Promise<unknown>((resolve) => {
        try {
          const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(setId);
          req.onsuccess = () => resolve((req.result as unknown) ?? null);
          req.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
    },
    async save(pool) {
      const d = await getDb();
      if (!d) return;
      await new Promise<void>((resolve) => {
        try {
          const tx = d.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(pool);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch { resolve(); }
      });
    },
  };
}

/** In-memory store for tests and environments without IndexedDB. */
export function memoryPoolCache(initial?: { setId: SetId } & Record<string, unknown>): PoolCacheStore & { saved: CachedPool[] } {
  const byId = new Map<SetId, unknown>();
  if (initial) byId.set(initial.setId, initial);
  const saved: CachedPool[] = [];
  return {
    saved,
    async load(setId) { return byId.get(setId) ?? null; },
    async save(pool) { byId.set(pool.setId, pool); saved.push(pool); },
  };
}
