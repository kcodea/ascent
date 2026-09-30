/**
 * FETCHING THE SHARED POOL AS WHOLE RUNS (R-LOBBY-08, 2026-09-29).
 *
 * Primary path: the `pool_runs_sample` RPC (supabase/migrations/2026-09-29-pool-whole-runs.sql). The server draws
 * `POOL_SAMPLE_RUNS` runs uniformly at random from every eligible run of this set and build version (owner: "i want
 * opponent snapshots to be completely random but i want them to be accurate"), and returns ONE ROW PER RUN with all
 * of its boards, so a run is present whole or absent. One request, bounded payload, constant server cost.
 *
 * Fallback path, until the owner has run that SQL (feature-detected: the RPC answers "function not found"): list
 * the pool's board identities (no snapshots), group them into runs client-side, keep the eligible ones, draw the
 * same uniform sample, then download those runs' boards BY RUN (`seed in (...)`, no row limit per run). Still whole
 * runs by construction: a run's boards are never cut by a per-wave or per-page limit, and the loader re-checks
 * every run against the wave count the listing saw (`isWholeRun`).
 *
 * The api is injected so the tests drive both paths without a network.
 */
import { MIN_RUN_WAVES, runWavesCover, type BoardSnapshot } from '@game/sim';
import type { SetId } from '@game/content';
import type { PoolFetch, PoolRun } from './poolLoader';

/** Runs per sample: about the size of the whole live pool today (150 runs, ~1,760 boards, ~2 MB of JSON before
 *  compression, the same as the old 17 x 120 per-wave pull), and far more than the 7 seats a lobby needs. */
export const POOL_SAMPLE_RUNS = 150;
/** Fallback listing: rows per page (PostgREST's default max-rows) and the most pages read. */
export const FALLBACK_PAGE = 1000;
export const FALLBACK_MAX_PAGES = 20;
/** Fallback download: runs per `seed in (...)` request (x ~18 boards stays under the max-rows cap). */
export const FALLBACK_RUNS_PER_REQUEST = 40;

export interface SampleRow { run_key: string; author: string; user_id: string | null; wave_count: number; boards: BoardSnapshot[] | null }
export interface LightRow { author: string | null; hero_id: string; seed: number | null; wave: number; user_id: string | null; set_id: string | null }
export interface ApiError { code?: string; message: string }
type Res<T> = Promise<{ data: T | null; error: ApiError | null }>;

export interface PoolApi {
  sample(args: { p_limit: number; p_set: string; p_patch_prefix: string; p_exclude_user: string | null }, signal: AbortSignal): Res<SampleRow[]>;
  /** One page of board identities for this build version, stable order (by id). */
  lightPage(patchPrefix: string, from: number, to: number, signal: AbortSignal): Res<LightRow[]>;
  /** Every board of these seeds for this build version. */
  boardsForSeeds(patchPrefix: string, seeds: number[], signal: AbortSignal): Res<Array<{ snapshot: BoardSnapshot; user_id: string | null }>>;
}

export interface PoolFetchOptions {
  setId: SetId;
  patchPrefix: string;
  /** Uniform [0, 1). `Math.random` in the app; seeded in tests. */
  random(): number;
}

/** Session memory: once the RPC answered "not found", go straight to the fallback. */
export interface PoolFetchSession { rpcMissing: boolean }

/** PostgREST's "no such function" (schema cache miss), Postgres' undefined_function, or a bare 404. */
export function isMissingFunction(error: ApiError | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || error.code === '42883' || error.code === '404' || /could not find the function/i.test(error.message);
}

const keyOf = (author: string | null | undefined, heroId: string, seed: number | null | undefined): string => `${author ?? 'anon'}|${heroId}|${seed}`;

/** Uniform sample of `n` from `items` (partial Fisher-Yates on a copy). */
export function sampleUniform<T>(items: readonly T[], n: number, random: () => number): T[] {
  const a = [...items];
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(random() * (a.length - i));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, k);
}

