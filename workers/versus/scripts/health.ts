/**
 * `npm run health -- [--record] [--json] [--hub <url>] [--site <url>]` — THE DAILY HEALTH CHECK, on demand
 * (R-OPS-HEALTH-01). Runs the SAME checks as the hub's cron (`src/health/healthCore.ts`) from a dev machine and prints
 * a summary; exit code 1 when any check fails.
 *
 * Plumbing: the hub and the Versus Worker over their public routes; Supabase through the Supabase CLI login the `db:*`
 * scripts already use (`supabase db query --linked`, read-only), calling `ops.health_probe` / `ops.pool_digest`
 * directly as the database admin, so a dev machine holds no writer key. Needs
 * supabase/migrations/2026-11-21-ops-health-checks.sql applied.
 *
 *   --record  also append the run to `ops.health_checks` (source 'cli'); the one write this script can make.
 *   --json    print the raw results instead of the summary.
 */
import { runJson, runSql } from '../../../scripts/supabase/lib.mjs';
import { formatSummary, runHealth, type HealthDeps, type WriteProbe } from '../src/health/healthCore';
import { OPS_ROUTES, SITE_URL, type HubActivity, type PoolDigest, type PoolParams } from '../src/health/healthProtocol';
import { getJson } from '../src/health/hubHealth';
import { FRIENDS_HUB_LIVE_URL } from '../src/hubProtocol';
import { VERSUS_CF_PROTOCOL } from '../src/protocol';

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (k: string): boolean => argv.includes(`--${k}`);
/** A SQL string literal (the CLI takes a file of SQL, not bind parameters). */
const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

const hubUrl = (arg('hub') ?? FRIENDS_HUB_LIVE_URL).replace(/\/$/, '');

async function okJson<T>(url: string): Promise<T> {
  const { status, body } = await getJson(url);
  if (status !== 200 || body == null) throw new Error(`${url} answered ${status}`);
  return body as T;
}

const deps: HealthDeps = {
  source: 'cli',
  now: Date.now(),
  hubUrl,
  siteUrl: (arg('site') ?? SITE_URL).replace(/\/$/, ''),
  cfProtocol: VERSUS_CF_PROTOCOL,
  getJson,
  probe: async (since) => {
    const v = runJson(`select ops.health_probe(${lit(since)}::timestamptz) as v`) as WriteProbe | null;
    if (!v) throw new Error('ops.health_probe answered nothing (is 2026-11-21-ops-health-checks.sql applied?)');
    return v;
  },
  sqlPoolDigest: async (params: PoolParams | null) => {
    const v = runJson(`select ops.pool_digest(${params ? `${lit(JSON.stringify(params))}::jsonb` : 'null'}) as v`) as PoolDigest | null;
    if (!v) throw new Error('ops.pool_digest answered nothing');
    return v;
  },
  mirrorPoolDigest: (params) => okJson<PoolDigest>(`${hubUrl}${OPS_ROUTES.poolDigest}${params ? `?p=${encodeURIComponent(JSON.stringify(params))}` : ''}`),
  activity: () => okJson<HubActivity>(`${hubUrl}${OPS_ROUTES.activity}`),
};

const results = await runHealth(deps);
if (flag('json')) console.log(JSON.stringify(results, null, 2));
else console.log(formatSummary(results));
if (flag('record')) {
  const rows = runSql(`select ops.health_record('cli', ${lit(JSON.stringify(results))}::jsonb) as v`, { readOnly: false });
  console.log(`recorded: ${JSON.stringify(rows[0]?.v ?? null)}`);
}
// exitCode, not exit(): an exit() with fetch's sockets still closing trips a libuv assertion on Windows.
process.exitCode = results.some((r) => r.status === 'fail') ? 1 : 0;
