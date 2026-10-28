/**
 * FRIENDS ACTIVITY against real Postgres (PGlite): `2026-11-10-friends-activity.sql` on the friends base
 * (R-FRIENDS-ACTIVITY-01, owner 2026-10-29: "more granular player online text in friends list"). The beat's `p_game`
 * slot now keeps an ONLINE player's activity as well as an in-game status, a friend reads it back through the list,
 * Offline never carries one, and a junk or oversized value is dropped without failing the beat.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const mig = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const SQL = mig('2026-10-13-versus.sql') + mig('2026-10-24-versus-group.sql') + mig('2026-10-28-friends.sql')
  + mig('2026-11-09-friends-presence-window.sql') + mig('2026-11-10-friends-activity.sql');
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

let db: PGlite;
async function as<T = Record<string, unknown>>(who: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally { await db.exec('reset role'); }
}
async function rpc(who: string, fn: string, args: unknown[] = []): Promise<Record<string, unknown>> {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  return (await as<{ v: Record<string, unknown> }>(who, `select public.${fn}(${ph}) as v`, args))[0]!.v;
}
const beat = (who: string, status: string, game: unknown, mode: string | null = null): Promise<Record<string, unknown>> =>
  rpc(who, 'friends_beat', [status, mode, null, null, game === null ? null : JSON.stringify(game)]);
const bobSeenByAnn = async (): Promise<Record<string, unknown>> =>
  ((await rpc(ANN, 'friends_list')).friends as Record<string, unknown>[]).find((p) => p.userId === BOB)!;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(SQL);
  for (const [id, name, tag] of [[ANN, 'Ann', '1111'], [BOB, 'Bob', '2222']] as const) {
    await db.query('insert into auth.users (id) values ($1)', [id]);
    await db.query('insert into public.profiles (user_id, author, discriminator, favorite_hero) values ($1, $2, $3, $4)', [id, name, tag, 'hero_a']);
  }
  await rpc(ANN, 'friends_request', [BOB, null]);
  await rpc(BOB, 'friends_respond', [ANN, true]);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the online activity rides the beat (R-FRIENDS-ACTIVITY-01)', () => {
  it('an online friend shows where they are; in a game, the game status; offline, nothing', async () => {
    await beat(BOB, 'online', { v: 1, act: 'career' });
    expect(await bobSeenByAnn()).toMatchObject({ status: 'online', game: { v: 1, act: 'career' } });
    await beat(BOB, 'online', { v: 1, act: 'versus_room', mode: 'versus_group', players: 3, max: 4 }, 'versus_room');
    expect(await bobSeenByAnn()).toMatchObject({ status: 'online', mode: 'versus_room', game: { act: 'versus_room', players: 3, max: 4 } });
    await beat(BOB, 'in_game', { v: 1, mode: 'ranked', round: 4, phase: 'combat', step: 'fight', foe: 'Cat' }, 'ranked');
    expect(await bobSeenByAnn()).toMatchObject({ status: 'in_game', game: { round: 4, step: 'fight', foe: 'Cat' } });
    await beat(BOB, 'offline', { v: 1, act: 'menu' });
    const off = await bobSeenByAnn();
    expect(off.status).toBe('offline');
    expect(off.game).toBeUndefined();
  });

  it('a junk or oversized value is dropped, and the beat still lands', async () => {
    await beat(BOB, 'online', { v: 1, act: 'menu', who: 'x'.repeat(2000) });
    expect(await bobSeenByAnn()).toMatchObject({ status: 'online', game: null });
    await beat(BOB, 'online', [1, 2, 3]);
    expect(await bobSeenByAnn()).toMatchObject({ status: 'online', game: null });
    await beat(BOB, 'online', null); // the private presence (no detail)
    expect(await bobSeenByAnn()).toMatchObject({ status: 'online', game: null });
  });
});
