/**
 * VERSUS GROUP + ROOM OPTIONS, EXECUTED (owner 2026-10-24; R-VERSUS-GROUP-01, R-VERSUS-OPTIONS-01). PGlite runs every
 * Versus migration in order, then `2026-10-24-versus-group.sql` (twice: idempotent), against a stubbed `auth.uid()`:
 * room options (host only, whitelist, the 1v1 switch moving extra players to the stands, the snapshot on each match),
 * 3-4 player rooms, a whole 4-player match driven through the REAL `finalize_group` handler to last one standing, and
 * the edge rules (simultaneous knockouts share a placement, a copy never loses a heart, leaving mid-round makes a
 * ghost, the wipeout guard, auto + missed rounds, the 5 s End Combat rule, idempotent commits).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { combatSide } from '@game/core';
import type { PreparedCombatSide } from '../state';
import { VERSUS_HEARTS } from './constants';
import { versusGroupPairings, type VersusGroupSeat } from './group';
import { handleVersusGroupFinalize, type VersusGroupFinalizeStore } from './groupFinalize';

const root = join(__dirname, '../../../..');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
];
const BASE = FILES.map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8')).join('\n');
const GROUP = readFileSync(join(root, 'supabase/migrations/2026-10-24-versus-group.sql'), 'utf8')
  // A knocked-out player goes to the stands (R-VERSUS-GROUP-06).
  + readFileSync(join(root, 'supabase/migrations/2026-10-24-versus-group-knockout-stands.sql'), 'utf8') + readFileSync(join(root, 'supabase/migrations/2026-10-26-versus-lock-order.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-27-versus-egress.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const U = (n: number): string => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const [A, B, C, D, E] = [1, 2, 3, 4, 5].map(U) as [string, string, string, string, string];
const NAMES: Record<string, string> = { [A]: 'Ann', [B]: 'Bob', [C]: 'Cat', [D]: 'Dan', [E]: 'Eve' };
const CONTENT = 'rev1';

let db: PGlite;
let clock = Date.parse('2026-10-24T12:00:00Z');
const at = (sec: number): void => { clock += sec * 1000; };
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
const groupRow = async (id: string): Promise<any> => (await db.query<{ m: any }>('select to_jsonb(m) m from public.versus_group_matches m where id = $1', [id])).rows[0]!.m;
const seatRows = async (id: string): Promise<Record<string, any>> =>
  Object.fromEntries((await db.query<any>('select * from public.versus_group_seats where match_id = $1', [id])).rows.map((r) => [r.seat, r]));
const roles = async (room: string): Promise<Record<string, string>> =>
  Object.fromEntries((await db.query<any>('select user_id, role from public.versus_members where room_id = $1', [room])).rows.map((r) => [NAMES[r.user_id], r.role]));

const OPT_GROUP = JSON.stringify({ v: 1, mode: 'group', modifiers: [] });

/** A group room with `users` seated (in join order: p1, p2, ...). */
async function groupRoom(users: string[]): Promise<string> {
  const room = await as<any>(users[0]!, `select public.versus_create_room('Pack', $1, '{}', 'set3', $2, 1, $3::jsonb)`, [NAMES[users[0]!], CONTENT, OPT_GROUP]);
  for (const u of users.slice(1)) await as(u, `select public.versus_join_room($1, 'player', $2, '{}', $3, 1)`, [room.id, NAMES[u], CONTENT]);
  return room.id;
}
/** Start + every gate → a group match in hero_select. */
async function startGroup(users: string[]): Promise<[string, string]> {
  const room = await groupRoom(users);
  await as(users[0]!, `select public.versus_start_game($1)`, [room]);
  let r: any;
  for (const u of users) r = await as(u, `select public.versus_press_gate($1)`, [room]);
  expect(r.status).toBe('in_game');
  return [room, r.current_match_id];
}
async function toShop(m: string, users: string[]): Promise<void> {
  for (const u of users) await as(u, `select public.versus_group_register_offer($1, array['warden','indy','keshi'])`, [m]);
  for (const u of users) await as(u, `select public.versus_group_pick_hero($1, 0)`, [m]);
  for (const u of users) await as(u, `select public.versus_group_intro_done($1)`, [m]);
}
const beat = async (room: string, users: string[]): Promise<void> => { for (const u of users) await as(u, 'select public.versus_heartbeat($1)', [room]); };
const EMPTY = (): PreparedCombatSide => ({ board: [], state: combatSide(), config: {} });
const lock = (u: string, m: string, round: number, side: unknown = EMPTY()) =>
  as(u, `select public.versus_group_submit($1, $2, 1, $3::jsonb, true, null, null)`, [m, round, JSON.stringify(side)]);
