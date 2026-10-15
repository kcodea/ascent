/**
 * LIVE RANKED LOBBY GAMES, the SQL executed (owner-approved 2026-10-15). PGlite runs the real migration
 * (`supabase/migrations/2026-10-15-lobby-live.sql`) against a stubbed `auth.uid()` and walks the presence lifecycle:
 * register (rank and rating from the player's own profile, never the client), heartbeat refresh, the watcher count that
 * gates publishing, the 20-watcher cap, never your own game, one live game per player, keyframes only from the owner
 * and only newer, the end (placement shown, then gone) and abandon (gone at once), and staleness after 60 s.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const MIGRATION = readFileSync(join(root, 'supabase/migrations/2026-10-15-lobby-live.sql'), 'utf8');
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

const P = '00000000-0000-0000-0000-0000000000aa'; // the player
const W = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`; // watchers

let db: PGlite;
async function as<T = any>(user: string | null, sql: string, params: unknown[] = []): Promise<T> {
  await db.exec(user ? `select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;` : `select set_config('request.jwt.claim.sub', '', false); set role anon;`);
  try {
    const r = await db.query<Record<string, unknown>>(sql, params);
    const row = r.rows[0];
    return (row ? Object.values(row)[0] : undefined) as T;
  } finally {
    await db.exec('reset role');
  }
}
async function fails(user: string | null, sql: string, params: unknown[] = []): Promise<string> {
  try { await as(user, sql, params); } catch (e) { return (e as Error).message; }
  return 'did not fail';
}
const beat = (user: string, game: string, round = 1, phase = 'shop') =>
  as<number>(user, `select public.lobby_live_heartbeat($1, 'Ann', 'warden', '{"frame":"gold"}'::jsonb, $2, $3)`, [game, round, phase]);
const listed = async (): Promise<any[]> => {
  await db.exec(`set role anon`);
  try { return (await db.query<any>(`select * from public.lobby_live_games order by division_index desc, rank_points desc, rating desc`)).rows; } finally { await db.exec('reset role'); }
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MIGRATION);
});
beforeEach(async () => {
  await db.exec(`delete from public.lobby_live_games; delete from auth.users; delete from public.profiles;`);
  const users = [P, ...Array.from({ length: 22 }, (_, i) => W(i + 1))];
  for (const u of users) await db.query(`insert into auth.users (id) values ($1)`, [u]);
  await db.query(`insert into public.profiles (user_id, rating, rank_division, rank_points) values ($1, 1500, 7, 40)`, [P]);
});

describe('the live listing', () => {
  it('registers with rank and rating from the profile, refreshes, and lists publicly', async () => {
    expect(await beat(P, 'g1')).toBe(0);
    let rows = await listed();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ game_id: 'g1', display_name: 'Ann', hero_id: 'warden', division_index: 7, rank_points: 40, rating: 1500, round: 1, phase: 'shop' });
    await beat(P, 'g1', 4, 'combat');
    rows = await listed();
    expect(rows[0]).toMatchObject({ round: 4, phase: 'combat' });
  });

  it('the watcher count gates publishing; the cap is 20; never your own game', async () => {
    await beat(P, 'g1');
    expect(await fails(P, `select public.lobby_live_watch('g1')`)).toMatch(/own_game/);
    expect(await beat(P, 'g1')).toBe(0); // nobody watching: the client publishes nothing
    await as(W(1), `select public.lobby_live_watch('g1')`);
    expect(await beat(P, 'g1')).toBe(1);
    for (let i = 2; i <= 20; i++) await as(W(i), `select public.lobby_live_watch('g1')`);
    expect(await fails(W(21), `select public.lobby_live_watch('g1')`)).toMatch(/spectators_full/);
    expect(await beat(P, 'g1')).toBe(20);
    await as(W(1), `select public.lobby_live_unwatch('g1')`);
    expect(await beat(P, 'g1')).toBe(19);
    // a watcher silent for 30 s no longer counts
    await db.exec(`update public.lobby_live_watchers set last_seen_at = now() - interval '45 seconds'`);
    expect(await beat(P, 'g1')).toBe(0);
  });

  it('one live game per player; keyframes only from the owner and only newer', async () => {
    await beat(P, 'g1');
    await beat(P, 'g2'); // a new game replaces the old row
    expect((await listed()).map((r) => r.game_id)).toEqual(['g2']);
    expect(await fails(W(1), `select public.lobby_live_publish_frame('g2', 1, 1, '{"kind":"key"}'::jsonb)`)).toMatch(/not_your_game/);
    await as(P, `select public.lobby_live_publish_frame('g2', 5, 1, '{"kind":"key","seq":5}'::jsonb)`);
    await as(P, `select public.lobby_live_publish_frame('g2', 3, 1, '{"kind":"key","seq":3}'::jsonb)`); // older: ignored
    const seq = await as<number>(W(1), `select seq from public.lobby_live_frames where game_id = 'g2'`);
    expect(Number(seq)).toBe(5);
  });

  it('end shows the placement, then the row goes; abandon removes it at once; 60 s of silence hides it', async () => {
    await beat(P, 'g1');
    await as(P, `select public.lobby_live_end('g1', 3)`);
    expect((await listed())[0]).toMatchObject({ phase: 'end', placement: 3 });
    await as(P, `select public.lobby_live_end('g1', null)`);
    expect(await listed()).toHaveLength(0);
    await beat(P, 'g3');
    await db.exec(`update public.lobby_live_games set last_seen_at = now() - interval '61 seconds'`);
    expect(await listed()).toHaveLength(0);
  });
});
