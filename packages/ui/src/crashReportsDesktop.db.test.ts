import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R-CRASH-REPORT-DESKTOP-01, the table side, EXECUTED. PGlite runs the table's migration, then the desktop file twice
 * (idempotent), as the REST API would: the generated columns read the payload (and an older row's shape), nobody can
 * write them, the grants and RLS are unchanged, and the rate limit stops a runaway client.
 */
const MIGRATIONS = join(__dirname, '../../../supabase/migrations');
const TABLE = readFileSync(join(MIGRATIONS, '2026-10-22-client-crash-reports.sql'), 'utf8');
const DESKTOP = readFileSync(join(MIGRATIONS, '2026-11-29-client-crash-reports-desktop.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
`;
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
let db: PGlite;

async function as<T>(role: 'anon' | 'authenticated', sub: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? '']);
    await db.exec(`set local role ${role}`);
    const r = await db.query<T>(sql, params);
    await db.exec('commit');
    return r.rows;
  } catch (e) { await db.exec('rollback'); throw e; }
}
const INSERT = "insert into public.client_crash_reports (session_key, last_step, ua, standalone, build, payload) values ($1, 'x', 'ua', false, 'b', $2::jsonb)";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(TABLE);
  // An older phone row, written before the desktop file ran.
  await db.exec(`insert into public.client_crash_reports (session_key, last_step, ua, build, payload) values ('old@1', 'hero picked', 'iPhone', 'b', '{"v":1,"device":{"lite":true}}')`);
  await db.exec(DESKTOP);
  await db.exec(DESKTOP);
});
afterAll(async () => { await db.close(); });

describe('client_crash_reports, desktop + web', () => {
  it('platform, kind and app_version come from the payload; an older row reads as a phone crash session', async () => {
    await as('authenticated', A, INSERT, ['e1', JSON.stringify({ v: 2, kind: 'renderer-gone', platform: 'desktop', app: { version: '1.2.3' } })]);
    await as('anon', null, INSERT, ['e2', JSON.stringify({ v: 2, kind: 'error', platform: 'web' })]);
    await as('anon', null, INSERT, ['e3', JSON.stringify({ v: 2, kind: 'error', platform: 'toaster' })]);
    const rows = (await db.query<{ session_key: string; platform: string | null; kind: string; app_version: string | null; user_id: string | null }>(
      'select session_key, platform, kind, app_version, user_id from public.client_crash_reports order by id')).rows;
    expect(rows).toEqual([
      { session_key: 'old@1', platform: 'phone', kind: 'crash-session', app_version: null, user_id: null },
      { session_key: 'e1', platform: 'desktop', kind: 'renderer-gone', app_version: '1.2.3', user_id: A },
      { session_key: 'e2', platform: 'web', kind: 'error', app_version: null, user_id: null },
      { session_key: 'e3', platform: null, kind: 'error', app_version: null, user_id: null },
    ]);
  });

  it('grants and RLS are unchanged: insert only, own rows only, generated columns unwritable', async () => {
    await expect(as('anon', null, 'select * from public.client_crash_reports')).rejects.toThrow();
    await expect(as('authenticated', A, "update public.client_crash_reports set last_step = 'x'")).rejects.toThrow();
    await expect(as('authenticated', A, 'delete from public.client_crash_reports')).rejects.toThrow();
    await expect(as('authenticated', A, "insert into public.client_crash_reports (user_id, session_key, last_step, ua, build, payload) values ($1, 'k', 's', 'u', 'b', '{}')", [B])).rejects.toThrow();
    await expect(as('anon', null, "insert into public.client_crash_reports (session_key, last_step, ua, build, payload, platform) values ('k', 's', 'u', 'b', '{}', 'web')")).rejects.toThrow();
    await expect(as('anon', null, 'select public.client_crash_reports_rate_limit()')).rejects.toThrow();
  });

  it('rate limit: 100 a day per signed-in user, then refused; another user is unaffected', async () => {
    await db.exec(`insert into public.client_crash_reports (user_id, session_key, last_step, ua, build, payload)
      select '${B}', 'bulk' || g, 's', 'u', 'b', '{}' from generate_series(1, 100) g`);
    await expect(as('authenticated', B, INSERT, ['over', '{}'])).rejects.toThrow(/crash report limit/);
    await as('authenticated', A, INSERT, ['fine', '{}']);
    // Rows older than a day no longer count.
    await db.exec(`update public.client_crash_reports set created_at = now() - interval '2 days' where user_id = '${B}'`);
    await as('authenticated', B, INSERT, ['again', '{}']);
  });

  it('rate limit: 300 an hour across rows with no user', async () => {
    const have = Number((await db.query<{ n: number }>('select count(*)::int as n from public.client_crash_reports where user_id is null')).rows[0]!.n);
    await db.exec(`insert into public.client_crash_reports (session_key, last_step, ua, build, payload)
      select 'anon' || g, 's', 'u', 'b', '{}' from generate_series(1, ${300 - have}) g`);
    await expect(as('anon', null, INSERT, ['over', '{}'])).rejects.toThrow(/crash report limit/);
    await as('authenticated', A, INSERT, ['signed-in still fine', '{}']);
  });
});
