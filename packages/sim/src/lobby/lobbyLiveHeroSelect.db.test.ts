/**
 * LIVE GAMES FROM HERO SELECT, the SQL executed (owner 2026-10-26: "I want spectating to show up when a player goes into
 * hero select. this should work in all modes. hero select should be spectatable."; R-SPECTATE-HEROSELECT-01). PGlite runs
 * the live-games migration, then `2026-10-26-lobby-live-hero-select.sql`, against a stubbed `auth.uid()`: a ranked game is
 * listed from its Hero Select (phase 'hero'), a watcher can join it, its Hero Select frame is stored like a keyframe, and
 * the pick flows into the same row (shop). Before the migration the 'hero' phase is refused (the client then simply is
 * not listed until its shop), and an unknown phase still is after it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const BASE = readFileSync(join(root, 'supabase/migrations/2026-10-15-lobby-live.sql'), 'utf8');
const HERO = readFileSync(join(root, 'supabase/migrations/2026-10-26-lobby-live-hero-select.sql'), 'utf8');
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

const P = '00000000-0000-0000-0000-0000000000aa';
const W = '00000000-0000-0000-0000-000000000001';
let db: PGlite;
async function as<T = any>(user: string, sql: string, params: unknown[] = []): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`);
  try {
    const r = await db.query<Record<string, unknown>>(sql, params);
    const row = r.rows[0];
    return (row ? Object.values(row)[0] : undefined) as T;
  } finally {
    await db.exec('reset role');
  }
}
async function fails(user: string, sql: string, params: unknown[] = []): Promise<string> {
  try { await as(user, sql, params); } catch (e) { return (e as Error).message; }
  return 'did not fail';
}
const beat = (game: string, phase: string, hero = 'warden', round = 1) =>
  as<number>(P, `select public.lobby_live_heartbeat($1, 'Ann', $2, null, $3, $4)`, [game, hero, round, phase]);
const rowOf = async (game: string): Promise<any> => (await db.query<any>(`select * from public.lobby_live_games where game_id = $1`, [game])).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(BASE);
  for (const u of [P, W]) await db.query(`insert into auth.users (id) values ($1)`, [u]);
});

describe('a ranked game is live from Hero Select (R-SPECTATE-HEROSELECT-01)', () => {
  it('before the migration the hero phase is refused (the client is listed from its shop, as before)', async () => {
    expect(await fails(P, `select public.lobby_live_heartbeat('g0', 'Ann', 'warden', null, 1, 'hero')`)).toMatch(/bad_phase/);
  });

  it('after it: listed at Hero Select, watchable, its frame stored, and the pick flows into the same row', async () => {
    await db.exec(HERO);
    await db.exec(HERO); // idempotent
    expect(await beat('rank-1', 'hero')).toBe(0);
    expect(await rowOf('rank-1')).toMatchObject({ phase: 'hero', round: 1, hero_id: 'warden' });
    await as(W, `select public.lobby_live_watch('rank-1')`);
    expect(await beat('rank-1', 'hero', 'juggler')).toBe(1); // a watcher: the client publishes its Hero Select
    await as(P, `select public.lobby_live_publish_frame('rank-1', 101, 0, '{"kind":"hero","seq":101,"hero":{"offer":["warden","juggler"]}}'::jsonb)`);
    expect(await as<string>(W, `select frame->>'kind' from public.lobby_live_frames where game_id = 'rank-1'`)).toBe('hero');
    // Start Game: the run's first keyframe replaces it, the row moves to the shop, the watcher stays
    await as(P, `select public.lobby_live_publish_frame('rank-1', 102, 1, '{"kind":"key","seq":102}'::jsonb)`);
    expect(await as<string>(W, `select frame->>'kind' from public.lobby_live_frames where game_id = 'rank-1'`)).toBe('key');
    expect(await beat('rank-1', 'shop', 'juggler')).toBe(1);
    expect(await rowOf('rank-1')).toMatchObject({ phase: 'shop', hero_id: 'juggler' });
  });

  it('an unknown phase is still refused, by the RPC and by the table', async () => {
    expect(await fails(P, `select public.lobby_live_heartbeat('g9', 'Ann', 'warden', null, 1, 'lobby')`)).toMatch(/bad_phase/);
    expect(await fails(P, `update public.lobby_live_games set phase = 'nope'`)).not.toBe('did not fail');
  });
});
