/**
 * THE VERSUS SQL, EXECUTED (2026-10-13). PGlite runs the real migration (`supabase/migrations/2026-10-13-versus.sql`)
 * against a stubbed `auth.uid()` and walks a match end to end: create/join/seat swap, the atomic second-seat race,
 * the host seal, the 30 s gate window, Hero Select (picks hidden, timeout auto-pick), shop deadlines, locking,
 * candidate promotion, the commit (hearts, draws, idempotence), the combat barrier, pause/resume/unpause/auto,
 * forfeits and the continuous room. Time moves through the `versus.test_now` hook.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentRevision } from '@game/content';
import * as K from './constants';
import { handleVersusFinalize, type VersusFinalizeStore } from './finalize';

const { VERSUS_HEARTS } = K;

const root = join(__dirname, '../../../..');
const MIGRATION = readFileSync(join(root, 'supabase/migrations/2026-10-13-versus.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-14-versus-shop-start.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-14-versus-scout.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-14-versus-ready-pause.sql'), 'utf8');

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const D = '00000000-0000-0000-0000-00000000000d';

let db: PGlite;
let clock = Date.parse('2026-10-13T12:00:00Z');
const at = (sec: number): void => { clock += sec * 1000; };

/** Run `sql` as `user` (authenticated), at the test clock. Returns the first column of the first row. */
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
  try {
    await as(user, sql, params);
  } catch (e) {
    return (e as Error).message;
  }
  return 'did not fail';
}
const SIDE = (n: number) => JSON.stringify({ board: [{ cardId: 'x', attack: n, health: n }], state: {}, config: {} });

async function match(id: string): Promise<any> {
  const r = await db.query<{ m: any }>('select to_jsonb(m) m from public.versus_matches m where id = $1', [id]);
  return r.rows[0]!.m;
}

/** A room with A as p1, B as p2, gates pressed → a match in hero_select. Returns [roomId, matchId]. */
async function startMatch(): Promise<[string, string]> {
  const room = await as<any>(A, `select public.versus_create_room('Duel', 'Ann', '{}', 'set3', 'rev1', 1)`);
  await as(B, `select public.versus_join_room($1, 'player', 'Bob', '{}', 'rev1', 1)`, [room.id]);
  await as(A, `select public.versus_start_game($1)`, [room.id]);
  await as(A, `select public.versus_press_gate($1)`, [room.id]);
  const r = await as<any>(B, `select public.versus_press_gate($1)`, [room.id]);
  expect(r.status).toBe('in_game');
  return [room.id, r.current_match_id];
}

/** Hero picks for both → round 1 shop. */
async function toShop(m: string): Promise<void> {
  await as(A, `select public.versus_register_offer($1, array['warden','indy','keshi'])`, [m]);
  await as(B, `select public.versus_register_offer($1, array['indy','warden','keshi'])`, [m]);
  await as(A, `select public.versus_pick_hero($1, 2)`, [m]);
  await as(B, `select public.versus_pick_hero($1, 0)`, [m]);
  await as(A, `select public.versus_intro_done($1)`, [m]);
  await as(B, `select public.versus_intro_done($1)`, [m]);
}
const beat = async (room: string, ...users: string[]) => { for (const u of users) await as(u, 'select public.versus_heartbeat($1)', [room]); };
async function lockBoth(m: string, round: number): Promise<void> {
  await as(A, `select public.versus_submit($1, $2, 1, $3::jsonb, true, null)`, [m, round, SIDE(1)]);
  await as(B, `select public.versus_submit($1, $2, 1, $3::jsonb, true, null)`, [m, round, SIDE(2)]);
}
const commit = (m: string, round: number, outcome: 'p1' | 'p2' | 'draw') =>
  as<any>(null, `select public.versus_commit_round($1, $2, 'p1', $3, $4, '{}', '{}', 'd')`, [m, round, outcome, outcome === 'draw' ? null : outcome === 'p1' ? 'p2' : 'p1']);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // idempotent
}, 60_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('delete from public.versus_matches; delete from public.versus_rooms;');
});

