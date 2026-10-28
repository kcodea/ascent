/**
 * VERSUS SERVER RELIABILITY (owner 2026-10-27: Versus 1v1, Group, Duos and Ranked Duos "need to be spotless experiences";
 * "disconnect/reconnects werent done correctly, where it would simply pause when someone returned"). PGlite runs every
 * Versus migration in order, then `2026-11-02-versus-server-reliability.sql` (twice: idempotent):
 *
 * - R-VERSUS-CLOSE-ONCE-01: exactly ONE close answers `closed_by_me: true` (reconcile and submit, every mode); a duplicate
 *   resolver save of a committed round answers `alreadyCommitted` WITHOUT taking the match lock;
 * - R-VERSUS-AUTO-RESUME-01: the paused player's own heartbeat starts the server 3-2-1 (shop and Hero Select, 1v1 and
 *   Group); after the grace another player may still Unpause;
 * - R-VERSUS-LEASE-01: the heartbeat records presence without the match lock (and takes it only to change the match,
 *   under a 2 s lock_timeout); a reconcile with nothing due takes no lock; the lease is 14 s (two missed 4 s beats +
 *   margin), so a 13 s gap never pauses;
 * - R-VERSUS-RESOLVE-TIMEOUT-01: resolving re-requests every 10 s (resolve_retry, visible on the match row) and ends the
 *   match 'void' after 90 s unpaused, or at the next window once versus-resolve reported an unresolvable content
 *   mismatch; a void Ranked Duos table is unrated;
 * - R-VERSUS-SWEEP-01: a match everybody left ends 'abandoned' through versus_sweep(); events older than 14 days prune;
 * - R-RANKED-DUOS-AUTO-VISIBLE-01: Ranked Duos auto on / off bumps the match row;
 * - versus_events is service-role only.
 *
 * PGlite is one connection, so two transactions never run at once here. "The heartbeat never waits on a held match
 * lock" is therefore proved from the locks the heartbeat itself takes (pg_locks inside its transaction): a function that
 * never asks for the match row lock cannot queue behind one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { combatSide, type BoardMinion } from '@game/core';
import type { PreparedCombatSide } from '../state';

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
  '2026-11-01-ranked-duos-party.sql', '2026-11-01-versus-ready-signal.sql', '2026-11-02-ranked-duos-both-ready.sql', '2026-11-02-ranked-duos-party-split.sql',
];
const BASE = FILES.map(mig).join('\n');
const FIX = mig('2026-11-02-versus-server-reliability.sql');
/** Applied after this one on the live project (2026-11-03): its Armor triggers run inside the submit / finalize transactions. */
const AFTER = mig('2026-11-03-versus-live-armor.sql');
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
/** More players, for tests that run several matches at once (a player is in one room at a time). */
const [E, F, G, H, I, J] = [5, 6, 7, 8, 9, 10].map(U) as [string, string, string, string, string, string];
const NAMES: Record<string, string> = { [A]: 'Ann', [B]: 'Bob', [C]: 'Cat', [D]: 'Dan', [E]: 'Eve', [F]: 'Fay', [G]: 'Gus', [H]: 'Hal', [I]: 'Ivy', [J]: 'Jon' };
const CONTENT = 'rev1';

let db: PGlite;
let clock = Date.parse('2026-10-27T12:00:00Z');
const at = (ms: number): void => { clock += ms; };
const who = (user: string | null): string =>
  user ? `select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;` : `select set_config('request.jwt.claim.sub', '', false); set role service_role;`;
