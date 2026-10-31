/**
 * THE DAILY HEALTH CHECK — its shared vocabulary (owner 2026-10-31: "a small daily health check that compares the
 * Cloudflare pool copy against Supabase, confirms the hub is up, and confirms the end-of-game writes are arriving";
 * R-OPS-HEALTH-01). The checks themselves are `healthCore.ts`; this file is what the hub, the CLI (`npm run health`) and
 * the pool mirror must agree on, byte for byte.
 *
 * Dependency-free: no imports (Web Crypto only, which both the Workers runtime and Node 18+ carry).
 */

/** The cron that runs the check on the hub (`hub.wrangler.toml` [triggers]): once a day, 06:17 UTC. */
export const HEALTH_CRON = '17 6 * * *';

/**
 * CAPABILITIES the hub advertises in `/health` (`caps`). A check that needs a capability the live hub does not
 * advertise is reported `n/a`, never failed, so the check can ship before the thing it checks.
 *   - `live_dir`     the Live Games directory (R-LIVE-DIR-01).
 *   - `activity`     the directory's hourly tally of NEW live listings (`GET /ops/activity`), the "were games played?"
 *                    signal the write-freshness checks key on.
 *   - `pool_mirror`  the pool mirror (R-POOL-MIRROR-01) answers `digest(params)` (in-process) and `GET /ops/pool-digest`.
 *   - `session`      the game session (R-SESSION-CF-01) flushes end-of-game writes through `session_cf_flush`.
 */
export const HUB_CAP = {
  liveDir: 'live_dir',
  activity: 'activity',
  poolMirror: 'pool_mirror',
  session: 'session',
} as const;

export const OPS_ROUTES = {
  /** `{ hours: { 'YYYY-MM-DDTHH': ActivityHour } }`, the last 48 hours (no auth: counts only). */
  activity: '/ops/activity',
  /** `?p=<json params or empty>` -> `PoolDigest` (no auth: hashes only; 404 until the hub carries a pool mirror). */
  poolDigest: '/ops/pool-digest',
} as const;

/** The game's site, and the file the release writes next to index.html (`scripts/release-web.mjs`). */
export const SITE_URL = 'https://ascent-game-web.netlify.app';
export const RELEASE_PATH = '/release.json';

/** One check's verdict. `n/a` = not applicable yet (a capability missing, a quiet day); it never fails the run. */
export type HealthStatus = 'ok' | 'fail' | 'n/a';
export interface HealthResult {
  check: string;
  status: HealthStatus;
  detail: Record<string, unknown>;
}

/** New live listings in one UTC hour, by kind, plus the content revisions lobby games were hosted on. */
export interface ActivityHour {
  /** Ranked lobby games (mode null). */
  lobby: number;
  casual: number;
  practice: number;
  /** Duel + group Versus rooms. */
  versus: number;
  /** Versus Duos + Ranked Duos rooms. */
  duos: number;
  /** `cf:<rev>` hosts of lobby games, counted. */
  revs: Record<string, number>;
}
export interface HubActivity {
  hours: Record<string, ActivityHour>;
}
export const emptyHour = (): ActivityHour => ({ lobby: 0, casual: 0, practice: 0, versus: 0, duos: 0, revs: {} });
/** The hour key of an epoch ms: `YYYY-MM-DDTHH` (UTC). */
export const hourKey = (ms: number): string => new Date(ms).toISOString().slice(0, 13);
/** How many hours of tallies the directory keeps. */
export const ACTIVITY_KEEP_HOURS = 48;

/**
 * THE POOL DIGEST. The same draw on both sides (`params` null = every eligible run in id order, the mirror's whole
 * index; otherwise `pool_runs_sample_keys`'s parameters, which must carry `p_seed` so the draw is deterministic), then
 * one line per drawn run, in draw order:
 *
 *     <run_id>|<run_key>|<rev>|<sha256 hex of the run's boards text>
 *
 * where the boards text is exactly what `pool_runs_boards` serves (`boards::text`, which the mirror holds verbatim).
 * `digest` = sha256 hex of the lines joined by "\n". `rows` carries each run's rev and the first 16 hex of its boards
 * hash, so a mismatch names the runs that differ without either side shipping a board. Supabase side:
 * `ops.pool_digest(p_params)` (supabase/migrations/2026-11-21-ops-health-checks.sql). Mirror side: `poolDigestOf`.
 */
export interface PoolParams {
  p_limit?: number;
  p_set?: string | null;
  p_patch_prefix?: string | null;
  p_seed: string;
  p_strength_min?: number | null;
  p_strength_max?: number | null;
  p_pool?: string | null;
  p_early_weight?: number | null;
  p_strength_cap?: number | null;
}
export interface PoolDigestRow {
  run_id: number;
  rev: string;
  h: string;
}
export interface PoolDigest {
  count: number;
  digest: string;
  rows: PoolDigestRow[];
  /** Mirror side only: when it last synced (epoch ms). */
  syncedAt?: number;
}
/** One run as the mirror holds it. */
export interface DigestRun {
  run_id: number;
  run_key: string;
  rev: string;
  boards: string;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The digest of runs in draw order (the mirror's side of `ops.pool_digest`). */
export async function poolDigestOf(runs: DigestRun[]): Promise<PoolDigest> {
  const lines: string[] = [];
  const rows: PoolDigestRow[] = [];
  for (const r of runs) {
    const h = await sha256Hex(r.boards);
    lines.push(`${r.run_id}|${r.run_key}|${r.rev}|${h}`);
    rows.push({ run_id: r.run_id, rev: r.rev, h: h.slice(0, 16) });
  }
  return { count: runs.length, digest: await sha256Hex(lines.join('\n')), rows };
}
