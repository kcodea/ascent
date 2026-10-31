/**
 * THE DAILY HEALTH CHECK — the checks (R-OPS-HEALTH-01; owner 2026-10-31). Pure: everything it reads is handed in
 * (`HealthDeps`), so the hub's cron (`hubWorker.ts` `scheduled`), the CLI (`npm run health`,
 * `scripts/health.ts`) and the tests run the SAME code with different plumbing.
 *
 *   hub              `ascent-hub` answers `/health`, its protocol range is sane, it carries a real deploy hash.
 *   versus_worker    the CURRENT versioned Versus Worker (its revision from the site's `release.json`, else the
 *                    revision live lobby games were hosted on, else the newest Cloudflare match) answers `/health`
 *                    with its own name's protocol and revision.
 *   pool.whole       the hub's pool mirror vs Supabase, every eligible run (keys + revs + a hash of each run's boards).
 *   pool.draw        the same for one seeded `pool_runs_sample_keys` draw (the mirror's port of the pick).
 *   writes.lobby     games were listed -> run_history, boards and lobby_fights rows arrived in the same window.
 *   writes.versus    Versus rooms were listed -> Cloudflare versus_matches rows arrived.
 *   writes.duos      Duos rooms were listed -> duos_match_history rows arrived.
 *   session.flush    the session's end-of-game flush rejected no writes (R-SESSION-CF-01).
 *   writer_key       the hub's writer key is accepted by Supabase (cron) / the hub's key row exists (CLI).
 *
 * A check whose subject is not deployed yet (a hub capability missing, the session SQL not applied) is `n/a`, never a
 * failure; a quiet day (too few games to expect rows) is `n/a` too. Thresholds: `HEALTH_LIMITS`.
 */
import { activitySince } from '../core/liveActivity';
import {
  HUB_CAP, RELEASE_PATH,
  type HealthResult, type HubActivity, type PoolDigest, type PoolParams,
} from './healthProtocol';

/** What the Supabase probe answers (`ops.health_probe`, supabase/migrations/2026-11-21-ops-health-checks.sql). */
export interface WriteProbe {
  since: string;
  /** The note of the writer key that made the call (the hub's cron path); absent on the CLI (admin) path. */
  key_note?: string | null;
  /** The notes of every writer key row (never the hashes). */
  writer_keys: string[];
  /** Rows since `since`; null = that table does not exist. */
  counts: Partial<Record<'run_history' | 'boards' | 'lobby_fights' | 'run_telemetry' | 'versus_cf' | 'duos_history' | 'saved_runs' | 'in_game', number | null>>;
  /** Newest row per table (ISO), any age. */
  latest: Record<string, string | null>;
  /** The newest Cloudflare match's content revision (last 7 days). */
  latest_cf_revision: string | null;
  /** The session's flush ledger since `since`; null = the session SQL is not applied. */
  session: { applied: number; rejected: number } | null;
}

export interface HealthDeps {
  source: 'cron' | 'cli';
  now: number;
  hubUrl: string;
  siteUrl: string;
  /** The Versus Worker protocol this code expects (`VERSUS_CF_PROTOCOL`). */
  cfProtocol: number;
  /** GET a URL: its status and JSON body (null when not JSON). Throws on a network error. */
  getJson(url: string): Promise<{ status: number; body: unknown }>;
  /** The Supabase write probe. Throws when Supabase refuses (a bad key: `not_authorized`). */
  probe(sinceIso: string): Promise<WriteProbe>;
  /** Supabase's pool digest (`ops.pool_digest`). */
  sqlPoolDigest(params: PoolParams | null): Promise<PoolDigest>;
  /** The hub mirror's pool digest (only called when the hub advertises `pool_mirror`). */
  mirrorPoolDigest(params: PoolParams | null): Promise<PoolDigest>;
  /** The directory's activity (only called when the hub advertises `activity`). */
  activity(): Promise<HubActivity>;
}

export const HEALTH_LIMITS = {
  /** The freshness window. */
  windowHours: 24,
  /** Lobby games listed in the window before end-of-game rows are demanded (a few may be abandoned). */
  minLobbyGames: 3,
  /** Same, without the hub's tally: the DB's own activity signal (cloud saves made in the window). */
  minSavedRuns: 3,
  minVersusRooms: 2,
  minDuosRooms: 3,
} as const;

const VERSUS_URL = /^https:\/\/ascent-versus-v(\d+)-([0-9a-z]+)\.team-ascent\.workers\.dev$/;
const REV = /^[0-9a-z]{1,40}$/;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const err = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 300);