async function as<T = any>(user: string | null, sql: string, params: unknown[] = []): Promise<T> {
  await db.exec(`set versus.test_now = '${new Date(clock).toISOString()}'`);
  await db.exec(who(user));
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
/** Run one RPC inside a transaction and report the locks it holds on the match tables just before commit. */
async function locksOf(user: string | null, sql: string, params: unknown[] = []): Promise<{ value: any; locks: string[] }> {
  await db.exec(`set versus.test_now = '${new Date(clock).toISOString()}'`);
  return db.transaction(async (tx) => {
    await tx.exec(who(user));
    const r = await tx.query<Record<string, unknown>>(sql, params);
    await tx.exec('reset role');
    const locks = (await tx.query<{ l: string }>(`select c.relname || ':' || l.mode l from pg_locks l join pg_class c on c.oid = l.relation
      where c.relname in ('versus_matches', 'versus_group_matches') and l.pid = pg_backend_pid() and l.mode <> 'AccessShareLock' order by 1`)).rows.map((x) => x.l);
    const row = r.rows[0];
    return { value: row ? Object.values(row)[0] : undefined, locks };
  });
}
const q = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const duel = async (m: string): Promise<any> => (await q<{ m: any }>('select to_jsonb(m) m from public.versus_matches m where id = $1', [m]))[0]!.m;
const group = async (m: string): Promise<any> => (await q<{ m: any }>('select to_jsonb(m) m from public.versus_group_matches m where id = $1', [m]))[0]!.m;
const seatRows = async (id: string): Promise<Record<string, any>> =>
  Object.fromEntries((await q<any>('select * from public.versus_group_seats where match_id = $1', [id])).map((r) => [r.seat, r]));
const events = async (m: string, kind?: string): Promise<any[]> =>
  q<any>(`select * from public.versus_events where match_id = $1 ${kind ? 'and kind = $2' : ''} order by id`, kind ? [m, kind] : [m]);
/** Everyone in the room is "seen" now (as if every client beat). */
const beatAll = async (): Promise<void> => { await db.query('update public.versus_members set last_seen_at = $1', [new Date(clock).toISOString()]); };
/** Only these users beat now (the RPC itself, not a shortcut). */
const heartbeat = (u: string, room: string): Promise<any> => as(u, 'select public.versus_heartbeat($1)', [room]);
const sideOf = (tag: string): PreparedCombatSide => ({ board: [{ cardId: 'sandbag', attack: 1, health: 1, sourceUid: tag }] as BoardMinion[], state: combatSide(), config: {} });

async function start1v1(toShop = true, [P, Q] = [A, B]): Promise<{ m: string; room: string }> {
  const room = await as<any>(P, `select public.versus_create_room('Duel', $1, '{}', 'set3', $2, 1)`, [NAMES[P], CONTENT]);
  await as(Q, `select public.versus_join_room($1, 'player', $2, '{}', $3, 1)`, [room.id, NAMES[Q], CONTENT]);
  await as(P, 'select public.versus_start_game($1)', [room.id]);
  await as(P, 'select public.versus_press_gate($1)', [room.id]);
  const r = await as<any>(Q, 'select public.versus_press_gate($1)', [room.id]);
  const m = r.current_match_id as string;
  await beatAll();
  if (!toShop) return { m, room: room.id };
  for (const u of [P, Q]) await as(u, 'select public.versus_register_offer($1, $2::text[])', [m, ['warden', 'indy', 'keshi']]);
  for (const u of [P, Q]) await as(u, 'select public.versus_pick_hero($1, 0)', [m]);
  for (const u of [P, Q]) await as(u, 'select public.versus_intro_done($1)', [m]);
  await beatAll();
  const row = await duel(m);
  expect([row.phase, !!row.shop_deadline]).toEqual(['shop', true]);
  return { m, room: room.id };
}
const lock1 = (u: string, m: string, seq: number, final: boolean, tag: string) =>
  as(u, 'select public.versus_submit($1, 1, $2, $3::jsonb, $4, null)', [m, seq, JSON.stringify(sideOf(tag)), final]);
/** A 1v1 round in resolving (both ended). */
async function resolving1v1(): Promise<{ m: string; room: string }> {
  const x = await start1v1();
  await lock1(A, x.m, 1, true, 'a');
  await lock1(B, x.m, 1, true, 'b');
  expect((await duel(x.m)).phase).toBe('resolving');
  return x;
}

async function startGroup(mode: 'duos' | 'ranked_duos' | 'group', users: string[], toShop = true): Promise<{ m: string; room: string }> {
  const opt = JSON.stringify({ v: 1, mode, modifiers: [] });
  const room = await as<any>(users[0]!, `select public.versus_create_room('Pair', $1, '{}', 'set3', $2, 1, $3::jsonb)`, [NAMES[users[0]!], CONTENT, opt]);
  for (const u of users.slice(1)) await as(u, `select public.versus_join_room($1, 'player', $2, '{}', $3, 1)`, [room.id, NAMES[u], CONTENT]);
  await as(users[0]!, `select public.versus_start_game($1)`, [room.id]);
  let r: any;
  for (const u of users) r = await as(u, `select public.versus_press_gate($1)`, [room.id]);
  expect(r.status).toBe('in_game');
  const m = r.current_match_id as string;
  await beatAll();
  if (!toShop) return { m, room: room.id };
  const offers = [['warden', 'indy', 'keshi'], ['indy', 'warden', 'keshi'], ['keshi', 'indy', 'warden'], ['nadja', 'indy', 'warden']];
  for (const [i, u] of users.entries()) await as(u, `select public.versus_group_register_offer($1, $2::text[])`, [m, offers[i]]);
  for (const u of users) await as(u, `select public.versus_group_pick_hero($1, 0)`, [m]);
  for (const u of users) await as(u, `select public.versus_group_intro_done($1)`, [m]);
  await beatAll();
  expect((await group(m)).phase).toBe('shop');
  return { m, room: room.id };
}
const gsubmit = (u: string, m: string, round: number, seq: number, final: boolean, tag: string) =>
  as(u, `select public.versus_group_submit($1, $2, $3, $4::jsonb, $5, null, null)`, [m, round, seq, JSON.stringify(sideOf(tag)), final]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(BASE);
  await db.exec('create table if not exists public.versus_test_bots (bot_user uuid primary key, host_user uuid not null, slot int not null, registered_at timestamptz not null default now())');
  await db.exec(FIX);
  await db.exec(FIX); // idempotent
  await db.exec(AFTER);
}, 120_000);
afterAll(async () => { await db?.close(); });
async function reset(): Promise<void> {
  await db.exec(`delete from public.versus_events; delete from public.versus_group_matches; delete from public.versus_matches; delete from public.versus_rooms;
    delete from public.duo_runs; delete from public.duos_rank_results; delete from public.duos_team_ranks; delete from public.duos_teams;`);
}
beforeEach(reset);

