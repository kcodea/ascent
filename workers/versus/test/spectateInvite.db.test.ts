/**
 * FRIENDS: "INVITE TO SPECTATE", executed (R-FRIENDS-MENU-02). PGlite runs the Versus, Live Games, friends and writer
 * migrations in order, then `2026-11-11-friends-invite-spectate.sql` twice (idempotent).
 *
 *  - `live:<game>`: only my own listed, still-live lobby / Practice game (either host keeps that row).
 *  - `versus:<room>` / `duos:<room>` on Supabase: I am in the room, its game is running, the friend is not in it.
 *  - `versus:cf:<room>`: refused without the room's signature, accepted with it (kind 'spectate', bound like room invites).
 *  - room invites are checked exactly as before (one regression case each).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signInviteProof } from '../src/invites';

const root = join(__dirname, '../../..');
const mig = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql', '2026-10-25-versus-duos-random-order.sql',
  '2026-10-25-versus-duos-pass-back.sql', '2026-10-26-versus-lock-order.sql', '2026-10-27-versus-egress.sql', '2026-10-28-versus-health.sql',
  '2026-10-15-lobby-live.sql', '2026-10-15-lobby-live-watcher-identity.sql', '2026-10-26-lobby-live-hero-select.sql', '2026-10-28-friends.sql',
  '2026-10-29-ranked-duos.sql', '2026-10-30-ranked-duos-client.sql', '2026-10-31-ranked-duos-live-fixes.sql',
  '2026-11-01-ranked-duos-party.sql', '2026-11-01-versus-ready-signal.sql', '2026-11-02-ranked-duos-both-ready.sql', '2026-11-02-ranked-duos-party-split.sql',
  '2026-11-02-versus-server-reliability.sql', '2026-11-03-versus-live-armor.sql',
  '2026-11-04-versus-cf-writer.sql', '2026-11-05-versus-cf-writer-group.sql', '2026-11-05-versus-host-config.sql',
  '2026-11-06-versus-cf-writer-duos.sql', '2026-11-07-versus-cf-ranked.sql', '2026-11-08-versus-cf-live-games-invites.sql',
];
const NEW = mig('2026-11-11-friends-invite-spectate.sql');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create table public.profiles (user_id uuid primary key, author text, discriminator text, avatar text, favorite_hero text,
    rank_division int not null default 0, rank_points int not null default 0, rating int not null default 0);
  grant select on public.profiles to anon, authenticated;
  create table public.cosmetic_loadouts (user_id uuid, slot text, target_id text not null default '', cosmetic_id text, primary key (user_id, slot, target_id));
  grant select on public.cosmetic_loadouts to anon, authenticated;
`;
const SECRET = 'test-writer-secret-not-real';
const u = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ANN = u(1);
const BOB = u(2);
const CAT = u(3);
const ROOM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const CF_ROOM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

let db: PGlite;
async function as<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who ?? ''}', false); set role ${who ? 'authenticated' : 'anon'};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally { await db.exec('reset role'); }
}
async function rpc(who: string | null, fn: string, args: unknown[] = []): Promise<Record<string, unknown>> {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  return (await as<{ v: Record<string, unknown> }>(who, `select public.${fn}(${ph}) as v`, args))[0]!.v;
}
async function err(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return (e as Error).message; }
  return 'did not fail';
}
const invite = (who: string, to: string, kind: string, target: string, proof?: string | null) =>
  rpc(who, 'friends_invite', proof === undefined ? [to, kind, target] : [to, kind, target, proof]);

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  await db.exec(FILES.map(mig).join('\n'));
  await db.exec(NEW);
  await db.exec(NEW);
  await db.query('insert into public.versus_cf_writer_keys (key_hash, note) values ($1, $2)', [createHash('sha256').update(SECRET).digest('hex'), 'test']);
  for (const [id, name, tag] of [[ANN, 'Ann', '1111'], [BOB, 'Bob', '2222'], [CAT, 'Cat', '3333']] as const) {
    await db.query('insert into auth.users (id) values ($1)', [id]);
    await db.query('insert into public.profiles (user_id, author, discriminator, favorite_hero) values ($1, $2, $3, $4)', [id, name, tag, 'hero_a']);
  }
  // Ann is friends with Cat (online) and Bob (online).
  for (const other of [CAT, BOB]) {
    await rpc(ANN, 'friends_request', [other, null]);
    await rpc(other, 'friends_respond', [ANN, true]);
  }
  for (const who of [ANN, BOB, CAT]) await rpc(who, 'friends_beat', ['online', null, null, null]);
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('friends_invite kind spectate (R-FRIENDS-MENU-02)', () => {
  it('live:<game>: my own listed live game only; a stale or someone else\'s row is no_game', async () => {
    expect(await err(invite(ANN, CAT, 'spectate', 'live:run-ann'))).toContain('no_game');
    await db.query(`insert into public.lobby_live_games (game_id, user_id, display_name, hero_id) values ('run-ann', '${ANN}', 'Ann', 'h'), ('run-bob', '${BOB}', 'Bob', 'h')`);
    const r = await invite(ANN, CAT, 'spectate', 'live:run-ann');
    expect(r).toMatchObject({ kind: 'spectate', target: 'live:run-ann' });
    expect(await err(invite(ANN, CAT, 'spectate', 'live:run-bob'))).toContain('no_game');
    await db.query(`update public.lobby_live_games set last_seen_at = now() - interval '5 minutes' where game_id = 'run-ann'`);
    expect(await err(invite(ANN, CAT, 'spectate', 'live:run-ann'))).toContain('no_game');
    // A Cloudflare-hosted row (event-driven, live_until) still counts.
    await db.query(`update public.lobby_live_games set live_until = now() + interval '2 minutes' where game_id = 'run-ann'`);
    expect(await invite(ANN, CAT, 'spectate', 'live:run-ann')).toMatchObject({ kind: 'spectate' });
    // The friend reads it in their list, with its kind.
    const list = await rpc(CAT, 'friends_list');
    expect((list.invites as { kind: string; target: string }[]).some((i) => i.kind === 'spectate' && i.target === 'live:run-ann')).toBe(true);
  });

  it('versus:<room> / duos:<room> on Supabase: a member, a running game, a friend not in the room', async () => {
    await db.query(`insert into public.versus_rooms (id, name, host_user_id, status, set_id, content_revision, protocol) values ($1, 'Room', $2, 'open', 'set1', 'rev1', 2)`, [ROOM, ANN]);
    await db.query(`insert into public.versus_members (room_id, user_id, role, display_name) values ($1, $2, 'p1', 'Ann')`, [ROOM, ANN]);
    expect(await err(invite(ANN, CAT, 'spectate', `versus:${ROOM}`))).toContain('no_game');
    await db.query(`update public.versus_rooms set status = 'in_game' where id = $1`, [ROOM]);
    expect(await invite(ANN, CAT, 'spectate', `versus:${ROOM}`)).toMatchObject({ kind: 'spectate', target: `versus:${ROOM}` });
    expect(await invite(ANN, CAT, 'spectate', `duos:${ROOM}`)).toMatchObject({ kind: 'spectate' });
    // Bob (not in it) cannot invite to it; a friend already in it is refused.
    expect(await err(invite(BOB, ANN, 'spectate', `versus:${ROOM}`))).toContain('not_in_room');
    await db.query(`insert into public.versus_members (room_id, user_id, role, display_name) values ($1, $2, 'spectator', 'Cat')`, [ROOM, CAT]);
    expect(await err(invite(ANN, CAT, 'spectate', `versus:${ROOM}`))).toContain('already_in_room');
    expect(await err(invite(ANN, CAT, 'spectate', 'versus:not-a-uuid'))).toContain('bad_target');
    expect(await err(invite(ANN, CAT, 'spectate', 'elsewhere:x'))).toContain('bad_target');
    await db.query(`delete from public.versus_members where user_id = $1`, [CAT]);
  });

  it('versus:cf:<room>: refused without the room\'s signature, accepted with it (kind spectate only)', async () => {
    const target = `versus:cf:${CF_ROOM}`;
    expect(await err(invite(ANN, CAT, 'spectate', target, null))).toContain('room_check');
    const roomProof = await signInviteProof(SECRET, { room: CF_ROOM, from: ANN, to: CAT, kind: 'versus_room' }, Date.now());
    expect(await err(invite(ANN, CAT, 'spectate', target, roomProof))).toContain('room_check');
    const proof = await signInviteProof(SECRET, { room: CF_ROOM, from: ANN, to: CAT, kind: 'spectate' }, Date.now());
    expect(await invite(ANN, CAT, 'spectate', target, proof)).toMatchObject({ kind: 'spectate', target });
    expect(await invite(ANN, CAT, 'spectate', `duos:cf:${CF_ROOM}`, proof)).toMatchObject({ kind: 'spectate' });
  });

  it('room invites are unchanged: an open Supabase room invites; a cf: room still needs its proof', async () => {
    await db.query(`update public.versus_rooms set status = 'open' where id = $1`, [ROOM]);
    expect(await invite(ANN, CAT, 'versus_room', ROOM)).toMatchObject({ kind: 'versus_room' });
    expect(await err(invite(ANN, CAT, 'versus_room', `cf:${CF_ROOM}`, null))).toContain('room_check');
    expect(await err(invite(ANN, CAT, 'party', ROOM))).toContain('bad_kind');
  });
});
