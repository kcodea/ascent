/**
 * THE DAILY HEALTH CHECK on the hub (R-OPS-HEALTH-01): the plumbing `healthCore.ts` runs on inside `ascent-hub`'s cron
 * (`HEALTH_CRON`), and the record it leaves in Supabase (`ops.health_checks`, through the key-gated
 * `ops_health_record`, with the hub's own writer secret; never the service role).
 *
 * Why the hub: it is the one Worker that is always deployed (never per content revision), it holds the pool mirror and
 * the Live Games directory in-process, and it already holds a Supabase writer key. If the hub itself is down, no row is
 * written: the lead's session-start query treats "no cron row in 26 hours" as a failure (docs/ops/health-check.md).
 *
 * The pool mirror is reached duck-typed (`env.POOL`), and only when the hub ADVERTISES `pool_mirror` (`HUB_CAPS` in
 * below): this file never imports the mirror, so it ships before the mirror does.
 */
import { VERSUS_CF_PROTOCOL } from '../protocol';
import { runHealth, formatSummary, type HealthDeps, type WriteProbe } from './healthCore';
import { HUB_CAP, SITE_URL, type HealthResult, type HubActivity, type PoolDigest, type PoolParams } from './healthProtocol';

/**
 * What this hub can do, for the daily health check (R-OPS-HEALTH-01): a check whose capability is missing is `n/a`.
 * ADD `HUB_CAP.poolMirror` in the PR whose PoolMirror object answers `digest(params)` (healthProtocol.ts `poolDigestOf`),
 * and `HUB_CAP.session` in the PR that turns the session's `session_cf_flush` on. Never advertise one before it is true.
 */
export const HUB_CAPS: readonly string[] = [HUB_CAP.liveDir, HUB_CAP.activity];

/** `?p=` of `/ops/pool-digest`: empty = the whole pool; else seeded `pool_runs_sample_keys` parameters. */
export function digestParams(raw: string | null): PoolParams | null | 'bad' {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as PoolParams;
    if (!p || typeof p !== 'object' || typeof p.p_seed !== 'string' || p.p_seed.length > 80) return 'bad';
    if (p.p_limit != null && !(Number.isInteger(p.p_limit) && p.p_limit >= 0 && p.p_limit <= 300)) return 'bad';
    return p;
  } catch {
    return 'bad';
  }
}

export interface HealthEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  HUB_WRITER_SECRET?: string;
  /** Overrides (tests, a staging hub): where the hub and the site answer. */
  HEALTH_HUB_URL?: string;
  HEALTH_SITE_URL?: string;
}

/** The mirror's digest, as the pool-mirror PR exposes it on its Durable Object (RPC). */
export interface PoolDigestSource {
  digest(params: PoolParams | null): Promise<PoolDigest>;
}

export async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* not JSON (an SPA fallback page, an error page) */ }
  return { status: res.status, body };
}

/** One key-gated RPC with the hub's writer secret. */
export async function supabaseRpc(env: HealthEnv, fn: string, args: Record<string, unknown>): Promise<unknown> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.HUB_WRITER_SECRET) throw new Error('no Supabase writer configured (SUPABASE_URL / SUPABASE_ANON_KEY / HUB_WRITER_SECRET)');
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: env.HUB_WRITER_SECRET, ...args }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export function hubHealthDeps(env: HealthEnv, hubUrl: string, opts: { activity: () => Promise<HubActivity>; pool: PoolDigestSource | null; now?: number }): HealthDeps {
  return {
    source: 'cron',
    now: opts.now ?? Date.now(),
    hubUrl: env.HEALTH_HUB_URL ?? hubUrl,
    siteUrl: env.HEALTH_SITE_URL ?? SITE_URL,
    cfProtocol: VERSUS_CF_PROTOCOL,
    getJson,
    probe: async (since) => (await supabaseRpc(env, 'ops_health_probe', { p_since: since })) as WriteProbe,
    sqlPoolDigest: async (params) => (await supabaseRpc(env, 'ops_pool_digest', { p_params: params })) as PoolDigest,
    mirrorPoolDigest: async (params) => {
      if (!opts.pool) throw new Error('the hub advertises pool_mirror but has no POOL binding');
      return opts.pool.digest(params);
    },
    activity: opts.activity,
  };
}

/** Run every check and record the rows. Never throws (a cron that throws only leaves a log line). */
export async function runAndRecord(env: HealthEnv, deps: HealthDeps): Promise<{ results: HealthResult[]; recorded: boolean }> {
  const results = await runHealth(deps);
  let recorded = false;
  try {
    await supabaseRpc(env, 'ops_health_record', { p_source: deps.source, p_rows: results });
    recorded = true;
  } catch (e) {
    console.warn(JSON.stringify({ ev: 'health_record_failed', error: String(e).slice(0, 300) }));
  }
  const failing = results.filter((r) => r.status === 'fail').map((r) => r.check);
  console.log(JSON.stringify({ ev: 'health', failing, recorded }));
  if (failing.length) console.warn(formatSummary(results));
  return { results, recorded };
}
