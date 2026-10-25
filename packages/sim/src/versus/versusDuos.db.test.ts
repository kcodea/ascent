/**
 * VERSUS DUOS, EXECUTED (owner 2026-10-25; R-DUOS-01, R-DUOS-PASS-01). PGlite runs every Versus migration in order, then
 * `2026-10-25-versus-duos.sql` (twice: idempotent), against a stubbed `auth.uid()`: a Duos room starts only with four,
 * the round's fight order (default alternation, a flip until the team locks), team hearts through the REAL
 * `finalize_duos` handler (1 heart, 2 for a stomp), a team out together and the other team winning, a concede taking
 * the team out, three auto rounds, passes (exactly once, only in the shop, only to the teammate, capped), and that a
 * group room still plays exactly as before.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { combatSide, type BoardMinion } from '@game/core';
import type { PreparedCombatSide } from '../state';
import type { VersusGroupSeat } from './group';
import { VERSUS_DUOS_HEARTS } from './duos';
import { handleVersusDuosFinalize, type VersusDuosFinalizeStore } from './duosFinalize';

const root = join(__dirname, '../../../..');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
];
const BASE = FILES.map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8')).join('\n');
const DUOS = readFileSync(join(root, 'supabase/migrations/2026-10-25-versus-duos.sql'), 'utf8');
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
const SEAT_OF: Record<string, VersusGroupSeat> = { [A]: 'p1', [B]: 'p2', [C]: 'p3', [D]: 'p4' };
const CONTENT = 'rev1';
const OPT_DUOS = JSON.stringify({ v: 1, mode: 'duos', modifiers: [] });

let db: PGlite;
let clock = Date.parse('2026-10-25T12:00:00Z');
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
const matchRow = async (id: string): Promise<any> => (await db.query<{ m: any }>('select to_jsonb(m) m from public.versus_group_matches m where id = $1', [id])).rows[0]!.m;
const seatRows = async (id: string): Promise<Record<string, any>> =>
  Object.fromEntries((await db.query<any>('select * from public.versus_group_seats where match_id = $1', [id])).rows.map((r) => [r.seat, r]));
const ALL = [A, B, C, D];

async function duosRoom(users: string[]): Promise<string> {
  const room = await as<any>(users[0]!, `select public.versus_create_room('Pair', $1, '{}', 'set3', $2, 1, $3::jsonb)`, [NAMES[users[0]!], CONTENT, OPT_DUOS]);
  for (const u of users.slice(1)) await as(u, `select public.versus_join_room($1, 'player', $2, '{}', $3, 1)`, [room.id, NAMES[u], CONTENT]);
  return room.id;
}
async function startDuos(): Promise<[string, string]> {
  const room = await duosRoom(ALL);
  await as(A, `select public.versus_start_game($1)`, [room]);
  let r: any;
  for (const u of ALL) r = await as(u, `select public.versus_press_gate($1)`, [room]);
  expect(r.status).toBe('in_game');
  return [room, r.current_match_id];
}
async function toShop(m: string): Promise<void> {
  for (const u of ALL) await as(u, `select public.versus_group_register_offer($1, array['warden','indy','keshi'])`, [m]);
  for (const u of ALL) await as(u, `select public.versus_group_pick_hero($1, 0)`, [m]);
  for (const u of ALL) await as(u, `select public.versus_group_intro_done($1)`, [m]);
}
const sideOf = (board: BoardMinion[]): PreparedCombatSide => ({ board, state: combatSide(), config: {} });
const bags = (n: number, attack: number, health: number, tag: string): BoardMinion[] =>
  Array.from({ length: n }, (_, i) => ({ cardId: 'sandbag', attack, health, sourceUid: `${tag}${i}` }));
const lock = (u: string, m: string, round: number, side: PreparedCombatSide = sideOf([])) =>
  as(u, `select public.versus_group_submit($1, $2, 1, $3::jsonb, true, null, null)`, [m, round, JSON.stringify(side)]);
const ready = async (m: string, round: number): Promise<void> => { for (const u of ALL) await as(u, `select public.versus_group_combat_ready($1, $2)`, [m, round]); };

const store: VersusDuosFinalizeStore = {
  async match(id) { return (await db.query<any>('select id, phase, round, seed, content_revision, duos_first, options from public.versus_group_matches where id = $1', [id])).rows[0] ?? null; },
  async finalSides(matchId, round) {
    const out: Partial<Record<VersusGroupSeat, unknown>> = {};
    for (const r of (await db.query<any>('select seat, prepared_side, final from public.versus_group_submissions where match_id = $1 and round = $2', [matchId, round])).rows) if (r.final) out[r.seat as VersusGroupSeat] = r.prepared_side;
    return out;
  },
  async commit(a) { return as(null, 'select public.versus_duos_commit_round($1, $2, $3::jsonb, $4)', [a.p_match, a.p_round, JSON.stringify(a.p_fight), a.p_digest]); },
  log: () => undefined,
};
const finalize = (m: string, round: number) => handleVersusDuosFinalize(A, { matchId: m, round }, CONTENT, store);

/** Lock a round with the given boards per seat, finalize it through the real handler, everyone back from the fight. */
async function playRound(m: string, round: number, boards: Partial<Record<VersusGroupSeat, BoardMinion[]>>): Promise<any> {
  for (const u of ALL) await lock(u, m, round, sideOf(boards[SEAT_OF[u]!] ?? []));
  expect((await matchRow(m)).phase).toBe('resolving');
  const res = await finalize(m, round);
  expect(res.body.status).toBe('committed');
  return res.body;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(BASE);
  await db.exec(DUOS);
  await db.exec(DUOS); // idempotent
}, 60_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('delete from public.versus_group_matches; delete from public.versus_matches; delete from public.versus_rooms;');
});

