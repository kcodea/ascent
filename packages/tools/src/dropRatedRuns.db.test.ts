/**
 * Supabase cleanup 2.6 (supabase/migrations/2026-11-07-drop-rated-runs.sql), executed in PGlite: it drops the empty
 * C3 ledger, is a no-op where the table is already gone, and refuses to drop a table that still holds rows.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const DROP = readFileSync(join(__dirname, '../../../supabase/migrations/2026-11-07-drop-rated-runs.sql'), 'utf8');
const C3 = `
  create schema auth; create table auth.users (id uuid primary key);
  create table public.rated_runs (
    user_id uuid not null references auth.users(id) on delete cascade, run_id text not null,
    created_at timestamptz not null default now(), primary key (user_id, run_id));
  alter table public.rated_runs enable row level security;
  create index rated_runs_user_time on public.rated_runs (user_id, created_at desc);`;
const exists = async (db: PGlite): Promise<boolean> =>
  (await db.query<{ r: string | null }>("select to_regclass('public.rated_runs')::text as r")).rows[0]!.r !== null;

describe('drop rated_runs', () => {
  let db: PGlite;
  beforeEach(async () => { db = new PGlite(); await db.exec(C3); });
  afterEach(async () => { await db.close(); });

  it('drops the empty table, and a re-run is a no-op', async () => {
    await db.exec(DROP);
    expect(await exists(db)).toBe(false);
    await db.exec(DROP);
    expect(await exists(db)).toBe(false);
    // auth.users keeps working without the FK (deleting a user no longer checks rated_runs).
    await db.exec("insert into auth.users values ('00000000-0000-0000-0000-000000000001'); delete from auth.users;");
  });

  it('refuses to drop a table that still holds rows', async () => {
    await db.exec("insert into auth.users values ('00000000-0000-0000-0000-000000000001'); insert into public.rated_runs (user_id, run_id) values ('00000000-0000-0000-0000-000000000001', 'r1');");
    await expect(db.exec(DROP)).rejects.toThrow(/holds 1 rows/);
    await db.exec('rollback').catch(() => undefined);
    expect(await exists(db)).toBe(true);
  });
});
