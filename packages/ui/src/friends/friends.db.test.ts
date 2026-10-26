/**
 * THE FRIENDS SQL against real Postgres (PGlite): `2026-10-28-friends.sql` (owner 2026-10-26: "yes to adding a friends
 * list that shows online players, to simplify invites"; R-FRIENDS-01..05). Every RPC and every policy:
 *  - requests by handle and by id; accept, decline, cancel, remove; a crossed request accepts; no self, no duplicate,
 *    no guest on either end, the hourly rate limit;
 *  - blocks: block wins (no request, no invite either way), a block ends the friendship and cancels open invites;
 *  - presence: the beat writes it, friends read it (Offline once 180 s stale), nobody else can;
 *  - invites: friends only, the target online, a Versus room I am in and that is open, 2-minute expiry, accept /
 *    decline / cancel, a newer invite replaces the older, rate limit;
 *  - RLS: each table shows a player only their own rows; no client role can write any table directly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const mig = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const SQL = mig('2026-10-13-versus.sql') + mig('2026-10-24-versus-group.sql') + mig('2026-10-28-friends.sql');
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
const u = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ANN = u(1);
const BOB = u(2);
const CAT = u(3);
const DAN = u(4);
const GUEST = u(9);

let db: PGlite;
let next = 100;
/** A fresh account (or guest) with a handle. */
async function account(name: string, opts: { guest?: boolean; tag?: string } = {}): Promise<string> {
  const id = u(next++);
  await db.query('insert into auth.users (id, is_anonymous) values ($1, $2)', [id, !!opts.guest]);
  await db.query('insert into public.profiles (user_id, author, discriminator, favorite_hero) values ($1, $2, $3, $4)', [id, name, opts.tag ?? String(1000 + next).slice(-4), 'hero_a']);
  return id;
}

/** Run one statement as `who` (null = anon). */
async function as<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who ?? ''}', false); set role ${who ? 'authenticated' : 'anon'};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally { await db.exec('reset role'); }
}
async function rpc(who: string | null, fn: string, args: unknown[] = []): Promise<Record<string, unknown>> {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await as<{ v: Record<string, unknown> }>(who, `select public.${fn}(${ph}) as v`, args);
  return rows[0]!.v;
}
const request = (from: string, to: string): Promise<Record<string, unknown>> => rpc(from, 'friends_request', [to, null]);
const beat = (who: string, status = 'online', mode: string | null = null, wk: string | null = null, wid: string | null = null): Promise<Record<string, unknown>> =>
  rpc(who, 'friends_beat', [status, mode, wk, wid]);