describe('R-VERSUS-CLOSE-ONCE-01: one close, one resolver', () => {
  it('1v1: four closes past the deadline (reconciles from both players), exactly one answers closed_by_me', async () => {
    const { m } = await start1v1();
    await lock1(A, m, 1, false, 'a');
    await lock1(B, m, 1, false, 'b');
    clock = Date.parse((await duel(m)).shop_deadline) + 1000;
    await beatAll();
    const answers = [];
    for (const u of [A, B, A, B]) answers.push(await as<any>(u, 'select public.versus_reconcile($1)', [m]));
    expect(answers.map((x) => x.closed_by_me)).toEqual([true, false, false, false]);
    expect(answers.every((x) => x.phase === 'resolving')).toBe(true);
    expect(await events(m, 'close')).toHaveLength(1);
    const row = await duel(m);
    expect(row.resolve_retry).toBe(0);
    expect(Date.parse(row.resolve_deadline) - Date.parse(row.resolving_since)).toBe(10_000);
  });

  it('1v1: the second End Turn is the one that closed; a re-sent End Turn after the close did not', async () => {
    const { m } = await start1v1();
    expect((await lock1(A, m, 1, true, 'a')).closed_by_me).toBe(false);
    expect((await lock1(B, m, 1, true, 'b')).closed_by_me).toBe(true);
    expect((await as<any>(A, 'select public.versus_reconcile($1)', [m])).closed_by_me).toBe(false);
  });

  it('Group and Duos: only the last End Turn closes', async () => {
    const g = await startGroup('group', [A, B, C]);
    expect((await gsubmit(A, g.m, 1, 1, true, 'a')).closed_by_me).toBe(false);
    expect((await gsubmit(B, g.m, 1, 1, true, 'b')).closed_by_me).toBe(false);
    expect((await gsubmit(C, g.m, 1, 1, true, 'c')).closed_by_me).toBe(true);
    expect((await as<any>(A, 'select public.versus_group_reconcile($1)', [g.m])).closed_by_me).toBe(false);
    const d = await startGroup('duos', [E, F, G, H]);
    const out = [];
    for (const u of [E, F, G, H]) out.push((await gsubmit(u, d.m, 1, 1, true, NAMES[u]!)).closed_by_me);
    expect(out).toEqual([false, false, false, true]);
  });

  it('Group: four reconciles past the deadline, exactly one closed_by_me', async () => {
    const g = await startGroup('group', [A, B, C]);
    clock = Date.parse((await group(g.m)).shop_deadline) + 1000;
    await beatAll();
    const out = [];
    for (const u of [A, B, C, A]) out.push((await as<any>(u, 'select public.versus_group_reconcile($1)', [g.m])).closed_by_me);
    expect(out).toEqual([true, false, false, false]);
  });

  it('Ranked Duos: the second ended seat closes (submit), the gate reconcile after it does not', async () => {
    const r = await startGroup('ranked_duos', [A, B]);
    expect((await gsubmit(A, r.m, 1, 1, true, 'a')).closed_by_me).toBe(false);
    expect((await gsubmit(B, r.m, 1, 1, true, 'b')).closed_by_me).toBe(true);
    expect((await as<any>(A, 'select public.versus_ranked_duos_reconcile($1)', [r.m])).closed_by_me).toBe(false);
  });

  it('a duplicate resolver save of a committed round answers alreadyCommitted without the match lock (every mode)', async () => {
    const { m } = await resolving1v1();
    const vitals = JSON.stringify({ p1: { health: 30, armor: 0, damage: 0 }, p2: { health: 30, armor: 0, damage: 0 } });
    const commit = `select public.versus_commit_round($1, 1, 'p1', 'draw', null, '{}'::jsonb, '{}'::jsonb, 'd', $2::jsonb)`;
    const first = await as<any>(null, commit, [m, vitals]);
    expect(first.alreadyCommitted).toBe(false);
    expect((await events(m, 'resolve_ok'))).toHaveLength(1);
    expect((await duel(m)).resolve_deadline).toBeNull();
    const again = await locksOf(null, commit, [m, vitals]);
    expect(again.value.alreadyCommitted).toBe(true);
    expect(again.locks).toEqual([]);
    expect((await events(m, 'resolve_ok'))).toHaveLength(1);

    // Group / Duos / Ranked Duos: the committed round row is what the fast path reads.
    for (const [mode, users, fn] of [
      ['group', [A, B, C], `select public.versus_group_commit_round($1, 1, '[]'::jsonb, 'd', '{}'::jsonb)`],
      ['duos', [A, B, C, D], `select public.versus_duos_commit_round($1, 1, '{}'::jsonb, 'd', '{}'::jsonb)`],
      ['ranked_duos', [A, B], `select public.versus_ranked_duos_commit_round($1, 1, '{}'::jsonb, 'd')`],
    ] as const) {
      await reset();
      const g = await startGroup(mode, [...users]);
      await q(`insert into public.versus_group_rounds (match_id, round, digest, hearts) values ($1, 1, 'd', null)`, [g.m]);
      const dup = await locksOf(null, fn, [g.m]);
      expect([mode, dup.value.alreadyCommitted, dup.locks]).toEqual([mode, true, []]);
    }
  });
});