// ── hub ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function checkHub(d: HealthDeps): Promise<{ result: HealthResult; caps: string[] }> {
  const url = `${d.hubUrl}/health`;
  try {
    const { status, body } = await d.getJson(url);
    const b = obj(body);
    const hub = Number(b?.hub), min = Number(b?.min);
    const code = typeof b?.code === 'string' ? b.code : null;
    const caps = Array.isArray(b?.caps) ? b!.caps.filter((c): c is string => typeof c === 'string') : [];
    const problems: string[] = [];
    if (status !== 200 || !b) problems.push(`status ${status}`);
    else {
      if (!Number.isInteger(hub) || !Number.isInteger(min) || min < 1 || hub < min) problems.push(`bad protocol range ${hub}/${min}`);
      if (!code || code === 'dev') problems.push(`no deploy hash (code ${code ?? 'missing'})`);
    }
    return { result: { check: 'hub', status: problems.length ? 'fail' : 'ok', detail: { url, hub, min, code, caps, ...(problems.length ? { problems } : {}) } }, caps };
  } catch (e) {
    return { result: { check: 'hub', status: 'fail', detail: { url, error: err(e) } }, caps: [] };
  }
}

// ── the current Versus Worker ───────────────────────────────────────────────────────────────────────────────────

/** Which Worker the live site uses: the release's own record first, then what live games ran on, then Supabase. */
export async function currentVersus(d: HealthDeps, activityRev: string | null, probe: WriteProbe | null): Promise<{ url: string; rev: string; source: string } | null> {
  try {
    const { status, body } = await d.getJson(`${d.siteUrl}${RELEASE_PATH}`);
    const b = obj(body);
    const m = typeof b?.versusWorker === 'string' ? VERSUS_URL.exec(b.versusWorker) : null;
    if (status === 200 && m) return { url: m[0], rev: m[2]!, source: 'release.json' };
  } catch { /* the site is checked by its own Worker check below; fall through */ }
  const at = (rev: string, source: string) => ({ url: `https://ascent-versus-v${d.cfProtocol}-${rev}.team-ascent.workers.dev`, rev, source });
  if (activityRev && REV.test(activityRev)) return at(activityRev, 'live lobby games');
  if (probe?.latest_cf_revision && REV.test(probe.latest_cf_revision)) return at(probe.latest_cf_revision, 'newest Cloudflare match');
  return null;
}

export async function checkVersus(d: HealthDeps, cur: { url: string; rev: string; source: string } | null): Promise<HealthResult> {
  if (!cur) return { check: 'versus_worker', status: 'n/a', detail: { reason: 'no current revision known (no release.json, no live games, no recent Cloudflare match)' } };
  const url = `${cur.url}/health`;
  try {
    const { status, body } = await d.getJson(url);
    const b = obj(body);
    const named = VERSUS_URL.exec(cur.url);
    const problems: string[] = [];
    if (status !== 200 || !b) problems.push(`status ${status}`);
    else {
      if (String(b.contentRevision) !== cur.rev) problems.push(`carries ${String(b.contentRevision)}, not ${cur.rev}`);
      if (named && Number(b.cfProtocol) !== Number(named[1])) problems.push(`cfProtocol ${String(b.cfProtocol)}, named v${named[1]}`);
      if (Number(b.cfProtocol) !== d.cfProtocol) problems.push(`cfProtocol ${String(b.cfProtocol)}, this code expects ${d.cfProtocol}`);
    }
    return {
      check: 'versus_worker', status: problems.length ? 'fail' : 'ok',
      detail: { url: cur.url, source: cur.source, cfProtocol: b?.cfProtocol, protocol: b?.protocol, contentRevision: b?.contentRevision, ...(problems.length ? { problems } : {}) },
    };
  } catch (e) {
    return { check: 'versus_worker', status: 'fail', detail: { url: cur.url, source: cur.source, error: err(e) } };
  }
}

