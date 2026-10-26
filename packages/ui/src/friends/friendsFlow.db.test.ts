/**
 * THE FRIENDS CLIENT against the real SQL (PGlite): `makeFriendsRemote` over a stand-in Supabase client whose `rpc`
 * runs the migration's functions as the signed-in player. Pins that every call's argument names match the SQL and that
 * the parsers read its answers: two accounts befriend each other by handle, see each other's presence, one invites the
 * other to a Versus room, the invite shows on the beat, is accepted, and a block ends it all (R-FRIENDS-01..05).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FriendsError, friendsErrorText, makeFriendsRemote, type FriendsRemote } from './friendsRemote';

const root = join(__dirname, '../../../..');
const mig = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create table public.profiles (user_id uuid primary key, author text, discriminator text, avatar text, favorite_hero text);
  create table public.cosmetic_loadouts (user_id uuid, slot text, target_id text not null default '', cosmetic_id text, primary key (user_id, slot, target_id));
`;
const ANN = '00000000-0000-0000-0000-0000000000a1';
const BOB = '00000000-0000-0000-0000-0000000000b2';

let db: PGlite;
/** A stand-in for supabase-js's `rpc(fn, args)`: named arguments, the caller's JWT subject, `{ data, error }`. */
function clientAs(who: string): SupabaseClient {
  return {
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      const keys = Object.keys(args);
      const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as v`;
      await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
      try {
        const r = await db.query<{ v: unknown }>(sql, keys.map((k) => args[k]));
        return { data: r.rows[0]!.v, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      } finally { await db.exec('reset role'); }
    },
  } as unknown as SupabaseClient;
}

let ann: FriendsRemote;
let bob: FriendsRemote;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(mig('2026-10-13-versus.sql') + mig('2026-10-24-versus-group.sql') + mig('2026-10-28-friends.sql'));
  await db.query('insert into auth.users (id) values ($1), ($2)', [ANN, BOB]);
  await db.query(`insert into public.profiles (user_id, author, discriminator, favorite_hero) values ($1, 'Ann', '1111', 'h1'), ($2, 'Bob', '2222', 'h2')`, [ANN, BOB]);
  await db.query(`insert into public.cosmetic_loadouts (user_id, slot, target_id, cosmetic_id) values ($1, 'portrait_frame', '', 'frame_x')`, [BOB]);
  ann = makeFriendsRemote(() => clientAs(ANN));
  bob = makeFriendsRemote(() => clientAs(BOB));
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the friends client on the real SQL', () => {
  it('request by handle, accept, presence, invite, accept the invite, block', async () => {
    expect(await ann.requestByHandle('Bob#2222')).toEqual({ status: 'sent', userId: BOB });
    expect((await bob.beat({ status: 'online', mode: null, watchKind: null, watchId: null })).incoming).toBe(1);
    const bl = await bob.list();
    expect(bl.incoming[0]).toMatchObject({ userId: ANN, author: 'Ann', discriminator: '1111', favoriteHero: 'h1' });
    await bob.respond(ANN, true);

    const al = await ann.list();
    expect(al.friends).toHaveLength(1);
    expect(al.friends[0]).toMatchObject({ userId: BOB, author: 'Bob', status: 'online', frame: 'frame_x' });

    await bob.beat({ status: 'in_game', mode: 'ranked', watchKind: 'live', watchId: 'game-9' });
    expect((await ann.list()).friends[0]).toMatchObject({ status: 'in_game', mode: 'ranked', watchKind: 'live', watchId: 'game-9' });

    // Ann opens a Versus room and invites Bob: refused while he plays, sent once he is back on a menu.
    const room = (await db.query<{ id: string }>(`insert into public.versus_rooms (name, host_user_id, status, set_id, content_revision, protocol) values ('R', $1, 'open', 'set1', 'rev', 1) returning id`, [ANN])).rows[0]!.id;
    await db.query(`insert into public.versus_members (room_id, user_id, role, display_name) values ($1, $2, 'p1', 'Ann')`, [room, ANN]);
    const refused = await ann.invite(BOB, 'versus_room', room).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(FriendsError);
    expect((refused as FriendsError).code).toBe('not_online');
    expect(friendsErrorText(refused)).toBe('That friend is not online right now.');
    await bob.beat({ status: 'online', mode: null, watchKind: null, watchId: null });
    const inv = await ann.invite(BOB, 'versus_room', room);
    const beat = await bob.beat({ status: 'online', mode: null, watchKind: null, watchId: null });
    expect(beat.invites).toHaveLength(1);
    expect(beat.invites[0]).toMatchObject({ id: inv.id, kind: 'versus_room', target: room, from: { userId: ANN, author: 'Ann' } });
    expect(await bob.respondInvite(inv.id, true)).toEqual({ status: 'accepted', kind: 'versus_room', target: room, from: ANN });
    expect((await ann.list()).sent[0]).toMatchObject({ id: inv.id, status: 'accepted' });

    await bob.block(ANN);
    expect((await ann.list()).friends).toEqual([]);
    const again = await ann.requestById(BOB).catch((e: unknown) => e);
    expect((again as FriendsError).code).toBe('blocked');
    expect((await bob.list()).blocked.map((b) => b.userId)).toEqual([ANN]);
    await bob.unblock(ANN);
    expect((await bob.list()).blocked).toEqual([]);
  });
});
