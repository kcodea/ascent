/**
 * VERSUS DUOS, EXECUTED (owner 2026-10-25; R-DUOS-01, R-DUOS-PASS-01). PGlite runs every Versus migration in order, then
 * `2026-10-25-versus-duos.sql`, `-duos-edges.sql`, `-duos-random-order.sql` and `-duos-pass-back.sql` (each twice: idempotent), against a stubbed
 * `auth.uid()`: a Duos room starts only with four, the round's fight order (the seeded 50/50, no flip path; R-DUOS-ORDER-01), the team's shared pool through the REAL
 * `finalize_duos` handler (30 Health + both heroes' Armor, the lobby damage of the board that ended the fight; R-DUOS-HEALTH-01), a team out together and the other team winning, a concede taking
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
import { duosMateOf, duosRandomFirst, VERSUS_DUOS_PASS_CAP } from './duos';
import { hitVitals, versusDuosStartingVitals, versusFreshSide } from './vitals';
import { handleVersusDuosFinalize, type VersusDuosFinalizeStore } from './duosFinalize';

const root = join(__dirname, '../../../..');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
];
const BASE = FILES.map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8')).join('\n');
const DUOS = readFileSync(join(root, 'supabase/migrations/2026-10-25-versus-duos.sql'), 'utf8');
const EDGES = readFileSync(join(root, 'supabase/migrations/2026-10-25-versus-duos-edges.sql'), 'utf8');
const ORDER = readFileSync(join(root, 'supabase/migrations/2026-10-25-versus-duos-random-order.sql'), 'utf8');
const PASS_BACK = readFileSync(join(root, 'supabase/migrations/2026-10-25-versus-duos-pass-back.sql'), 'utf8');
const LOCK_ORDER = readFileSync(join(root, 'supabase/migrations/2026-10-26-versus-lock-order.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-27-versus-egress.sql'), 'utf8')
  // Health and Armor (R-VERSUS-HEALTH-01, R-DUOS-HEALTH-01).
  + readFileSync(join(root, 'supabase/migrations/2026-10-28-versus-health.sql'), 'utf8');
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
  async match(id) { return (await db.query<any>('select id, phase, round, seed, content_revision, options from public.versus_group_matches where id = $1', [id])).rows[0] ?? null; },
  async finalSides(matchId, round) {
    const out: Partial<Record<VersusGroupSeat, unknown>> = {};
    for (const r of (await db.query<any>('select seat, prepared_side, final, source from public.versus_group_submissions where match_id = $1 and round = $2', [matchId, round])).rows) if (r.final) out[r.seat as VersusGroupSeat] = versusFreshSide(r.prepared_side, r.source);
    return out;
  },
  async seats(id) { return (await db.query<any>('select seat, hero from public.versus_group_seats where match_id = $1', [id])).rows; },
  async teams(id) { return (await db.query<any>('select team, health, armor from public.versus_group_teams where match_id = $1', [id])).rows; },
  async commit(a) { return as(null, 'select public.versus_duos_commit_round($1, $2, $3::jsonb, $4, $5::jsonb)', [a.p_match, a.p_round, JSON.stringify(a.p_fight), a.p_digest, JSON.stringify(a.p_vitals)]); },
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
  await db.exec(EDGES);
  await db.exec(EDGES); // idempotent
  await db.exec(ORDER);
  await db.exec(ORDER); // idempotent
  await db.exec(PASS_BACK);
  await db.exec(PASS_BACK); // idempotent
  await db.exec(LOCK_ORDER); // R-VERSUS-LOCK-ORDER-01: heartbeat / leave / knockout trigger / list prune in one lock order
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
    // No stored pool until round 1 commits (each team then starts on 30 + both heroes' Armor, R-DUOS-HEALTH-01).
    expect(Object.values(await seatRows(m.id)).map((s: any) => [s.team, s.health])).toEqual([['a', null], ['a', null], ['b', null], ['b', null]]);
    const teams = (await db.query<any>('select team, health, armor from public.versus_group_teams where match_id = $1 order by team', [m.id])).rows;
    expect(teams).toEqual([{ team: 'a', health: null, armor: null }, { team: 'b', health: null, armor: null }]);
  });
});

describe('Versus Duos rounds (R-DUOS-01)', () => {
  it('the order is the seeded 50/50: no flip RPC, nothing stored, and the fight is fought in the seeded pick', async () => {
    const [, m] = await startDuos();
    await toShop(m);
    const row = await matchRow(m);
    expect(row.duos_first).toBeNull();
    expect(await fails(B, 'select public.versus_duos_flip_order($1)', [m])).toMatch(/does not exist/);
    const pick = duosRandomFirst(Number(row.seed), 1);
    const r1 = await playRound(m, 1, { p1: bags(1, 2, 2, 'a'), p2: bags(1, 2, 2, 'b'), p3: bags(1, 2, 2, 'c'), p4: bags(1, 2, 2, 'd') });
    expect(r1.first).toEqual(pick);
    const fight = (await db.query<any>('select a_seat, b_seat from public.versus_group_fights where match_id = $1 and round = 1', [m])).rows;
    expect(fight).toEqual([{ a_seat: pick.a, b_seat: pick.b }]);
    await ready(m, 1);
    expect((await matchRow(m)).duos_first).toBeNull();
  });

  // R-DUOS-HEALTH-01 (owner 2026-10-26): "The duo gets 30 hp plus the sum of both armors."
  const START = versusDuosStartingVitals('warden', 'warden', null); // every seat picks offer index 0 (warden)

  it('the team pool: 30 + both Armors; the losing team takes the lobby damage (capped, Armor first); both seats mirror it', async () => {
    const [, m] = await startDuos();
    await toShop(m);
    const seed = Number((await matchRow(m)).seed);
    // Round 1: team A's first board is a stomp (team B's lone board sits on its own pick; an empty pick hands over).
    const f1 = duosRandomFirst(seed, 1);
    const r1 = await playRound(m, 1, { [f1.a]: bags(1, 40, 400, 'a'), [f1.b]: bags(1, 1, 2, 'c') });
    expect(r1.outcome).toBe('a');
    expect(r1.damage).toBeGreaterThan(0);
    expect(r1.damage).toBeLessThanOrEqual(5); // round 1's lobby cap
    const b1 = hitVitals(START, r1.damage);
    let s = await seatRows(m);
    expect([s.p1.health, s.p1.armor, s.p2.health, s.p2.armor]).toEqual([START.health, START.armor, START.health, START.armor]);
    expect([s.p3.health, s.p3.armor, s.p4.health, s.p4.armor]).toEqual([b1.health, b1.armor, b1.health, b1.armor]);
    const fight = (await db.query<any>('select * from public.versus_group_fights where match_id = $1 and round = 1', [m])).rows;
    expect(fight.map((f) => [f.a_seat, f.b_seat, f.outcome, f.heart_lost_by, f.damage])).toEqual([[f1.a, f1.b, 'a', f1.b, r1.damage]]);
    const round = (await db.query<any>('select hearts, vitals from public.versus_group_rounds where match_id = $1 and round = 1', [m])).rows[0];
    expect(round.hearts).toBeNull();
    expect(round.vitals.p3).toEqual(b1);
    await ready(m, 1);
    // Round 2: team A's first board falls, its teammate steps in and wins: the damage is the board that ENDED it.
    const f2 = duosRandomFirst(seed, 2);
    const r2 = await playRound(m, 2, { [f2.a]: bags(1, 1, 1, 'b'), [duosMateOf(f2.a)]: bags(1, 40, 400, 'a'), [f2.b]: bags(1, 2, 3, 'd') });
    expect([r2.first, r2.outcome]).toEqual([f2, 'a']);
    s = await seatRows(m);
    const b2 = hitVitals(b1, r2.damage);
    expect([s.p3.health, s.p3.armor, s.p4.health, s.p4.armor]).toEqual([b2.health, b2.armor, b2.health, b2.armor]);
    // A re-run of the finalize is a free no-op.
    expect((await finalize(m, 2)).body.status).toBe('not_resolving');
  });

  it('a team at 0 Health is out together (2nd: placement is by team) and the other team wins (both 1st); the room opens', async () => {
    const [room, m] = await startDuos();
    await toShop(m);
    await db.query(`update public.versus_group_teams set health = 2, armor = 0 where match_id = $1 and team = 'b'`, [m]);
    await playRound(m, 1, { p1: bags(1, 40, 400, 'a') });
    const s = await seatRows(m);
    expect([s.p1.placement, s.p2.placement, s.p3.placement, s.p4.placement]).toEqual([1, 1, 2, 2]);
    expect([s.p3.out_reason, s.p4.out_reason]).toEqual(['hearts', 'hearts']);
    const teams = (await db.query<any>('select team, health, placement, eliminated_round from public.versus_group_teams where match_id = $1 order by team', [m])).rows;
    expect(teams.map((x) => [x.team, x.health, x.placement, x.eliminated_round])).toEqual([['a', START.health, 1, null], ['b', 0, 2, 1]]);
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
    expect([r.outcome, r.damage]).toEqual(['draw', 0]);
    expect(Object.values(await seatRows(m)).every((x: any) => x.health === START.health && x.armor === START.armor)).toBe(true);
  });

  it('the group commit refuses nothing of Duos it was not asked for: a crafted bad Duos commit is refused', async () => {
    const [, m] = await startDuos();
    await toShop(m);
    for (const u of ALL) await lock(u, m, 1);
    const vit = JSON.stringify({ a: { health: 30, armor: 0, damage: 0, before: 30 }, b: { health: 27, armor: 0, damage: 3, before: 30 } });
    const bad = { a: 'p3', b: 'p1', chair: 'a', outcome: 'a', losingTeam: 'b', damage: 3, aResult: {}, bResult: {} };
    expect(await fails(null, `select public.versus_duos_commit_round($1, 1, $2::jsonb, 'd', $3::jsonb)`, [m, JSON.stringify(bad), vit])).toMatch(/bad_fight/);
    // The losing team's pool must record exactly the fight's damage; the winners take none.
    const good = { ...bad, a: 'p1', b: 'p3' };
    const wrong = JSON.stringify({ a: { health: 30, armor: 0, damage: 3, before: 30 }, b: { health: 27, armor: 0, damage: 3, before: 30 } });
    expect(await fails(null, `select public.versus_duos_commit_round($1, 1, $2::jsonb, 'd', $3::jsonb)`, [m, JSON.stringify(good), wrong])).toMatch(/bad_vitals/);
    const drawHit = { ...good, outcome: 'draw', losingTeam: null };
    expect(await fails(null, `select public.versus_duos_commit_round($1, 1, $2::jsonb, 'd', $3::jsonb)`, [m, JSON.stringify(drawHit), vit])).toMatch(/bad_fight/);
    expect(await fails(A, `select public.versus_duos_commit_round($1, 1, $2::jsonb, 'd', $3::jsonb)`, [m, JSON.stringify(good), vit])).toMatch(/permission denied/);
  });
});

describe('Versus Duos passes (R-DUOS-PASS-01)', () => {
  const card = (n: number, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ uid: `b${n}`, cardId: 'sandbag', attack: 3, health: 3, keywords: [], golden: false, tribe: 'neutral', passFrom: 'hand', ...extra });

  it('"you should be able to pass cards back to your teammate": A->B->A->B, each its own row (pass back + again)', async () => {
    const [, m] = await startDuos();
    await toShop(m);
    await as(A, 'select public.versus_duos_pass($1, 1, 0, $2::jsonb)', [m, card(1)]);
    await as(B, `select public.versus_duos_answer_pass($1, 'p1', 0, true)`, [m]);
    // Bob sends the same card straight back (it carries the key it arrived through), then Ann sends it again.
    expect((await as<any>(B, 'select public.versus_duos_pass($1, 1, 0, $2::jsonb)', [m, card(40, { passKey: 'p1:0' })])).to_seat).toBe('p1');
    await as(A, `select public.versus_duos_answer_pass($1, 'p2', 0, true)`, [m]);
    expect((await as<any>(A, 'select public.versus_duos_pass($1, 1, 1, $2::jsonb)', [m, card(7, { passKey: 'p2:0' })])).seq).toBe(1);
    const rows = (await db.query<any>('select from_seat, seq, card from public.versus_duos_passes where match_id = $1 order by created_at, from_seat', [m])).rows;
    expect(rows.map((r) => [r.from_seat, r.seq, r.card.passKey ?? null])).toEqual([['p1', 0, null], ['p2', 0, 'p1:0'], ['p1', 1, 'p2:0']]);
  });

  it('"only from hand": a pass not marked as leaving the hand is refused (bad_card, so an older client refunds it)', async () => {
    const [, m] = await startDuos();
    await toShop(m);
    expect(await fails(A, 'select public.versus_duos_pass($1, 1, 0, $2::jsonb)', [m, card(1, { passFrom: 'board' })])).toMatch(/bad_card/);
    expect(await fails(A, 'select public.versus_duos_pass($1, 1, 0, $2::jsonb)', [m, card(1, { passFrom: undefined })])).toMatch(/bad_card/);
    expect((await db.query<any>('select count(*)::int n from public.versus_duos_passes where match_id = $1', [m])).rows[0].n).toBe(0);
    expect((await as<any>(A, 'select public.versus_duos_pass($1, 1, 0, $2::jsonb)', [m, card(1)])).seq).toBe(0);
  });

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

  it('a teammate who is away (on auto, or the one the match is paused for) is refused up front (phase 3)', async () => {
    const [, m] = await startDuos();
    await toShop(m);
    await db.query(`update public.versus_group_seats set auto = true where match_id = $1 and seat = 'p2'`, [m]);
    expect(await fails(A, 'select public.versus_duos_pass($1, 1, 0, $2::jsonb)', [m, card(1)])).toMatch(/teammate_away/);
    expect((await db.query<any>('select count(*)::int n from public.versus_duos_passes where match_id = $1', [m])).rows[0].n).toBe(0);
    // Back (auto cleared): the pass goes through; the other team is untouched by it.
    await db.query(`update public.versus_group_seats set auto = false where match_id = $1 and seat = 'p2'`, [m]);
    expect((await as<any>(A, 'select public.versus_duos_pass($1, 1, 0, $2::jsonb)', [m, card(1)])).to_seat).toBe('p2');
    await db.query(`update public.versus_group_matches set paused_at = now(), paused_seat = 'p4' where id = $1`, [m]);
    expect(await fails(C, 'select public.versus_duos_pass($1, 1, 0, $2::jsonb)', [m, card(2)])).toMatch(/teammate_away/);
  });

  it('closes with the clock (past its grace) and is capped at 10 a round (the anti-spam cap, VERSUS_DUOS_PASS_CAP)', async () => {
    expect(VERSUS_DUOS_PASS_CAP).toBe(10);
    const [, m] = await startDuos();
    await toShop(m);
    // The SAME card ten times (passed back and forth): every pass is its own row, until the cap.
    for (let i = 0; i < 10; i++) await as(C, 'select public.versus_duos_pass($1, 1, $2, $3::jsonb)', [m, i, card(1, i ? { passKey: `p4:${i - 1}` } : {})]);
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
    // A group concede still puts out only that seat.
    for (const u of [A, B, C]) await as(u, `select public.versus_group_register_offer($1, array['warden','indy','keshi'])`, [m]);
    await as(C, 'select public.versus_group_forfeit($1)', [m]);
    const s = await seatRows(m);
    expect([s.p1.eliminated_round, s.p2.eliminated_round, s.p3.eliminated_round != null]).toEqual([null, null, true]);
  });
});
