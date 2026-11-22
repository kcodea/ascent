import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE DAILY RETENTION CLEANUP, EXECUTED (R-OPS-RETENTION-01, 2026-11-22). PGlite has no pg_cron and no Supabase auth, so a
 * stub `auth` (users, sessions) and `storage.objects` stand in, and the schedule block is skipped by its own guard. Proves:
 * the client roles cannot run it; a dry run deletes nothing and counts right; a real run deletes only old perf runs, only
 * the child rows of OLD COMPLETE Versus matches (never a match or seat row, never a live or recent match), only idle empty
 * anonymous users (never one with a row in any user-linked column, including a table created AFTER the migration, never
 * an email account, never a recently active session); batch_limit holds; a disabled rule does nothing.
 */
const SQL = readFileSync(join(__dirname, '../../../supabase/migrations/2026-11-27-ops-retention.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_change text, phone text,
    is_anonymous boolean not null default false, created_at timestamptz, last_sign_in_at timestamptz);
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade,
    updated_at timestamptz, refreshed_at timestamp);
  create schema storage;
  create table storage.objects (id uuid primary key default gen_random_uuid(), owner uuid, owner_id text);

  create table public.perf_runs (id bigserial primary key, user_id uuid, created_at timestamptz not null default now());
  create table public.profiles (user_id uuid primary key references auth.users on delete cascade);
  create table public.boards (id bigserial primary key, user_id uuid references auth.users on delete set null);
  create table public.friendships (id bigserial primary key, requester uuid, user_lo uuid, user_hi uuid);  -- no FK
  create table public.duos_match_history (match_id uuid primary key, players uuid[]);                       -- uuid[]

  create table public.versus_matches (id uuid primary key, phase text not null, completed_at timestamptz,
    p1_user uuid not null, p2_user uuid not null);
  create table public.versus_submissions (match_id uuid references public.versus_matches on delete cascade, round int,
    seat text, user_id uuid not null, primary key (match_id, round, seat));
  create table public.versus_rounds (match_id uuid references public.versus_matches on delete cascade, round int,
    primary key (match_id, round));
  create table public.versus_group_matches (id uuid primary key, phase text not null, completed_at timestamptz);
  create table public.versus_group_seats (match_id uuid references public.versus_group_matches on delete cascade, seat text,
    user_id uuid, primary key (match_id, seat));
  create table public.versus_group_submissions (match_id uuid references public.versus_group_matches on delete cascade,
    round int, seat text, user_id uuid not null, primary key (match_id, round, seat));
  create table public.versus_group_fights (match_id uuid references public.versus_group_matches on delete cascade,
    round int, fight smallint, primary key (match_id, round, fight));
  create table public.versus_group_rounds (match_id uuid references public.versus_group_matches on delete cascade,
    round int, primary key (match_id, round));