/** A crafted commit (service role), for the SQL's own rules. */
const commitFights = (m: string, round: number, fights: unknown[]) =>
  as<any>(null, `select public.versus_group_commit_round($1, $2, $3::jsonb, 'd')`, [m, round, JSON.stringify(fights)]);
const fight = (i: number, a: VersusGroupSeat, b: VersusGroupSeat, outcome: 'a' | 'b' | 'draw', copy = false) => ({
  fight: i, a, b, copy, chair: 'a', outcome, aResult: {}, bResult: {},
  heartLostBy: outcome === 'draw' ? null : outcome === 'a' ? (copy ? null : b) : a,
});
const ready = async (m: string, round: number, users: string[]): Promise<void> => {
  for (const u of users) await as(u, `select public.versus_group_combat_ready($1, $2)`, [m, round]);
};

const store: VersusGroupFinalizeStore = {
  async match(id) { return (await db.query<any>('select id, phase, round, seed, content_revision from public.versus_group_matches where id = $1', [id])).rows[0] ?? null; },
  async seats(id) { return (await db.query<any>('select seat, eliminated_round from public.versus_group_seats where match_id = $1', [id])).rows; },
  async finalSides(matchId, round) {
    const out: Partial<Record<VersusGroupSeat, unknown>> = {};
    for (const r of (await db.query<any>('select seat, prepared_side, final from public.versus_group_submissions where match_id = $1 and round = $2', [matchId, round])).rows) if (r.final) out[r.seat as VersusGroupSeat] = r.prepared_side;
    return out;
  },
  async commit(a) { return as(null, 'select public.versus_group_commit_round($1, $2, $3::jsonb, $4)', [a.p_match, a.p_round, JSON.stringify(a.p_fights), a.p_digest]); },
  log: () => undefined,
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(BASE);
  await db.exec(GROUP);
  await db.exec(GROUP); // idempotent
}, 60_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('delete from public.versus_group_matches; delete from public.versus_matches; delete from public.versus_rooms;');
});