// ── pool parity ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Where two digests differ, by run. */
export function comparePoolDigests(sql: PoolDigest, mirror: PoolDigest): { same: boolean; detail: Record<string, unknown> } {
  const base = { sqlCount: sql.count, mirrorCount: mirror.count, sqlDigest: sql.digest.slice(0, 16), mirrorDigest: mirror.digest.slice(0, 16) };
  if (sql.digest === mirror.digest && sql.count === mirror.count) return { same: true, detail: base };
  const m = new Map(mirror.rows.map((r) => [r.run_id, r]));
  const s = new Map(sql.rows.map((r) => [r.run_id, r]));
  const missing = sql.rows.filter((r) => !m.has(r.run_id)).map((r) => r.run_id);
  const extra = mirror.rows.filter((r) => !s.has(r.run_id)).map((r) => r.run_id);
  const stale: number[] = [];
  const byteDrift: number[] = [];
  for (const r of sql.rows) {
    const o = m.get(r.run_id);
    if (!o) continue;
    if (o.rev !== r.rev) stale.push(r.run_id);
    else if (o.h !== r.h) byteDrift.push(r.run_id);
  }
  const orderDiffers = !missing.length && !extra.length && sql.rows.some((r, i) => mirror.rows[i]?.run_id !== r.run_id);
  const cap = (a: number[]) => a.slice(0, 10);
  return {
    same: false,
    detail: {
      ...base, missing: cap(missing), missingCount: missing.length, extra: cap(extra), extraCount: extra.length,
      stale: cap(stale), staleCount: stale.length, byteDrift: cap(byteDrift), byteDriftCount: byteDrift.length, orderDiffers,
      ...(mirror.syncedAt ? { mirrorSyncAgeMin: Math.round((Date.now() - mirror.syncedAt) / 60_000) } : {}),
    },
  };
}

/** The draw the parity check compares (seeded by the UTC date, so each day samples a different draw). */
export const poolDrawParams = (now: number): PoolParams => ({ p_limit: 150, p_seed: `health:${new Date(now).toISOString().slice(0, 10)}` });

export async function checkPool(d: HealthDeps, caps: string[]): Promise<HealthResult[]> {
  const sets: [string, PoolParams | null][] = [['pool.whole', null], ['pool.draw', poolDrawParams(d.now)]];
  if (!caps.includes(HUB_CAP.poolMirror)) {
    return sets.map(([check]) => ({ check, status: 'n/a', detail: { reason: `the hub does not advertise '${HUB_CAP.poolMirror}' yet` } }));
  }
  const out: HealthResult[] = [];
  for (const [check, params] of sets) {
    try {
      const [sql, mirror] = await Promise.all([d.sqlPoolDigest(params), d.mirrorPoolDigest(params)]);
      const c = comparePoolDigests(sql, mirror);
      out.push({ check, status: c.same ? 'ok' : 'fail', detail: { ...(params ? { params } : {}), ...c.detail } });
    } catch (e) {
      out.push({ check, status: 'fail', detail: { error: err(e) } });
    }
  }
  return out;
}

// ── write freshness ─────────────────────────────────────────────────────────────────────────────────────────────

export function checkWrites(probe: WriteProbe, activity: HubActivity | null, sinceMs: number): HealthResult[] {
  const c = probe.counts;
  const n = (k: keyof WriteProbe['counts']): number => Number(c[k] ?? 0);
  const L = HEALTH_LIMITS;
  const act = activity ? activitySince(activity, sinceMs) : null;
  const out: HealthResult[] = [];

  // Lobby: the hub's tally of listed ranked lobby games, else the DB's own signal (cloud saves made in the window).
  {
    const demand = act ? act.lobby : n('saved_runs');
    const signal = act ? 'lobby games listed (hub)' : 'cloud saves made (Supabase; the hub has no activity tally)';
    const min = act ? L.minLobbyGames : L.minSavedRuns;
    const rows = { run_history: c.run_history ?? null, boards: c.boards ?? null, lobby_fights: c.lobby_fights ?? null };
    const latest = { run_history: probe.latest.run_history ?? null, boards: probe.latest.boards ?? null, lobby_fights: probe.latest.lobby_fights ?? null };
    if (demand < min) out.push({ check: 'writes.lobby', status: 'n/a', detail: { reason: `quiet: ${demand} ${signal}, fewer than ${min}`, rows, latest } });
    else {
      const missing = (Object.keys(rows) as (keyof typeof rows)[]).filter((k) => !(Number(rows[k] ?? 0) > 0));
      out.push({ check: 'writes.lobby', status: missing.length ? 'fail' : 'ok', detail: { demand, signal, rows, latest, ...(missing.length ? { missing } : {}) } });
    }
  }
  // Versus + Duos: only the hub knows rooms were played.
  const room = (check: string, demand: number | null, min: number, key: 'versus_cf' | 'duos_history', what: string): HealthResult => {
    const rows = { [key]: c[key] ?? null };
    const latest = { [key]: probe.latest[key] ?? null };
    if (demand == null) return { check, status: 'n/a', detail: { reason: `the hub does not advertise '${HUB_CAP.activity}'`, rows, latest } };
    if (demand < min) return { check, status: 'n/a', detail: { reason: `quiet: ${demand} ${what} listed, fewer than ${min}`, rows, latest } };
    return { check, status: n(key) > 0 ? 'ok' : 'fail', detail: { demand, rows, latest, ...(n(key) > 0 ? {} : { missing: [key] }) } };
  };
  out.push(room('writes.versus', act ? act.versus : null, L.minVersusRooms, 'versus_cf', 'Versus rooms'));
  out.push(room('writes.duos', act ? act.duos : null, L.minDuosRooms, 'duos_history', 'Duos rooms'));
  return out;
}

