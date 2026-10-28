import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE SECURITY PASS, EXECUTED (R-SEC-WRITES-01, R-SEC-READS-01; 2026-11-07).
 *
 * PGlite builds every table a client WRITES (enumerated from every `.from(...)` call in packages/ui on 2026-11-07:
 * boards, board_results, lobby_fights, perf_runs, practice_games, profiles, run_history, run_telemetry, runs,
 * client_crash_reports) with the policies production carried on 2026-10-28 (pg_policy dump), plus an RPC-only table
 * (`loot_crates`: no client policy, written by a SECURITY DEFINER function), the pool trigger (SECURITY DEFINER,
 * writes `pool_runs`), the `run_fight_records` view and the pool/histogram RPCs. Then, as PostgREST would (role +
 * request.jwt.claim.sub), it runs every client call shape BEFORE and AFTER both migrations (each applied twice):
 *  - part 1: the anon boards insert is closed; every client write still lands; the definer writers still write;
 *    a write no policy allows is now a permission error; TRUNCATE is gone everywhere;
 *  - part 2: the large tables and the pool RPCs answer a session only (an anonymous guest is `authenticated`);
 *    the small public reads (profiles) still answer anon.
 */
const root = join(__dirname, '../../..');
const PART1 = readFileSync(join(root, 'supabase/migrations/2026-11-07-security-writes.sql'), 'utf8');
const PART2 = readFileSync(join(root, 'supabase/migrations/2026-11-07-security-reads-need-session.sql'), 'utf8');
const CRASH = readFileSync(join(root, 'supabase/migrations/2026-10-22-client-crash-reports.sql'), 'utf8');

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  -- Supabase's defaults: every client role holds every table privilege; RLS is the guard.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant usage, select, update on sequences to anon, authenticated, service_role;

  create table public.boards (id bigserial primary key, user_id uuid, author text, hero_id text, seed bigint, wave int,
    patch text, snapshot jsonb, unrated boolean not null default false);
  create table public.pool_runs (run_key text primary key, boards int not null default 0);
  create table public.board_results (id bigserial primary key, user_id uuid, board_id text, outcome text, created_at timestamptz default now());
  create table public.lobby_fights (id bigserial primary key, user_id uuid, lobby_seed bigint, run_a text, run_b text, outcome text,
    unique (lobby_seed, run_a, run_b));
  create table public.perf_runs (id bigserial primary key, user_id uuid, patch text);
  create table public.practice_games (id bigserial primary key, user_id uuid, replay jsonb);
  create table public.profiles (user_id uuid primary key, author text, rating int not null default 0, avatar text);
  create table public.run_history (id bigserial primary key, user_id uuid, entry jsonb);
  create table public.run_telemetry (id bigserial primary key, user_id uuid, replay jsonb);
  create table public.runs (id bigserial primary key, user_id uuid, hero_id text);
  create table public.loot_crates (id bigserial primary key, user_id uuid, state text);
  do $$ declare t text; begin
    foreach t in array array['boards','pool_runs','board_results','lobby_fights','perf_runs','practice_games','profiles',
      'run_history','run_telemetry','runs','loot_crates'] loop
      execute format('alter table public.%I enable row level security', t);
    end loop;
  end $$;

  -- The production policies (2026-10-28).
  create policy "anon insert" on public.boards for insert to anon with check (true);
  create policy "anon read" on public.boards for select to anon using (true);
  create policy "insert own boards" on public.boards for insert to authenticated with check (auth.uid() = user_id);
  create policy "read boards" on public.boards for select using (true);
  create policy "read pool_runs" on public.pool_runs for select using (true);
  create policy "insert own board_results" on public.board_results for insert to authenticated with check (auth.uid() = user_id);
  create policy "read board_results" on public.board_results for select using (true);
  create policy "insert own lobby_fights" on public.lobby_fights for insert to authenticated with check (auth.uid() = user_id);
  create policy "read lobby_fights" on public.lobby_fights for select using (true);
  create policy "delete own perf_runs" on public.perf_runs for delete to authenticated using (auth.uid() = user_id);
  create policy "insert own perf_runs" on public.perf_runs for insert to authenticated with check (auth.uid() = user_id);
  create policy "read perf_runs" on public.perf_runs for select to authenticated using (true);
  create policy "insert own practice_games" on public.practice_games for insert to authenticated with check (auth.uid() = user_id);
  create policy "read practice_games" on public.practice_games for select using (true);
  create policy "insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = user_id and rating = 0);
  create policy "read profiles" on public.profiles for select using (true);
  create policy "update own profile" on public.profiles for update to authenticated using (auth.uid() = user_id)
    with check (auth.uid() = user_id and rating = (select p.rating from public.profiles p where p.user_id = auth.uid()));
  create policy "insert own run_history" on public.run_history for insert to authenticated with check (auth.uid() = user_id);
  create policy "read run_history" on public.run_history for select to authenticated using (true);
  create policy "insert own run_telemetry" on public.run_telemetry for insert to authenticated with check (auth.uid() = user_id);
  create policy "read run_telemetry" on public.run_telemetry for select using (true);
  create policy "insert own runs" on public.runs for insert to authenticated with check (auth.uid() = user_id);
  create policy "read runs" on public.runs for select using (true);
  create policy "read own loot_crates" on public.loot_crates for select to authenticated using (auth.uid() = user_id);

  -- The pool trigger: SECURITY DEFINER, writes pool_runs on every board insert (statement-level in production).
  create function public.pool_runs_after_boards_insert() returns trigger language plpgsql security definer set search_path = public as $$
  begin
    insert into public.pool_runs (run_key, boards) select n.author || '|' || n.hero_id || '|' || n.seed, count(*) from new_rows n
      group by 1 on conflict (run_key) do update set boards = public.pool_runs.boards + excluded.boards;
    return null;
  end $$;
  create trigger pool_runs_boards_insert after insert on public.boards referencing new table as new_rows
    for each statement execute function public.pool_runs_after_boards_insert();

  -- An RPC-only writer (the progression/crate shape): SECURITY DEFINER, executable by a session.
  create function public.grant_crate() returns void language sql security definer set search_path = public as $$
    insert into public.loot_crates (user_id, state) values (auth.uid(), 'sealed') $$;
  revoke all on function public.grant_crate() from public, anon;
  grant execute on function public.grant_crate() to authenticated;

  -- The pool/histogram RPCs: SECURITY INVOKER, readable by every role before part 2 (the production grants).
  create function public.pool_runs_sample(p_limit int) returns setof public.pool_runs language sql stable as $$
    select * from public.pool_runs order by run_key limit p_limit $$;
  create function public.board_strength_histogram(p_ref text) returns table (n bigint) language sql stable as $$
    select count(*) from public.boards $$;
  create function public.run_strength_histogram(p_set text) returns table (n bigint) language sql stable as $$
    select count(*) from public.pool_runs $$;

  create view public.run_fight_records with (security_invoker = true) as
    select run_a as run_key, count(*) as fights from public.lobby_fights group by run_a;
  grant select on public.run_fight_records to anon, authenticated;
