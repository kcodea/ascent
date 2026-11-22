/**
 * THE CRASH DIGEST, Supabase side (R-OPS-HEALTH-04), EXECUTED. PGlite runs the crash table's two migrations, the
 * health-check file (for the `ops` schema and the key gate), then `2026-11-30-ops-crash-digest.sql` twice (idempotent),
 * and proves:
 *
 *  - the wrapper is key-gated (no key, a wrong key: `not_authorized`), refuses a bad mode, and client roles cannot call
 *    the `ops.*` functions directly;
 *  - the hour digest: per platform the last hour's count and players, kinds and versions with their first-seen time over
 *    the trailing 7 days, the top 3 messages (without the "kind: " prefix), the 168-hour baseline (zero hours count);
 *    perf rows and rows outside the window never count;
 *  - the day digest: yesterday per platform and kind against the 7 days before it as a daily average;
 *  - nothing identifying comes back: no user id, no user agent, no payload text;
 *  - SPEED: a 7-day table of ~21k rows (realistic payloads, a quarter of them 20 KB phone crash sessions) answers both
 *    modes well under the anon role's 3 s ceiling.
 *
 * Measured 2026-11-22 on PGlite (in-process WASM Postgres, Windows dev box; see the `speed` test's log line): the hour
 * digest 80 ms and the day digest 32 ms over 21,000 rows (a week at 125 reports an hour, about 50x today's live
 * volume). Neither digest reads `payload`, so a cold read is the window's heap pages only, never the TOASTed payloads.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const TABLE = read('2026-10-22-client-crash-reports.sql');
const DESKTOP = read('2026-11-29-client-crash-reports-desktop.sql');
const HEALTH = read('2026-11-21-ops-health-checks.sql');
const DIGEST = read('2026-11-30-ops-crash-digest.sql');
const SECRET = 'test-hub-secret-not-real';
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
/** A fixed "now" so the hour boundaries are exact. */
const AT = '2026-11-22T14:30:00Z';

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions;
  create extension pgcrypto with schema extensions;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  create table public.versus_cf_writer_keys (key_hash text primary key, note text, created_at timestamptz not null default now());
  insert into public.versus_cf_writer_keys (key_hash, note) values ('${createHash('sha256').update(SECRET).digest('hex')}', 'ascent-hub');
