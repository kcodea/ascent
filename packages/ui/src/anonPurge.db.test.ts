import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE EMPTY ANONYMOUS USER PURGE, EXECUTED (R-SEC-ANON-PURGE-01, 2026-10-28). PGlite builds a stub `auth` (users,
 * identities, sessions, refresh_tokens) and every KIND of place a user id lives in production: a cascading foreign key,
 * a set-null foreign key, a non-FK uuid column (Versus seats), a uuid[] column, a user id inside jsonb (duo_runs.members),
 * storage.objects.owner and owner_id. Only an anonymous user that is in none of them AND idle past the window is a
 * candidate; an email account, a pending email change, an identity row, a fresh guest, or a guest whose session refreshed
 * recently is never touched; the batch needs the exact phrase, honours its limit, logs every id, and is repeatable.
 */
const SQL = readFileSync(join(__dirname, '../../../supabase/migrations/2026-11-07-anon-user-purge.sql'), 'utf8');
const OLD = "now() - interval '90 days'";
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_change text, phone text, phone_change text,
    is_anonymous boolean not null default false, created_at timestamptz, updated_at timestamptz, last_sign_in_at timestamptz);
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade, provider text);
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade,
    updated_at timestamptz, refreshed_at timestamp);
  create table auth.refresh_tokens (id bigserial primary key, user_id varchar(255), updated_at timestamptz);
  create schema storage;
  create table storage.objects (id uuid primary key default gen_random_uuid(), owner uuid, owner_id text);

  create table public.boards (id bigserial primary key, user_id uuid references auth.users on delete set null, snapshot jsonb);
  create table public.profiles (user_id uuid primary key references auth.users on delete cascade);
  create table public.versus_group_seats (match_id uuid, seat text, user_id uuid);       -- no FK
  create table public.progression_results (id bigserial primary key, crate_ids uuid[]);   -- uuid[]
  create table public.duo_runs (id uuid primary key default gen_random_uuid(), members jsonb); -- ids inside jsonb