describe('Versus Duos room (R-DUOS-01)', () => {
  it('a Duos room seats four and starts only with four; it lists with four seats', async () => {
    const room = await duosRoom([A, B, C]);
    expect(await fails(A, `select public.versus_start_game($1)`, [room])).toMatch(/need_four_players/);
    await as(D, `select public.versus_join_room($1, 'player', 'Dan', '{}', $2, 1)`, [room, CONTENT]);
    const list = await as<any[]>(E, 'select public.versus_list_rooms()');
    expect(list.map((x) => [x.players, x.maxPlayers, x.options.mode])).toEqual([[4, 4, 'duos']]);
    await as(A, `select public.versus_start_game($1)`, [room]);
    let r: any;
    for (const u of ALL) r = await as(u, `select public.versus_press_gate($1)`, [room]);
    const m = await matchRow(r.current_match_id);
    expect([m.options.mode, m.seat_count]).toEqual(['duos', 4]);
    expect(Object.values(await seatRows(m.id)).map((s: any) => [s.team, s.hearts])).toEqual([['a', VERSUS_DUOS_HEARTS], ['a', VERSUS_DUOS_HEARTS], ['b', VERSUS_DUOS_HEARTS], ['b', VERSUS_DUOS_HEARTS]]);
    const teams = (await db.query<any>('select team, hearts from public.versus_group_teams where match_id = $1 order by team', [m.id])).rows;
    expect(teams).toEqual([{ team: 'a', hearts: VERSUS_DUOS_HEARTS }, { team: 'b', hearts: VERSUS_DUOS_HEARTS }]);
  });
});

