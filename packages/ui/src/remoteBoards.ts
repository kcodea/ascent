/**
 * Remote board sync — the live shared opponent pool (async-PvP step 5), behind a Supabase Postgres table.
 * Mirrors `boardLibrary.ts` but over the network instead of localStorage: finished-run boards POST here
 * (fire-and-forget) and a curated, patch-matched pool is fetched ONCE at startup and registered into the
 * static opponent pool. This kills the manual Export → `docs/board-exports/` → `npm run pool` round-trip for
 * the live game — you and a friend automatically pool each other's boards.
 *
 * No-ops gracefully when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are unset (no project configured) — so
 * the build, the headless tests, and offline play are all unaffected. The committed `OPPONENT_POOL_DATA` stays
 * the offline FLOOR; this is purely additive fresh boards on top.
 *
 * Determinism: like the committed pool, the remote pool is fetched once at boot and kept static for the session
 * (`registerOpponents` is never called mid-run), so replays stay faithful within a session. Daily/shareable
 * seeds should still pin to the committed pool only (see docs/board-pool.md).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { registerOpponents, type BoardSnapshot } from '@game/sim';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TABLE = 'boards';
const FETCH_LIMIT = 2000; // cap the startup pull (curate server-side later if the table grows large)
const FETCH_TIMEOUT_MS = 4000; // never block boot on a slow / absent network

/** True when a backend is configured (both env vars present). */
export const remoteEnabled = (): boolean => !!(SUPABASE_URL && SUPABASE_KEY);

let cachedClient: SupabaseClient | null | undefined;
function client(): SupabaseClient | null {
  if (cachedClient === undefined) {
    cachedClient =
      SUPABASE_URL && SUPABASE_KEY
        ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
        : null;
  }
  return cachedClient;
}

/** A DB row: the full `BoardSnapshot` lives in the `snapshot` jsonb column; the rest are denormalized so the
 *  dashboard can index / sort / patch-prune (`delete from boards where patch <> '…'`). */
const toRow = (b: BoardSnapshot) => ({
  patch: b.patch ?? 'unknown',
  wave: b.wave,
  hero_id: b.heroId,
  power: b.power,
  rating: b.rating ?? null,
  origin: b.origin ?? 'self',
  author: b.author ?? null,
  tribes: b.tribes ?? [],
  captured_at: b.capturedAt ?? null,
  seed: b.seed ?? null,
  snapshot: b,
});

/** Upload a finished run's boards. Fire-and-forget — never throws, never blocks the game (offline → skipped). */
export async function uploadBoards(boards: BoardSnapshot[]): Promise<void> {
  const c = client();
  if (!c || boards.length === 0) return;
  try {
    await c.from(TABLE).insert(boards.map(toRow));
  } catch {
    /* best-effort — capture must never disrupt play */
  }
}

/**
 * Fetch the shared pool for the current patch and register it into the static opponent pool. Best-effort +
 * time-boxed; returns how many boards were registered (0 on any failure / no backend). Call ONCE at startup,
 * before any run faces combat. `patchPrefix` matches by build VERSION (e.g. `"0.1.0+"`) so per-commit SHA
 * churn doesn't hide your own boards — boards are keyed `version+sha`, served by `version+%`.
 */
export async function fetchAndRegisterPool(patchPrefix?: string): Promise<number> {
  const c = client();
  if (!c) return 0;
  try {
    let query = c.from(TABLE).select('snapshot');
    if (patchPrefix) query = query.like('patch', `${patchPrefix}%`);
    const request = Promise.resolve(query.order('wave', { ascending: true }).limit(FETCH_LIMIT));
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const result = await Promise.race([request, timeout]);
    if (!result || result.error || !result.data) return 0;
    const snaps = (result.data as { snapshot: BoardSnapshot }[])
      .map((r) => r.snapshot)
      .filter((s): s is BoardSnapshot => !!s && Array.isArray(s.minions) && s.minions.length > 0);
    registerOpponents(snaps);
    return snaps.length;
  } catch {
    return 0;
  }
}