`;

let db: PGlite;

interface Row { at: string; platform?: string; kind?: string; version?: string; user?: string | null; ua?: string; step: string }
async function insert(rows: Row[]): Promise<void> {
  for (const r of rows) {
    const payload = { v: 2, kind: r.kind ?? 'crash-session', ...(r.platform ? { platform: r.platform } : {}), ...(r.version ? { app: { version: r.version } } : {}),
      error: { message: 'SECRET-PAYLOAD-TEXT', stack: 'at SECRET-STACK' } };
    await db.query(`insert into public.client_crash_reports (created_at, user_id, session_key, last_step, ua, build, payload)
      values ($1, $2, 'k', $3, $4, 'b', $5::jsonb)`, [r.at, r.user ?? null, r.step, r.ua ?? 'UA-SECRET-iPhone', JSON.stringify(payload)]);
  }
}
const ago = (min: number): string => new Date(Date.parse(AT) - min * 60_000).toISOString();

async function asAnon<T>(sql: string, params: unknown[] = []): Promise<T> {
  await db.exec('set role anon');
  try { return (await db.query<{ v: T }>(sql, params)).rows[0]!.v; } finally { await db.exec('reset role'); }
}
async function fails(sql: string, params: unknown[] = []): Promise<string> {
  try { await asAnon(sql, params); return 'did not fail'; } catch (e) { return String(e); }
}

interface Count { n: number; users: number; first?: string }
interface HourDigest {
  mode: 'hour'; key_note: string;
  platforms: { platform: string; n: number; users: number; base: { total: number; mean: number; sd: number; max: number; hours: number };
    kinds: (Count & { kind: string })[]; versions: (Count & { v: string })[]; top: { kind: string; msg: string; n: number }[] }[];
}
interface DayDigest {
  mode: 'day'; day: string; total: number; users: number; avg7: number;
  platforms: { platform: string; n: number; users: number; avg7: number; kinds: { kind: string; n: number }[] }[];
  top: { platform: string; kind: string; msg: string; n: number }[];
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  await db.exec(TABLE);
  await db.exec(DESKTOP);
  // The health file's pool digest reads pool tables this test does not build; only its key gate is needed here.
  await db.exec('set check_function_bodies = off');
  await db.exec(HEALTH);
  await db.exec('set check_function_bodies = on');
  await db.exec(DIGEST);
  await db.exec(DIGEST); // idempotent

  await insert([
    // The last hour, phone: 6 rows from 3 players (two signed in, one anonymous device).
    { at: ago(5), platform: 'phone', kind: 'crash-session', version: '0.42.0', user: A, step: 'combat start' },
    { at: ago(10), platform: 'phone', kind: 'crash-session', version: '0.42.0', user: A, step: 'combat start' },
    { at: ago(20), platform: 'phone', kind: 'crash-session', version: '0.42.0', user: B, step: 'combat start' },
    { at: ago(30), platform: 'phone', kind: 'error', version: '0.42.0', user: null, step: 'error: TypeError: x is undefined' },
    { at: ago(40), platform: 'phone', kind: 'error', version: '0.42.0', user: null, step: 'error: TypeError: x is undefined' },
    { at: ago(59), platform: 'phone', kind: 'crash-session', version: '0.41.3', user: B, step: 'shop open' },
    // The last hour, desktop: one renderer crash.
    { at: ago(15), platform: 'desktop', kind: 'renderer-gone', version: '0.42.0', user: C, step: 'renderer-gone: oom' },
    // Perf never counts; a row at exactly AT is outside the window; one just over the hour is baseline.
    { at: ago(3), platform: 'phone', kind: 'perf', user: A, step: 'perf' },
    { at: ago(0), platform: 'phone', kind: 'crash-session', user: A, step: 'future' },
    { at: ago(61), platform: 'phone', kind: 'crash-session', version: '0.41.3', user: A, step: 'shop open' },
    // Baseline: phone crash sessions on 0.41.3 two and five days ago (0.42.0 and `error` are new today).
    { at: ago(48 * 60), platform: 'phone', kind: 'crash-session', version: '0.41.3', user: B, step: 'shop open' },
    { at: ago(48 * 60 - 1), platform: 'phone', kind: 'crash-session', version: '0.41.3', user: B, step: 'shop open' },
    { at: ago(5 * 24 * 60), platform: 'phone', kind: 'crash-session', version: '0.41.3', user: B, step: 'shop open' },
    // Older than 7 days: outside every window.
    { at: ago(8 * 24 * 60), platform: 'phone', kind: 'error', version: '0.42.0', user: B, step: 'error: old' },
  ]);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('ops_crash_digest: the key gate', () => {
  it('refuses no key, a wrong key and a bad mode; answers the key note', async () => {
    expect(await fails('select public.ops_crash_digest(null) as v')).toMatch(/not_authorized/);
    expect(await fails('select public.ops_crash_digest($1) as v', ['wrong'])).toMatch(/not_authorized/);
    expect(await fails("select public.ops_crash_digest($1, 'everything') as v", [SECRET])).toMatch(/bad_mode/);
    const d = await asAnon<HourDigest>('select public.ops_crash_digest($1) as v', [SECRET]);
    expect(d.key_note).toBe('ascent-hub');
    expect(d.mode).toBe('hour');
  });
  it('client roles cannot call the ops functions or read the table', async () => {
    expect(await fails('select ops.crash_digest_hour(now()) as v')).toMatch(/permission denied/);
    expect(await fails('select ops.crash_digest_day(current_date) as v')).toMatch(/permission denied/);
    expect(await fails('select count(*) as v from public.client_crash_reports')).toMatch(/permission denied/);
  });
});

describe('the hour digest', () => {
  let d: HourDigest;
  beforeAll(async () => { d = await asAnon<HourDigest>('select public.ops_crash_digest($1, $2, $3) as v', [SECRET, 'hour', AT]); });

  it('counts the last hour per platform, players by user or device, perf and out-of-window rows excluded', () => {
    expect(d.platforms.map((p) => [p.platform, p.n, p.users])).toEqual([['phone', 6, 3], ['desktop', 1, 1]]);
  });
  it('kinds and versions carry their first-seen time over the trailing 7 days', () => {
    const phone = d.platforms[0]!;
    expect(phone.kinds.map((k) => [k.kind, k.n, k.users])).toEqual([['crash-session', 4, 2], ['error', 2, 1]]);
    expect(Date.parse(phone.kinds.find((k) => k.kind === 'crash-session')!.first!)).toBe(Date.parse(ago(5 * 24 * 60)));
    expect(Date.parse(phone.kinds.find((k) => k.kind === 'error')!.first!)).toBe(Date.parse(ago(40))); // the 8-day-old row is outside
    expect(phone.versions.map((v) => [v.v, v.n, v.users])).toEqual([['0.42.0', 5, 3], ['0.41.3', 1, 1]]);
    expect(Date.parse(phone.versions[0]!.first!)).toBe(Date.parse(ago(40)));
  });
  it('the top messages drop the kind prefix', () => {
    expect(d.platforms[0]!.top).toEqual([
      { kind: 'crash-session', msg: 'combat start', n: 3 },
      { kind: 'error', msg: 'TypeError: x is undefined', n: 2 },
      { kind: 'crash-session', msg: 'shop open', n: 1 },
    ]);
    expect(d.platforms[1]!.top).toEqual([{ kind: 'renderer-gone', msg: 'oom', n: 1 }]);
  });
  it('the baseline is the 168 hours before the last hour, zero hours counted', () => {
    const b = d.platforms[0]!.base;
    expect(b.total).toBe(4);
    expect(b.hours).toBe(168);
    expect(b.mean).toBeCloseTo(4 / 168, 3);
    expect(b.max).toBe(2);
    expect(b.sd).toBeGreaterThan(0);
    expect(d.platforms[1]!.base).toMatchObject({ total: 0, mean: 0, max: 0 });
  });
  it('returns nothing identifying', () => {
    const s = JSON.stringify(d);
    for (const bad of [A, B, C, 'UA-SECRET', 'SECRET-PAYLOAD', 'SECRET-STACK']) expect(s).not.toContain(bad);
  });
  it('an empty hour is an empty list', async () => {
    const e = await asAnon<HourDigest>('select public.ops_crash_digest($1, $2, $3) as v', [SECRET, 'hour', '2026-01-01T00:00:00Z']);
    expect(e.platforms).toEqual([]);
  });
});

describe('the day digest', () => {
  it('yesterday per platform and kind, against the 7 days before it', async () => {
    // At 06:20 on 2026-11-23, "yesterday" is 2026-11-22: the 9 counted rows of that day (perf excluded).
    const d = await asAnon<DayDigest>('select public.ops_crash_digest($1, $2, $3) as v', [SECRET, 'day', '2026-11-23T06:20:00Z']);
    expect(d.day).toBe('2026-11-22');
    expect(d.total).toBe(9);
    expect(d.users).toBe(4);
    // The 7 days before (11-15..11-21): the three baseline rows; the 8-day-old row (11-14) is outside.
    expect(d.avg7).toBeCloseTo(3 / 7, 1);
    const phone = d.platforms.find((p) => p.platform === 'phone')!;
    expect(phone.n).toBe(8);
    expect(phone.kinds).toEqual([{ kind: 'crash-session', n: 6 }, { kind: 'error', n: 2 }]);
    expect(d.platforms.find((p) => p.platform === 'desktop')!.n).toBe(1);
    expect(d.top[0]).toEqual({ platform: 'phone', kind: 'crash-session', msg: 'combat start', n: 3 });
    expect(d.top).toHaveLength(3);
    expect(JSON.stringify(d)).not.toContain('UA-SECRET');
  });
});

describe('speed', () => {
  it('both modes answer far under the anon role\'s 3 s ceiling over a full week of rows', async () => {
    // ~21k rows across 7 days: 125 an hour, a quarter of them phone crash sessions with 20 KB payloads (stored out of line).
    const big = 'x'.repeat(20_000);
    await db.exec('alter table public.client_crash_reports disable trigger client_crash_reports_rate_limit');
    await db.exec(`insert into public.client_crash_reports (created_at, user_id, session_key, last_step, ua, build, payload)
      select '${AT}'::timestamptz - (g * interval '29 seconds'), null, 'bench' || g, 'error: bench ' || (g % 40), 'ua' || (g % 300), 'b',
             case when g % 4 = 0 then jsonb_build_object('v', 1, 'kind', 'crash-session', 'device', jsonb_build_object('lite', true), 'crumbs', '${big}')
                  else jsonb_build_object('v', 2, 'kind', case when g % 7 = 0 then 'perf' else 'error' end,
                                          'platform', (array['desktop','web','phone'])[1 + g % 3], 'app', jsonb_build_object('version', '0.4' || (g % 5))) end
        from generate_series(1, 21000) g`);
    await db.exec('analyze public.client_crash_reports');
    const time = async (mode: string, at: string): Promise<number> => {
      const t = performance.now();
      await asAnon('select public.ops_crash_digest($1, $2, $3) as v', [SECRET, mode, at]);
      return performance.now() - t;
    };
    const hour = await time('hour', AT);
    const day = await time('day', '2026-11-23T06:20:00Z');
    console.log(JSON.stringify({ ev: 'crash_digest_bench', rows: 21000, hourMs: Math.round(hour), dayMs: Math.round(day) }));
    expect(hour).toBeLessThan(1500);
    expect(day).toBeLessThan(1500);
  }, 120_000);
});