describe('Versus rooms', () => {
  it('create claims p1; join claims p2 atomically; a third player is refused; spectators fill to 20', async () => {
    const room = await as<any>(A, `select public.versus_create_room('Duel', 'Ann', '{}', 'set3', 'rev1', 1)`);
    expect(room.members.map((m: any) => m.role)).toEqual(['p1']);
    await as(B, `select public.versus_join_room($1, 'player', 'Bob', '{}', 'rev1', 1)`, [room.id]);
    expect(await fails(C, `select public.versus_join_room($1, 'player', 'Cat', '{}', 'rev1', 1)`, [room.id])).toMatch(/seats_full/);
    expect(await fails(C, `select public.versus_join_room($1, 'player', 'Cat', '{}', 'rev2', 1)`, [room.id])).toMatch(/version_mismatch/);
    const r = await as<any>(C, `select public.versus_join_room($1, 'spectator', 'Cat', '{}', 'rev1', 1)`, [room.id]);
    expect(r.members.map((m: any) => m.role)).toEqual(['p1', 'p2', 'spectator']);
    for (let i = 0; i < 19; i++) {
      await as(`00000000-0000-0000-0000-1000000000${String(i).padStart(2, '0')}`, `select public.versus_join_room($1, 'spectator', 'S', '{}', 'rev1', 1)`, [room.id]);
    }
    expect(await fails(D, `select public.versus_join_room($1, 'spectator', 'Dan', '{}', 'rev1', 1)`, [room.id])).toMatch(/spectators_full/);
  });

  it('seat swapping while open: a player moves to the stands, a spectator takes the empty seat', async () => {
    const room = await as<any>(A, `select public.versus_create_room('Duel', 'Ann', '{}', 'set3', 'rev1', 1)`);
    await as(B, `select public.versus_join_room($1, 'spectator', 'Bob', '{}', 'rev1', 1)`, [room.id]);
    await as(B, `select public.versus_take_seat($1, 'p2')`, [room.id]);
    await as(A, `select public.versus_take_seat($1, 'spectator')`, [room.id]);
    const r = await as<any>(C, `select public.versus_join_room($1, 'player', 'Cat', '{}', 'rev1', 1)`, [room.id]);
    expect(Object.fromEntries(r.members.map((m: any) => [m.displayName, m.role]))).toEqual({ Ann: 'spectator', Bob: 'p2', Cat: 'p1' });
    expect(await fails(A, `select public.versus_take_seat($1, 'p1')`, [room.id])).toMatch(/seat_taken/);
  });

  it('only the host starts, only with two players; Start seals the room and refuses player joins', async () => {
    const room = await as<any>(A, `select public.versus_create_room('Duel', 'Ann', '{}', 'set3', 'rev1', 1)`);
    expect(await fails(A, `select public.versus_start_game($1)`, [room.id])).toMatch(/need_two_players/);
    await as(B, `select public.versus_join_room($1, 'player', 'Bob', '{}', 'rev1', 1)`, [room.id]);
    expect(await fails(B, `select public.versus_start_game($1)`, [room.id])).toMatch(/not_host/);
    const s = await as<any>(A, `select public.versus_start_game($1)`, [room.id]);
    expect(s.status).toBe('sealed');
    expect(await fails(C, `select public.versus_join_room($1, 'player', 'Cat', '{}', 'rev1', 1)`, [room.id])).toMatch(/room_not_open/);
    expect(await fails(B, `select public.versus_take_seat($1, 'spectator')`, [room.id])).toMatch(/room_not_open/);
    await as(C, `select public.versus_join_room($1, 'spectator', 'Cat', '{}', 'rev1', 1)`, [room.id]); // spectators always welcome
  });

  it('the gate gems must both be pressed within 30 s, or the room returns to Open', async () => {
    const room = await as<any>(A, `select public.versus_create_room('Duel', 'Ann', '{}', 'set3', 'rev1', 1)`);
    await as(B, `select public.versus_join_room($1, 'player', 'Bob', '{}', 'rev1', 1)`, [room.id]);
    await as(A, `select public.versus_start_game($1)`, [room.id]);
    await as(A, `select public.versus_press_gate($1)`, [room.id]);
    at(31);
    expect(await fails(B, `select public.versus_press_gate($1)`, [room.id])).toMatch(/gate_expired/);
    const r = await as<any>(C, `select public.versus_reconcile_room($1)`, [room.id]);
    expect([r.status, r.p1_gate, r.p2_gate]).toEqual(['open', false, false]);
  });
});

