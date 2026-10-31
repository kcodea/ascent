/**
 * LIVE GAMES ARE CLOUDFLARE ONLY, the SQL half (R-LIVE-CF-ONLY-01; `supabase/migrations/2026-11-17-retire-supabase-live.sql`).
 * PGlite runs the original live-game migrations, then the retirement, and pins what an OLD client sees afterwards:
 *  - its Supabase heartbeat, end and keyframe writes are refused (`live_moved`), so its game is simply not listed;
 *  - its Supabase watch of a listed game answers `other_host` (its friend Watch then joins the game on the Worker), and
 *    of an unlisted one `no_game`; no watcher row is ever written; the watcher read is empty, unwatch does nothing;
 *  - the transient rows go (Supabase-hosted lobby rows, keyframes, watcher rows); Worker rows and Versus rows stay;
 *  - running it twice is harmless.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const sql = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.profiles (user_id uuid, rating int not null default 0, rank_division int not null default 0, rank_points int not null default 0);
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
// The later columns the retirement reads (2026-11-08 / 2026-11-10), without the rest of those migrations.
const LATER_COLUMNS = `
  alter table public.lobby_live_games add column if not exists live_until timestamptz;
  alter table public.lobby_live_games add column if not exists live_host text;
`;

const P = '00000000-0000-0000-0000-0000000000aa'; // a player
const Q = '00000000-0000-0000-0000-0000000000bb'; // another player
const R = '00000000-0000-0000-0000-0000000000cc'; // a third
const W = '00000000-0000-0000-0000-000000000001'; // a watcher

let db: PGlite;
async function as<T = any>(user: string, q: string, params: unknown[] = []): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`);
  try {
    const r = await db.query<Record<string, unknown>>(q, params);
    const row = r.rows[0];
    return (row ? Object.values(row)[0] : undefined) as T;
  } finally {
    await db.exec('reset role');
  }
}
async function fails(user: string, q: string, params: unknown[] = []): Promise<string> {
  try { await as(user, q, params); } catch (e) { return (e as Error).message; }
  return 'did not fail';
}
const count = async (table: string, where = 'true'): Promise<number> =>
  Number((await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${where}`)).rows[0]!.n);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(sql('2026-10-15-lobby-live.sql'));
  await db.exec(sql('2026-10-15-lobby-live-watcher-identity.sql'));
  await db.exec(LATER_COLUMNS);
  for (const u of [P, Q, R, W]) await db.query(`insert into auth.users (id) values ($1)`, [u]);
  // Before the retirement: an old client's Supabase game (listed, watched, a keyframe), a Worker row and a Versus row.
  await as(P, `select public.lobby_live_heartbeat('old-game', 'Ann', 'warden', null, 2, 'shop')`);
  await as(W, `select public.lobby_live_watch('old-game')`);
  await as(P, `select public.lobby_live_publish_frame('old-game', 1, 2, '{"k":1}'::jsonb)`);
  await db.query(`insert into public.lobby_live_games (game_id, user_id, display_name, hero_id, live_host, live_until, last_seen_at)
    values ('cf-game', $1, 'Bea', 'warden', 'cf:rev1', now() + interval '4 minutes', now() - interval '90 seconds')`, [Q]);
  await db.query(`insert into public.lobby_live_games (game_id, user_id, display_name, hero_id) values ('versus:cf:room-1', $1, 'Cat', 'warden')`, [R]);
  expect(await count('lobby_live_watchers')).toBe(1);
  expect(await count('lobby_live_frames')).toBe(1);
  // The retirement, twice (idempotent).
  await db.exec(sql('2026-11-17-retire-supabase-live.sql'));
  await db.exec(sql('2026-11-17-retire-supabase-live.sql'));
});

describe('after the retirement (R-LIVE-CF-ONLY-01)', () => {
  it('an old client\'s Supabase writes are refused: its game is simply not listed', async () => {
    expect(await fails(P, `select public.lobby_live_heartbeat('old-2', 'Ann', 'warden', null, 1, 'shop')`)).toMatch(/live_moved/);
    expect(await fails(P, `select public.lobby_live_end('old-2', 1)`)).toMatch(/live_moved/);
    expect(await fails(P, `select public.lobby_live_publish_frame('old-2', 2, 1, '{}'::jsonb)`)).toMatch(/live_moved/);
    expect(await count('lobby_live_games', `game_id = 'old-2'`)).toBe(0);
  });

  it('the transient rows are gone; the Worker row and the Versus row stay', async () => {
    expect(await count('lobby_live_games', `game_id = 'old-game'`)).toBe(0);
    expect(await count('lobby_live_frames')).toBe(0);
    expect(await count('lobby_live_watchers')).toBe(0);
    expect(await count('lobby_live_games', `game_id in ('cf-game', 'versus:cf:room-1')`)).toBe(2);
  });

  it('an old client\'s watch: a listed game answers other_host (even past 60 s, by live_until); an unlisted one no_game; no watcher row', async () => {
    expect(await fails(W, `select public.lobby_live_watch('cf-game')`)).toMatch(/other_host/);
    expect(await fails(W, `select public.lobby_live_watch_as('cf-game', 'Claudebot2', '{}'::jsonb)`)).toMatch(/other_host/);
    expect(await fails(W, `select public.lobby_live_watch_as('gone', 'Claudebot2', '{}'::jsonb)`)).toMatch(/no_game/);
    expect(await count('lobby_live_watchers')).toBe(0);
    expect(await as(W, `select public.lobby_live_watchers('cf-game')`)).toEqual([]);
    expect(await fails(W, `select public.lobby_live_unwatch('cf-game')`)).toBe('did not fail');
  });
});