async function befriend(a: string, b: string): Promise<void> {
  await request(a, b);
  await rpc(b, 'friends_respond', [a, true]);
}
type Person = { userId: string; status?: string; mode?: string; watchKind?: string; watchId?: string; author?: string; discriminator?: string; frame?: string | null; skin?: string | null };
const list = async (who: string): Promise<{ friends: Person[]; incoming: Person[]; outgoing: Person[]; blocked: Person[]; invites: Array<{ id: string; kind: string; target: string; from: Person }>; sent: Array<{ id: string; to: string; status: string }> }> =>
  (await rpc(who, 'friends_list')) as never;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(SQL);
  for (const [id, name, tag] of [[ANN, 'Ann', '1111'], [BOB, 'Bob', '2222'], [CAT, 'Cat', '3333'], [DAN, 'Dan', '4444']] as const) {
    await db.query('insert into auth.users (id) values ($1)', [id]);
    await db.query('insert into public.profiles (user_id, author, discriminator, favorite_hero, avatar) values ($1, $2, $3, $4, $5)', [id, name, tag, 'hero_a', `av_${name}`]);
  }
  await db.query('insert into auth.users (id, is_anonymous) values ($1, true)', [GUEST]);
  await db.query(`insert into public.profiles (user_id, author, discriminator) values ($1, 'Guesty', '9999')`, [GUEST]);
  await db.query(`insert into public.cosmetic_loadouts (user_id, slot, target_id, cosmetic_id) values ($1, 'portrait_frame', '', 'frame_gold'), ($1, 'hero_skin', 'hero_a', 'skin_a'), ($1, 'hero_skin', 'hero_b', 'skin_b')`, [BOB]);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('friend requests', () => {
  it('sends by handle (case-insensitive name, exact tag) and accepts', async () => {
    const out = await rpc(ANN, 'friends_request', [null, 'bob#2222']);
    expect(out).toEqual({ status: 'sent', userId: BOB });
    const bob = await list(BOB);
    expect(bob.incoming.map((p) => p.userId)).toEqual([ANN]);
    expect(bob.incoming[0]).toMatchObject({ author: 'Ann', discriminator: '1111' });
    expect((await list(ANN)).outgoing.map((p) => p.userId)).toEqual([BOB]);
    expect((await beat(BOB)).incoming).toBe(1);
    expect(await rpc(BOB, 'friends_respond', [ANN, true])).toEqual({ status: 'accepted', userId: ANN });
    expect((await list(ANN)).friends.map((p) => p.userId)).toEqual([BOB]);
    expect((await list(BOB)).friends.map((p) => p.userId)).toEqual([ANN]);
    expect((await beat(BOB)).incoming).toBe(0);
  });

  it('a friend card carries the handle, avatar and the equipped frame + favourite-hero skin', async () => {
    const bob = (await list(ANN)).friends.find((p) => p.userId === BOB)!;
    expect(bob).toMatchObject({ author: 'Bob', discriminator: '2222', frame: 'frame_gold', skin: 'skin_a' });
  });

  it('refuses a bad handle, an unknown handle, myself, a duplicate, an existing friend', async () => {
    await expect(rpc(ANN, 'friends_request', [null, 'Bob'])).rejects.toThrow(/bad_handle/);
    await expect(rpc(ANN, 'friends_request', [null, 'Bob#22'])).rejects.toThrow(/bad_handle/);
    await expect(rpc(ANN, 'friends_request', [null, 'Bob#2223'])).rejects.toThrow(/not_found/);
    await expect(rpc(ANN, 'friends_request', [null, 'Ann#1111'])).rejects.toThrow(/self/);
    await expect(request(ANN, ANN)).rejects.toThrow(/self/);
    await expect(request(ANN, BOB)).rejects.toThrow(/already_friends/);
    await request(ANN, CAT);
    await expect(request(ANN, CAT)).rejects.toThrow(/already_requested/);
  });

  it('a crossed request accepts the other one', async () => {
    // Ann already asked Cat (above): Cat asking Ann is Cat's yes.
    expect(await request(CAT, ANN)).toEqual({ status: 'accepted', userId: ANN });
    expect((await list(CAT)).friends.map((p) => p.userId)).toEqual([ANN]);
  });

  it('a name with a # in it still parses (the tag is the last four digits)', async () => {
    const odd = await account('Sharp#Name', { tag: '5555' });
    expect(await rpc(DAN, 'friends_request', [null, 'Sharp#Name#5555'])).toEqual({ status: 'sent', userId: odd });
  });

  it('decline and cancel delete the request; remove ends a friendship; only the right side may', async () => {
    const x = await account('Xan');
    const y = await account('Yul');
    await request(x, y);
    await expect(rpc(x, 'friends_respond', [y, true])).rejects.toThrow(/no_request/); // the requester cannot accept their own
    expect(await rpc(y, 'friends_respond', [x, false])).toEqual({ status: 'declined', userId: x });
    expect((await list(y)).incoming).toEqual([]);
    await request(x, y); // may ask again after a decline
    await expect(rpc(y, 'friends_cancel', [x])).rejects.toThrow(/no_request/); // only the sender cancels
    expect(await rpc(x, 'friends_cancel', [y])).toEqual({ status: 'cancelled', userId: y });
    expect((await list(y)).incoming).toEqual([]);
    await befriend(x, y);
    expect(await rpc(y, 'friends_remove', [x])).toEqual({ status: 'removed', userId: x });
    expect((await list(x)).friends).toEqual([]);
    await expect(rpc(y, 'friends_remove', [x])).rejects.toThrow(/not_friends/);
  });

  it('accounts only: a guest can do nothing, and cannot be added', async () => {
    await expect(request(GUEST, ANN)).rejects.toThrow(/guest/);
    await expect(rpc(GUEST, 'friends_list')).rejects.toThrow(/guest/);
    await expect(beat(GUEST)).rejects.toThrow(/guest/);
    await expect(request(ANN, GUEST)).rejects.toThrow(/not_an_account/);
    await expect(rpc(ANN, 'friends_request', [null, 'Guesty#9999'])).rejects.toThrow(/not_an_account/);
    await expect(rpc(null, 'friends_list')).rejects.toThrow(/permission denied/);
  });

  it('rate limit: 20 requests an hour', async () => {
    const spammer = await account('Spam');
    for (let i = 0; i < 20; i++) await request(spammer, await account(`T${i}`));
    await expect(request(spammer, await account('T20'))).rejects.toThrow(/rate_limited/);
    // An hour later the budget is back.
    await db.query(`update public.friend_rate set at = at - interval '61 minutes' where user_id = $1`, [spammer]);
    await expect(request(spammer, await account('T21'))).resolves.toMatchObject({ status: 'sent' });
  });
});