`;
const U = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const M = (n: number): string => `00000000-0000-0000-0001-${String(n).padStart(12, '0')}`;
const AGO = (d: number): string => `now() - interval '${d} days'`;
let db: PGlite;

type RuleOut = { enabled: boolean; candidates?: number; deleted?: number; tables?: Record<string, { candidates: number; deleted: number }> };
type RunOut = { dry_run: boolean; deleted: number; failed: number; rules: Record<string, RuleOut> };
const run = async (dry: boolean): Promise<RunOut> =>
  (await db.query<{ r: RunOut }>('select ops.retention_run($1) as r', [dry])).rows[0]!.r;
const count = async (sql: string): Promise<number> => Number((await db.query<{ n: number }>(`select count(*) as n from ${sql}`)).rows[0]!.n);
const ids = async (sql: string): Promise<string[]> => (await db.query<{ id: string }>(sql)).rows.map((r) => r.id).sort();
const users = (): Promise<string[]> => ids('select id from auth.users');

async function user(n: number, o: { anon?: boolean; email?: string; age?: number; signIn?: number | null } = {}): Promise<void> {
  const age = o.age ?? 90;
  const signIn = o.signIn === null ? 'null' : AGO(o.signIn ?? age);
  await db.query(`insert into auth.users (id, email, is_anonymous, created_at, last_sign_in_at) values ($1, $2, $3, ${AGO(age)}, ${signIn})`,
    [U(n), o.email ?? null, o.anon ?? true]);
}
/** A 1v1 match with `rounds` rounds (both seats' submissions + the round row each). */
async function match1v1(n: number, phase: string, doneAgo: number | null, rounds: number): Promise<void> {
  await db.query(`insert into public.versus_matches values ($1, $2, ${doneAgo === null ? 'null' : AGO(doneAgo)}, $3, $4)`, [M(n), phase, U(900), U(901)]);
  for (let r = 1; r <= rounds; r++) {
    await db.query("insert into public.versus_submissions values ($1, $2, 'p1', $3), ($1, $2, 'p2', $4)", [M(n), r, U(900), U(901)]);
    await db.query('insert into public.versus_rounds values ($1, $2)', [M(n), r]);
  }
}
async function matchGroup(n: number, phase: string, doneAgo: number | null, rounds: number): Promise<void> {
  await db.query(`insert into public.versus_group_matches values ($1, $2, ${doneAgo === null ? 'null' : AGO(doneAgo)})`, [M(n), phase]);
  await db.query("insert into public.versus_group_seats values ($1, 'p1', $2), ($1, 'p2', $3)", [M(n), U(900), U(901)]);
  for (let r = 1; r <= rounds; r++) {
    await db.query("insert into public.versus_group_submissions values ($1, $2, 'p1', $3), ($1, $2, 'p2', $4)", [M(n), r, U(900), U(901)]);
    await db.query('insert into public.versus_group_fights values ($1, $2, 1), ($1, $2, 2)', [M(n), r]);
    await db.query('insert into public.versus_group_rounds values ($1, $2)', [M(n), r]);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(SQL);
  await db.exec(SQL); // idempotent

  // perf runs: 5 old (61..65 days), 2 recent
  for (let d = 61; d <= 65; d++) await db.query(`insert into public.perf_runs (created_at) values (${AGO(d)})`);
  await db.query(`insert into public.perf_runs (created_at) values (${AGO(59)}), (now())`);

  // Versus 1v1: old complete (2 rounds), old complete (1 round), recent complete, live (old created, not complete)
  await match1v1(1, 'complete', 40, 2);
  await match1v1(2, 'complete', 31, 1);
  await match1v1(3, 'complete', 5, 2);
  await match1v1(4, 'shop', null, 3);
  // Group: old complete (2 rounds), recent complete, live
  await matchGroup(11, 'complete', 45, 2);
  await matchGroup(12, 'complete', 2, 1);
  await matchGroup(13, 'combat', null, 2);

  // Users. 900/901 are the Versus players: email accounts.
  await user(900, { anon: false, email: 'a@example.com' }); await user(901, { anon: false, email: 'b@example.com' });
  await user(1, { anon: false, email: 'kevin@example.com' });                          // email account, idle, no data
  await user(2); await db.query('insert into public.profiles values ($1)', [U(2)]);     // FK column (cascade)
  await user(3); await db.query('insert into public.boards (user_id) values ($1)', [U(3)]); // FK column (set null)
  await user(4); await db.query('insert into public.friendships (requester) values ($1)', [U(4)]); // named, no FK
  await user(5); await db.query('insert into public.duos_match_history values (gen_random_uuid(), array[$1::uuid])', [U(5)]); // uuid[]
  await user(6); await db.query('insert into storage.objects (owner_id) values ($1)', [U(6)]);   // a stored file
  await user(7, { age: 10 });                                                           // a new guest, nothing yet
  await user(8, { age: 90, signIn: 3 });                                                // signed in 3 days ago
  await user(9); await db.query(`insert into auth.sessions (user_id, updated_at, refreshed_at) values ($1, ${AGO(90)}, (${AGO(2)})::timestamp)`, [U(9)]); // refreshed 2 days ago
  await user(10); await db.query(`insert into auth.sessions (user_id, updated_at) values ($1, ${AGO(1)})`, [U(10)]); // session updated yesterday
  await user(11, { age: 90, signIn: null });                                            // never signed in, created 90 days ago: empty
  for (let n = 20; n < 25; n++) await user(n);                                          // five idle empty guests
  await db.query(`insert into auth.sessions (user_id, updated_at, refreshed_at) values ($1, ${AGO(60)}, (${AGO(60)})::timestamp)`, [U(20)]);
  // Two users only kept by tables created AFTER the migration (the column list is read at run time).
  await db.exec(`
    create table public.late_named (id bigserial primary key, owner_user uuid);
    create table public.late_fk (id bigserial primary key, who uuid references auth.users on delete cascade);`);
  await user(12); await db.query('insert into public.late_named (owner_user) values ($1)', [U(12)]);
  await user(13); await db.query('insert into public.late_fk (who) values ($1)', [U(13)]);
});
afterAll(async () => { await db.close(); });

const EMPTY = [U(11), U(20), U(21), U(22), U(23), U(24)];

describe('ops.retention_run', () => {
  it('the client roles cannot run it or read the rules; service_role can run it', async () => {
    const p = (await db.query<{ a: boolean; b: boolean; s: boolean; ra: boolean }>(`select
      has_function_privilege('anon', 'ops.retention_run(boolean)', 'execute') a,
      has_function_privilege('authenticated', 'ops.retention_run(boolean)', 'execute') b,
      has_function_privilege('service_role', 'ops.retention_run(boolean)', 'execute') s,
      has_table_privilege('authenticated', 'ops.retention_rules', 'select') ra`)).rows[0]!;
    expect(p).toEqual({ a: false, b: false, s: true, ra: false });
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await expect(db.query('select ops.retention_run(true)')).rejects.toThrow(/permission denied/);
      await expect(db.query('select ops.retention_run(false)')).rejects.toThrow(/permission denied/);
      await db.exec('reset role');
    }
    expect(await count('public.perf_runs')).toBe(7);
  });

  it('the scanned columns come from the catalog, tables created later included', async () => {
    const cols = (await db.query<{ c: string }>("select schema_name || '.' || table_name || '.' || column_name as c from ops.retention__user_columns()")).rows.map((r) => r.c);
    for (const c of ['public.profiles.user_id', 'public.boards.user_id', 'public.friendships.requester', 'public.friendships.user_lo',
      'public.duos_match_history.players', 'public.versus_matches.p1_user', 'public.versus_group_seats.user_id',
      'public.late_named.owner_user', 'public.late_fk.who', 'storage.objects.owner']) expect(cols).toContain(c);
    expect(cols).not.toContain('public.versus_matches.id');
  });

  it('a dry run counts everything and deletes nothing', async () => {
    const before = { perf: await count('public.perf_runs'), users: await users(), subs: await count('public.versus_submissions'),
      gsubs: await count('public.versus_group_submissions') };
    const r = await run(true);
    expect(r.dry_run).toBe(true);
    expect(r.deleted).toBe(0);
    expect(r.failed).toBe(0);
    expect(r.rules.perf_runs).toMatchObject({ candidates: 5, deleted: 0 });
    expect(r.rules.versus_1v1_leftovers!.tables).toEqual({
      versus_submissions: { candidates: 6, deleted: 0 }, versus_rounds: { candidates: 3, deleted: 0 } });
    expect(r.rules.versus_group_leftovers!.tables).toEqual({
      versus_group_submissions: { candidates: 4, deleted: 0 }, versus_group_fights: { candidates: 4, deleted: 0 },
      versus_group_rounds: { candidates: 2, deleted: 0 } });
    expect(r.rules.anon_empty_users).toMatchObject({ candidates: EMPTY.length, deleted: 0 });
    expect(await count('public.perf_runs')).toBe(before.perf);
    expect(await users()).toEqual(before.users);
    expect(await count('public.versus_submissions')).toBe(before.subs);
    expect(await count('public.versus_group_submissions')).toBe(before.gsubs);
    const rule = (await db.query<{ d: boolean; c: number; t: number }>("select last_dry_run d, last_candidates c, total_deleted t from ops.retention_rules where rule = 'perf_runs'")).rows[0]!;
    expect({ d: rule.d, c: Number(rule.c), t: Number(rule.t) }).toEqual({ d: true, c: 5, t: 0 });
    expect(await count("ops.events where source = 'retention' and kind = 'dry_run'")).toBe(1);
  });

  it('a disabled rule does nothing', async () => {
    await db.exec("update ops.retention_rules set enabled = false");
    const r = await run(false);
    expect(r.deleted).toBe(0);
    for (const k of ['perf_runs', 'versus_1v1_leftovers', 'versus_group_leftovers', 'anon_empty_users']) expect(r.rules[k]).toEqual({ enabled: false });
    expect(await count('public.perf_runs')).toBe(7);
    expect((await users()).length).toBe(20);
    await db.exec("update ops.retention_rules set enabled = true");
  });

  it('a real run deletes only the targets, and batch_limit holds', async () => {
    await db.exec(`update ops.retention_rules set batch_limit = 2 where rule in ('perf_runs', 'anon_empty_users');
                   update ops.retention_rules set batch_limit = 3 where rule in ('versus_1v1_leftovers', 'versus_group_leftovers')`);
    const r1 = await run(false);
    expect(r1.failed).toBe(0);
    expect(r1.rules.perf_runs).toMatchObject({ candidates: 5, deleted: 2 });
    expect(r1.rules.versus_1v1_leftovers!.tables).toEqual({
      versus_submissions: { candidates: 6, deleted: 3 }, versus_rounds: { candidates: 3, deleted: 3 } });
    expect(r1.rules.versus_group_leftovers!.tables!.versus_group_submissions).toEqual({ candidates: 4, deleted: 3 });
    expect(r1.rules.anon_empty_users).toMatchObject({ candidates: 6, deleted: 2 });

    // drain the rest
    for (let i = 0; i < 4; i++) await run(false);
    const last = await run(false);
    expect(last.deleted).toBe(0);

    // perf: only the 5 old ones went
    expect(await count('public.perf_runs')).toBe(2);
    expect(await count(`public.perf_runs where created_at < ${AGO(60)}`)).toBe(0);
    // Versus: every match and seat row is kept; only the old complete ones lost their children
    expect(await count('public.versus_matches')).toBe(4);
    expect(await count('public.versus_group_matches')).toBe(3);
    expect(await count('public.versus_group_seats')).toBe(6);
    for (const [t, keep] of [['versus_submissions', 0], ['versus_rounds', 0]] as const) {
      expect(await count(`public.${t} where match_id in ('${M(1)}', '${M(2)}')`)).toBe(keep);
    }
    expect(await count(`public.versus_submissions where match_id = '${M(3)}'`)).toBe(4);   // recent complete
    expect(await count(`public.versus_rounds where match_id = '${M(4)}'`)).toBe(3);        // live
    expect(await count(`public.versus_submissions where match_id = '${M(4)}'`)).toBe(6);
    for (const t of ['versus_group_submissions', 'versus_group_fights', 'versus_group_rounds']) {
      expect(await count(`public.${t} where match_id = '${M(11)}'`)).toBe(0);
    }
    expect(await count(`public.versus_group_submissions where match_id = '${M(12)}'`)).toBe(2);
    expect(await count(`public.versus_group_rounds where match_id = '${M(13)}'`)).toBe(2);
    expect(await count(`public.versus_group_fights where match_id = '${M(13)}'`)).toBe(4);

    // users: exactly the idle empty guests went
    const left = await users();
    for (const id of EMPTY) expect(left).not.toContain(id);
    for (const n of [900, 901, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13]) expect(left).toContain(U(n));
    expect(await count('public.profiles')).toBe(1);
    expect(await count('public.boards where user_id is not null')).toBe(1);
    expect(await count('public.late_fk')).toBe(1);

    const rules = (await db.query<{ rule: string; t: number; e: string | null }>('select rule, total_deleted t, last_error e from ops.retention_rules order by rule')).rows;
    expect(Object.fromEntries(rules.map((x) => [x.rule, Number(x.t)]))).toEqual({
      anon_empty_users: 6, perf_runs: 5, versus_1v1_leftovers: 9, versus_group_leftovers: 10 });
    expect(rules.every((x) => x.e === null)).toBe(true);
  });
});
