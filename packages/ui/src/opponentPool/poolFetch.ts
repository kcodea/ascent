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
import { MIN_RUN_WAVES, OPPONENT_SEATS, bandSteps, runWavesCover, seatableRuns, type BoardSnapshot, type StrengthBand } from '@game/sim';
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

export interface SampleRow { run_key: string; author: string; user_id: string | null; wave_count: number; boards: BoardSnapshot[] | null;
  /** The run's strength percentile (R-LOBBY-09); absent before the 2026-09-30 SQL, null = unscored. */
  strength?: number | string | null }
export interface SampleArgs {
  p_limit: number; p_set: string; p_patch_prefix: string; p_exclude_user: string | null;
  /** The matchmaking band (R-LOBBY-09). Only sent once the server has it (`PoolFetchSession.bandsMissing`). */
  p_strength_min?: number; p_strength_max?: number;
}
export interface LightRow { author: string | null; hero_id: string; seed: number | null; wave: number; user_id: string | null; set_id: string | null }
export interface ApiError { code?: string; message: string }
type Res<T> = Promise<{ data: T | null; error: ApiError | null }>;

export interface PoolApi {
  sample(args: SampleArgs, signal: AbortSignal): Res<SampleRow[]>;
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
  /** The player's matchmaking band (R-LOBBY-09); null = uncapped (Platinum, or no rank yet). */
  band?: StrengthBand | null;
}

/** Session memory: once the RPC answered "not found", go straight to the fallback. `bandsMissing`: the RPC exists
 *  but does not take a band yet (the 2026-09-30 SQL has not been run), so the band is not sent this session. */
export interface PoolFetchSession { rpcMissing: boolean; bandsMissing?: boolean }

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

const strengthOfRow = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Who a delivered run belongs to, for the seat estimate (the account, else the author in the run key). */
function ownerOfRun(r: PoolRun): string | null {
  if (r.ownerId) return `id:${r.ownerId}`;
  const author = r.key.split('|')[0];
  return author && author !== 'anon' ? `name:${author.toLowerCase()}` : null;
}

/**
 * One sample of whole runs. With a band (R-LOBBY-09) the server draws only runs inside it (unscored runs count as
 * inside); when those cannot fill a table under the per-player cap, the band widens step by step (+10 on each
 * capped side, `bandSteps`) and the wider sample is merged in, until it can or the band is uncapped. The number of
 * widening steps is reported (`widenings`) for pool telemetry. Before the server takes a band, the band is dropped
 * for the session (feature-detected) and the sample is exactly the uncapped one of before.
 */
export async function fetchPoolRuns(api: PoolApi, opts: PoolFetchOptions, signal: AbortSignal, session: PoolFetchSession): Promise<PoolFetch> {
  if (!session.rpcMissing) {
    // `p_exclude_user` stays null (owner 2026-09-30: your own runs are opponents too). The SQL keeps the parameter,
    // defaulting to null.
    const base: SampleArgs = { p_limit: POOL_SAMPLE_RUNS, p_set: opts.setId, p_patch_prefix: opts.patchPrefix, p_exclude_user: null };
    const steps = bandSteps(opts.band ?? null);
    const byKey = new Map<string, PoolRun>();
    let widenings = 0;
    for (let i = 0; i < steps.length; i++) {
      const band = session.bandsMissing ? null : steps[i]!;
      const args: SampleArgs = band ? { ...base, p_strength_min: band.min, p_strength_max: band.max } : base;
      let res = await api.sample(args, signal);
      if (res.error && band && isMissingFunction(res.error)) {
        // The RPC exists but not with a band yet: drop the band for the session and ask the plain way.
        session.bandsMissing = true;
        res = await api.sample(base, signal);
      }
      if (res.error) {
        if (!isMissingFunction(res.error)) throw new Error(res.error.message);
        session.rpcMissing = true;
        break;
      }
      widenings = i;
      for (const r of res.data ?? []) {
        if (byKey.has(r.run_key)) continue;
        const strength = strengthOfRow(r.strength);
        byKey.set(r.run_key, {
          key: r.run_key, ownerId: r.user_id, waves: r.wave_count, snaps: Array.isArray(r.boards) ? r.boards : [],
          ...(strength !== undefined ? { strength } : {}),
        });
      }
      // Enough runs to seat a table (or nothing narrower to ask for): stop widening.
      if (session.bandsMissing || !steps[i] || seatableRuns([...byKey.values()].map(ownerOfRun)) >= OPPONENT_SEATS) break;
    }
    if (!session.rpcMissing) return { runs: [...byKey.values()], path: 'rpc', ...(opts.band && !session.bandsMissing ? { widenings } : {}) };
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