describe('Versus room options (R-VERSUS-OPTIONS-01)', () => {
  it('a room starts on today\'s defaults; the host (only) changes them while Open; the server refuses anything off the whitelist', async () => {
    const room = await as<any>(A, `select public.versus_create_room('Duel', 'Ann', '{}', 'set3', $1, 1)`, [CONTENT]);
    expect([room.options, room.options_rev]).toEqual([{ v: 1, mode: 'duel', modifiers: [] }, 0]);
    await as(B, `select public.versus_join_room($1, 'player', 'Bob', '{}', $2, 1)`, [room.id, CONTENT]);
    expect(await fails(B, `select public.versus_set_options($1, $2::jsonb)`, [room.id, OPT_GROUP])).toMatch(/not_host/);
    for (const [bad, why] of [
      [{ mode: 'trio' }, 'bad_mode'], [{ hearts: 9 }, 'unknown_option'], [{ timer: 'fast' }, 'unknown_option'],
      [{ modifiers: ['runic'] }, 'bad_modifiers'], [{ modifiers: ['freedom', 'summit'] }, 'bad_modifiers'], [{ v: 2 }, 'bad_version'], [[], 'options_not_object'],
    ] as const) {
      expect(await fails(A, `select public.versus_set_options($1, $2::jsonb)`, [room.id, JSON.stringify(bad)]), JSON.stringify(bad)).toMatch(new RegExp(why));
    }
    const r = await as<any>(A, `select public.versus_set_options($1, $2::jsonb)`, [room.id, JSON.stringify({ modifiers: ['summit'] })]);
    expect([r.options, r.options_rev]).toEqual([{ v: 1, mode: 'duel', modifiers: ['summit'] }, 1]);
    // The same options again: no "changed" bump.
    expect((await as<any>(A, `select public.versus_set_options($1, $2::jsonb)`, [room.id, JSON.stringify({ mode: 'duel', modifiers: ['summit'] })])).options_rev).toBe(1);
    await as(A, `select public.versus_start_game($1)`, [room.id]);
    expect(await fails(A, `select public.versus_set_options($1, $2::jsonb)`, [room.id, OPT_GROUP])).toMatch(/room_not_open/);
  });

  it('each 1v1 match snapshots the room\'s options; changing them between games never touches a finished match', async () => {
    const room = await as<any>(A, `select public.versus_create_room('Duel', 'Ann', '{}', 'set3', $1, 1, $2::jsonb)`, [CONTENT, JSON.stringify({ modifiers: ['freedom'] })]);
    await as(B, `select public.versus_join_room($1, 'player', 'Bob', '{}', $2, 1)`, [room.id, CONTENT]);
    await as(A, `select public.versus_start_game($1)`, [room.id]);
    await as(A, `select public.versus_press_gate($1)`, [room.id]);
    const r = await as<any>(B, `select public.versus_press_gate($1)`, [room.id]);
    const m = r.current_match_id;
    expect((await db.query<any>('select options, p1_hearts from public.versus_matches where id = $1', [m])).rows[0]).toEqual({ options: { v: 1, mode: 'duel', modifiers: ['freedom'] }, p1_hearts: VERSUS_HEARTS });
    await as(A, `select public.versus_forfeit($1)`, [m]);
    await as(A, `select public.versus_set_options($1, $2::jsonb)`, [room.id, JSON.stringify({ modifiers: [] })]);
    expect((await db.query<any>('select options from public.versus_matches where id = $1', [m])).rows[0].options.modifiers).toEqual(['freedom']);
  });

  it('switching to group opens seats 3 and 4; switching back to 1v1 moves the extras to the stands (an empty p1/p2 is filled first)', async () => {
    const room = await as<any>(A, `select public.versus_create_room('Pack', 'Ann', '{}', 'set3', $1, 1)`, [CONTENT]);
    await as(B, `select public.versus_join_room($1, 'player', 'Bob', '{}', $2, 1)`, [room.id, CONTENT]);
    expect(await fails(C, `select public.versus_join_room($1, 'player', 'Cat', '{}', $2, 1)`, [room.id, CONTENT])).toMatch(/seats_full/);
    await as(A, `select public.versus_set_options($1, $2::jsonb)`, [room.id, OPT_GROUP]);
    await as(C, `select public.versus_join_room($1, 'player', 'Cat', '{}', $2, 1)`, [room.id, CONTENT]);
    await as(D, `select public.versus_join_room($1, 'spectator', 'Dan', '{}', $2, 1)`, [room.id, CONTENT]);
    await as(D, `select public.versus_take_seat($1, 'p4')`, [room.id]);
    expect(await roles(room.id)).toEqual({ Ann: 'p1', Bob: 'p2', Cat: 'p3', Dan: 'p4' });
    const list = await as<any[]>(E, 'select public.versus_list_rooms()');
    expect(list.map((x) => [x.players, x.maxPlayers, x.options.mode])).toEqual([[4, 4, 'group']]);
    await as(B, `select public.versus_take_seat($1, 'spectator')`, [room.id]);
    expect((await as<any>(E, `select public.versus_open_rooms(1, $1)`, [CONTENT])).seatOpen).toBe(1);
    const r = await as<any>(A, `select public.versus_set_options($1, $2::jsonb)`, [room.id, JSON.stringify({ mode: 'duel' })]);
    expect(r.options_rev).toBe(2);
    expect(await roles(room.id)).toEqual({ Ann: 'p1', Bob: 'spectator', Cat: 'p2', Dan: 'spectator' });
    expect(await fails(B, `select public.versus_take_seat($1, 'p3')`, [room.id])).toMatch(/bad_role/);
  });
});