describe('blocks', () => {
  it('block wins: ends the friendship, refuses requests both ways, unblock lets them ask again', async () => {
    const p = await account('Pia');
    const q = await account('Quin');
    await befriend(p, q);
    expect(await rpc(p, 'friends_block', [q])).toEqual({ status: 'blocked', userId: q });
    expect((await list(p)).friends).toEqual([]);
    expect((await list(q)).friends).toEqual([]);
    expect((await list(p)).blocked.map((x) => x.userId)).toEqual([q]);
    expect((await list(q)).blocked).toEqual([]); // the blocked player never sees the block
    await expect(request(q, p)).rejects.toThrow(/blocked/);
    await expect(request(p, q)).rejects.toThrow(/you_blocked/);
    await expect(rpc(p, 'friends_block', [p])).rejects.toThrow(/self/);
    await rpc(p, 'friends_unblock', [q]);
    await expect(request(q, p)).resolves.toMatchObject({ status: 'sent' });
  });

  it('a block clears a pending request', async () => {
    const r = await account('Rex');
    const s = await account('Sue');
    await request(r, s);
    await rpc(s, 'friends_block', [r]);
    expect((await list(s)).incoming).toEqual([]);
    expect((await list(r)).outgoing).toEqual([]);
  });
});

describe('presence', () => {
  it('the beat writes my row; friends read it; Offline once stale; an explicit offline is Offline', async () => {
    await beat(BOB, 'in_game', 'ranked', 'live', 'game-123');
    const seen = (await list(ANN)).friends.find((p) => p.userId === BOB)!;
    expect(seen).toMatchObject({ status: 'in_game', mode: 'ranked', watchKind: 'live', watchId: 'game-123' });
    await db.query(`update public.player_presence set updated_at = now() - interval '181 seconds' where user_id = $1`, [BOB]);
    const stale = (await list(ANN)).friends.find((p) => p.userId === BOB)!;
    expect(stale.status).toBe('offline');
    expect(stale.watchId).toBeUndefined(); // an offline friend shows no watch target
    await beat(BOB, 'offline');
    expect((await list(ANN)).friends.find((p) => p.userId === BOB)!.status).toBe('offline');
    await beat(BOB, 'online');
    expect((await list(ANN)).friends.find((p) => p.userId === BOB)!.status).toBe('online');
  });

  it('the beat answers friends / online / incoming counts and refuses a bad status; junk mode and watch are dropped', async () => {
    await beat(CAT, 'online');
    const a = await beat(ANN);
    expect(a).toMatchObject({ friends: 2, online: 2, incoming: 0 }); // Bob + Cat
    await expect(beat(ANN, 'busy')).rejects.toThrow(/bad_status/);
    await beat(DAN, 'in_game', 'Not A Mode!', 'nonsense', 'x');
    const row = (await db.query<{ mode: string | null; watch_kind: string | null }>('select mode, watch_kind from public.player_presence where user_id = $1', [DAN])).rows[0]!;
    expect(row).toEqual({ mode: null, watch_kind: null });
  });

  it('RLS: presence is visible to me and my friends only', async () => {
    const stranger = await account('Stranger');
    const rows = (who: string) => as<{ user_id: string }>(who, 'select user_id from public.player_presence order by user_id');
    expect((await rows(ANN)).map((r) => r.user_id).sort()).toEqual([ANN, BOB, CAT].sort());
    expect((await rows(stranger)).map((r) => r.user_id)).toEqual([]);
    await expect(as(null, 'select * from public.player_presence')).rejects.toThrow(/permission denied/);
  });
});