export async function fetchPoolRuns(api: PoolApi, opts: PoolFetchOptions, signal: AbortSignal, session: PoolFetchSession): Promise<PoolFetch> {
  if (!session.rpcMissing) {
    // `p_exclude_user` stays null (owner 2026-09-30: your own runs are opponents too). The SQL keeps the parameter,
    // defaulting to null, so no migration is needed.
    const res = await api.sample({ p_limit: POOL_SAMPLE_RUNS, p_set: opts.setId, p_patch_prefix: opts.patchPrefix, p_exclude_user: null }, signal);
    if (!res.error) {
      const runs: PoolRun[] = (res.data ?? []).map((r) => ({
        key: r.run_key, ownerId: r.user_id, waves: r.wave_count, snaps: Array.isArray(r.boards) ? r.boards : [],
      }));
      return { runs, path: 'rpc' };
    }
    if (!isMissingFunction(res.error)) throw new Error(res.error.message);
    session.rpcMissing = true;
  }
  return { runs: await fallbackRuns(api, opts, signal), path: 'fallback' };
}

async function fallbackRuns(api: PoolApi, opts: PoolFetchOptions, signal: AbortSignal): Promise<PoolRun[]> {
  // 1. Every board identity of this build version, grouped by run.
  const byRun = new Map<string, { waves: Set<number>; ownerId: string | null; setId: string; seed: number }>();
  for (let page = 0; page < FALLBACK_MAX_PAGES; page++) {
    const from = page * FALLBACK_PAGE;
    const res = await api.lightPage(opts.patchPrefix, from, from + FALLBACK_PAGE - 1, signal);
    if (res.error) throw new Error(res.error.message);
    const rows = res.data ?? [];
    for (const r of rows) {
      if (r.seed === null || r.seed === undefined) continue; // no run identity
      const k = keyOf(r.author, r.hero_id, r.seed);
      let e = byRun.get(k);
      if (!e) byRun.set(k, e = { waves: new Set(), ownerId: r.user_id, setId: r.set_id ?? 'set1', seed: r.seed });
      e.waves.add(r.wave);
    }
    if (rows.length < FALLBACK_PAGE) break;
  }
  // 2. The eligible runs of this set (the same rule as seat selection), yours included, sampled uniformly.
  const eligible = [...byRun.entries()].filter(([, e]) =>
    e.setId === opts.setId
    && e.waves.size >= MIN_RUN_WAVES && runWavesCover([...e.waves]));
  const picked = sampleUniform(eligible, POOL_SAMPLE_RUNS, opts.random);
  // 3. Download the picked runs WHOLE: by seed, with no per-wave or per-run limit.
  const want = new Map(picked);
  const snapsByRun = new Map<string, BoardSnapshot[]>();
  const seeds = [...new Set(picked.map(([, e]) => e.seed))];
  const chunks: number[][] = [];
  for (let i = 0; i < seeds.length; i += FALLBACK_RUNS_PER_REQUEST) chunks.push(seeds.slice(i, i + FALLBACK_RUNS_PER_REQUEST));
  const results = await Promise.all(chunks.map((c) => api.boardsForSeeds(opts.patchPrefix, c, signal)));
  for (const res of results) {
    if (res.error) throw new Error(res.error.message);
    for (const row of res.data ?? []) {
      const s = row.snapshot;
      if (!s) continue;
      const k = keyOf(s.author, s.heroId, s.seed);
      if (!want.has(k)) continue; // another run that shares a seed
      const list = snapsByRun.get(k);
      if (list) list.push(s); else snapsByRun.set(k, [s]);
    }
  }
  return [...want.entries()].map(([key, e]) => ({
    key, ownerId: e.ownerId, waves: e.waves.size,
    snaps: (snapsByRun.get(key) ?? []).sort((a, b) => a.wave - b.wave),
  }));
}