describe('R-VERSUS-AUTO-RESUME-01: a returning player ends their own pause', () => {
  it('1v1 shop: the absent player\'s heartbeat starts the 3-2-1; the clock resumes with the pause added back', async () => {
    const { m, room } = await start1v1();
    const deadline = Date.parse((await duel(m)).shop_deadline);
    at(15_000);
    await heartbeat(A, room);
    const paused = await as<any>(A, 'select public.versus_reconcile($1)', [m]);
    expect([paused.paused_seat, !!paused.paused_at]).toEqual(['p2', true]);
    expect(await events(m, 'pause')).toHaveLength(1);
    at(40_000); // well past the 30 s grace: nobody pressed Unpause
    await heartbeat(A, room);
    const back = await heartbeat(B, room);
    expect(Date.parse(back.match.resume_at)).toBe(clock + 3000);
    expect((await events(m, 'resume_request'))[0].detail).toEqual({ seat: 'p2', by: 'heartbeat' });
    // A second beat inside the 3-2-1 changes nothing.
    at(1000);
    expect((await heartbeat(B, room)).match.resume_at).toBe(back.match.resume_at);
    at(2000);
    const live = await as<any>(A, 'select public.versus_reconcile($1)', [m]);
    expect([live.paused_at, live.paused_seat, live.resume_at]).toEqual([null, null, null]);
    expect(Date.parse(live.shop_deadline)).toBe(deadline + 43_000); // paused at +15 s, resumed at +58 s
    expect(await events(m, 'resume')).toHaveLength(1);
  });

  it('1v1 Hero Select: the same', async () => {
    const { m, room } = await start1v1(false);
    const deadline = Date.parse((await duel(m)).hero_deadline);
    at(15_000);
    await heartbeat(A, room);
    expect((await as<any>(A, 'select public.versus_reconcile($1)', [m])).paused_seat).toBe('p2');
    at(5000);
    await heartbeat(A, room);
    expect((await heartbeat(B, room)).match.resume_at).toBeTruthy();
    at(3000);
    const live = await as<any>(B, 'select public.versus_reconcile($1)', [m]);
    expect([live.phase, live.paused_at]).toEqual(['hero_select', null]);
    expect(Date.parse(live.hero_deadline)).toBe(deadline + 8000); // paused at +15 s, resumed at +23 s
  });

  it('after the grace the other player may still Unpause (the absent seat goes on auto); its heartbeat then takes it off auto', async () => {
    const { m, room } = await start1v1();
    at(15_000);
    await heartbeat(A, room);
    await as(A, 'select public.versus_reconcile($1)', [m]);
    expect(await fails(A, 'select public.versus_unpause($1)', [m])).toMatch(/grace_running/);
    at(31_000);
    await heartbeat(A, room);
    const un = await as<any>(A, 'select public.versus_unpause($1)', [m]);
    expect([un.p2_auto, !!un.resume_at]).toEqual([true, true]);
    at(3000);
    await heartbeat(A, room);
    expect((await as<any>(A, 'select public.versus_reconcile($1)', [m])).paused_at).toBeNull();
    const back = await heartbeat(B, room);
    expect(back.match.p2_auto).toBe(false);
  });

  it('Group shop and Hero Select: the absent seat\'s heartbeat resumes', async () => {
    for (const toShop of [true, false]) {
      await reset();
      const { m, room } = await startGroup('group', [A, B, C], toShop);
      at(15_000);
      await heartbeat(A, room);
      await heartbeat(B, room);
      expect((await as<any>(A, 'select public.versus_group_reconcile($1)', [m])).paused_seat).toBe('p3');
      at(4000);
      await heartbeat(A, room);
      await heartbeat(B, room);
      const back = await heartbeat(C, room);
      expect(back.groupMatch.resume_at).toBeTruthy();
      at(3000);
      const live = await as<any>(B, 'select public.versus_group_reconcile($1)', [m]);
      expect([live.phase, live.paused_at]).toEqual([toShop ? 'shop' : 'hero_select', null]);
    }
  });
});

