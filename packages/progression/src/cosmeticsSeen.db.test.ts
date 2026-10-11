import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE COLLECTION'S "SEEN" SQL, EXECUTED (owner 2026-10-11: "i want to save the 'seen' on the account level").
 * PGlite runs the MVP and crates migrations, gives two players some items, then runs the seen migration:
 *  - THE BASELINE: everything owned when the file first runs is seen; a later unlock is not;
 *  - `mark_cosmetics_seen` marks only the CALLER's own unseen items, and reports how many;
 *  - it never touches another account, never grants an item, never moves an already-set time;
 *  - a signed-out caller marks nothing; clients cannot write the column directly;
 *  - re-running the file changes nothing (it does NOT re-take the baseline over later finds).
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const MVP = read('2026-09-27-account-progression.sql');
const CRATES = read('2026-09-28-progression-crates.sql');
const SEEN = read('2026-10-11-cosmetics-seen.sql');

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.profiles (user_id uuid primary key references auth.users(id), rating int not null default 0,
    rank_highest_division int not null default 0, updated_at timestamptz not null default now());
  alter table public.profiles enable row level security;
  create policy "read profiles" on public.profiles for select using (true);
  create policy "update own profile" on public.profiles for update to authenticated using (auth.uid() = user_id);
  create table public.rank_results (user_id uuid, run_id text, placement int, seed bigint, created_at timestamptz default now(),
    promoted boolean not null default false, division_before int not null default 0, was_demotion_game boolean not null default false,
    demoted boolean not null default false, lobby_strength int, primary key (user_id, run_id));
  create table public.run_history (user_id uuid, mode text, entry jsonb, wins int, created_at timestamptz default now());
  create table public.practice_games (id bigserial primary key, user_id uuid, hero_id text, placement int, config jsonb, record jsonb, created_at timestamptz default now());
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
`;

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
let db: PGlite;
let ids: string[] = [];

const own = (u: string, id: string): Promise<unknown> =>
  db.query("insert into public.player_cosmetics (user_id, cosmetic_id, source) values ($1, $2, 'test')", [u, id]);
const unseen = async (u: string): Promise<string[]> =>
  (await db.query<{ cosmetic_id: string }>('select cosmetic_id from public.player_cosmetics where user_id = $1 and seen_at is null order by cosmetic_id', [u])).rows.map((r) => r.cosmetic_id);
/** Call the function the way the REST API does: as the `authenticated` role with the caller's id in the JWT claim. */
async function markAs(u: string | null, list: string[] | null): Promise<number> {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [u ?? '']);
    await db.exec('set local role authenticated');
    const n = (await db.query<{ n: number }>('select public.mark_cosmetics_seen($1::text[]) as n', [list])).rows[0]!.n;
    await db.exec('commit');
    return n;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MVP);
  await db.exec(CRATES);
  for (const u of [A, B]) await db.query('insert into auth.users (id) values ($1)', [u]);
  ids = (await db.query<{ cosmetic_id: string }>('select cosmetic_id from public.cosmetic_catalog order by cosmetic_id limit 4')).rows.map((r) => r.cosmetic_id);
  expect(ids).toHaveLength(4);
  // Owned BEFORE the migration: two for A, one for B.
  await own(A, ids[0]!); await own(A, ids[1]!); await own(B, ids[0]!);
  await db.exec(SEEN);
  // Supabase grants the API roles every table privilege by default; row level security is what holds the line.
  await db.exec('grant select, insert, update, delete on all tables in schema public to anon, authenticated;');
}, 60_000);
afterAll(async () => { await db.close(); });

describe('the Collection seen list on the account', () => {
  it('THE BASELINE: everything owned when the file first runs is seen; a later unlock is not', async () => {
    expect(await unseen(A)).toEqual([]);
    expect(await unseen(B)).toEqual([]);
    await own(A, ids[2]!); // every existing writer inserts without the column: it stays null
    expect(await unseen(A)).toEqual([ids[2]]);
  });

  it('re-running the file does NOT re-take the baseline over a later find', async () => {
    await db.exec(SEEN);
    await db.exec(SEEN);
    expect(await unseen(A)).toEqual([ids[2]]);
  });

  it('marks only the caller\'s own unseen items, reports the count, and never moves a time already set', async () => {
    await own(B, ids[2]!);
    const before = (await db.query<{ t: string }>('select seen_at::text as t from public.player_cosmetics where user_id = $1 and cosmetic_id = $2', [A, ids[0]])).rows[0]!.t;
    // ids[3] is not owned by A: it is not granted, and not counted.
    expect(await markAs(A, [ids[0]!, ids[2]!, ids[3]!])).toBe(1);
    expect(await unseen(A)).toEqual([]);
    expect(await unseen(B)).toEqual([ids[2]]); // another account's same item is untouched
    expect((await db.query('select 1 from public.player_cosmetics where user_id = $1 and cosmetic_id = $2', [A, ids[3]])).rows).toHaveLength(0);
    const after = (await db.query<{ t: string }>('select seen_at::text as t from public.player_cosmetics where user_id = $1 and cosmetic_id = $2', [A, ids[0]])).rows[0]!.t;
    expect(after).toBe(before);
    expect(await markAs(A, [ids[2]!])).toBe(0); // again: nothing left to mark
  });

  it('an empty or missing list, and a signed-out caller, mark nothing', async () => {
    expect(await markAs(B, [])).toBe(0);
    expect(await markAs(B, null)).toBe(0);
    expect(await markAs(null, [ids[2]!])).toBe(0);
    expect(await unseen(B)).toEqual([ids[2]]);
  });

  it('only a signed-in role may call it, and no client can write the column directly', async () => {
    const tryAs = async (role: string, sql: string): Promise<string> => {
      await db.exec('begin');
      try {
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [B]);
        await db.exec(`set local role ${role}`);
        await db.query(sql);
        return 'no error';
      } catch (e) {
        return String((e as Error).message);
      } finally {
        await db.exec('commit').catch(() => db.exec('rollback'));
      }
    };
    expect(await tryAs('anon', "select public.mark_cosmetics_seen(array['x'])")).toMatch(/permission denied/);
    // A direct write is stopped by row level security (the table has a read policy only): refused, or zero rows.
    await tryAs('authenticated', 'update public.player_cosmetics set seen_at = now()');
    await tryAs('authenticated', "update public.player_cosmetics set seen_at = null");
    expect(await unseen(B)).toEqual([ids[2]]);
    expect(await unseen(A)).toEqual([]);
  });
});