`;

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
type Role = 'anon' | 'authenticated';
let db: PGlite;

async function as<T>(role: Role, sub: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? '']);
    await db.exec(`set local role ${role}`);
    const r = await db.query<T>(sql, params);
    await db.exec('commit');
    return r.rows;
  } catch (e) { await db.exec('rollback'); throw e; }
}
const count = async (sql: string): Promise<number> => Number((await db.query<{ n: number }>(sql)).rows[0]!.n);

/** Every client write, in the shape the client sends it (supabase-js -> PostgREST). Each must land. */
async function everyClientWriteLands(user: string, tag: string): Promise<void> {
  // uploadBoards: one multi-row insert, return=minimal (no RETURNING).
  await as('authenticated', user, `insert into public.boards (user_id, author, hero_id, seed, wave, patch, snapshot, unrated)
    values ($1, 'p${tag}', 'h', 1, 1, '0.1.0+x', '{}', false), ($1, 'p${tag}', 'h', 1, 2, '0.1.0+x', '{}', false)`, [user]);
  await as('authenticated', user, "insert into public.board_results (user_id, board_id, outcome) values ($1, 'b', 'win')", [user]);
  // recordLobbyFights: upsert with ignoreDuplicates = ON CONFLICT DO NOTHING; twice, the second is a duplicate.
  for (let i = 0; i < 2; i++) {
    await as('authenticated', user, `insert into public.lobby_fights (user_id, lobby_seed, run_a, run_b, outcome) values ($1, 7, 'a${tag}', 'b', 'win')
      on conflict (lobby_seed, run_a, run_b) do nothing`, [user]);
  }
  // perfCloud: insert, read, delete own.
  const [perf] = await as<{ id: number }>('authenticated', user, "insert into public.perf_runs (user_id, patch) values ($1, 'x') returning id", [user]);
  expect((await as('authenticated', user, 'select id from public.perf_runs where id = $1', [perf!.id])).length).toBe(1);
  expect((await as('authenticated', user, 'delete from public.perf_runs where id = $1 returning id', [perf!.id])).length).toBe(1);
  // uploadPracticeGame: insert ... select('id') = RETURNING.
  expect((await as('authenticated', user, "insert into public.practice_games (user_id, replay) values ($1, '{}') returning id", [user])).length).toBe(1);
  // uploadPlayerProfile / claimHandle / pushProfileAvatar: update own (returning user_id), insert when missing.
  const upd = await as('authenticated', user, "update public.profiles set author = $2, avatar = 'x' where user_id = $1 returning user_id", [user, `n${tag}`]);
  if (upd.length === 0) await as('authenticated', user, 'insert into public.profiles (user_id, author, rating) values ($1, $2, 0)', [user, `n${tag}`]);
  await as('authenticated', user, "insert into public.run_history (user_id, entry) values ($1, '{}')", [user]);
  await as('authenticated', user, "insert into public.run_telemetry (user_id, replay) values ($1, '{}')", [user]);
  await as('authenticated', user, "insert into public.runs (user_id, hero_id) values ($1, 'h')", [user]);
  // crashReport.ts fallback: the bare public key, insert only.
  await as('anon', null, "insert into public.client_crash_reports (session_key, last_step, ua, standalone, build, payload) values ('k', 's', 'u', false, 'b', '{}')");
  // The definer writers keep writing (the trigger fed pool_runs; the RPC writes a no-policy table).
  await as('authenticated', user, 'select public.grant_crate()');
}

/** Every client read of the large tables, as a signed-in session (an anonymous guest included). */
async function sessionReadsAnswer(user: string): Promise<void> {
  for (const t of ['boards', 'run_telemetry', 'practice_games', 'runs', 'lobby_fights', 'board_results', 'pool_runs', 'run_history', 'profiles']) {
    expect((await as('authenticated', user, `select * from public.${t} limit 5`)).length, t).toBeGreaterThan(0);
  }
  expect((await as('authenticated', user, 'select * from public.run_fight_records')).length).toBeGreaterThan(0);
  expect((await as('authenticated', user, 'select * from public.pool_runs_sample(150)')).length).toBeGreaterThan(0);
  expect((await as<{ n: number }>('authenticated', user, "select * from public.board_strength_histogram('v1')"))[0]!.n).toBeGreaterThan(0);
  expect((await as('authenticated', user, "select * from public.run_strength_histogram('set3')")).length).toBe(1);
  expect((await as('authenticated', user, 'select * from public.loot_crates')).length).toBeGreaterThan(0);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(CRASH);
});
afterAll(async () => { await db.close(); });

describe('security pass (2026-11-07)', () => {
  it('BEFORE: the hole is real (anon writes a board for someone else) and every client flow works', async () => {
    await as('anon', null, "insert into public.boards (user_id, author, hero_id, seed, wave, snapshot) values ($1, 'forged', 'h', 9, 1, '{}')", [B]);
    expect(await count("select count(*) as n from public.boards where author = 'forged'")).toBe(1);
    await db.exec("delete from public.boards where author = 'forged'");
    await everyClientWriteLands(A, '0');
    await sessionReadsAnswer(A);
  });

  it('part 1 applies twice, and every client write still lands', async () => {
    await db.exec(PART1);
    await db.exec(PART1);
    await everyClientWriteLands(A, '1');
    await everyClientWriteLands(B, '2'); // a second account, so the profile INSERT path runs after part 1 too
    await sessionReadsAnswer(A);
    expect(await count('select boards as n from public.pool_runs where run_key = \'p1|h|1\'')).toBe(2);
  });

  it('part 1: anon can no longer write boards, and nobody writes them for someone else', async () => {
    await expect(as('anon', null, "insert into public.boards (user_id, author, hero_id, seed, wave, snapshot) values ($1, 'forged', 'h', 9, 1, '{}')", [B])).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', A, "insert into public.boards (user_id, author, hero_id, seed, wave, snapshot) values ($1, 'forged', 'h', 9, 1, '{}')", [B])).rejects.toThrow(/row-level security/);
    expect(await count("select count(*) as n from public.boards where author = 'forged'")).toBe(0);
  });

  it('part 1: a write no policy allows is a permission error now (was a silent 0 rows), and TRUNCATE is gone', async () => {
    await expect(as('authenticated', A, "update public.loot_crates set state = 'open'")).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', A, 'delete from public.run_telemetry')).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', A, "update public.boards set author = 'x'")).rejects.toThrow(/permission denied/);
    await expect(as('anon', null, "insert into public.profiles (user_id, author) values ($1, 'x')", [B])).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', A, "insert into public.run_fight_records values ('x', 1)")).rejects.toThrow(/permission denied|cannot insert/);
    for (const t of ['boards', 'profiles', 'loot_crates', 'run_telemetry']) {
      await expect(as('authenticated', A, `truncate public.${t}`), t).rejects.toThrow(/permission denied/);
      await expect(as('anon', null, `truncate public.${t}`), t).rejects.toThrow(/permission denied/);
    }
    // the profile's update policy still guards its columns (a rating write is refused, not newly allowed)
    await expect(as('authenticated', A, 'update public.profiles set rating = 9 where user_id = $1', [A])).rejects.toThrow(/row-level security/);
  });

  it('part 1: a table created later no longer hands TRUNCATE to the client roles', async () => {
    await db.exec('create table public.later_table (id int); alter table public.later_table enable row level security');
    const r = await db.query<{ t: boolean; i: boolean }>("select has_table_privilege('authenticated', 'public.later_table', 'truncate') t, has_table_privilege('authenticated', 'public.later_table', 'insert') i");
    expect(r.rows[0]).toEqual({ t: false, i: true });
    await db.exec('drop table public.later_table');
  });

  it('BEFORE part 2: the bare public key still reads the large tables (old builds keep working until it is applied)', async () => {
    expect((await as('anon', null, 'select * from public.run_telemetry limit 1')).length).toBe(1);
    expect((await as('anon', null, 'select * from public.pool_runs_sample(150)')).length).toBeGreaterThan(0);
  });

  it('part 2 applies twice: the large tables and pool RPCs answer a session only; the small public reads still answer anon', async () => {
    await db.exec(PART2);
    await db.exec(PART2);
    for (const t of ['boards', 'run_telemetry', 'practice_games', 'runs', 'lobby_fights', 'board_results', 'pool_runs', 'run_fight_records']) {
      await expect(as('anon', null, `select * from public.${t} limit 1`), t).rejects.toThrow(/permission denied/);
    }
    await expect(as('anon', null, 'select * from public.pool_runs_sample(150)')).rejects.toThrow(/permission denied/);
    await expect(as('anon', null, "select * from public.board_strength_histogram('v1')")).rejects.toThrow(/permission denied/);
    await expect(as('anon', null, "select * from public.run_strength_histogram('set3')")).rejects.toThrow(/permission denied/);
    expect((await as('anon', null, 'select user_id, author from public.profiles')).length).toBeGreaterThan(0);
    await sessionReadsAnswer(A);
    await sessionReadsAnswer(B);
    await everyClientWriteLands(A, '3');
  });
});
