import { useEffect, useSyncExternalStore } from 'react';

/**
 * SOCIAL CACHE (perf 2026-10-09, owner: "our social tab takes forever to load and is also laggy").
 *
 * The ladder pages (Leaderboard, Hall of Champions, Recent Games) used to clear their list and refetch on EVERY open,
 * so each visit, and each sidebar hop between them, started on a spinner. This is a tiny stale-while-revalidate
 * cache shared by those pages and the title's idle prefetch (`socialPrefetch.ts`):
 *
 *  - a page paints the last answer for its key AT ONCE, then refreshes behind it when that answer is older than
 *    `maxAgeMs` (default `SOCIAL_FRESH_MS`);
 *  - concurrent loads of one key share ONE request (a prefetch already in flight when the page opens is reused);
 *  - an empty answer never replaces a non-empty one (the fetchers return `[]` on a network failure, and a blip must
 *    not blank a list the player was just reading).
 *
 * Module state, not the Zustand store: nothing else reads it, and it keeps the hot `store.ts` out of this change.
 */

export const SOCIAL_FRESH_MS = 60_000;

interface Entry { data: unknown; at: number }
const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
let version = 0;
const bump = (): void => { version++; for (const l of listeners) l(); };

const isEmpty = (v: unknown): boolean => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/** The cached answer for `key` (and when it was stored), if any. */
export function peekSocial<T>(key: string): { data: T; at: number } | undefined {
  return entries.get(key) as { data: T; at: number } | undefined;
}

/** Store an answer (an empty one never replaces a non-empty one). */
export function putSocial<T>(key: string, data: T): void {
  const prev = entries.get(key);
  if (prev && isEmpty(data) && !isEmpty(prev.data)) { prev.at = Date.now(); return; }
  entries.set(key, { data, at: Date.now() });
  bump();
}

/** Load `key`: the cached answer while it is fresh, else ONE shared request. Resolves to the stored answer. */
export function loadSocial<T>(key: string, fetcher: () => Promise<T>, opts: { maxAgeMs?: number; force?: boolean } = {}): Promise<T> {
  const hit = entries.get(key);
  if (hit && !opts.force && Date.now() - hit.at < (opts.maxAgeMs ?? SOCIAL_FRESH_MS)) return Promise.resolve(hit.data as T);
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fetcher()
    .then((data) => { putSocial(key, data); return (entries.get(key)?.data ?? data) as T; })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

/** Is a request for `key` in flight right now? */
export const socialLoading = (key: string): boolean => inflight.has(key);

const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = (): number => version;

/**
 * A page's view of one key: `undefined` until the first answer exists, then the latest answer (stale ones included).
 * While `key` is non-null it loads on mount / key change, refreshing in the background when the answer is stale.
 */
export function useSocial<T>(key: string | null, fetcher: () => Promise<T>, opts: { maxAgeMs?: number } = {}): T | undefined {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (key === null) return;
    void loadSocial(key, fetcher, opts);
    // The fetcher is a fresh closure every render; the key names what it fetches, so the key alone is the dep.
  }, [key]);
  return key === null ? undefined : (entries.get(key)?.data as T | undefined);
}

/** Tests: forget everything. */
export function clearSocialCache(): void {
  entries.clear();
  inflight.clear();
  bump();
}