describe('R-VERSUS-LEASE-01: presence never waits on the match row', () => {
  it('the heartbeat records presence with no match lock; it locks only to change the match, under a 2 s lock_timeout', async () => {
    const { m, room } = await start1v1();
    const plain = await locksOf(A, 'select public.versus_heartbeat($1)', [room]);
    expect(plain.locks).toEqual([]);
    expect(plain.value.match.id).toBe(m);
    // On auto: this beat must clear the flag, so it takes the match row (and only the match row) and clears it.
    await q('update public.versus_matches set p1_auto = true where id = $1', [m]);
    const auto = await locksOf(A, 'select public.versus_heartbeat($1)', [room]);
    expect(auto.locks).toContain('versus_matches:RowShareLock');
    expect(auto.value.match.p1_auto).toBe(false);
    const cfg = (await q<{ c: string[] }>(`select proconfig c from pg_proc where proname = 'versus_heartbeat'`))[0]!.c;
    expect(cfg).toContain('lock_timeout=2s');
    // Group: the same.
    const g = await startGroup('group', [E, F, G]);
    expect((await locksOf(E, 'select public.versus_heartbeat($1)', [g.room])).locks).toEqual([]);
  });

  it('a reconcile with nothing due takes no lock; one with something due does', async () => {
    const { m } = await start1v1();
    expect((await locksOf(A, 'select public.versus_reconcile($1)', [m])).locks).toEqual([]);
    const g = await startGroup('group', [C, D, E]);
    expect((await locksOf(C, 'select public.versus_group_reconcile($1)', [g.m])).locks).toEqual([]);
    const r = await startGroup('ranked_duos', [F, G]);
    expect((await locksOf(F, 'select public.versus_ranked_duos_reconcile($1)', [r.m])).locks).toEqual([]);
    clock = Date.parse((await duel(m)).shop_deadline) + 1000;
    await beatAll();
    expect((await locksOf(A, 'select public.versus_reconcile($1)', [m])).locks).toContain('versus_matches:RowShareLock');
  });

  it('a 13 s silence (a slow third beat) never pauses; past the 14 s lease it does', async () => {
    const { m, room } = await start1v1();
    at(13_000);
    await heartbeat(A, room);
    expect((await as<any>(A, 'select public.versus_reconcile($1)', [m])).paused_at).toBeNull();
    at(1500);
    await heartbeat(A, room);
    expect((await as<any>(A, 'select public.versus_reconcile($1)', [m])).paused_seat).toBe('p2');
  });
});