describe('Versus match', () => {
  it('Hero Select: picks are hidden until both are in; then round 1 opens on the normal timer', async () => {
    const [, m] = await startMatch();
    await as(A, `select public.versus_register_offer($1, array['warden','indy','keshi'])`, [m]);
    await as(A, `select public.versus_pick_hero($1, 1)`, [m]);
    let row = await match(m);
    expect([row.phase, row.p1_hero, row.heroes_revealed]).toEqual(['hero_select', null, false]);
    // B cannot read A's private row (offer + pick).
    const peek = await as<number>(B, `select count(*)::int from public.versus_seat_private where seat = 'p1'`);
    expect(peek).toBe(0);
    await as(B, `select public.versus_register_offer($1, array['indy','indy','warden'])`, [m]);
    await as(B, `select public.versus_pick_hero($1, 0)`, [m]);
    row = await match(m);
    expect([row.phase, row.round, row.p1_hero, row.p2_hero, row.heroes_revealed]).toEqual(['shop', 1, 'indy', 'indy', true]);
    // Round 1 has no clock until both game starts (ceremony + Good Luck) have played out.
    expect([row.shop_starts_at, row.shop_deadline]).toEqual([null, null]);
    at(9);
    await as(A, `select public.versus_intro_done($1)`, [m]);
    expect((await match(m)).shop_deadline).toBeNull();
    at(2);
    await as(B, `select public.versus_intro_done($1)`, [m]);
    row = await match(m);
    expect(Date.parse(row.shop_starts_at)).toBe(clock); // the moment the second intro ended: no lead
    expect((Date.parse(row.shop_deadline) - clock) / 1000).toBe(21);
  });

  it('scouts: each committed round records the public state of BOTH seats (tier from the locked side), wins, losses and draws alike', async () => {
    const [, m] = await startMatch();
    await toShop(m);
    const sideAt = (tier: number) => JSON.stringify({ board: [{ cardId: 'x', attack: 1, health: 1 }], state: { tier }, config: {} });
    const lock = async (round: number, t1: number, t2: number) => {
      // A candidate first (as the client sends one while shopping), then the lock with a newer scout.
      await as(A, `select public.versus_submit($1, $2, 1, $3::jsonb, false, null, $4::jsonb)`, [m, round, sideAt(t1), JSON.stringify({ tier: 1, triples: 0 })]);
      await as(A, `select public.versus_submit($1, $2, 2, $3::jsonb, true, null, $4::jsonb)`, [m, round, sideAt(t1), JSON.stringify({ tier: 99, triples: round, runes: ['r' + round] })]);
      await as(B, `select public.versus_submit($1, $2, 1, $3::jsonb, true, null, $4::jsonb)`, [m, round, sideAt(t2), JSON.stringify({ triples: 0, quests: ['q' + round] })]);
    };
    const outcomes = ['p2', 'draw', 'p1'] as const; // A loses, draws, wins
    for (let round = 1; round <= 3; round++) {
      await lock(round, round + 1, round + 2);
      await commit(m, round, outcomes[round - 1]!);
      const r = (await db.query<any>('select p1_scout, p2_scout from public.versus_rounds where match_id = $1 and round = $2', [m, round])).rows[0];
      // The tier is the LOCKED side's (the client said 99), the rest is the lock's scout, on every outcome.
      expect(r.p1_scout).toEqual({ tier: round + 1, triples: round, runes: ['r' + round] });
      expect(r.p2_scout).toEqual({ tier: round + 2, triples: 0, quests: ['q' + round] });
      await as(A, `select public.versus_combat_ready($1, $2)`, [m, round]);
      await as(B, `select public.versus_combat_ready($1, $2)`, [m, round]);
    }
    // The old 6-argument submit still works (an older client): the round then records the tier alone.
    await as(A, `select public.versus_submit($1, 4, 1, $2::jsonb, true, null)`, [m, sideAt(5)]);
    await as(B, `select public.versus_submit($1, 4, 1, $2::jsonb, true, null)`, [m, sideAt(6)]);
    await commit(m, 4, 'draw');
    const r4 = (await db.query<any>('select p1_scout, p2_scout from public.versus_rounds where match_id = $1 and round = 4', [m])).rows[0];
    expect([r4.p1_scout, r4.p2_scout]).toEqual([{ tier: 5 }, { tier: 6 }]);
  });

  it('round 1 clock: a stuck client cannot stall it (the intro cap starts it through reconcile)', async () => {
    const [room, m] = await startMatch();
    await as(A, `select public.versus_register_offer($1, array['warden','indy','keshi'])`, [m]);
    await as(B, `select public.versus_register_offer($1, array['indy','warden','keshi'])`, [m]);
    await as(A, `select public.versus_pick_hero($1, 0)`, [m]);
    await as(B, `select public.versus_pick_hero($1, 0)`, [m]);
    await as(A, `select public.versus_intro_done($1)`, [m]);
    at(30);
    await beat(room, A, B);
    await as(A, `select public.versus_reconcile($1)`, [m]);
    expect((await match(m)).shop_deadline).toBeNull();
    at(K.VERSUS_INTRO_CAP_SECONDS - 30);
    await beat(room, A, B);
    await as(A, `select public.versus_reconcile($1)`, [m]);
    const row = await match(m);
    expect(Date.parse(row.shop_starts_at)).toBe(clock);
  });

  it('the next shop opens the moment both players are back from the fight, with its clock starting then', async () => {
    const [, m] = await startMatch();
    await toShop(m);
    await lockBoth(m, 1);
    await commit(m, 1, 'draw');
    await as(A, `select public.versus_combat_ready($1, 1)`, [m]);
    expect((await match(m)).phase).toBe('combat');
    at(7);
    await as(B, `select public.versus_combat_ready($1, 1)`, [m]);
    const row = await match(m);
    expect([row.phase, row.round]).toEqual(['shop', 2]);
    expect(Date.parse(row.shop_starts_at)).toBe(clock);
    expect(Date.parse(row.shop_deadline) - clock).toBe((await as<number>(A, 'select public.versus_turn_seconds(2)')) * 1000);
  });

  it('Hero Select timeout: a deterministic pick from the seat\'s own three', async () => {
    const [room, m] = await startMatch();
    await as(A, `select public.versus_register_offer($1, array['warden','indy','keshi'])`, [m]);
    await as(B, `select public.versus_register_offer($1, array['indy','warden','keshi'])`, [m]);
    await as(A, `select public.versus_pick_hero($1, 0)`, [m]);
    at(21);
    await beat(room, A, B);
    await as(A, `select public.versus_reconcile($1)`, [m]);
    const row = await match(m);
    expect(row.phase).toBe('shop');
    expect(row.p1_hero).toBe('warden');
    expect(['indy', 'warden', 'keshi']).toContain(row.p2_hero);
    const auto = await db.query<{ hero_auto: boolean; seat: string }>(`select seat, hero_auto from public.versus_seat_private where match_id = $1 order by seat`, [m]);
    expect(auto.rows.map((r) => r.hero_auto)).toEqual([false, true]);
  });

  it('a round: locks are irreversible, both locks → resolving, the commit strikes one heart, retries change nothing', async () => {
    const [, m] = await startMatch();
    await toShop(m);
    await as(A, `select public.versus_submit($1, 1, 1, $2::jsonb, true, null)`, [m, SIDE(1)]);
    expect(await fails(A, `select public.versus_submit($1, 1, 2, $2::jsonb, false, null)`, [m, SIDE(9)])).toMatch(/already_locked/);
    expect((await match(m)).phase).toBe('shop'); // early lock never shortens the other's turn
    await as(B, `select public.versus_submit($1, 1, 1, $2::jsonb, true, null)`, [m, SIDE(2)]);
    expect((await match(m)).phase).toBe('resolving');
    expect(await fails(A, `select public.versus_commit_round($1, 1, 'p1', 'p1', 'p2', '{}', '{}', 'd')`, [m])).toMatch(/permission denied/);
    const c1 = await commit(m, 1, 'p1');
    expect(c1.alreadyCommitted).toBe(false);
    const c2 = await commit(m, 1, 'p1');
    expect(c2.alreadyCommitted).toBe(true);
    const row = await match(m);
    expect([row.phase, row.p1_hearts, row.p2_hearts]).toEqual(['combat', VERSUS_HEARTS, VERSUS_HEARTS - 1]);
    expect(await fails(A, `select public.versus_submit($1, 1, 3, $2::jsonb, true, null)`, [m, SIDE(1)])).toMatch(/stale_round/);
  });

  it('a draw strikes nobody', async () => {
    const [, m] = await startMatch();
    await toShop(m);
    await lockBoth(m, 1);
    await commit(m, 1, 'draw');
    const row = await match(m);
    expect([row.p1_hearts, row.p2_hearts]).toEqual([VERSUS_HEARTS, VERSUS_HEARTS]);
  });

  it('the combat barrier: both ready (never a spectator) or the cap opens the next shop', async () => {
    const [room, m] = await startMatch();
    await as(C, `select public.versus_join_room($1, 'spectator', 'Cat', '{}', 'rev1', 1)`, [room]);
    await toShop(m);
    await lockBoth(m, 1);
    await commit(m, 1, 'p2');
    expect(await fails(C, `select public.versus_combat_ready($1, 1)`, [m])).toMatch(/not_a_player/);
    await as(A, `select public.versus_combat_ready($1, 1)`, [m]);
    expect((await match(m)).phase).toBe('combat');
    await as(B, `select public.versus_combat_ready($1, 1)`, [m]);
    let row = await match(m);
    expect([row.phase, row.round]).toEqual(['shop', 2]);
    await lockBoth(m, 2);
    await commit(m, 2, 'p2');
    at(91);
    await beat(room, A, B);
    await as(C, `select public.versus_reconcile($1)`, [m]);
    row = await match(m);
    expect([row.phase, row.round]).toEqual(['shop', 3]);
  });

  it('the shop deadline promotes the newest candidate; a seat with none fights its last locked board', async () => {
    const [room, m] = await startMatch();
    await toShop(m);
    await lockBoth(m, 1);
    await commit(m, 1, 'draw');
    await as(A, `select public.versus_combat_ready($1, 1)`, [m]);
    await as(B, `select public.versus_combat_ready($1, 1)`, [m]);
    await as(A, `select public.versus_submit($1, 2, 1, $2::jsonb, false, null)`, [m, SIDE(5)]);
    await as(A, `select public.versus_submit($1, 2, 2, $2::jsonb, false, null)`, [m, SIDE(6)]);
    await as(A, `select public.versus_submit($1, 2, 1, $2::jsonb, false, null)`, [m, SIDE(4)]); // stale, ignored
    at(3 + 22 + 1);
    await beat(room, A, B);
    expect(await fails(A, `select public.versus_submit($1, 2, 3, $2::jsonb, true, null)`, [m, SIDE(7)])).toMatch(/deadline_passed/);
    await as(B, `select public.versus_reconcile($1)`, [m]);
    expect((await match(m)).phase).toBe('resolving');
    const subs = await db.query<{ seat: string; source: string; side: any }>(`select seat, source, prepared_side side from public.versus_submissions where match_id = $1 and round = 2 order by seat`, [m]);
    expect(subs.rows.map((r) => [r.seat, r.source, r.side.board[0].attack])).toEqual([['p1', 'deadline', 6], ['p2', 'auto', 2]]);
  });

  it('seven lost rounds end the match; the room returns to Open with everyone in it', async () => {
    const [room, m] = await startMatch();
    await toShop(m);
    for (let round = 1; round <= VERSUS_HEARTS; round++) {
      await lockBoth(m, round);
      await commit(m, round, 'p1');
      const row = await match(m);
      if (round < VERSUS_HEARTS) {
        await as(A, `select public.versus_combat_ready($1, $2)`, [m, round]);
        await as(B, `select public.versus_combat_ready($1, $2)`, [m, round]);
      } else {
        expect([row.phase, row.winner_seat, row.end_reason, row.p2_hearts]).toEqual(['complete', 'p1', 'hearts', 0]);
      }
    }
    const r = await as<any>(A, `select public.versus__room_json($1)`, [room]).catch(() => null);
    expect(r).toBeNull(); // helpers are not callable by clients
    const rooms = await as<any[]>(A, `select public.versus_list_rooms()`);
    expect(rooms[0]).toMatchObject({ status: 'open', players: 2 });
    // A fresh match can start in the same room.
    await as(A, `select public.versus_start_game($1)`, [room]);
  });

  it('disconnect: the clock pauses; the returning player unpauses with a 3-2-1, every deadline shifted by the whole pause', async () => {
    const [room, m] = await startMatch();
    await toShop(m);
    const before = await match(m);
    at(13);
    await beat(room, A); // B silent past the 12 s lease
    await as(A, `select public.versus_reconcile($1)`, [m]);
    let row = await match(m);
    expect(row.paused_seat).toBe('p2');
    at(20);
    expect(await fails(A, `select public.versus_unpause($1)`, [m])).toMatch(/grace_running/);
    await beat(room, B); // back: still paused until B presses Unpause
    await as(A, `select public.versus_reconcile($1)`, [m]);
    expect((await match(m)).paused_seat).toBe('p2');
    expect(await fails(A, `select public.versus_request_resume($1)`, [m])).toMatch(/not_your_pause/);
    at(2);
    await as(B, `select public.versus_request_resume($1)`, [m]);
    row = await match(m);
    expect([row.paused_seat, Date.parse(row.resume_at) - clock]).toEqual(['p2', 3000]);
    at(2);
    await as(A, `select public.versus_reconcile($1)`, [m]);
    expect((await match(m)).paused_at).not.toBeNull(); // the countdown is still running
    at(1);
    await beat(room, A, B);
    await as(A, `select public.versus_reconcile($1)`, [m]);
    row = await match(m);
    expect([row.paused_at, row.resume_at]).toEqual([null, null]);
    expect(Date.parse(row.shop_deadline) - Date.parse(before.shop_deadline)).toBe(25_000); // 20 + 2 + 3: froze, resumed
  });

  it('End Combat: the first one back gives the other 5 s, then the next shop opens for both', async () => {
    const [, m] = await startMatch();
    await toShop(m);
    await lockBoth(m, 1);
    await commit(m, 1, 'draw');
    await as(A, `select public.versus_combat_ready($1, 1)`, [m]);
    let row = await match(m);
    expect([row.phase, Date.parse(row.combat_deadline) - clock]).toEqual(['combat', 5000]);
    at(4);
    await as(A, `select public.versus_reconcile($1)`, [m]);
    expect((await match(m)).phase).toBe('combat');
    at(1);
    await as(A, `select public.versus_reconcile($1)`, [m]);
    row = await match(m);
    expect([row.phase, row.round, Date.parse(row.shop_starts_at)]).toEqual(['shop', 2, clock]);
  });

  it('disconnect past the grace: the opponent unpauses, the absent board auto-plays, 3 missed rounds forfeit', async () => {
    const [room, m] = await startMatch();
    await toShop(m);
    await lockBoth(m, 1);
    await commit(m, 1, 'draw');
    await as(A, `select public.versus_combat_ready($1, 1)`, [m]);
    await as(B, `select public.versus_combat_ready($1, 1)`, [m]);
    at(13);
    await beat(room, A);
    await as(A, `select public.versus_reconcile($1)`, [m]);
    at(31);
    await beat(room, A);
    expect(await fails(B, `select public.versus_unpause($1)`, [m])).toMatch(/cannot_unpause_own_absence/);
    await as(A, `select public.versus_unpause($1)`, [m]);
    at(3); // the 3-2-1
    await beat(room, A);
    await as(A, `select public.versus_reconcile($1)`, [m]);
    let row = await match(m);
    expect([row.paused_at, row.p2_auto]).toEqual([null, true]);
    for (let round = 2; round <= 4; round++) {
      await as(A, `select public.versus_submit($1, $2, 1, $3::jsonb, true, null)`, [m, round, SIDE(3)]);
      row = await match(m);
      expect(row.phase).toBe('resolving'); // the auto seat never holds the present player up
      const sub = await db.query<{ source: string }>(`select source from public.versus_submissions where match_id = $1 and round = $2 and seat = 'p2'`, [m, round]);
      expect(sub.rows[0]!.source).toBe('auto');
      await commit(m, round, 'draw');
      row = await match(m);
      if (round < 4) {
        await beat(room, A);
        await as(A, `select public.versus_combat_ready($1, $2)`, [m, round]);
      }
    }
    expect([row.phase, row.winner_seat, row.end_reason]).toEqual(['complete', 'p1', 'missed']);
  });

  it('a returning auto player leaves auto and the missed count resets', async () => {
    const [room, m] = await startMatch();
    await toShop(m);
    at(13);
    await beat(room, A);
    await as(A, `select public.versus_reconcile($1)`, [m]);
    at(31);
    await beat(room, A);
    await as(A, `select public.versus_unpause($1)`, [m]);
    at(3);
    await beat(room, A);
    await as(A, `select public.versus_reconcile($1)`, [m]);
    await beat(room, B);
    const row = await match(m);
    expect([row.p2_auto, row.p2_missed]).toEqual([false, 0]);
  });

  it('leaving mid-match forfeits; the room survives for the rest', async () => {
    const [room, m] = await startMatch();
    await as(C, `select public.versus_join_room($1, 'spectator', 'Cat', '{}', 'rev1', 1)`, [room]);
    await as(A, `select public.versus_leave_room($1)`, [room]);
    const row = await match(m);
    expect([row.phase, row.winner_seat, row.end_reason]).toEqual(['complete', 'p2', 'forfeit']);
    const r = await as<any[]>(C, `select public.versus_list_rooms()`);
    expect(r[0]).toMatchObject({ status: 'open', players: 1, spectators: 1 });
  });

  it('candidates and private rows are owner-only; rounds and matches are public', async () => {
    const [, m] = await startMatch();
    await toShop(m);
    await as(A, `select public.versus_submit($1, 1, 1, $2::jsonb, false, null)`, [m, SIDE(1)]);
    expect(await as<number>(B, `select count(*)::int from public.versus_submissions where seat = 'p1'`)).toBe(0);
    expect(await as<number>(A, `select count(*)::int from public.versus_submissions where seat = 'p1'`)).toBe(1);
    expect(await fails(A, `insert into public.versus_rounds (match_id, round, chair, outcome, p1_result, p2_result, digest, p1_hearts, p2_hearts) values ($1, 1, 'p1', 'draw', '{}', '{}', 'x', 7, 7)`, [m])).toMatch(/permission denied/);
    expect(await as<number>(C, `select count(*)::int from public.versus_matches`)).toBe(1);
  });
});

