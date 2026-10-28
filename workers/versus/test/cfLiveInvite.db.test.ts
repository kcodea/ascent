/**
 * VERSUS ON CLOUDFLARE — Live Games rows and invite checks, executed (PGlite runs the Versus, Live Games, friends and
 * writer migrations in order, then `2026-11-08-versus-cf-live-games-invites.sql` twice: idempotent).
 *
 *  - `versus_cf_live` (R-VERSUS-CF-LIVE-01): no key, no write; a Cloudflare Ranked Duos row lands as `duos:cf:<room>`
 *    with the team's name and medal looked up in SQL; it stays readable for 4 minutes (not the 60 s every other row
 *    keeps); end / null removes it; it can only ever touch its own `duos:cf:` row.
 *  - `friends_invite` with a `cf:` target (R-VERSUS-CF-INVITE-01): refused without a proof, with a forged / expired /
 *    re-targeted one; accepted with the room's signature from `src/invites.ts` (the same code the Worker runs). A
 *    Supabase target is checked exactly as before, through the old three-argument call.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INVITE_PROOF_TTL_S, signInviteProof } from '../src/invites';

const root = join(__dirname, '../../..');
const mig = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql', '2026-10-25-versus-duos-random-order.sql',
  '2026-10-25-versus-duos-pass-back.sql', '2026-10-26-versus-lock-order.sql', '2026-10-27-versus-egress.sql', '2026-10-28-versus-health.sql',
  '2026-10-15-lobby-live.sql', '2026-10-26-lobby-live-hero-select.sql', '2026-10-28-friends.sql',
  '2026-10-29-ranked-duos.sql', '2026-10-30-ranked-duos-client.sql', '2026-10-31-ranked-duos-live-fixes.sql',
  '2026-11-01-ranked-duos-party.sql', '2026-11-01-versus-ready-signal.sql', '2026-11-02-ranked-duos-both-ready.sql', '2026-11-02-ranked-duos-party-split.sql',
  '2026-11-02-versus-server-reliability.sql', '2026-11-03-versus-live-armor.sql',
  '2026-11-04-versus-cf-writer.sql', '2026-11-05-versus-cf-writer-group.sql', '2026-11-05-versus-host-config.sql',
  '2026-11-06-versus-cf-writer-duos.sql', '2026-11-07-versus-cf-ranked.sql',
];
const NEW = mig('2026-11-08-versus-cf-live-games-invites.sql');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create table public.profiles (user_id uuid primary key, author text, discriminator text, avatar text, favorite_hero text);
  grant select on public.profiles to anon, authenticated;
  create table public.cosmetic_loadouts (user_id uuid, slot text, target_id text not null default '', cosmetic_id text, primary key (user_id, slot, target_id));
  grant select on public.cosmetic_loadouts to anon, authenticated;
`;
const SECRET = 'test-writer-secret-not-real';
const u = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ANN = u(1);
const BOB = u(2);
const CAT = u(3);
const ROOM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEAM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GAME = `duos:cf:${ROOM}`;

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
const live = (key: string | null, room: string, row: unknown) =>
  as<{ v: Record<string, unknown> }>(null, 'select public.versus_cf_live($1, $2::uuid, $3::jsonb) as v', [key, room, row == null ? null : JSON.stringify(row)]);
const row = (over: Record<string, unknown> = {}) => ({ room: ROOM, p1: ANN, team: TEAM, names: 'Ann & Bob', hero: 'hero_x', round: 3, phase: 'shop', spectators: 2, ...over });
const listed = async (): Promise<Record<string, unknown>[]> => as(null, `select * from public.lobby_live_games where game_id = '${GAME}'`);

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
  await db.query(`insert into public.duos_teams (id, user_lo, user_hi, name) values ('${TEAM}', '${ANN}', '${BOB}', 'Twin Stars')`);
  await db.query(`insert into public.duos_team_ranks (team_id, season, division, points) values ('${TEAM}', 3, 4, 37)`);
  // Ann and Cat are friends and online (the invite tests).
  await rpc(ANN, 'friends_request', [CAT, null]);
  await rpc(CAT, 'friends_respond', [ANN, true]);
  for (const who of [ANN, CAT]) await rpc(who, 'friends_beat', ['online', null, null, null]);
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('versus_cf_live: a Cloudflare Ranked Duos room\'s Live Games row', () => {
  it('refuses without the writer key', async () => {
    expect(await err(live(null, ROOM, row()))).toContain('not_authorized');
    expect(await err(live('wrong', ROOM, row()))).toContain('not_authorized');
    expect(await listed()).toHaveLength(0);
  });

  it('writes duos:cf:<room> with the team\'s own name and medal (from SQL, never the room\'s word for it)', async () => {
    await live(SECRET, ROOM, row({ names: 'ignored when the team is named' }));
    const [g] = await listed();
    expect(g).toMatchObject({ user_id: ANN, display_name: 'Twin Stars', hero_id: 'hero_x', division_index: 4, rank_points: 37, rating: 437, round: 3, phase: 'shop', spectators: 2 });
    // The page's own read (anon, the listing columns) sees it.
    const page = await as(null, `select game_id from public.lobby_live_games order by division_index desc`);
    expect(page.map((r) => r.game_id)).toContain(GAME);
  });

  it('an unnamed / unknown team reads as the pair\'s names', async () => {
    const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await live(SECRET, other, row({ room: other, p1: CAT, team: null, names: 'Cat & Dan' }));
    const [g] = await as(null, `select display_name, division_index from public.lobby_live_games where game_id = 'duos:cf:${other}'`);
    expect(g).toMatchObject({ display_name: 'Cat & Dan', division_index: 0 });
    await live(SECRET, other, null);
  });

  it('stays listed between the room\'s throttled writes (4 minutes), then drops out of the read', async () => {
    await db.query(`update public.lobby_live_games set last_seen_at = now() - interval '3 minutes', live_until = now() + interval '1 minute' where game_id = '${GAME}'`);
    expect(await listed()).toHaveLength(1);
    // A solo row 3 minutes silent is still hidden: the 60 s rule for everything else is unchanged.
    await db.query(`insert into public.lobby_live_games (game_id, user_id, display_name, hero_id, last_seen_at) values ('solo-x', '${BOB}', 'Bob', 'h', now() - interval '3 minutes')`);
    expect(await as(null, `select 1 from public.lobby_live_games where game_id = 'solo-x'`)).toHaveLength(0);
    await db.query(`update public.lobby_live_games set live_until = now() - interval '1 second' where game_id = '${GAME}'`);
    expect(await listed()).toHaveLength(0);
    await live(SECRET, ROOM, row({ round: 4, phase: 'combat' }));
    expect((await listed())[0]).toMatchObject({ round: 4, phase: 'combat' });
  });

  it('end (or null) removes the row; a bad phase / bad first seat is refused', async () => {
    expect(await err(live(SECRET, ROOM, row({ phase: 'paused' })))).toContain('bad_phase');
    expect(await err(live(SECRET, ROOM, row({ p1: 'nope' })))).toContain('bad_row');
    await live(SECRET, ROOM, row({ phase: 'end' }));
    expect(await listed()).toHaveLength(0);
    await live(SECRET, ROOM, row());
    await live(SECRET, ROOM, null);
    expect(await listed()).toHaveLength(0);
  });

  it('only ever its own duos:cf: row: a Supabase ranked row of another player is untouched; the first seat\'s own older row goes', async () => {
    await db.query(`insert into public.lobby_live_games (game_id, user_id, display_name, hero_id) values ('duos:old', '${ANN}', 'Ann', 'h') on conflict do nothing`);
    await db.query(`update public.lobby_live_games set last_seen_at = now() where game_id = 'solo-x'`);
    await live(SECRET, ROOM, row());
    const ids = (await db.query<{ game_id: string }>('select game_id from public.lobby_live_games order by game_id')).rows.map((r) => r.game_id);
    expect(ids).toContain(GAME);
    expect(ids).toContain('solo-x');
    expect(ids).not.toContain('duos:old');
    await live(SECRET, ROOM, null);
  });
});

describe('friends_invite into a Cloudflare room: checked when sent', () => {
  const target = `cf:${ROOM}`;
  const invite = (who: string, to: string, kind: string, tgt: string, proof?: string | null) =>
    proof === undefined ? rpc(who, 'friends_invite', [to, kind, tgt]) : rpc(who, 'friends_invite', [to, kind, tgt, proof]);
  const sign = (over: Partial<{ room: string; from: string; to: string; kind: string }> = {}, now = Date.now()) =>
    signInviteProof(SECRET, { room: ROOM, from: ANN, to: CAT, kind: 'versus_room', ...over }, now);

  it('no proof, no invite (the room could not vouch for it)', async () => {
    expect(await err(invite(ANN, CAT, 'versus_room', target))).toContain('room_check');
    expect(await err(invite(ANN, CAT, 'versus_room', target, null))).toContain('room_check');
    expect(await err(invite(ANN, CAT, 'versus_room', target, 'junk'))).toContain('room_check');
  });

  it('the room\'s proof lets it through; the invite is written as before', async () => {
    const out = await invite(ANN, CAT, 'versus_room', target, await sign());
    expect(out).toMatchObject({ kind: 'versus_room', target });
    const [i] = await as<{ status: string }>(CAT, `select status from public.friend_invites where to_user = '${CAT}' and target = '${target}'`);
    expect(i?.status).toBe('pending');
  });

  it('a proof is bound to its room, inviter, invitee and kind, and expires', async () => {
    expect(await err(invite(ANN, CAT, 'versus_room', target, await sign({ room: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })))).toContain('room_check');
    expect(await err(invite(ANN, CAT, 'versus_room', target, await sign({ to: BOB })))).toContain('room_check');
    expect(await err(invite(ANN, CAT, 'versus_room', target, await sign({ from: BOB })))).toContain('room_check');
    expect(await err(invite(ANN, CAT, 'duos_party', target, await sign()))).toContain('room_check');
    const stale = Date.now() - (INVITE_PROOF_TTL_S + 5) * 1000;
    expect(await err(invite(ANN, CAT, 'versus_room', target, await sign({}, stale)))).toContain('room_check');
    // Signed with some other secret (a forged proof).
    const forged = await signInviteProof('not-the-secret', { room: ROOM, from: ANN, to: CAT, kind: 'versus_room' }, Date.now());
    expect(await err(invite(ANN, CAT, 'versus_room', target, forged))).toContain('room_check');
    // A party invite with its own proof is fine.
    expect(await invite(ANN, CAT, 'duos_party', target, await sign({ kind: 'duos_party' }))).toMatchObject({ kind: 'duos_party' });
  });

  it('the friendship checks still come first (a proof never makes a stranger invitable)', async () => {
    expect(await err(invite(ANN, BOB, 'versus_room', target, await sign({ to: BOB })))).toContain('not_friends');
  });

  it('a Supabase room is checked in SQL exactly as before, through the old three-argument call', async () => {
    expect(await err(invite(ANN, CAT, 'versus_room', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'))).toContain('room_not_open');
  });

  it('the proof checker is not callable by a client', async () => {
    expect(await err(as(ANN, `select public.versus_cf__invite_proof_ok('${ROOM}', '${ANN}', '${CAT}', 'versus_room', 'x')`))).toMatch(/permission denied/);
  });
});