describe('R-VERSUS-RESOLVE-TIMEOUT-01: no round sits in resolving', () => {
  it('1v1: a retry every 10 s on the match row, then void at 90 s (no winner, room open)', async () => {
    const { m, room } = await resolving1v1();
    at(9000);
    await beatAll();
    expect((await as<any>(A, 'select public.versus_reconcile($1)', [m])).resolve_retry).toBe(0);
    const rev = (await duel(m)).revision;
    at(1000);
    await beatAll();
    const r1 = await as<any>(B, 'select public.versus_reconcile($1)', [m]);
    expect([r1.phase, r1.resolve_retry, r1.closed_by_me]).toEqual(['resolving', 1, false]);
    expect(r1.revision).toBeGreaterThan(rev);
    for (let i = 2; i <= 8; i++) {
      at(10_000);
      await beatAll();
      expect((await as<any>(A, 'select public.versus_reconcile($1)', [m])).resolve_retry).toBe(i);
    }
    at(10_000);
    await beatAll();
    const done = await as<any>(A, 'select public.versus_reconcile($1)', [m]);
    expect([done.phase, done.end_reason, done.winner_seat]).toEqual(['complete', 'void', null]);
    expect(await events(m, 'void')).toHaveLength(1);
    expect(await events(m, 'resolve_retry')).toHaveLength(8);
    expect((await q<any>('select status from public.versus_rooms where id = $1', [room]))[0].status).toBe('open');
  });

  it('1v1: an unresolvable round (versus-resolve reported the match content is not deployed) voids at the next window', async () => {
    const { m } = await resolving1v1();
    await as(null, `select public.versus__event($1, 1, 'resolve_err', '{"stage":"handler","status":409,"error":"engine_mismatch"}'::jsonb)`, [m]);
    at(10_000);
    await beatAll();
    expect((await as<any>(A, 'select public.versus_reconcile($1)', [m])).end_reason).toBe('void');
  });

  it('1v1: a pause while resolving does not count against the 90 s', async () => {
    const { m, room } = await resolving1v1();
    at(15_000);
    await heartbeat(A, room);
    expect((await as<any>(A, 'select public.versus_reconcile($1)', [m])).paused_seat).toBe('p2');
    at(120_000);
    await heartbeat(A, room);
    await heartbeat(B, room);
    at(3000);
    await heartbeat(A, room);
    const live = await as<any>(A, 'select public.versus_reconcile($1)', [m]);
    expect([live.phase, live.paused_at]).toEqual(['resolving', null]);
    // 15 s of resolving so far, so the deadline already passed: one retry, no void.
    expect((await as<any>(A, 'select public.versus_reconcile($1)', [m])).resolve_retry).toBe(1);
    expect((await duel(m)).phase).toBe('resolving');
  });

  it('Group and Duos: void after 90 s', async () => {
    for (const [mode, users] of [['group', [A, B, C]], ['duos', [A, B, C, D]]] as const) {
      await reset();
      const g = await startGroup(mode, [...users]);
      for (const u of users) await gsubmit(u, g.m, 1, 1, true, NAMES[u]!);
      for (let i = 0; i < 9; i++) {
        at(10_000);
        await beatAll();
        await as(A, 'select public.versus_group_reconcile($1)', [g.m]);
      }
      const row = await group(g.m);
      expect([mode, row.phase, row.end_reason, row.winner_seat, row.resolve_retry]).toEqual([mode, 'complete', 'void', null, 8]);
    }
  });

  it('Ranked Duos: void after 90 s is unrated and settles nothing', async () => {
    const r = await startGroup('ranked_duos', [A, B]);
    await gsubmit(A, r.m, 1, 1, true, 'a');
    await gsubmit(B, r.m, 1, 1, true, 'b');
    for (let i = 0; i < 9; i++) {
      at(10_000);
      await beatAll();
      await as(A, 'select public.versus_ranked_duos_reconcile($1)', [r.m]);
    }
    const row = await group(r.m);
    expect([row.phase, row.end_reason, row.unrated]).toEqual(['complete', 'void', 'void']);
    expect(await q('select * from public.duos_rank_results')).toEqual([]);
  });
});

