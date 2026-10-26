/**
 * A tiny IndexedDB key-value store for network caches (perf/supabase-egress-audit 2026-10-26, R-NET-CACHE-01): the
 * launch reads that used to be fetched WHOLE on every boot (the board-results window, the Recent Games feed) keep their
 * last answer here and ask the server only for rows newer than it. Every call resolves: a browser that refuses
 * IndexedDB simply has no cache, which is exactly the old behaviour (a full read). Same pattern as
 * `opponentPool/poolCache.ts`.
 */
const DB_NAME = 'ascent.netcache';
const DB_VERSION = 1;
const STORE = 'kv';

let dbp: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  return (dbp ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  }));
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const d = await openDb();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const d = await openDb();
  if (!d) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

/**
 * Merge an incremental read into a cached newest-first list: `fresh` rows (newer than the cache) go first, any id
 * already cached is dropped from the old list, and the result is cut to `limit`. Pure (exported for the tests).
 */
export function mergeNewestFirst<T extends { id: number | string }>(
  fresh: readonly T[], cached: readonly T[], limit: number, newerFirst: (a: T, b: T) => number = (a, b) => Number(b.id) - Number(a.id),
): T[] {
  const seen = new Set(fresh.map((r) => String(r.id)));
  const out = [...fresh, ...cached.filter((r) => !seen.has(String(r.id)))];
  out.sort(newerFirst);
  return out.slice(0, limit);
}

/** The highest id in a list (0 when empty). */
export const maxId = (rows: ReadonlyArray<{ id: number | string }>): number => rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