describe('invites', () => {
  let room = '';
  beforeAll(async () => {
    const r = await db.query<{ id: string }>(`insert into public.versus_rooms (name, host_user_id, status, set_id, content_revision, protocol) values ('Ann room', $1, 'open', 'set1', 'rev', 1) returning id`, [ANN]);
    room = r.rows[0]!.id;
    await db.query(`insert into public.versus_members (room_id, user_id, role, display_name) values ($1, $2, 'p1', 'Ann')`, [room, ANN]);
  });

  it('invite a friend who is online to my open room; they see it on the beat and accept', async () => {
    await beat(BOB, 'online');
    const inv = await rpc(ANN, 'friends_invite', [BOB, 'versus_room', room]);
    expect(inv).toMatchObject({ kind: 'versus_room', target: room });
    const b = await beat(BOB);
    const invites = b.invites as Array<{ id: string; target: string; from: Person }>;
    expect(invites.map((i) => i.id)).toEqual([inv.id]);
    expect(invites[0]!.from).toMatchObject({ userId: ANN, author: 'Ann' });
    expect(await rpc(BOB, 'friends_invite_respond', [inv.id, true])).toEqual({ status: 'accepted', kind: 'versus_room', target: room, from: ANN });
    expect(((await beat(BOB)).invites as unknown[]).length).toBe(0);
    expect((await list(ANN)).sent.find((s) => s.id === inv.id)!.status).toBe('accepted');
    await expect(rpc(BOB, 'friends_invite_respond', [inv.id, true])).rejects.toThrow(/no_invite/);
  });

  it('decline, cancel, a newer invite replaces the older', async () => {
    const a = await rpc(ANN, 'friends_invite', [BOB, 'versus_room', room]);
    expect((await rpc(BOB, 'friends_invite_respond', [a.id, false])).status).toBe('declined');
    expect((await list(ANN)).sent.find((s) => s.id === a.id)!.status).toBe('declined');
    const b = await rpc(ANN, 'friends_invite', [BOB, 'versus_room', room]);
    const c = await rpc(ANN, 'friends_invite', [BOB, 'versus_room', room]);
    expect(((await beat(BOB)).invites as Array<{ id: string }>).map((i) => i.id)).toEqual([c.id]);
    await expect(rpc(BOB, 'friends_invite_respond', [b.id, true])).rejects.toThrow(/no_invite/);
    await expect(rpc(BOB, 'friends_invite_cancel', [c.id])).rejects.toThrow(/no_invite/); // only the sender cancels
    expect(await rpc(ANN, 'friends_invite_cancel', [c.id])).toEqual({ status: 'cancelled' });
    expect(((await beat(BOB)).invites as unknown[]).length).toBe(0);
  });

  it('expires after 2 minutes', async () => {
    const a = await rpc(ANN, 'friends_invite', [BOB, 'versus_room', room]);
    const ttl = (await db.query<{ s: number }>('select extract(epoch from (expires_at - created_at))::int as s from public.friend_invites where id = $1', [a.id])).rows[0]!.s;
    expect(ttl).toBe(120);
    await db.query(`update public.friend_invites set expires_at = now() - interval '1 second' where id = $1`, [a.id]);
    expect(((await beat(BOB)).invites as unknown[]).length).toBe(0);
    await expect(rpc(BOB, 'friends_invite_respond', [a.id, true])).rejects.toThrow(/expired/);
    expect((await list(ANN)).sent.find((s) => s.id === a.id)!.status).toBe('expired');
  });

  it('friends only, online only (not in a game, not stale), my open room only, not someone already in it', async () => {
    const stranger = await account('Stranger2');
    await beat(stranger);
    await expect(rpc(ANN, 'friends_invite', [stranger, 'versus_room', room])).rejects.toThrow(/not_friends/);
    await beat(CAT, 'in_game', 'practice');
    await expect(rpc(ANN, 'friends_invite', [CAT, 'versus_room', room])).rejects.toThrow(/not_online/);
    await beat(CAT, 'online');
    await db.query(`update public.player_presence set updated_at = now() - interval '200 seconds' where user_id = $1`, [CAT]);
    await expect(rpc(ANN, 'friends_invite', [CAT, 'versus_room', room])).rejects.toThrow(/not_online/);
    await beat(CAT, 'online');
    await expect(rpc(BOB, 'friends_invite', [ANN, 'versus_room', room])).rejects.toThrow(/not_online|not_in_room/);
    await beat(ANN, 'online');
    await expect(rpc(BOB, 'friends_invite', [ANN, 'versus_room', room])).rejects.toThrow(/not_in_room/); // Bob is not in it
    await expect(rpc(ANN, 'friends_invite', [CAT, 'versus_room', 'not-a-uuid'])).rejects.toThrow(/bad_target/);
    await expect(rpc(ANN, 'friends_invite', [CAT, 'party_time', room])).rejects.toThrow(/bad_kind/);
    await db.query(`insert into public.versus_members (room_id, user_id, role, display_name) values ($1, $2, 'spectator', 'Cat')`, [room, CAT]);
    await expect(rpc(ANN, 'friends_invite', [CAT, 'versus_room', room])).rejects.toThrow(/already_in_room/);
    await db.query(`delete from public.versus_members where room_id = $1 and user_id = $2`, [room, CAT]);
    await db.query(`update public.versus_rooms set status = 'in_game' where id = $1`, [room]);
    await expect(rpc(ANN, 'friends_invite', [CAT, 'versus_room', room])).rejects.toThrow(/room_not_open/);
    await db.query(`update public.versus_rooms set status = 'open' where id = $1`, [room]);
    // The Ranked Duos party's invite: an opaque party id, validated by that feature on accept.
    await expect(rpc(ANN, 'friends_invite', [CAT, 'duos_party', 'party-42'])).resolves.toMatchObject({ kind: 'duos_party', target: 'party-42' });
  });

  it('a block cancels open invites and refuses new ones both ways', async () => {
    const p = await account('Penny');
    await befriend(ANN, p);
    await beat(p);
    const inv = await rpc(ANN, 'friends_invite', [p, 'duos_party', 'party-1']);
    await rpc(p, 'friends_block', [ANN]);
    expect(((await beat(p)).invites as unknown[]).length).toBe(0);
    await expect(rpc(p, 'friends_invite_respond', [inv.id, true])).rejects.toThrow(/no_invite/);
    await expect(rpc(ANN, 'friends_invite', [p, 'duos_party', 'party-1'])).rejects.toThrow(/blocked/);
  });

  it('rate limit: 30 invites an hour', async () => {
    const host = await account('Host');
    const pal = await account('Pal');
    await befriend(host, pal);
    await beat(pal);
    for (let i = 0; i < 30; i++) await rpc(host, 'friends_invite', [pal, 'duos_party', `p${i}`]);
    await expect(rpc(host, 'friends_invite', [pal, 'duos_party', 'p30'])).rejects.toThrow(/rate_limited/);
  });
});