describe('Versus SQL mirrors the TS constants', () => {
  it('hearts, windows, caps and byte limits match constants.ts', () => {
    expect(MIGRATION).toContain(`p1_hearts          int  not null default ${K.VERSUS_HEARTS}`);
    expect(MIGRATION).toContain(`interval '${K.VERSUS_HERO_SELECT_SECONDS} seconds'`);
    expect(MIGRATION).toContain(`gate_deadline = public.versus_clock() + interval '${K.VERSUS_GATE_SECONDS} seconds'`);
    expect(MIGRATION).toContain(`pause_grace_until = v_now + interval '${K.VERSUS_PAUSE_GRACE_SECONDS} seconds'`);
    expect(MIGRATION).toContain(`missed >= ${K.VERSUS_MISSED_ROUNDS_FORFEIT}`);
    expect(MIGRATION).toContain(`>= ${K.VERSUS_SPECTATOR_CAP} then raise exception 'spectators_full'`);
    expect(MIGRATION).toContain(`interval '${K.VERSUS_INTRO_CAP_SECONDS} seconds'`);
    expect(MIGRATION).toContain(`interval '${K.VERSUS_COMBAT_VIEW_CAP_SECONDS} seconds'`);
    expect(MIGRATION).toContain(`interval '${K.VERSUS_LEASE_SECONDS} seconds'`);
    expect(MIGRATION).toContain(`<= ${K.VERSUS_LIMITS.preparedSideBytes}`);
    expect(MIGRATION).toContain(`<= ${K.VERSUS_LIMITS.spectatorFrameBytes}`);
  });
});