`;
const U = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let db: PGlite;

/** An auth user; `seen` is the SQL for every activity stamp unless overridden. */
async function user(n: number, o: { anon?: boolean; email?: string; emailChange?: string; seen?: string; signIn?: string } = {}): Promise<void> {
  const seen = o.seen ?? OLD;
  await db.query(`insert into auth.users (id, email, email_change, is_anonymous, created_at, updated_at, last_sign_in_at)
    values ($1, $2, $3, $4, ${seen}, ${seen}, ${o.signIn ?? seen})`, [U(n), o.email ?? null, o.emailChange ?? null, o.anon ?? true]);
}
const candidates = async (idle = '30 days'): Promise<string[]> =>
  (await db.query<{ user_id: string }>('select user_id from maint.anon_purge_candidates($1::interval)', [idle])).rows.map((r) => r.user_id).sort();
const users = async (): Promise<string[]> => (await db.query<{ id: string }>('select id from auth.users order by id')).rows.map((r) => r.id);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(SQL);
  await db.exec(SQL); // idempotent

  await user(1, { anon: false, email: 'kevin@example.com' });      // an email account, idle, no data
  await user(2); await db.query('insert into public.boards (user_id, snapshot) values ($1, \'{}\')', [U(2)]); // a board (set-null FK)
  await user(3); await db.query('insert into public.profiles (user_id) values ($1)', [U(3)]);                  // a profile (cascade FK)
  await user(4); await db.query("insert into public.versus_group_seats values (gen_random_uuid(), 'p1', $1)", [U(4)]); // a seat, no FK
  await user(5); await db.query('insert into public.progression_results (crate_ids) values (array[$1::uuid])', [U(5)]); // in a uuid[]
  await user(6); await db.query("insert into public.duo_runs (members) values (jsonb_build_array(jsonb_build_object('userId', $1::text)))", [U(6)]); // in jsonb
  await user(7); await db.query('insert into storage.objects (owner) values ($1)', [U(7)]);                    // a stored file
  await user(8); await db.query('insert into storage.objects (owner_id) values ($1)', [U(8)]);
  await user(9, { emailChange: 'new@example.com' });              // converting to an email account
  await user(10); await db.query("insert into auth.identities (user_id, provider) values ($1, 'email')", [U(10)]);
  await user(11, { seen: "now() - interval '2 days'" });          // a brand-new guest, nothing yet
  await user(12); await db.query("insert into auth.sessions (user_id, updated_at, refreshed_at) values ($1, now() - interval '90 days', (now() - interval '1 day')::timestamp)", [U(12)]); // refreshed yesterday
  await user(13); await db.query("insert into auth.refresh_tokens (user_id, updated_at) values ($1, now() - interval '3 days')", [U(13)]);
  for (let n = 20; n < 25; n++) await user(n);                    // five idle, empty guests
  await db.query("insert into auth.sessions (user_id, updated_at, refreshed_at) values ($1, now() - interval '60 days', (now() - interval '60 days')::timestamp)", [U(20)]);
});
afterAll(async () => { await db.close(); });

describe('maint.anon_purge_*', () => {
  it('candidates are exactly the idle anonymous users that own nothing anywhere', async () => {
    expect(await candidates()).toEqual([U(20), U(21), U(22), U(23), U(24)]);
    // a shorter window would also reach the guests active 3 days ago, still never the 1-day or 2-day ones
    expect(await candidates('2 days 12 hours')).toEqual([U(13), U(20), U(21), U(22), U(23), U(24)]);
  });

  it('the report is a dry run: counts only, nothing deleted', async () => {
    const before = await users();
    const rows = (await db.query<{ metric: string; n: number }>('select * from maint.anon_purge_report()')).rows;
    const m = Object.fromEntries(rows.map((r) => [r.metric, Number(r.n)]));
    expect(m['auth users']).toBe(18);
    expect(m['email / phone / identity accounts (never touched)']).toBe(3);
    expect(m['anonymous']).toBe(17);
    expect(m['anonymous owning data (kept)']).toBe(7);
    expect(m['anonymous owning nothing']).toBe(10);
    expect(m['PURGE CANDIDATES (anonymous, nothing, idle 30 days)']).toBe(5);
    expect(await users()).toEqual(before);
  });

  it('the batch refuses without the exact phrase, a short window or a silly size', async () => {
    await expect(db.query("select maint.anon_purge_batch('yes')")).rejects.toThrow(/phrase/);
    await expect(db.query("select maint.anon_purge_batch('DELETE EMPTY ANONYMOUS USERS', interval '1 day')")).rejects.toThrow(/7 days/);
    await expect(db.query("select maint.anon_purge_batch('DELETE EMPTY ANONYMOUS USERS', interval '30 days', 5000)")).rejects.toThrow(/1\.\.1000/);
    expect((await users()).length).toBe(18);
  });

  it('batches delete only candidates, honour the limit, log every id, and stop at 0', async () => {
    const one = await db.query<{ n: number }>("select maint.anon_purge_batch('DELETE EMPTY ANONYMOUS USERS', interval '30 days', 2) as n");
    expect(Number(one.rows[0]!.n)).toBe(2);
    const rest = await db.query<{ n: number }>("select maint.anon_purge_batch('DELETE EMPTY ANONYMOUS USERS') as n");
    expect(Number(rest.rows[0]!.n)).toBe(3);
    const none = await db.query<{ n: number }>("select maint.anon_purge_batch('DELETE EMPTY ANONYMOUS USERS') as n");
    expect(Number(none.rows[0]!.n)).toBe(0);
    const left = await users();
    for (let n = 20; n < 25; n++) expect(left).not.toContain(U(n));
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) expect(left).toContain(U(n));
    const log = (await db.query<{ user_id: string }>('select user_id from maint.anon_purge_log order by user_id')).rows.map((r) => r.user_id);
    expect(log).toEqual([U(20), U(21), U(22), U(23), U(24)]);
    // the data of the kept users is untouched
    expect((await db.query('select * from public.boards where user_id is not null')).rows.length).toBe(1);
    expect((await db.query('select * from public.profiles')).rows.length).toBe(1);
  });

  it('the client roles cannot reach the tools', async () => {
    const r = (await db.query<{ a: boolean; b: boolean }>(
      "select has_schema_privilege('anon', 'maint', 'usage') a, has_schema_privilege('authenticated', 'maint', 'usage') b")).rows[0]!;
    expect(r).toEqual({ a: false, b: false });
  });
});
