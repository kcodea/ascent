#!/usr/bin/env node
/**
 * `npm run db:measure` — the repeatable read-only measurement pack behind docs/design/2026-10-28-supabase-cleanup.md
 * (Phase 0.1). Captures the doc's key numbers against the live project and writes a dated markdown report:
 *
 *   - the stats window (pg_stat_statements reset / postmaster start), database size, deadlocks, temp spill, rollbacks
 *   - EGRESS-WEIGHTED drivers: calls (pg_stat_statements) x bytes per answer (measured server-side with
 *     `octet_length` of exactly what the client selects; nothing large crosses the wire)
 *   - the top statements grouped by target (rpc:<fn>, read:<table>, insert:<table>, ...) by total time, and the slowest
 *   - table sizes, dead tuples, scans and writes; pg_cron job health
 *
 *   npm run db:measure [-- --out docs/ops/db-reports/2026-10-28-measure.md] [--json] [--top 25]
 *
 * SELECT only (lib.mjs forces a read-only transaction). Every count covers the window since the last stats reset, so
 * compare reports by RATE (per day), which the report prints next to every total.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, arg, flag, fmtBytes, fmtInt, fmtMs, mdTable, runJson, today } from './lib.mjs';

const argv = process.argv.slice(2);
const TOP = Number(arg(argv, 'top', '25'));
const OUT = path.resolve(ROOT, arg(argv, 'out', `docs/ops/db-reports/${today()}-measure.md`));

// ── 1. Platform: window, size, health, settings ─────────────────────────────────────────────────────────────
const platform = runJson(`
select jsonb_build_object(
  'now', now(),
  'stats_reset', (select stats_reset from extensions.pg_stat_statements_info),
  'postmaster_start', pg_postmaster_start_time(),
  'version', current_setting('server_version'),
  'db_bytes', pg_database_size(current_database()),
  'db', (select to_jsonb(d) from (
     select deadlocks, temp_files, temp_bytes, xact_commit, xact_rollback, blks_hit, blks_read, stats_reset
     from pg_stat_database where datname = current_database()) d),
  'settings', (select jsonb_object_agg(name, setting || coalesce(unit, '')) from pg_settings
     where name in ('work_mem','shared_buffers','max_connections','statement_timeout','lock_timeout',
                    'idle_in_transaction_session_timeout','log_lock_waits','deadlock_timeout','log_min_duration_statement')),
  'role_config', (select jsonb_object_agg(rolname, rolconfig) from pg_roles
     where rolname in ('anon','authenticated','authenticator','service_role') and rolconfig is not null),
  'connections', (select count(*) from pg_stat_activity)
) as v;`);

const windowStart = new Date(platform.stats_reset ?? platform.postmaster_start);
const days = Math.max((new Date(platform.now) - windowStart) / 86_400_000, 1 / 24);
const perDay = (n) => (Number(n) || 0) / days;

// ── 2. Statements, grouped by what they touch ───────────────────────────────────────────────────────────────
const stmts = runJson(`
select coalesce(jsonb_agg(s), '[]') as v from (
  select left(regexp_replace(query, '\\s+', ' ', 'g'), 2000) as q, r.rolname as role, calls, total_exec_time as total_ms,
         mean_exec_time as mean_ms, max_exec_time as max_ms, rows, shared_blks_hit, temp_blks_written
  from extensions.pg_stat_statements p left join pg_roles r on r.oid = p.userid
  where p.dbid = (select oid from pg_database where datname = current_database())
  order by total_exec_time desc limit 3000) s;`);

/** rpc:<fn> | insert:<t> | update:<t> | delete:<t> | read:<t> | realtime:wal | other:<prefix>. */
function targetOf(q) {
  let m;
  if (/wal->>|realtime\.list_changes|wal2json/i.test(q)) return 'realtime:wal-poll';
  // Writes first: `INSERT INTO "public"."t"(cols)` would otherwise read as an RPC call.
  if ((m = /\binsert\s+into\s+"?public"?\."?([a-z_0-9]+)/i.exec(q))) return `insert:${m[1]}`;
  if ((m = /\bupdate\s+"?public"?\."?([a-z_0-9]+)"?\s+set\b/i.exec(q))) return `update:${m[1]}`;
  if ((m = /\bdelete\s+from\s+"?public"?\."?([a-z_0-9]+)/i.exec(q))) return `delete:${m[1]}`;
  // PostgREST RPC: `SELECT "public"."fn"(...)` (scalar) / `LATERAL "public"."fn"(...)` (set-returning).
  if ((m = /\b(?:select|from|lateral)\s+"public"\."([a-z_0-9]+)"\s*\(/i.exec(q))) return `rpc:${m[1]}`;
  if ((m = /^\s*select\s+(?:public\.)?([a-z_0-9]+)\s*\(/i.exec(q)) && !/^(count|now|set_config|pg_|jsonb?_|coalesce|array_|row_to_json)/i.test(m[1])) return `call:${m[1]}`;
  // A PostgREST read: the first qualified column names the table (the FROM can sit past a long select list).
  if ((m = /"public"\."([a-z_0-9]+)"\."[a-z_0-9]+"/i.exec(q)) || (m = /\bfrom\s+"?public"?\."?([a-z_0-9]+)/i.exec(q))) {
    // Career's detail read selects the WHOLE entry blob; the light read projects fields out of it.
    if (m[1] === 'run_history' && /"run_history"\."entry"(?!\s*->)/i.test(q)) return 'read:run_history(entry)';
    return `read:${m[1]}`;
  }
  return `other:${q.replace(/\$\d+/g, '?').slice(0, 60)}`;
}

const groups = new Map();
let totalMs = 0;
for (const s of stmts) {
  totalMs += Number(s.total_ms);
  const k = targetOf(s.q);
  const g = groups.get(k) ?? { target: k, calls: 0, total_ms: 0, max_ms: 0, rows: 0, temp_blks: 0, hit: 0, roles: new Set() };
  g.calls += Number(s.calls); g.total_ms += Number(s.total_ms); g.rows += Number(s.rows);
  g.max_ms = Math.max(g.max_ms, Number(s.max_ms)); g.temp_blks += Number(s.temp_blks_written); g.hit += Number(s.shared_blks_hit);
  if (s.role) g.roles.add(s.role);
  groups.set(k, g);
}
const grouped = [...groups.values()].map((g) => ({ ...g, mean_ms: g.total_ms / Math.max(g.calls, 1), roles: [...g.roles].sort().join(',') }));
const callsOf = (pred) => grouped.filter((g) => pred(g.target)).reduce((a, g) => a + g.calls, 0);

// ── 3. Egress-weighted drivers: bytes per answer measured server-side, times the calls ──────────────────────
// Each probe returns ONE number: the JSON size of exactly what the client's query selects (see the client file named).
const probes = runJson(`
select jsonb_build_object(
  -- remoteBoards.poolApi -> pool_runs_sample: up to 150 WHOLE runs (every board snapshot). Bytes = mean eligible run
  -- (in the busiest set + patch) x min(150, eligible runs there).
  'pool_run_bytes', (select avg(b) from (
     select sum(octet_length(x.snapshot::text)) b from public.pool_runs r
     join public.boards x on coalesce(x.author,'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
     where r.eligible group by r.id) t),
  'pool_eligible_busiest', (select max(n) from (select count(*) n from public.pool_runs where eligible group by set_id, patch_prefix) t),
  'pool_eligible_total', (select count(*) from public.pool_runs where eligible),
  -- progressionRemote.ts: the full catalog list (cosmetic_id, active, admin_off) on every probe.
  'catalog_bytes', (select octet_length(coalesce(jsonb_agg(jsonb_build_object('cosmetic_id', cosmetic_id, 'active', active, 'admin_off', admin_off)), '[]')::text) from public.cosmetic_catalog),
  -- remoteBoards.fetchCareer: up to 50 full run_history.entry blobs per detail read.
  'career_entry_bytes', (select avg(octet_length(entry::text)) from public.run_history),
  -- remoteBoards board-records boot read, paged 1,000 rows at a time: bytes of one full page (id, board_id, outcome).
  'board_results_page_bytes', (select octet_length(coalesce(jsonb_agg(jsonb_build_object('id', id, 'board_id', board_id, 'outcome', outcome)), '[]')::text)
     from (select id, board_id, outcome from public.board_results order by id desc limit 1000) t),
  -- run_telemetry: the stored (compressed) size of a replay, the table's growth driver.
  'telemetry_replay_bytes', (select avg(pg_column_size(replay)) from public.run_telemetry where replay is not null)
) as v;`);

const poolPerCall = Number(probes.pool_run_bytes || 0) * Math.min(150, Number(probes.pool_eligible_busiest || 0));
const drivers = [
  { driver: 'pool_runs_sample (150 whole runs)', calls: callsOf((t) => t === 'rpc:pool_runs_sample'), bytes: poolPerCall },
  { driver: 'cosmetic_catalog full list', calls: grouped.filter((g) => g.target === 'read:cosmetic_catalog').reduce((a, g) => Math.max(a, g.calls), 0), bytes: Number(probes.catalog_bytes || 0) },
  { driver: 'Career detail (50 x run_history.entry)', calls: callsOf((t) => t === 'read:run_history(entry)'), bytes: 50 * Number(probes.career_entry_bytes || 0), note: 'upper bound: a player with < 50 runs gets fewer' },
  { driver: 'board_results read (per 1,000-row page)', calls: callsOf((t) => t === 'read:board_results'), bytes: Number(probes.board_results_page_bytes || 0), note: 'upper bound: incremental pages are smaller' },
].map((d) => ({ ...d, total: d.calls * d.bytes }));

// ── 4. Tables ───────────────────────────────────────────────────────────────────────────────────────────────
const tables = runJson(`
select coalesce(jsonb_agg(t order by t.bytes desc), '[]') as v from (
  select relname as name, pg_total_relation_size(relid) as bytes, n_live_tup as live, n_dead_tup as dead,
         coalesce(seq_scan,0) as seq, coalesce(idx_scan,0) as idx, n_tup_ins as ins, n_tup_upd as upd, n_tup_del as del,
         greatest(last_autovacuum, last_vacuum) as vacuumed
  from pg_stat_user_tables where schemaname = 'public') t;`);

// ── 5. pg_cron ──────────────────────────────────────────────────────────────────────────────────────────────
let cron = [];
try {
  cron = runJson(`
select coalesce(jsonb_agg(c), '[]') as v from (
  select d.jobid, j.jobname, j.schedule, count(*) as runs, count(*) filter (where d.status <> 'succeeded') as failed,
         round(avg(extract(epoch from (d.end_time - d.start_time)) * 1000)) as avg_ms,
         round(max(extract(epoch from (d.end_time - d.start_time)) * 1000)) as max_ms,
         max(d.start_time) as last_run,
         (array_agg(d.return_message order by d.start_time desc) filter (where d.status <> 'succeeded'))[1] as last_error
  from cron.job_run_details d left join cron.job j using (jobid)
  where d.start_time >= now() - interval '16 days'
  group by d.jobid, j.jobname, j.schedule order by d.jobid) c;`);
} catch (e) {
  cron = [{ jobname: `(cron not readable: ${String(e.message).split('\n')[0]})` }];
}

// ── Report ──────────────────────────────────────────────────────────────────────────────────────────────────
const db = platform.db ?? {};
const share = (ms) => (totalMs ? `${((ms / totalMs) * 100).toFixed(1)}%` : '-');
const L = [];
L.push(`# Supabase measurement ${today()}`);
L.push('');
L.push(`Generated by \`npm run db:measure\` (scripts/supabase/measure.mjs), read-only. Project \`${process.env.SUPABASE_PROJECT_REF || 'zcwhbejpqcdcfdpfxeza'}\`.`);
L.push(`Stats window: **${days.toFixed(1)} days** (from ${windowStart.toISOString()} to ${platform.now}). Per-day rates divide by that window.`);
L.push('');
L.push('## Platform');
L.push('');
L.push(mdTable([
  ['Postgres', platform.version],
  ['Database size', fmtBytes(platform.db_bytes)],
  ['Deadlocks', `${fmtInt(db.deadlocks)} (${perDay(db.deadlocks).toFixed(1)}/day)`],
  ['Temp files', `${fmtInt(db.temp_files)} / ${fmtBytes(db.temp_bytes)} (${fmtBytes(perDay(db.temp_bytes))}/day)`],
  ['Commits / rollbacks', `${fmtInt(db.xact_commit)} / ${fmtInt(db.xact_rollback)} (${((Number(db.xact_rollback) / Math.max(Number(db.xact_commit) + Number(db.xact_rollback), 1)) * 100).toFixed(1)}%)`],
  ['Cache hit', `${((Number(db.blks_hit) / Math.max(Number(db.blks_hit) + Number(db.blks_read), 1)) * 100).toFixed(2)}%`],
  ['Connections now', platform.connections],
  ['Statement time in window', `${fmtMs(totalMs)} across ${fmtInt(stmts.reduce((a, s) => a + Number(s.calls), 0))} calls (top 3000 statements)`],
  ...Object.entries(platform.settings ?? {}).map(([k, v]) => [k, v]),
  ...Object.entries(platform.role_config ?? {}).map(([k, v]) => [`role ${k}`, (v ?? []).join(', ')]),
], [['Item', (r) => r[0]], ['Value', (r) => r[1]]]));
L.push('');
L.push('## Egress-weighted drivers (estimate: uncompressed JSON)');
L.push('');
L.push(`Pool: ${fmtInt(probes.pool_eligible_total)} eligible runs (busiest set+patch ${fmtInt(probes.pool_eligible_busiest)}), mean run ${fmtBytes(probes.pool_run_bytes)}. Replay mean stored size ${fmtBytes(probes.telemetry_replay_bytes)}.`);
L.push('');
L.push(mdTable(drivers, [
  ['Driver', (d) => d.driver], ['Calls', (d) => fmtInt(d.calls), 'r'], ['Bytes / call', (d) => fmtBytes(d.bytes), 'r'],
  ['Window', (d) => fmtBytes(d.total), 'r'], ['Per 30 days', (d) => fmtBytes(perDay(d.total) * 30), 'r'], ['Note', (d) => d.note ?? ''],
]));
L.push('');
L.push(`## Top ${TOP} targets by total time`);
L.push('');
L.push(mdTable([...grouped].sort((a, b) => b.total_ms - a.total_ms).slice(0, TOP), [
  ['Target', (g) => `\`${g.target}\``], ['Calls', (g) => fmtInt(g.calls), 'r'], ['Calls/day', (g) => fmtInt(perDay(g.calls)), 'r'],
  ['Mean', (g) => fmtMs(g.mean_ms), 'r'], ['Max', (g) => fmtMs(g.max_ms), 'r'], ['Total', (g) => fmtMs(g.total_ms), 'r'],
  ['Share', (g) => share(g.total_ms), 'r'], ['Temp written', (g) => fmtBytes(g.temp_blks * 8192), 'r'], ['Roles', (g) => g.roles],
]));
L.push('');
L.push(`## Slowest targets by mean (>= 20 calls)`);
L.push('');
L.push(mdTable(grouped.filter((g) => g.calls >= 20).sort((a, b) => b.mean_ms - a.mean_ms).slice(0, TOP), [
  ['Target', (g) => `\`${g.target}\``], ['Calls', (g) => fmtInt(g.calls), 'r'], ['Mean', (g) => fmtMs(g.mean_ms), 'r'],
  ['Max', (g) => fmtMs(g.max_ms), 'r'], ['Total', (g) => fmtMs(g.total_ms), 'r'],
]));
L.push('');
L.push(`## Most-called targets`);
L.push('');
L.push(mdTable([...grouped].sort((a, b) => b.calls - a.calls).slice(0, TOP), [
  ['Target', (g) => `\`${g.target}\``], ['Calls', (g) => fmtInt(g.calls), 'r'], ['Calls/day', (g) => fmtInt(perDay(g.calls)), 'r'],
  ['Mean', (g) => fmtMs(g.mean_ms), 'r'], ['Rows returned', (g) => fmtInt(g.rows), 'r'],
]));
L.push('');
L.push('## Tables (public)');
L.push('');
L.push(mdTable(tables, [
  ['Table', (t) => `\`${t.name}\``], ['Size', (t) => fmtBytes(t.bytes), 'r'], ['Live', (t) => fmtInt(t.live), 'r'], ['Dead', (t) => fmtInt(t.dead), 'r'],
  ['Seq scans', (t) => fmtInt(t.seq), 'r'], ['Idx scans', (t) => fmtInt(t.idx), 'r'], ['Ins / Upd / Del', (t) => `${fmtInt(t.ins)} / ${fmtInt(t.upd)} / ${fmtInt(t.del)}`],
  ['Last vacuum', (t) => (t.vacuumed ? String(t.vacuumed).slice(0, 16) : '-')],
]));
L.push('');
L.push('## pg_cron (last 16 days)');
L.push('');
L.push(cron.length ? mdTable(cron, [
  ['Job', (c) => `${c.jobid ?? ''} ${c.jobname ?? '(deleted)'}`], ['Schedule', (c) => c.schedule ?? ''], ['Runs', (c) => fmtInt(c.runs), 'r'],
  ['Failed', (c) => fmtInt(c.failed), 'r'], ['Avg', (c) => fmtMs(c.avg_ms), 'r'], ['Max', (c) => fmtMs(c.max_ms), 'r'],
  ['Last run', (c) => String(c.last_run ?? '').slice(0, 16)], ['Last error', (c) => String(c.last_error ?? '').slice(0, 80)],
]) : '(no runs)');
L.push('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join('\n'));
if (flag(argv, 'json')) {
  fs.writeFileSync(OUT.replace(/\.md$/, '.json'), JSON.stringify({ platform, days, probes, drivers, grouped, tables, cron }, null, 1));
}
console.log(`db:measure: ${days.toFixed(1)}-day window, ${fmtBytes(platform.db_bytes)}, deadlocks ${db.deadlocks}, temp ${fmtBytes(db.temp_bytes)}`);
for (const d of drivers) console.log(`  ${d.driver}: ${fmtInt(d.calls)} x ${fmtBytes(d.bytes)} = ${fmtBytes(d.total)}`);
console.log(`wrote ${path.relative(ROOT, OUT)}`);