describe('Versus finalize (the Edge Function handler) against the real SQL', () => {
  const FIXTURE = JSON.parse(readFileSync(join(__dirname, 'fixtures/parity.v1.json'), 'utf8')) as { cases: { p1: unknown; p2: unknown }[] };
  const store: VersusFinalizeStore = {
    async match(id) {
      const r = await db.query<any>('select id, phase, round, seed, content_revision, p1_user, p2_user from public.versus_matches where id = $1', [id]);
      return r.rows[0] ?? null;
    },
    async finalSides(matchId, round) {
      const r = await db.query<any>('select seat, prepared_side, final from public.versus_submissions where match_id = $1 and round = $2', [matchId, round]);
      const out: Record<'p1' | 'p2', unknown> = { p1: null, p2: null };
      for (const row of r.rows) if (row.final) out[row.seat as 'p1' | 'p2'] = row.prepared_side;
      return out;
    },
    async commit(a) {
      return as(null, 'select public.versus_commit_round($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)',
        [a.p_match, a.p_round, a.p_chair, a.p_outcome, a.p_heart_lost_by, JSON.stringify(a.p_p1), JSON.stringify(a.p_p2), a.p_digest]);
    },
    log: () => undefined,
  };

  it('fights the two stored sides once, commits idempotently, and refuses a stale engine', async () => {
    const [, m] = await startMatch();
    await db.query(`update public.versus_matches set content_revision = $2 where id = $1`, [m, contentRevision()]);
    await toShop(m);
    const c = FIXTURE.cases[6]!;
    await as(A, `select public.versus_submit($1, 1, 1, $2::jsonb, true, null)`, [m, JSON.stringify(c.p1)]);
    expect((await handleVersusFinalize(A, { matchId: m, round: 1 }, contentRevision(), store)).body.status).toBe('not_resolving');
    await as(B, `select public.versus_submit($1, 1, 1, $2::jsonb, true, null)`, [m, JSON.stringify(c.p2)]);
    expect((await handleVersusFinalize(A, { matchId: m, round: 1 }, 'other', store)).status).toBe(409);
    const [x, y] = await Promise.all([
      handleVersusFinalize(A, { matchId: m, round: 1 }, contentRevision(), store),
      handleVersusFinalize(B, { matchId: m, round: 1 }, contentRevision(), store),
    ]);
    expect([x.status, y.status]).toEqual([200, 200]);
    const rounds = await db.query<any>('select outcome, heart_lost_by, p1_hearts, p2_hearts from public.versus_rounds where match_id = $1', [m]);
    expect(rounds.rows).toHaveLength(1);
    const row = await match(m);
    expect(row.phase === 'combat' || row.phase === 'complete').toBe(true);
    const lost = rounds.rows[0].heart_lost_by;
    expect([row.p1_hearts, row.p2_hearts]).toEqual([VERSUS_HEARTS - (lost === 'p1' ? 1 : 0), VERSUS_HEARTS - (lost === 'p2' ? 1 : 0)]);
    expect((await handleVersusFinalize(null, { matchId: m, round: 1 }, contentRevision(), store)).status).toBe(401);
  });
});
