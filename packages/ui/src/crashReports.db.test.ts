import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE CRASH REPORT TABLE, EXECUTED (R-TOUCH-CRASH-REPORT-01). PGlite runs the migration twice (idempotent), then, as
 * the REST API would: anon and a signed-in player may insert; nobody but the service role may read, update or
 * delete; a player cannot write a row as someone else; a payload of 64 KB or more is refused.
 */
const SQL = readFileSync(join(__dirname, '../../../supabase/migrations/2026-10-22-client-crash-reports.sql'), 'utf8');
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
const INSERT = "insert into public.client_crash_reports (session_key, last_step, ua, standalone, build, payload) values ('a@1', 'play pressed', 'iPhone', true, 'v+sha', $1::jsonb)";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(SQL);
  await db.exec(SQL);
});
afterAll(async () => { await db.close(); });

describe('client_crash_reports', () => {
  it('anon and a signed-in player can insert; the row records who', async () => {
    await as('anon', null, INSERT, ['{"v":1}']);
    await as('authenticated', A, INSERT, ['{"v":1}']);
    const rows = (await db.query<{ user_id: string | null }>('select user_id from public.client_crash_reports order by id')).rows;
    expect(rows.map((r) => r.user_id)).toEqual([null, A]);
  });

  it('clients cannot read, update or delete, nor write a row as someone else', async () => {
    await expect(as('anon', null, 'select * from public.client_crash_reports')).rejects.toThrow();
    await expect(as('authenticated', A, 'select * from public.client_crash_reports')).rejects.toThrow();
    await expect(as('authenticated', A, "update public.client_crash_reports set last_step = 'x'")).rejects.toThrow();
    await expect(as('authenticated', A, 'delete from public.client_crash_reports')).rejects.toThrow();
    await expect(as('authenticated', A, "insert into public.client_crash_reports (user_id, session_key, last_step, ua, build, payload) values ($1, 'k', 's', 'u', 'b', '{}')", [B])).rejects.toThrow();
  });

  it('refuses a payload of 64 KB or more', async () => {
    const big = JSON.stringify({ x: Array.from({ length: 4000 }, (_, i) => `${i}-${Math.sin(i)}-padding-padding`) });
    await expect(as('anon', null, INSERT, [big])).rejects.toThrow(/check constraint/);
  });
});