describe('R-RANKED-DUOS-AUTO-VISIBLE-01: Ranked Duos auto on / off reaches every client', () => {
  it('a seat going on auto, and coming back, each bump the match row', async () => {
    const r = await startGroup('ranked_duos', [A, B]);
    const rev0 = (await group(r.m)).revision;
    at(15_000);
    await heartbeat(A, r.room);
    await as(A, 'select public.versus_ranked_duos_reconcile($1)', [r.m]);
    expect((await seatRows(r.m)).p2.auto).toBe(true);
    const rev1 = (await group(r.m)).revision;
    expect(rev1).toBeGreaterThan(rev0);
    expect((await events(r.m, 'auto_on'))[0].detail).toEqual({ seats: ['p2'] });
    // Back through its own reconcile (before any heartbeat): off auto, bumped again.
    await as(B, 'select public.versus_ranked_duos_reconcile($1)', [r.m]);
    expect((await seatRows(r.m)).p2.auto).toBe(false);
    expect((await group(r.m)).revision).toBeGreaterThan(rev1);
    expect(await events(r.m, 'auto_off')).toHaveLength(1);
  });
});

describe('R-VERSUS-SWEEP-01: a match everybody left ends', () => {
  it('1v1, Group and Duos end abandoned after 10 silent minutes; a match with anyone still beating is left alone; events prune at 14 days', async () => {
    const left = await start1v1(true, [I, J]);
    const kept = await startGroup('group', [A, B, C]);
    const duos = await startGroup('duos', [D, E, F, G]);
    await as(null, `select public.versus__event($1, 0, 'pause', null)`, [left.m]);
    await q(`update public.versus_events set at = $1::timestamptz - interval '15 days'`, [new Date(clock).toISOString()]);
    at(11 * 60_000);
    await heartbeat(C, kept.room);
    const out = await as<any>(null, 'select public.versus_sweep()');
    expect(out).toEqual({ solo: 1, group: 1, rankedDuos: 0, pruned: 1 });
    expect([(await duel(left.m)).phase, (await duel(left.m)).end_reason]).toEqual(['complete', 'abandoned']);
    expect((await group(duos.m)).end_reason).toBe('abandoned');
    expect((await group(kept.m)).phase).toBe('shop');
    expect((await events(left.m, 'sweep_end'))).toHaveLength(1);
    expect(await fails(A, 'select public.versus_sweep()')).toMatch(/permission denied/);
  });

  it('the sweep skips a match another transaction holds (SKIP LOCKED) and is service-role only', async () => {
    const fn = (await q<{ d: string }>(`select pg_get_functiondef('public.versus_sweep()'::regprocedure) d`))[0]!.d;
    expect(fn.match(/for update skip locked/g)).toHaveLength(2);
    const rd = (await q<{ d: string }>(`select pg_get_functiondef('public.versus_ranked_duos_sweep_abandoned()'::regprocedure) d`))[0]!.d;
    expect(rd).toMatch(/for update skip locked/);
  });
});

describe('versus_events is the server\'s own log', () => {
  it('players can neither read nor write it, nor call the event writer', async () => {
    expect(await fails(A, 'select count(*) from public.versus_events')).toMatch(/permission denied/);
    expect(await fails(A, `select public.versus__event('00000000-0000-0000-0000-000000000000', 1, 'void', null)`)).toMatch(/permission denied/);
    expect(await as<number>(null, 'select count(*)::int from public.versus_events')).toBe(0);
  });
});