describe('row level security and grants', () => {
  it('each table shows a player only their own rows', async () => {
    const pairs = await as<{ user_a: string; user_b: string }>(DAN, 'select user_a, user_b from public.friendships');
    expect(pairs.every((r) => r.user_a === DAN || r.user_b === DAN)).toBe(true);
    const invites = await as<{ from_user: string; to_user: string }>(BOB, 'select from_user, to_user from public.friend_invites');
    expect(invites.length).toBeGreaterThan(0);
    expect(invites.every((r) => r.from_user === BOB || r.to_user === BOB)).toBe(true);
    const blocks = await as<{ blocker: string }>(ANN, 'select blocker from public.user_blocks');
    expect(blocks.every((r) => r.blocker === ANN)).toBe(true);
  });

  it('no client role can write any table, read the rate ledger, or call a helper', async () => {
    await expect(as(ANN, `insert into public.friendships (user_a, user_b, requester, status) values ($1, $2, $1, 'accepted')`, [ANN, DAN])).rejects.toThrow(/permission denied/);
    await expect(as(ANN, `update public.player_presence set status = 'online'`)).rejects.toThrow(/permission denied/);
    await expect(as(ANN, `insert into public.friend_invites (from_user, to_user, kind, target, expires_at) values ($1, $2, 'duos_party', 'x', now())`, [ANN, DAN])).rejects.toThrow(/permission denied/);
    await expect(as(ANN, `delete from public.user_blocks`)).rejects.toThrow(/permission denied/);
    await expect(as(ANN, 'select * from public.friend_rate')).rejects.toThrow(/permission denied/);
    await expect(as(ANN, 'select public.friends__are_friends($1, $2)', [ANN, BOB])).rejects.toThrow(/permission denied/);
    await expect(as(null, 'select * from public.friendships')).rejects.toThrow(/permission denied/);
    await expect(rpc(null, 'friends_beat', ['online', null, null, null])).rejects.toThrow(/permission denied/);
  });
});