export function checkSession(probe: WriteProbe | null, caps: string[]): HealthResult {
  if (!caps.includes(HUB_CAP.session)) return { check: 'session.flush', status: 'n/a', detail: { reason: `the hub does not advertise '${HUB_CAP.session}' yet` } };
  if (!probe) return { check: 'session.flush', status: 'fail', detail: { reason: 'the Supabase probe failed' } };
  if (!probe.session) return { check: 'session.flush', status: 'n/a', detail: { reason: 'the session SQL (session_cf_writes) is not applied' } };
  const { applied, rejected } = probe.session;
  return { check: 'session.flush', status: rejected > 0 ? 'fail' : 'ok', detail: { applied, rejected } };
}

export function checkWriterKey(source: HealthDeps['source'], probe: WriteProbe | null, probeError: string | null): HealthResult {
  if (source === 'cron') {
    if (!probe) return { check: 'writer_key', status: 'fail', detail: { error: probeError ?? 'probe failed' } };
    return probe.key_note != null
      ? { check: 'writer_key', status: 'ok', detail: { note: probe.key_note, rows: probe.writer_keys } }
      : { check: 'writer_key', status: 'fail', detail: { error: 'the probe answered without a key note', rows: probe.writer_keys } };
  }
  // The CLI runs as the database admin: it cannot test the hub's secret (only the hub holds it), only that its row is
  // there. The cron's own run proves the secret every day.
  if (!probe) return { check: 'writer_key', status: 'fail', detail: { error: probeError ?? 'probe failed' } };
  const has = probe.writer_keys.includes('ascent-hub');
  return { check: 'writer_key', status: has ? 'ok' : 'fail', detail: { rows: probe.writer_keys, note: 'CLI: row present only; the hub cron proves the secret', ...(has ? {} : { missing: ['ascent-hub'] }) } };
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function runHealth(d: HealthDeps): Promise<HealthResult[]> {
  const sinceMs = d.now - HEALTH_LIMITS.windowHours * 3_600_000;
  const out: HealthResult[] = [];
  const { result: hub, caps } = await checkHub(d);
  out.push(hub);

  let activity: HubActivity | null = null;
  if (caps.includes(HUB_CAP.activity)) {
    try { activity = await d.activity(); } catch (e) { out.push({ check: 'activity', status: 'fail', detail: { error: err(e) } }); }
  }
  let probe: WriteProbe | null = null;
  let probeError: string | null = null;
  try { probe = await d.probe(new Date(sinceMs).toISOString()); } catch (e) { probeError = err(e); }

  const actRev = activity ? activitySince(activity, d.now - 7 * 24 * 3_600_000).latestRev : null;
  out.push(await checkVersus(d, await currentVersus(d, actRev, probe)));
  out.push(...(await checkPool(d, caps)));
  if (probe) out.push(...checkWrites(probe, activity, sinceMs));
  else for (const check of ['writes.lobby', 'writes.versus', 'writes.duos']) out.push({ check, status: 'fail', detail: { reason: 'the Supabase probe failed', error: probeError } });
  out.push(checkSession(probe, caps));
  out.push(checkWriterKey(d.source, probe, probeError));
  return out;
}

/** The run's one-line verdict and a row per check (the CLI prints it; the cron logs it). */
export function formatSummary(results: HealthResult[]): string {
  const bad = results.filter((r) => r.status === 'fail');
  const mark = { ok: 'ok  ', fail: 'FAIL', 'n/a': 'n/a ' } as const;
  const lines = results.map((r) => {
    const d = r.detail;
    const why = d.problems ?? d.missing ?? d.reason ?? d.error ?? '';
    return `  ${mark[r.status]}  ${r.check.padEnd(14)} ${typeof why === 'string' ? why : JSON.stringify(why)}`;
  });
  return [`health: ${bad.length ? `${bad.length} FAILING (${bad.map((r) => r.check).join(', ')})` : 'all good'}`, ...lines].join('\n');
}
