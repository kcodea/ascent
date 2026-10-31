/**
 * LIVE INFORMATION ON CLOUDFLARE, the SQL half (R-LIVE-DIR-01, R-FRIENDS-HUB-LIVE-01): PGlite runs the friends SQL, then
 * `2026-11-18-live-directory.sql` (the hub's two writers) and `2026-11-19-retire-supabase-live-list.sql` (the retirement),
 * and pins:
 *  - the hub's presence mirror (`hub_presence_cf`): key-gated, cleaned like the beat, read back by friends as before
 *    (status, mode, watch target, game / activity), offline on null; it is what `friends__online` (the invite check)
 *    reads; rows say who wrote them (`source`), which the retire check query counts;
 *  - the rank lookup (`live_dir_meta`): key-gated, players' rank and Ranked Duos teams' name + medal (season 3);
 *  - after the retirement: the Worker listing writers answer `retired` and write nothing, the Supabase list is empty and
 *    unreadable, `friends_beat` is refused, a `live:` spectate invite no longer needs a Supabase row; both files run
 *    twice harmlessly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
// PGlite has no pgcrypto: the extension line is stripped and `extensions.digest` is sha256 (as versusCfParity.db.test.ts).
const mig = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8').replace(/create extension if not exists pgcrypto[^;]*;/gi, '');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create schema extensions;
  create function extensions.digest(t text, alg text) returns bytea language sql immutable as $$ select sha256(convert_to(t, 'UTF8')) $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create table public.profiles (user_id uuid primary key, author text, discriminator text, avatar text, favorite_hero text,
    rating int not null default 0, rank_division int not null default 0, rank_points int not null default 0);
  grant select on public.profiles to anon, authenticated;
  create table public.cosmetic_loadouts (user_id uuid, slot text, target_id text not null default '', cosmetic_id text, primary key (user_id, slot, target_id));
  grant select on public.cosmetic_loadouts to anon, authenticated;
  create table public.versus_cf_writer_keys (key_hash text primary key, note text);
  create table public.duos_teams (id uuid primary key, name text);
  create table public.duos_team_ranks (team_id uuid, season int, division int, points int, primary key (team_id, season));
`;
const KEY = 'test-hub-writer-secret';
const u = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ANN = u(1);
const BOB = u(2);
const TEAM = u(77);

let db: PGlite;
async function as<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who ?? ''}', false); set role ${who ? 'authenticated' : 'anon'};`);
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec('reset role'); }
}
async function rpc(who: string | null, fn: string, args: unknown[] = []): Promise<any> {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  return (await as<{ v: unknown }>(who, `select public.${fn}(${ph}) as v`, args))[0]!.v;
}
const fails = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { return (e as Error).message; } return 'did not fail'; };
const mirror = (who: string, presence: unknown, key = KEY) => rpc(null, 'hub_presence_cf', [key, who, presence === null ? null : JSON.stringify(presence)]);
const friendOf = async (reader: string, id: string) => ((await rpc(reader, 'friends_list')).friends as Array<Record<string, any>>).find((f) => f.userId === id);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(mig('2026-10-13-versus.sql') + mig('2026-10-24-versus-group.sql') + mig('2026-10-28-friends.sql')
    + mig('2026-11-09-friends-presence-window.sql') + mig('2026-11-10-friends-activity.sql') + mig('2026-10-15-lobby-live.sql'));
  // The later bits the retirement touches (2026-11-08 / 2026-11-10 / 2026-11-11), without the rest of those migrations.
  await db.exec(`alter table public.lobby_live_games add column if not exists live_until timestamptz;
    alter table public.lobby_live_games add column if not exists live_host text;
    alter table public.friend_invites drop constraint if exists friend_invites_kind;
    alter table public.friend_invites add constraint friend_invites_kind check (kind in ('versus_room', 'duos_party', 'spectate'));`);
  for (const [id, name, tag] of [[ANN, 'Ann', '1111'], [BOB, 'Bob', '2222']] as const) {
    await db.query('insert into auth.users (id) values ($1)', [id]);
    await db.query('insert into public.profiles (user_id, author, discriminator, rating, rank_division, rank_points) values ($1, $2, $3, 1500, 4, 25)', [id, name, tag]);
  }
  await db.query('insert into public.versus_cf_writer_keys (key_hash, note) values ($1, $2)', [createHash('sha256').update(KEY).digest('hex'), 'ascent-hub']);
  await db.query(`insert into public.duos_teams (id, name) values ($1, 'The Hammers')`, [TEAM]);
  await db.query('insert into public.duos_team_ranks (team_id, season, division, points) values ($1, 3, 5, 40), ($1, 2, 9, 99)', [TEAM]);
  await rpc(ANN, 'friends_request', [BOB, null]);
  await rpc(BOB, 'friends_respond', [ANN, true]);
  await db.exec(mig('2026-11-18-live-directory.sql'));
  await db.exec(mig('2026-11-18-live-directory.sql'));
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the hub presence mirror (hub_presence_cf)', () => {
  it('is key-gated and needs a real account', async () => {
    expect(await fails(mirror(BOB, { status: 'online' }, 'wrong'))).toMatch(/not_authorized/);
    expect(await fails(mirror(u(999), { status: 'online' }))).toMatch(/bad_user/);
  });

  it('friends read it as they read the beat: status, mode, watch target, the game; the invite check sees it online', async () => {
    await mirror(BOB, { status: 'in_game', mode: 'ranked', watchKind: 'live', watchId: 'game-1', game: { v: 1, round: 3 } });
    expect(await friendOf(ANN, BOB)).toMatchObject({ status: 'in_game', mode: 'ranked', watchKind: 'live', watchId: 'game-1', game: { v: 1, round: 3 } });
    // In a game is not invitable (friends__online wants Online); the mirror's Online is.
    expect((await db.query<{ v: boolean }>('select public.friends__online($1) as v', [BOB])).rows[0]!.v).toBe(false);
    // Online carries the activity in the same slot (R-FRIENDS-ACTIVITY-01); junk is dropped, never an error.
    await mirror(BOB, { status: 'online', mode: 'Not A Mode!', watchKind: 'nonsense', watchId: 'x', activity: { v: 1, act: 'career' } });
    expect(await friendOf(ANN, BOB)).toMatchObject({ status: 'online', mode: null, watchKind: null, watchId: null, game: { v: 1, act: 'career' } }); // the list carries it in the game slot
    expect((await db.query<{ v: boolean }>('select public.friends__online($1) as v', [BOB])).rows[0]!.v).toBe(true);
  });

  it('null is Offline; every row says it came from the hub (the retire check query counts beats)', async () => {
    await mirror(BOB, null);
    expect((await friendOf(ANN, BOB))?.status).toBe('offline');
    expect((await db.query<{ source: string }>('select source from public.player_presence where user_id = $1', [BOB])).rows[0]!.source).toBe('hub');
    await rpc(ANN, 'friends_beat', ['online', null, null, null, null]);
    expect((await db.query<{ source: string }>('select source from public.player_presence where user_id = $1', [ANN])).rows[0]!.source).toBe('beat');
  });
});

describe('the directory rank lookup (live_dir_meta)', () => {
  it('players\' rank and a team\'s name + season 3 medal; key-gated; bounded', async () => {
    const r = await rpc(null, 'live_dir_meta', [KEY, `{${ANN}}`, `{${TEAM}}`]);
    expect(r.users[ANN]).toEqual({ division: 4, points: 25, rating: 1500 });
    expect(r.teams[TEAM]).toEqual({ name: 'The Hammers', division: 5, points: 40, rating: 540 });
    expect(await rpc(null, 'live_dir_meta', [KEY, '{}', '{}'])).toEqual({ users: {}, teams: {} });
    expect(await fails(rpc(null, 'live_dir_meta', ['nope', `{${ANN}}`, '{}']))).toMatch(/not_authorized/);
    const many = `{${Array.from({ length: 51 }, (_, i) => u(1000 + i)).join(',')}}`;
    expect(await fails(rpc(null, 'live_dir_meta', [KEY, many, '{}']))).toMatch(/too_many/);
  });
});

describe('after the retirement (2026-11-19)', () => {
  beforeAll(async () => {
    await db.query(`insert into public.lobby_live_games (game_id, user_id, display_name, hero_id, live_host, live_until) values ('cf-game', $1, 'Ann', 'warden', 'cf:rev1', now() + interval '4 minutes')`, [ANN]);
    await db.exec(mig('2026-11-19-retire-supabase-live-list.sql'));
    await db.exec(mig('2026-11-19-retire-supabase-live-list.sql'));
  });

  it('the Worker listing writers answer retired and write nothing; still key-gated', async () => {
    const room = '11111111-1111-4111-8111-111111111111';
    expect(await rpc(null, 'versus_cf_live', [KEY, room, JSON.stringify({ mode: 'duel', phase: 'shop', p1: ANN })])).toEqual({ ok: true, retired: true });
    expect(await rpc(null, 'lobby_live_cf', [KEY, 'g1', JSON.stringify({ user: ANN, phase: 'shop', host: 'cf:r' })])).toEqual({ ok: true, retired: true });
    expect(await fails(rpc(null, 'lobby_live_cf', ['nope', 'g1', null]))).toMatch(/not_authorized/);
    expect(Number((await db.query<{ n: number }>('select count(*)::int as n from public.lobby_live_games')).rows[0]!.n)).toBe(0);
  });

  it('the Supabase list is unreadable to players; the beat is refused; the presence mirror keeps working', async () => {
    expect(await fails(as(ANN, 'select * from public.lobby_live_games'))).toMatch(/permission denied/);
    expect(await fails(rpc(ANN, 'friends_beat', ['online', null, null, null, null]))).toMatch(/beat_moved/);
    await mirror(BOB, { status: 'online' });
    expect((await friendOf(ANN, BOB))?.status).toBe('online');
  });

  it('an invite to spectate my live game needs no Supabase row any more (the id must still be well formed)', async () => {
    const inv = await rpc(ANN, 'friends_invite', [BOB, 'spectate', 'live:run-123', null]);
    expect(inv).toMatchObject({ kind: 'spectate', target: 'live:run-123' });
    expect(await fails(rpc(ANN, 'friends_invite', [BOB, 'spectate', 'live:has space', null]))).toMatch(/bad_target/);
  });
});