describe('Versus Group: knocked out = into the stands (R-VERSUS-GROUP-06)', () => {
  it('out of hearts or conceding moves the player to the stands of the room, past a full stand; they lock nothing more', async () => {
    const users = [A, B, C, D];
    const [room, m] = await startGroup(users);
    // A full stand: 20 spectators.
    for (let i = 0; i < 20; i++) await as(U(40 + i), `select public.versus_join_room($1, 'spectator', 'S', '{}', $2, 1)`, [room, CONTENT]);
    await toShop(m, users);
    await db.query(`update public.versus_group_seats set hearts = 1 where match_id = $1 and seat = 'p2'`, [m]);
    for (const u of users) await lock(u, m, 1);
    await commitFights(m, 1, [fight(0, 'p1', 'p2', 'a'), fight(1, 'p3', 'p4', 'draw')]);
    expect((await roles(room)).Bob).toBe('spectator');
    expect(await fails(B, `select public.versus_group_submit($1, 2, 1, '{}'::jsonb, true, null, null)`, [m])).toMatch(/eliminated|stale_round/);
    await as(D, 'select public.versus_group_forfeit($1)', [m]);
    expect((await roles(room)).Dan).toBe('spectator');
    // The match goes on for the other two; the group seats keep their placements.
    const seats = await seatRows(m);
    expect([seats.p2.placement, seats.p4.placement, (await groupRow(m)).phase]).toEqual([4, 3, 'combat']);
    // When it ends they are in the open room's stands, and can take a seat for the next game.
    await as(C, 'select public.versus_group_forfeit($1)', [m]);
    expect((await as<any>(A, 'select public.versus_reconcile_room($1)', [room])).status).toBe('open');
    await as(B, `select public.versus_take_seat($1, 'p2')`, [room]);
    expect((await roles(room)).Bob).toBe('p2');
  });
});

