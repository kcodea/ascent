/**
 * RANKED DUOS phase 3, EXECUTED (R-RANKED-DUOS-PARTY-01): PGlite runs every Versus migration, the friends and Live Games
 * migrations, the Ranked Duos server, then `2026-11-01-ranked-duos-party.sql` (twice: idempotent), against a stubbed
 * `auth.uid()`:
 *
 * - the friends-only switch: host only, open rooms only; a friends-only party is listed, counted and joinable only for
 *   the host's friends and its own members; a public party for everyone;
 * - `versus_open_rooms` counts Ranked Duos parties apart (`duosOpen`), never in the Versus counts;
 * - the invite path: a `duos_party` invite to an online friend, accepted, then the friend joins and takes the free seat;
 * - `duos_leaderboard` lists TEAMS by division then points with both players' public fields; `duos_teams_of` a player's;
 * - `lobby_live_duos_heartbeat`: ONE row per team from the first seat only, named by the team, never for a friends-only
 *   party, gone at the game's end.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const mig = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql', '2026-10-25-versus-duos-random-order.sql',
  '2026-10-25-versus-duos-pass-back.sql', '2026-10-26-versus-lock-order.sql', '2026-10-27-versus-egress.sql', '2026-10-28-versus-health.sql',
  '2026-10-15-lobby-live.sql', '2026-10-26-lobby-live-hero-select.sql', '2026-10-28-friends.sql',
  '2026-10-29-ranked-duos.sql', '2026-10-30-ranked-duos-client.sql', '2026-10-31-ranked-duos-live-fixes.sql',
];
const BASE = FILES.map(mig).join('\n');
const PARTY = mig('2026-11-01-ranked-duos-party.sql');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create table public.profiles (user_id uuid primary key, author text, discriminator text, avatar text, favorite_hero text);
  grant select on public.profiles to anon, authenticated;
  create table public.cosmetic_loadouts (user_id uuid, slot text, target_id text not null default '', cosmetic_id text, primary key (user_id, slot, target_id));
  grant select on public.cosmetic_loadouts to anon, authenticated;
`;
const U = (n: number): string => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const [A, B, C, D] = [1, 2, 3, 4].map(U) as [string, string, string, string];
const NAMES: Record<string, string> = { [A]: 'Kevin', [B]: 'Lemon', [C]: 'Ionlime', [D]: 'Dan' };
const CONTENT = 'rev1';
const OPT_RANKED = JSON.stringify({ v: 1, mode: 'ranked_duos', modifiers: [] });

let db: PGlite;
const clock = Date.now();
async function as<T = any>(user: string | null, sql: string, params: unknown[] = []): Promise<T> {
  await db.exec(`set versus.test_now = '${new Date(clock).toISOString()}'`);
  await db.exec(user ? `select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;` : `select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
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
const q = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const party = async (host: string): Promise<string> =>
  (await as<any>(host, `select public.versus_create_room('Party', $1, '{}', 'set3', $2, 1, $3::jsonb)`, [NAMES[host], CONTENT, OPT_RANKED])).id;
const join_ = (u: string, room: string) => as<any>(u, `select public.versus_join_room($1, 'player', $2, '{}', $3, 1)`, [room, NAMES[u], CONTENT]);
const listIds = async (u: string): Promise<string[]> => ((await as<any[]>(u, 'select public.versus_list_rooms()')) ?? []).map((r) => r.id);
const counts = (u: string) => as<{ open: number; seatOpen: number; duosOpen: number }>(u, 'select public.versus_open_rooms(1, $1)', [CONTENT]);
const leave = (u: string, room: string) => as(u, 'select public.versus_leave_room($1)', [room]);
async function befriend(a: string, b: string): Promise<void> {
  await as(a, 'select public.friends_request($1, null)', [b]);
  await as(b, 'select public.friends_respond($1, true)', [a]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const [i, id] of [A, B, C, D].entries()) {
    await db.query('insert into auth.users (id) values ($1)', [id]);
    await db.query('insert into public.profiles (user_id, author, discriminator, favorite_hero) values ($1, $2, $3, $4)', [id, NAMES[id], String(1111 * (i + 1)), 'warden']);
  }
  await db.exec(BASE);
  await db.exec(PARTY);
  await db.exec(PARTY); // idempotent
  // The 2026-11-02 reliability migration changes no behaviour these tests pin (R-VERSUS-CLOSE-ONCE-01 and friends).
  await db.exec(readFileSync(join(root, 'supabase/migrations/2026-11-02-versus-server-reliability.sql'), 'utf8'));
  await befriend(A, B); // Kevin and Lemon are friends; Ionlime is nobody's friend
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('Ranked Duos party (R-RANKED-DUOS-PARTY-01)', () => {
  it('a public party is listed and counted for everyone, in the Duos count only', async () => {
    const room = await party(A);
    expect(await listIds(C)).toContain(room);
    const c = await counts(C);
    expect(c.duosOpen).toBe(1);
    expect(c.open).toBe(0); // never in the Versus counts
    await leave(A, room);
  });

  it('friends only: host only, open rooms only; listed, counted and joinable only for friends and members', async () => {
    const room = await party(A);
    expect(await fails(C, 'select public.versus_set_friends_only($1, true)', [room])).toMatch(/not_host|not_a_member/);
    const r = await as<any>(A, 'select public.versus_set_friends_only($1, true)', [room]);
    expect(r.friends_only ?? r.friendsOnly).toBe(true);
    // A stranger: not listed, not counted, cannot join.
    expect(await listIds(C)).not.toContain(room);
    expect((await counts(C)).duosOpen).toBe(0);
    expect(await fails(C, `select public.versus_join_room($1, 'player', 'Ionlime', '{}', $2, 1)`, [room, CONTENT])).toMatch(/friends_only/);
    // The host's friend: listed, counted, joins.
    expect(await listIds(B)).toContain(room);
    expect((await counts(B)).duosOpen).toBe(1);
    const joined = await join_(B, room);
    expect(joined.members.map((m: any) => m.userId)).toContain(B);
    // Back to public: the stranger sees it again (no free seat now, so not counted).
    await as(A, 'select public.versus_set_friends_only($1, false)', [room]);
    expect(await listIds(C)).toContain(room);
    await leave(B, room);
    await leave(A, room);
  });

  it('the invite path: a duos_party invite to an online friend, accepted, then the friend takes the free seat', async () => {
    const room = await party(A);
    await as(B, `select public.friends_beat('online')`);
    expect(await fails(A, `select public.friends_invite($1, 'duos_party', $2)`, [C, room])).toMatch(/not_friends/);
    const inv = await as<any>(A, `select public.friends_invite($1, 'duos_party', $2)`, [B, room]);
    const got = await as<any>(B, 'select public.friends_invite_respond($1, true)', [inv.id]);
    expect(got).toMatchObject({ status: 'accepted', kind: 'duos_party', target: room });
    // The client's accept: join the room (into the hand) and take the party's free seat.
    await join_(B, got.target);
    const seated = await as<any>(B, `select public.versus_take_seat($1, 'p2')`, [room]);
    expect(seated.members.find((m: any) => m.userId === B)?.role).toBe('p2');
    expect(seated.members.find((m: any) => m.userId === A)?.role).toBe('p1');
    await leave(B, room);
    await leave(A, room);
  });

  it('duos_leaderboard lists teams by division then points; duos_teams_of lists a player’s rated teams', async () => {
    const t1 = (await as<any>(A, 'select public.duos_team_set_name($1, $2)', [B, 'Lemon Squad'])).id;
    const [t2] = (await q<{ id: string }>(`insert into public.duos_teams (user_lo, user_hi) values ($1, $2) returning id`, [C < D ? C : D, C < D ? D : C])).map((r) => r.id);
    await as(null, 'select public.settle_duos_rank($1, $2, 1)', [t1, '00000000-0000-4000-8000-000000000001']);
    await as(null, 'select public.settle_duos_rank($1, $2, 4)', [t2, '00000000-0000-4000-8000-000000000002']);
    const board = await as<any[]>(C, 'select public.duos_leaderboard(10, 0)');
    expect(board.map((r) => r.teamId)).toEqual([t1, t2]);
    expect(board[0]).toMatchObject({ name: 'Lemon Squad', games: 1 });
    expect(board[0].players.map((p: any) => p.name).sort()).toEqual(['Kevin', 'Lemon']);
    expect(board[1].name).toBeNull(); // unnamed: the client shows "Name1 & Name2"
    const mine = await as<any[]>(A, 'select public.duos_teams_of($1)', [A]);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ teamId: t1, name: 'Lemon Squad', games: 1, partner: { name: 'Lemon' } });
  });

  it('Live Games: one row per team from the first seat, named by the team; never friends-only; gone at the end', async () => {
    const room = await party(A);
    await join_(B, room);
    await as(B, `select public.versus_take_seat($1, 'p2')`, [room]);
    await as(A, 'select public.versus_start_game($1)', [room]);
    let r: any;
    for (const u of [A, B]) r = await as(u, 'select public.versus_press_gate($1)', [room]);
    expect(r.status).toBe('in_game');
    expect(await fails(B, `select public.lobby_live_duos_heartbeat($1, 1, 'hero')`, [room])).toMatch(/not_p1/);
    expect(await as(A, `select public.lobby_live_duos_heartbeat($1, 1, 'hero')`, [room])).toBe(0);
    const rows = await q<any>('select * from public.lobby_live_games');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ game_id: `duos:${room}`, user_id: A, display_name: 'Lemon Squad', phase: 'hero' });
    // A friends-only party leaves the list (the room is in a game, so the flag is set directly here).
    await q('update public.versus_rooms set friends_only = true where id = $1', [room]);
    expect(await as(A, `select public.lobby_live_duos_heartbeat($1, 2, 'shop')`, [room])).toBe(0);
    expect(await q('select 1 from public.lobby_live_games')).toHaveLength(0);
    await q('update public.versus_rooms set friends_only = false where id = $1', [room]);
    await as(A, `select public.lobby_live_duos_heartbeat($1, 3, 'combat')`, [room]);
    expect(await q('select 1 from public.lobby_live_games')).toHaveLength(1);
    // The end: delisted at once.
    expect(await as(A, `select public.lobby_live_duos_heartbeat($1, 3, 'end')`, [room])).toBe(0);
    expect(await q('select 1 from public.lobby_live_games')).toHaveLength(0);
  });
});