describe('Versus Duos rounds (R-DUOS-01)', () => {
  it('the order alternates by round and a teammate may flip it until the team locks', async () => {
    const [, m] = await startDuos();
    await toShop(m);
    expect((await matchRow(m)).duos_first).toEqual({ a: 'p1', b: 'p3' });
    const flipped = await as<any>(B, 'select public.versus_duos_flip_order($1)', [m]);
    expect(flipped.duos_first).toEqual({ a: 'p2', b: 'p3' });
    await as(A, 'select public.versus_duos_flip_order($1)', [m]); // either teammate, and back
    expect((await matchRow(m)).duos_first).toEqual({ a: 'p1', b: 'p3' });
    await lock(C, m, 1);
    expect(await fails(D, 'select public.versus_duos_flip_order($1)', [m])).toMatch(/team_locked/);
    for (const u of [A, B, D]) await lock(u, m, 1);
    await finalize(m, 1);
    await ready(m, 1);
    expect((await matchRow(m)).duos_first).toEqual({ a: 'p2', b: 'p4' });
  });

  it('team hearts: 1 when the winner needed its second board, 2 when it did not; both seats keep the same count', async () => {
    const [, m] = await startDuos();
    await toShop(m);
    // Round 1 (p1 / p3 first): p1 is a stomp, team B loses 2.
    const r1 = await playRound(m, 1, { p1: bags(1, 40, 400, 'a'), p3: bags(1, 1, 2, 'c') });
    expect([r1.outcome, r1.heartsLost]).toEqual(['a', 2]);
    let s = await seatRows(m);
    expect([s.p1.hearts, s.p2.hearts, s.p3.hearts, s.p4.hearts]).toEqual([7, 7, 5, 5]);
    const fight = (await db.query<any>('select * from public.versus_group_fights where match_id = $1 and round = 1', [m])).rows;
    expect(fight.map((f) => [f.a_seat, f.b_seat, f.outcome, f.heart_lost_by])).toEqual([['p1', 'p3', 'a', 'p3']]);
    await ready(m, 1);
    // Round 2 (p2 / p4 first): p2's board falls, p1's steps in and wins: 1 heart.
    const r2 = await playRound(m, 2, { p2: bags(1, 1, 1, 'b'), p1: bags(1, 40, 400, 'a'), p4: bags(1, 2, 3, 'd') });
    expect([r2.first, r2.outcome, r2.heartsLost]).toEqual([{ a: 'p2', b: 'p4' }, 'a', 1]);
    s = await seatRows(m);
    expect([s.p3.hearts, s.p4.hearts]).toEqual([4, 4]);
    // A re-run of the finalize is a free no-op.
    expect((await finalize(m, 2)).body.status).toBe('not_resolving');
  });

  it('a team at 0 hearts is out together (2nd: placement is by team) and the other team wins (both 1st); the room opens', async () => {
    const [room, m] = await startDuos();
    await toShop(m);
    await db.query(`update public.versus_group_teams set hearts = 2 where match_id = $1 and team = 'b'`, [m]);
    await playRound(m, 1, { p1: bags(1, 40, 400, 'a') });
    const s = await seatRows(m);
    expect([s.p1.placement, s.p2.placement, s.p3.placement, s.p4.placement]).toEqual([1, 1, 2, 2]);
    expect([s.p3.out_reason, s.p4.out_reason]).toEqual(['hearts', 'hearts']);
    const teams = (await db.query<any>('select team, hearts, placement, eliminated_round from public.versus_group_teams where match_id = $1 order by team', [m])).rows;
    expect(teams.map((x) => [x.team, x.hearts, x.placement, x.eliminated_round])).toEqual([['a', 7, 1, null], ['b', 0, 2, 1]]);
    const row = await matchRow(m);
    expect([row.phase, row.winner_seat, row.end_reason]).toEqual(['complete', 'p1', 'hearts']);
    expect((await as<any>(A, 'select public.versus_reconcile_room($1)', [room])).status).toBe('open');
  });

  it('a concede puts the whole team out and the other team wins', async () => {
    const [, m] = await startDuos();
    await toShop(m);
    await as(D, 'select public.versus_group_forfeit($1)', [m]);
    const s = await seatRows(m);
    expect([s.p3.eliminated_round, s.p4.eliminated_round].every((x) => x != null)).toBe(true);
    expect([s.p1.placement, s.p2.placement, s.p3.placement, s.p4.placement]).toEqual([1, 1, 2, 2]);
    expect((await matchRow(m)).phase).toBe('complete');
  });

  it('a draw costs nobody', async () => {
    const [, m] = await startDuos();
    await toShop(m);
    const r = await playRound(m, 1, {});
    expect([r.outcome, r.heartsLost]).toEqual(['draw', 0]);
    expect(Object.values(await seatRows(m)).every((x: any) => x.hearts === 7)).toBe(true);
  });

  it('the group commit refuses nothing of Duos it was not asked for: a crafted bad Duos commit is refused', async () => {
    const [, m] = await startDuos();
    await toShop(m);
    for (const u of ALL) await lock(u, m, 1);
    const bad = { a: 'p3', b: 'p1', chair: 'a', outcome: 'a', losingTeam: 'b', heartsLost: 1, aResult: {}, bResult: {} };
    expect(await fails(null, `select public.versus_duos_commit_round($1, 1, $2::jsonb, 'd')`, [m, JSON.stringify(bad)])).toMatch(/bad_fight/);
    const three = { ...bad, a: 'p1', b: 'p3', heartsLost: 3 };
    expect(await fails(null, `select public.versus_duos_commit_round($1, 1, $2::jsonb, 'd')`, [m, JSON.stringify(three)])).toMatch(/bad_fight/);
    expect(await fails(A, `select public.versus_duos_commit_round($1, 1, $2::jsonb, 'd')`, [m, JSON.stringify(bad)])).toMatch(/permission denied/);
  });
});