describe('Versus Group rooms', () => {
  it('Start needs three seated in a group room; every seated player must press the gate; the match snapshots the options', async () => {
    const room = await groupRoom([A, B]);
    expect(await fails(A, `select public.versus_start_game($1)`, [room])).toMatch(/need_three_players/);
    await as(C, `select public.versus_join_room($1, 'player', 'Cat', '{}', $2, 1)`, [room, CONTENT]);
    await as(A, `select public.versus_start_game($1)`, [room]);
    await as(A, `select public.versus_press_gate($1)`, [room]);
    await as(B, `select public.versus_press_gate($1)`, [room]);
    expect(await fails(E, `select public.versus_press_gate($1)`, [room])).toMatch(/not_a_player/);
    const r = await as<any>(C, `select public.versus_press_gate($1)`, [room]);
    expect(r.status).toBe('in_game');
    const m = await groupRow(r.current_match_id);
    expect([m.phase, m.seat_count, m.options.mode]).toEqual(['hero_select', 3, 'group']);
    const seats = await seatRows(m.id);
    expect(Object.keys(seats).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(Object.values(seats).every((s) => s.hearts === VERSUS_HEARTS)).toBe(true);
    // Private seeds are owner-only.
    expect(await as<number>(B, `select count(*)::int from public.versus_group_seat_private where seat = 'p1'`)).toBe(0);
  });

  it('a whole 4-player match through the real finalize_group: the strong board wins, everyone else is placed, last one standing', async () => {
    const users = [A, B, C, D];
    const [room, m] = await startGroup(users);
    await toShop(m, users);
    const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/parity.v1.json'), 'utf8')) as { cases: { p1: PreparedCombatSide }[] };
    const STRONG = fixture.cases[fixture.cases.length - 1]!.p1;
    const seatOf: Record<string, VersusGroupSeat> = { [A]: 'p1', [B]: 'p2', [C]: 'p3', [D]: 'p4' };
    let sawCopy = false;
    for (let round = 1; round <= 60; round++) {
      const row = await groupRow(m);
      if (row.phase === 'complete') break;
      expect([row.phase, row.round]).toEqual(['shop', round]);
      const seats = await seatRows(m);
      const living = users.filter((u) => seats[seatOf[u]!].eliminated_round == null);
      for (const u of living) await lock(u, m, round, u === A ? STRONG : EMPTY());
      expect((await groupRow(m)).phase).toBe('resolving');
      const res = await handleVersusGroupFinalize(B, { matchId: m, round }, CONTENT, store);
      expect(res.status).toBe(200);
      // The resolver used exactly the public pairing every client derives.
      const elim = Object.fromEntries(Object.values(seats).map((s) => [s.seat, s.eliminated_round]));
      const expected = versusGroupPairings(['p1', 'p2', 'p3', 'p4'], elim, round);
      const fights = (await db.query<any>('select a_seat, b_seat, b_copy from public.versus_group_fights where match_id = $1 and round = $2 order by fight', [m, round])).rows;
      expect(fights.map((f) => ({ a: f.a_seat, b: f.b_seat, copy: f.b_copy }))).toEqual(expected);
      if (fights.some((f) => f.b_copy)) sawCopy = true;
      // A retry is a no-op.
      expect((await handleVersusGroupFinalize(C, { matchId: m, round }, CONTENT, store)).body.status).toBe('not_resolving');
      if ((await groupRow(m)).phase === 'complete') break;
      await beat(room, living);
      await ready(m, round, living);
    }
    const end = await groupRow(m);
    expect([end.phase, end.winner_seat, end.end_reason]).toEqual(['complete', 'p1', 'hearts']);
    expect(sawCopy).toBe(true);
    const seats = await seatRows(m);
    expect(seats.p1.placement).toBe(1);
    expect([seats.p2, seats.p3, seats.p4].every((s) => s.hearts <= 0 && s.out_reason === 'hearts' && s.placement >= 2)).toBe(true);
    // The room is Open again with everyone in it.
    const r = await as<any>(A, `select public.versus_reconcile_room($1)`, [room]);
    expect([r.status, r.members.length]).toEqual(['open', 4]);
  });

  it('simultaneous knockouts share a placement; a copy never loses a heart; the commit is idempotent and validated', async () => {
    const users = [A, B, C, D];
    const [, m] = await startGroup(users);
    await toShop(m, users);
    await db.query(`update public.versus_group_seats set hearts = 1 where match_id = $1 and seat in ('p2', 'p4')`, [m]);
    for (const u of users) await lock(u, m, 1);
    expect(await fails(A, `select public.versus_group_commit_round($1, 1, '[]'::jsonb, 'd')`, [m])).toMatch(/permission denied/);
    expect(await fails(null, `select public.versus_group_commit_round($1, 1, $2::jsonb, 'd')`, [m, JSON.stringify([{ ...fight(0, 'p1', 'p2', 'a'), heartLostBy: 'p1' }])])).toMatch(/bad_fights/);
    const c = await commitFights(m, 1, [fight(0, 'p1', 'p2', 'a'), fight(1, 'p3', 'p4', 'a')]);
    expect(c.alreadyCommitted).toBe(false);
    expect((await commitFights(m, 1, [fight(0, 'p1', 'p2', 'b')])).alreadyCommitted).toBe(true);
    let seats = await seatRows(m);
    expect([seats.p2.placement, seats.p4.placement, seats.p2.eliminated_round]).toEqual([4, 4, 1]); // the lobby rule: a tie takes the lower place
    const round = (await db.query<any>('select hearts, eliminated from public.versus_group_rounds where match_id = $1', [m])).rows[0];
    expect(round).toEqual({ hearts: { p1: VERSUS_HEARTS, p2: 0, p3: VERSUS_HEARTS, p4: 0 }, eliminated: ['p2', 'p4'] });
    // Two left: round 2 is p1 vs p3.
    await ready(m, 1, [A, C]);
    expect((await groupRow(m)).round).toBe(2);
    // A crafted copy fight claiming the copy lost a heart is refused.
    await lock(A, m, 2);
    await lock(C, m, 2);
    expect(await fails(null, `select public.versus_group_commit_round($1, 2, $2::jsonb, 'd')`, [m, JSON.stringify([{ ...fight(0, 'p1', 'p3', 'a', true), heartLostBy: 'p3' }])])).toMatch(/bad_fights/);
    await commitFights(m, 2, [fight(0, 'p1', 'p3', 'draw')]);
    seats = await seatRows(m);
    expect([seats.p1.hearts, seats.p3.hearts]).toEqual([VERSUS_HEARTS, VERSUS_HEARTS]);
  });

  it('leaving mid-shop: the seat is out at once (placed), still fights the round as a ghost that cannot lose a heart; the last one standing wins', async () => {
    const users = [A, B, C];
    const [room, m] = await startGroup(users);
    await toShop(m, users);
    await lock(B, m, 1);
    await as(C, `select public.versus_leave_room($1)`, [room]);
    let seats = await seatRows(m);
    expect([seats.p3.eliminated_round, seats.p3.out_reason, seats.p3.placement]).toEqual([1, 'left', 3]);
    expect((await groupRow(m)).phase).toBe('shop'); // A has not locked yet
    await lock(A, m, 1);
    expect((await groupRow(m)).phase).toBe('resolving');
    // The ghost fights with its last locked board (none yet: empty) and the round's pairing is unchanged.
    const res = await handleVersusGroupFinalize(A, { matchId: m, round: 1 }, CONTENT, store);
    expect(res.body.fights).toEqual(versusGroupPairings(['p1', 'p2', 'p3'], {}, 1).map((p) => ({ ...p, outcome: 'draw' })));
    expect(await fails(C, `select public.versus_group_submit($1, 2, 1, '{}'::jsonb, true, null, null)`, [m])).toMatch(/not_a_player|eliminated|stale_round/);
    await ready(m, 1, [A, B]);
    await as(B, `select public.versus_group_forfeit($1)`, [m]);
    const row = await groupRow(m);
    seats = await seatRows(m);
    expect([row.phase, row.winner_seat, row.end_reason, seats.p1.placement, seats.p2.placement]).toEqual(['complete', 'p1', 'forfeit', 1, 2]);
  });

  it('the wipeout guard: two players both losing to ghosts of seats that left leave one standing (healthier, then seat order)', async () => {
    const users = [A, B, C, D];
    const [room, m] = await startGroup(users);
    await toShop(m, users);
    await db.query(`update public.versus_group_seats set hearts = 1 where match_id = $1`, [m]);
    await as(A, `select public.versus_leave_room($1)`, [room]); // p1 out (4th)
    await as(C, `select public.versus_leave_room($1)`, [room]); // p3 out (3rd)
    await lock(B, m, 1);
    await lock(D, m, 1);
    // Round 1 pairing: p1-p2, p3-p4 (both ghosts win).
    await commitFights(m, 1, [fight(0, 'p1', 'p2', 'a'), fight(1, 'p3', 'p4', 'a')]);
    const row = await groupRow(m);
    const seats = await seatRows(m);
    expect([row.phase, row.winner_seat]).toEqual(['complete', 'p2']);
    expect([seats.p2.placement, seats.p4.placement, seats.p1.placement, seats.p3.placement]).toEqual([1, 2, 4, 3]);
  });

  it('disconnects: a pause, the grace, another living player unpauses (auto), three auto rounds = out; coming back clears auto', async () => {
    const users = [A, B, C];
    const [room, m] = await startGroup(users);
    await toShop(m, users);
    await beat(room, users);
    at(13);
    await beat(room, [A, B]);
    let row = await as<any>(A, 'select public.versus_group_reconcile($1)', [m]);
    expect(row.paused_seat).toBe('p3');
    expect(await fails(B, 'select public.versus_group_unpause($1)', [m])).toMatch(/grace_running/);
    at(31);
    await beat(room, [A, B]);
    await as(B, 'select public.versus_group_unpause($1)', [m]);
    at(4);
    await beat(room, [A, B]);
    row = await as<any>(A, 'select public.versus_group_reconcile($1)', [m]);
    expect(row.paused_at).toBeNull();
    expect((await seatRows(m)).p3.auto).toBe(true);
    const playRound = async (round: number): Promise<void> => {
      await lock(A, m, round);
      await lock(B, m, round);
      expect((await groupRow(m)).phase).toBe('resolving'); // an auto seat never holds the round up
      await handleVersusGroupFinalize(A, { matchId: m, round }, CONTENT, store);
    };
    await playRound(1);
    expect((await seatRows(m)).p3.missed).toBe(1);
    // Coming back (a heartbeat) clears auto and the missed count.
    const hb = await as<any>(C, 'select public.versus_heartbeat($1)', [room]);
    expect(hb.groupMatch.seats.find((s: any) => s.seat === 'p3')).toMatchObject({ auto: false, missed: 0 });
    await db.query(`update public.versus_group_seats set auto = true where match_id = $1 and seat = 'p3'`, [m]);
    for (let round = 2; round <= 4; round++) {
      await beat(room, [A, B]);
      await ready(m, round - 1, [A, B]);
      await playRound(round);
    }
    const seats = await seatRows(m);
    expect([seats.p3.eliminated_round, seats.p3.out_reason, seats.p3.placement]).toEqual([4, 'missed', 3]);
    expect((await groupRow(m)).phase).toBe('combat'); // two remain: the match goes on
  });

  it('End Combat: when all but one living player are back, the last has 5 s; the barrier ignores eliminated seats', async () => {
    const users = [A, B, C, D];
    const [room, m] = await startGroup(users);
    await toShop(m, users);
    for (const u of users) await lock(u, m, 1);
    await commitFights(m, 1, [fight(0, 'p1', 'p2', 'draw'), fight(1, 'p3', 'p4', 'draw')]);
    await ready(m, 1, [A, B]);
    let row = await groupRow(m);
    expect(Date.parse(row.combat_deadline) - clock).toBe(90_000);
    await ready(m, 1, [C]);
    row = await groupRow(m);
    expect(Date.parse(row.combat_deadline) - clock).toBe(5_000);
    at(5);
    await beat(room, users);
    row = await as<any>(A, 'select public.versus_group_reconcile($1)', [m]);
    expect([row.phase, row.round]).toEqual(['shop', 2]);
    // D concedes during combat of round 2: the barrier then waits only for the living.
    for (const u of users) await lock(u, m, 2);
    await commitFights(m, 2, versusGroupPairings(['p1', 'p2', 'p3', 'p4'], {}, 2).map((p, i) => fight(i, p.a, p.b, 'draw')));
    await as(D, 'select public.versus_group_forfeit($1)', [m]);
    await ready(m, 2, [A, B, C]);
    row = await groupRow(m);
    expect([row.phase, row.round]).toEqual(['shop', 3]);
    expect(versusGroupPairings(['p1', 'p2', 'p3', 'p4'], { p4: 2 }, 3).some((p) => p.copy)).toBe(true);
  });

  it('Hero Select timeout picks for every unpicked seat; the round-1 clock waits for every living intro', async () => {
    const users = [A, B, C];
    const [room, m] = await startGroup(users);
    for (const u of users) await as(u, `select public.versus_group_register_offer($1, array['warden','indy','keshi'])`, [m]);
    await as(A, `select public.versus_group_pick_hero($1, 1)`, [m]);
    at(21);
    await beat(room, users);
    let row = await as<any>(B, 'select public.versus_group_reconcile($1)', [m]);
    expect([row.phase, row.round, row.shop_deadline]).toEqual(['shop', 1, null]);
    expect(row.seats.map((s: any) => s.hero)).toEqual(['indy', expect.any(String), expect.any(String)]);
    await as(A, 'select public.versus_group_intro_done($1)', [m]);
    await as(B, 'select public.versus_group_intro_done($1)', [m]);
    expect((await groupRow(m)).shop_deadline).toBeNull();
    row = await as<any>(C, 'select public.versus_group_intro_done($1)', [m]);
    expect((Date.parse(row.shop_deadline) - clock) / 1000).toBe(21);
  });
});
