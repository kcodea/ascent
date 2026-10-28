/**
 * DURABLE RUN UPLOADS, server side (R-NET-OUTBOX-01; supabase/migrations/2026-11-07-durable-run-uploads.sql), executed
 * in PGlite on stubs of the three tables: the idempotency keys (generated from the board id / the Career entry's
 * seed + finish time; sent for telemetry) make the outbox's `on conflict (user_id, upload_key) do nothing` retry a
 * no-op, never collide across accounts or on legacy rows without a key; `report_write_failure` needs a session, is
 * capped per account per day, cuts its texts, and is the only door into `ops.events`.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(join(__dirname, '../../../../supabase/migrations/2026-11-07-durable-run-uploads.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.boards (id uuid primary key default gen_random_uuid(), user_id uuid, wave int not null, snapshot jsonb not null, unrated boolean not null default false);
  create table public.run_history (id bigserial primary key, user_id uuid, hero_id text, entry jsonb not null);
  create table public.run_telemetry (id bigserial primary key, user_id uuid, hero_id text);
`;
const U1 = '00000000-0000-0000-0000-000000000001';
const U2 = '00000000-0000-0000-0000-000000000002';

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  // A legacy board without a client id and two Career rows already there.
  await db.exec(`insert into public.boards (user_id, wave, snapshot) values ('${U1}', 1, '{"wave":1}'), ('${U1}', 2, '{"wave":2}');
                 insert into public.run_history (user_id, hero_id, entry) values ('${U1}', 'h', '{"seed": 7, "at": "2026-10-28T10:00:00Z"}');`);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // idempotent
}, 60_000);
afterAll(async () => { await db?.close(); });

const n = async (sql: string): Promise<number> => Number((await db.query<{ n: number }>(sql)).rows[0]!.n);

describe('idempotency keys', () => {
  it('boards: the key is the board id; a retried upsert stores nothing twice; legacy rows (no id) never collide', async () => {
    const up = `insert into public.boards (user_id, wave, snapshot) values ($1, 3, $2::jsonb), ($1, 4, $3::jsonb)
                on conflict (user_id, upload_key) do nothing`;
    await db.query(up, [U1, '{"id":"b-3","wave":3}', '{"id":"b-4","wave":4}']);
    await db.query(up, [U1, '{"id":"b-3","wave":3}', '{"id":"b-4","wave":4}']); // the retry after a timeout that committed
    await db.query(up, [U2, '{"id":"b-3","wave":3}', '{"id":"b-4","wave":4}']); // another account, same ids: its own rows
    expect(await n("select count(*) n from public.boards where upload_key = 'b-3'")).toBe(2);
    expect(await n(`select count(*) n from public.boards where user_id = '${U1}'`)).toBe(4);
    expect(await n('select count(*) n from public.boards where upload_key is null')).toBe(2);
    await db.query(`insert into public.boards (user_id, wave, snapshot) values ($1, 1, '{"wave":1}') on conflict (user_id, upload_key) do nothing`, [U1]);
    expect(await n('select count(*) n from public.boards where upload_key is null')).toBe(3); // a keyless row is never "a duplicate"
  });

  it('run_history: the key is seed|at from the entry (the existing row has it too)', async () => {
    expect((await db.query<{ k: string }>('select upload_key k from public.run_history')).rows[0]!.k).toBe('7|2026-10-28T10:00:00Z');
    const up = `insert into public.run_history (user_id, hero_id, entry) values ($1, 'h', $2::jsonb) on conflict (user_id, upload_key) do nothing`;
    await db.query(up, [U1, '{"seed": 7, "at": "2026-10-28T10:00:00Z", "wins": 3}']);
    await db.query(up, [U1, '{"seed": 7, "at": "2026-10-28T11:00:00Z"}']); // same seed, another game
    expect(await n('select count(*) n from public.run_history')).toBe(2);
  });

  it('run_telemetry: the client-sent key dedupes; rows without one never do', async () => {
    const up = `insert into public.run_telemetry (user_id, hero_id, upload_key) values ($1, 'h', $2) on conflict (user_id, upload_key) do nothing`;
    await db.query(up, [U1, '7|t']);
    await db.query(up, [U1, '7|t']);
    await db.query(up, [U1, null]);
    await db.query(up, [U1, null]);
    expect(await n('select count(*) n from public.run_telemetry')).toBe(3);
  });

  it('a plain insert of a duplicate (an older client re-sending) is refused by the index, not doubled', async () => {
    await expect(db.query(`insert into public.boards (user_id, wave, snapshot) values ($1, 3, '{"id":"b-3"}')`, [U1])).rejects.toThrow(/boards_user_upload_key/);
  });
});

describe('report_write_failure', () => {
  const report = (uid: string | null, key = 'k', err = 'boom', detail: unknown = { attempts: 5 }) =>
    db.exec(`set test.uid = '${uid ?? ''}'; select public.report_write_failure('boards', '${key}', '${err}', '${JSON.stringify(detail)}'::jsonb);`);

  it('needs a session, records who and what, cuts long texts, drops an oversized detail', async () => {
    await report(null);
    expect(await n('select count(*) n from ops.events')).toBe(0);
    await report(U1, 'boards:b-9:3', 'x'.repeat(900));
    const ev = (await db.query<{ source: string; kind: string; key: string; detail: { user: string; write: string; error: string; detail: { attempts: number } } }>('select source, kind, key, detail from ops.events')).rows[0]!;
    expect(ev).toMatchObject({ source: 'client', kind: 'write_failure', key: 'boards:b-9:3' });
    expect(ev.detail).toMatchObject({ user: U1, write: 'boards', detail: { attempts: 5 } });
    expect(ev.detail.error).toHaveLength(500);
    await report(U1, 'big', 'e', { blob: 'y'.repeat(3000) });
    const big = (await db.query<{ detail: Record<string, unknown> }>("select detail from ops.events where key = 'big'")).rows[0]!;
    expect(big.detail.detail).toBeUndefined();
  });

  it('caps at 50 reports per account per day (the log is never an egress or storage lever)', async () => {
    for (let i = 0; i < 60; i++) await report(U2, `k${i}`);
    expect(await n(`select count(*) n from ops.events where detail ->> 'user' = '${U2}'`)).toBe(50);
  });

  it('only a signed-in client may call it; nobody reads ops from the client side', async () => {
    const p = (await db.query<Record<string, boolean>>(`select
      has_function_privilege('authenticated', 'public.report_write_failure(text, text, text, jsonb)', 'execute') auth_exec,
      has_function_privilege('anon', 'public.report_write_failure(text, text, text, jsonb)', 'execute') anon_exec,
      has_schema_privilege('authenticated', 'ops', 'usage') auth_ops,
      has_schema_privilege('anon', 'ops', 'usage') anon_ops`)).rows[0]!;
    expect(p).toEqual({ auth_exec: true, anon_exec: false, auth_ops: false, anon_ops: false });
  });
});