describe('Versus Duos passes (R-DUOS-PASS-01)', () => {
  const card = (n: number) => JSON.stringify({ uid: `b${n}`, cardId: 'sandbag', attack: 3, health: 3, keywords: [], golden: false, tribe: 'neutral' });

  it('a pass goes to my teammate only, exactly once per seq, during my shop only', async () => {
    const [, m] = await startDuos();
    await toShop(m);
    const p = await as<any>(A, 'select public.versus_duos_pass($1, 1, 0, $2::jsonb)', [m, card(1)]);
    expect([p.from_seat, p.to_seat, p.seq, p.card.cardId]).toEqual(['p1', 'p2', 0, 'sandbag']);
    // A retry answers with the recorded row (no second pass).
    await as(A, 'select public.versus_duos_pass($1, 1, 0, $2::jsonb)', [m, card(9)]);
    const rows = (await db.query<any>('select * from public.versus_duos_passes where match_id = $1', [m])).rows;
    expect(rows.map((r) => [r.from_seat, r.seq, r.card.uid])).toEqual([['p1', 0, 'b1']]);
    // The teammate (and only the team) can read it.
    await db.exec('grant select on public.versus_duos_passes to authenticated');
    const seen = async (u: string) => (await (async () => {
      await db.exec(`select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`);
      try { return (await db.query<any>('select count(*)::int n from public.versus_duos_passes where match_id = $1', [m])).rows[0].n; } finally { await db.exec('reset role'); }
    })());
    expect([await seen(A), await seen(B), await seen(C)]).toEqual([1, 1, 0]);
    expect(await fails(A, 'select public.versus_duos_pass($1, 2, 1, $2::jsonb)', [m, card(2)])).toMatch(/not_shop/);
    expect(await fails(A, `select public.versus_duos_pass($1, 1, 1, '{"x":1}'::jsonb)`, [m])).toMatch(/bad_card/);
    expect(await fails(E, 'select public.versus_duos_pass($1, 1, 1, $2::jsonb)', [m, card(2)])).toMatch(/not_a_player/);
    await lock(A, m, 1);
    expect(await fails(A, 'select public.versus_duos_pass($1, 1, 1, $2::jsonb)', [m, card(2)])).toMatch(/locked/);
    // My teammate can still pass to me while I wait.
    expect((await as<any>(B, 'select public.versus_duos_pass($1, 1, 0, $2::jsonb)', [m, card(3)])).to_seat).toBe('p1');
  });

  it('"Pass is refused if hand is full": a reported full hand refuses it; a pass that still reaches one is answered refused', async () => {
    const [, m] = await startDuos();
    await toShop(m);
    // Bob reports 1 free slot: Ann's first pass is taken, the second refused until Bob answers the first.
    await as(B, 'select public.versus_duos_hand_room($1, 1)', [m]);
    await as(A, 'select public.versus_duos_pass($1, 1, 0, $2::jsonb)', [m, card(1)]);
    expect(await fails(A, 'select public.versus_duos_pass($1, 1, 1, $2::jsonb)', [m, card(2)])).toMatch(/hand_full/);
    // Only the receiver answers.
    expect(await fails(A, `select public.versus_duos_answer_pass($1, 'p1', 0, true)`, [m])).toMatch(/not_receiver/);
    const landed = await as<any>(B, `select public.versus_duos_answer_pass($1, 'p1', 0, true)`, [m]);
    expect(landed.status).toBe('landed');
    // Bob's hand is now full: he reports 0, so Ann's next pass is refused by the server.
    await as(B, 'select public.versus_duos_hand_room($1, 0)', [m]);
    expect(await fails(A, 'select public.versus_duos_pass($1, 1, 1, $2::jsonb)', [m, card(2)])).toMatch(/hand_full/);
    // A race: Bob reported room, then filled up: his run refuses it and answers so; the answer sticks.
    await as(B, 'select public.versus_duos_hand_room($1, 2)', [m]);
    await as(A, 'select public.versus_duos_pass($1, 1, 1, $2::jsonb)', [m, card(2)]);
    expect((await as<any>(B, `select public.versus_duos_answer_pass($1, 'p1', 1, false)`, [m])).status).toBe('refused');
    expect((await as<any>(B, `select public.versus_duos_answer_pass($1, 'p1', 1, true)`, [m])).status).toBe('refused');
    expect(await fails(B, 'select public.versus_duos_hand_room($1, 99)', [m])).toMatch(/bad_room/);
  });

  it('closes with the clock (past its grace) and is capped at 10 a round', async () => {
    const [, m] = await startDuos();
    await toShop(m);
    for (let i = 0; i < 10; i++) await as(C, 'select public.versus_duos_pass($1, 1, $2, $3::jsonb)', [m, i, card(i)]);
    expect(await fails(C, 'select public.versus_duos_pass($1, 1, 10, $2::jsonb)', [m, card(10)])).toMatch(/too_many_passes/);
    at(3600);
    expect(await fails(D, 'select public.versus_duos_pass($1, 1, 0, $2::jsonb)', [m, card(1)])).toMatch(/deadline_passed/);
  });

  it('a group room plays exactly as before (no Duos rules leak in)', async () => {
    const room = await as<any>(A, `select public.versus_create_room('Pack', 'Ann', '{}', 'set3', $1, 1, $2::jsonb)`, [CONTENT, JSON.stringify({ mode: 'group' })]);
    for (const u of [B, C]) await as(u, `select public.versus_join_room($1, 'player', $2, '{}', $3, 1)`, [room.id, NAMES[u], CONTENT]);
    await as(A, `select public.versus_start_game($1)`, [room.id]);
    let r: any;
    for (const u of [A, B, C]) r = await as(u, `select public.versus_press_gate($1)`, [room.id]);
    const m = r.current_match_id;
    expect((await matchRow(m)).duos_first).toBeNull();
    expect(await fails(A, 'select public.versus_duos_pass($1, 1, 0, $2::jsonb)', [m, card(1)])).toMatch(/not_duos/);
    expect(await fails(A, 'select public.versus_duos_flip_order($1)', [m])).toMatch(/not_duos/);
    // A group concede still puts out only that seat.
    for (const u of [A, B, C]) await as(u, `select public.versus_group_register_offer($1, array['warden','indy','keshi'])`, [m]);
    await as(C, 'select public.versus_group_forfeit($1)', [m]);
    const s = await seatRows(m);
    expect([s.p1.eliminated_round, s.p2.eliminated_round, s.p3.eliminated_round != null]).toEqual([null, null, true]);
  });
});
