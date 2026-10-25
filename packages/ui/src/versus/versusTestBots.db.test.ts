/**
 * THE TEST BOTS IN EVERY SEAT + THE DUOS DEV TUNER'S SERVER SIDE, against the real SQL (PGlite) and the real
 * `finalize_duos` handler (owner 2026-10-25: "id like the ability to test the various mechanics with bots").
 *
 *  - 2026-10-25-versus-test-bots.sql: only an anonymous account registers as a bot; the dev RPCs (hearts, skip the
 *    shop) open only to the room's host on a table of that host's own bots, and mark the match
 *    `dev_forced`; no XP row is ever written for a bot or for a forced match.
 *  - Four `VersusBotDriver`s (through `makeBotMatchApi`, the adapter the browser uses) fill a Duos room, gate, pick,
 *    shop, lock and play it to the end; a bot passes to its teammate bot through the real pass RPCs and run actions
 *    (landed), and the armed full-hand race comes back refused and refunded.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentRevision } from '@game/content';
import { handleVersusDuosFinalize, type VersusDuosFinalizeStore } from '@game/sim/versus/server';
import type { VersusGroupSeat } from '@game/sim';
import { VersusBotDriver } from './versusBotDriver';
import { withAddedCard } from './duosDevTuner';
import { makeBotMatchApi, type BotRemote } from './versusBotApi';
import { groupSeatOfRow, VersusError, type VersusGroupFightRow, type VersusGroupMatchRaw, type VersusRoom } from './versusRemote';

const root = join(__dirname, '../../../..');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql', '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql',
];
const BASE = FILES.map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8')).join('\n');
const BOTS = readFileSync(join(root, 'supabase/migrations/2026-10-25-versus-test-bots.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant select on auth.users to authenticated;
  -- The progression ledger, as far as the no-XP trigger reads it.
  create table public.progression_results (user_id uuid not null, run_id text not null, mode text not null, primary key (user_id, run_id, mode));
`;
const U = (n: number): string => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const HOST = U(1);
const [B2, B3, B4, STRANGER] = [U(2), U(3), U(4), U(9)] as [string, string, string, string];
const ALL = [HOST, B2, B3, B4];
const OPT_DUOS = { v: 1, mode: 'duos', modifiers: [] };

let db: PGlite;
let clock = Date.parse('2026-10-25T12:00:00Z');
let queue: Promise<unknown> = Promise.resolve();

function as<T = any>(user: string | null, sql: string, params: unknown[] = []): Promise<T> {
  const run = async (): Promise<T> => {
    await db.exec(`set versus.test_now = '${new Date(clock).toISOString()}'`);
    await db.exec(user ? `select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;` : `select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
    try {
      const r = await db.query<Record<string, unknown>>(sql, params);
      const row = r.rows[0];
      return (row ? Object.values(row)[0] : undefined) as T;
    } catch (e) {
      // The browser's remote raises a VersusError with the SQL's code; so does this one.
      const msg = (e as Error).message;
      throw new VersusError(msg.replace(/^.*?([a-z_]+)$/, '$1'), msg);
    } finally {
      await db.exec('reset role');
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}
const rows = async <T,>(sql: string, params: unknown[] = []): Promise<T[]> => { await queue; return (await db.query<T>(sql, params)).rows; };
async function fails(user: string | null, sql: string, params: unknown[] = []): Promise<string> {
  try { await as(user, sql, params); } catch (e) { return (e as Error).message; }
  return 'did not fail';
}

const store: VersusDuosFinalizeStore = {
  async match(id) { return (await rows<any>('select id, phase, round, seed, content_revision, duos_first, options from public.versus_group_matches where id = $1', [id]))[0] ?? null; },
  async finalSides(matchId, round) {
    const out: Partial<Record<VersusGroupSeat, unknown>> = {};
    for (const r of await rows<any>('select seat, prepared_side, final from public.versus_group_submissions where match_id = $1 and round = $2', [matchId, round])) if (r.final) out[r.seat as VersusGroupSeat] = r.prepared_side;
    return out;
  },
  async commit(a) { return as(null, 'select public.versus_duos_commit_round($1, $2, $3::jsonb, $4)', [a.p_match, a.p_round, JSON.stringify(a.p_fight), a.p_digest]); },
  log: () => undefined,
};

const nope = (): never => { throw new VersusError('not_used'); };
async function groupMatch(id: string): Promise<VersusGroupMatchRaw | null> {
  const m = (await rows<any>('select to_jsonb(m) m from public.versus_group_matches m where id = $1', [id]))[0]?.m;
  if (!m) return null;
  const seats = await rows<Record<string, unknown>>('select * from public.versus_group_seats where match_id = $1 order by seat', [id]);
  return { ...m, seats: seats.map(groupSeatOfRow) };
}

/** The bot's remote over PGlite: the same RPCs and reads the browser's remote makes (as that account). */
function remoteFor(user: string): BotRemote {
  return {
    async room(roomId) {
      const r = (await rows<any>('select * from public.versus_rooms where id = $1', [roomId]))[0];
      if (!r) return null;
      const members = await rows<any>('select user_id, role, display_name, profile, last_seen_at from public.versus_members where room_id = $1 order by joined_at', [roomId]);
      return { ...r, members: members.map((m) => ({ userId: m.user_id, role: m.role, displayName: m.display_name, profile: m.profile, lastSeenAt: m.last_seen_at })), serverNow: '' } as VersusRoom;
    },
    pressGate: (roomId) => as(user, 'select public.versus_press_gate($1)', [roomId]),
    heartbeat: (roomId) => as(user, 'select public.versus_heartbeat($1)', [roomId]),
    match: async () => null, // every match here is a Duos (group table) match
    myPrivate: nope, registerOffer: nope, pickHero: nope, submit: nope, combatReady: nope, introDone: nope, requestResume: nope, rounds: nope,
    reconcile: nope, finalize: nope, forfeit: nope, publishFrame: nope, finalizeGroup: nope,
    groupMatch,
    async groupRounds(id, from = 1) {
      const rs = await rows<any>('select round, hearts, eliminated from public.versus_group_rounds where match_id = $1 and round >= $2 order by round', [id, from]);
      const fights = await rows<VersusGroupFightRow>('select * from public.versus_group_fights where match_id = $1 and round >= $2 order by round, fight', [id, from]);
      return rs.map((r) => ({ round: r.round, hearts: r.hearts, eliminated: r.eliminated, fights: fights.filter((f) => f.round === r.round) }));
    },
    async groupMyPrivate(id) { return (await rows<any>('select * from public.versus_group_seat_private where match_id = $1 and user_id = $2', [id, user]))[0] ?? null; },
    groupRegisterOffer: (id, offer) => as(user, 'select public.versus_group_register_offer($1, $2)', [id, offer]),
    groupPickHero: (id, i) => as(user, 'select public.versus_group_pick_hero($1, $2)', [id, i]),
    groupSubmit: (id, round, seq, side, final, ck, scout) => as(user, 'select public.versus_group_submit($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb)',
      [id, round, seq, JSON.stringify(side), final, ck == null ? null : JSON.stringify(ck), scout == null ? null : JSON.stringify(scout)]),
    groupIntroDone: (id) => as(user, 'select public.versus_group_intro_done($1)', [id]),
    groupCombatReady: (id, round) => as(user, 'select public.versus_group_combat_ready($1, $2)', [id, round]),
    groupForfeit: (id) => as(user, 'select public.versus_group_forfeit($1)', [id]),
    groupRequestResume: (id) => as(user, 'select public.versus_group_request_resume($1)', [id]),
    groupReconcile: (id) => as(user, 'select public.versus_group_reconcile($1)', [id]),
    groupPublishFrame: async () => undefined,
    async finalizeDuos(id, round) { await handleVersusDuosFinalize(user, { matchId: id, round }, contentRevision(), store); },
    duosPasses: (id, from) => rows<any>('select match_id, round, from_seat, to_seat, seq, card, status from public.versus_duos_passes where match_id = $1 and round >= $2 order by seq', [id, from]),
    duosPass: (id, round, seq, card) => as(user, 'select public.versus_duos_pass($1, $2, $3, $4::jsonb)', [id, round, seq, JSON.stringify(card)]),
    duosAnswerPass: (id, from, seq, landed) => as(user, 'select public.versus_duos_answer_pass($1, $2, $3, $4)', [id, from, seq, landed]),
    duosHandRoom: (id, room) => as(user, 'select public.versus_duos_hand_room($1, $2)', [id, room]),
  } as BotRemote;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(BASE);
  await db.exec(BOTS);
  await db.exec(BOTS); // idempotent
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${HOST}', false), ('${B2}', true), ('${B3}', true), ('${B4}', true), ('${STRANGER}', false)`);
}, 60_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('delete from public.versus_group_matches; delete from public.versus_matches; delete from public.versus_rooms; delete from public.versus_test_bots; delete from public.progression_results;');
});

/** A Duos room hosted by HOST with the three bots seated (and, optionally, registered as HOST's bots). */
async function duosRoom(register = true): Promise<string> {
  const room = await as<any>(HOST, `select public.versus_create_room('Bots', 'Host', '{}', 'set2', $1, 1, $2::jsonb)`, [contentRevision(), JSON.stringify(OPT_DUOS)]);
  for (const [i, b] of [B2, B3, B4].entries()) {
    if (register) await as(b, 'select public.versus_test_bot_register($1, $2)', [HOST, i + 1]);
    await as(b, `select public.versus_join_room($1, 'player', $2, '{}', $3, 1)`, [room.id, `Test Bot ${i + 1}`, contentRevision()]);
  }
  return room.id;
}

const drivers = (roomId: string, opts: Partial<Record<string, { maxActions?: number }>> = {}): VersusBotDriver[] =>
  ALL.map((u, i) => new VersusBotDriver(makeBotMatchApi(remoteFor(u), () => u), roomId, { userId: u, now: () => clock, seed: 11 + i, beatMs: 3000, passPollMs: 500, ...opts[u] }));

async function stepAll(ds: VersusBotDriver[], until: () => Promise<boolean>, max = 4000): Promise<void> {
  for (let i = 0; i < max; i++) {
    for (const d of ds) await d.step();
    clock += 500;
    if (await until()) return;
  }
  const m = await theMatch();
  const seats = m ? await rows<any>('select seat, locked, ready, intro, hearts, auto from public.versus_group_seats where match_id = $1 order by seat', [m.id]) : [];
  throw new Error(`did not get there: ${JSON.stringify({ phase: m?.phase, round: m?.round, paused: m?.paused_seat, deadline: m?.shop_deadline, seats, runs: ds.map((d) => [d.realSeat, d.run?.phase, d.run?.wave, d.lockedFor]) })}`);
}
const theMatch = async (): Promise<any> => (await rows<any>('select * from public.versus_group_matches'))[0];

describe('test bot registry (2026-10-25-versus-test-bots.sql)', () => {
  it('only an anonymous account registers as a bot, never as its own host', async () => {
    expect(await fails(STRANGER, 'select public.versus_test_bot_register($1, 1)', [HOST])).toMatch(/not_anonymous/);
    expect(await fails(B2, 'select public.versus_test_bot_register($1, 1)', [B2])).toMatch(/bad_host/);
    expect(await fails(B2, 'select public.versus_test_bot_register($1, 4)', [HOST])).toMatch(/bad_slot/);
    await as(B2, 'select public.versus_test_bot_register($1, 1)', [HOST]);
    await as(B2, 'select public.versus_test_bot_register($1, 2)', [HOST]); // re-registering moves it, never a second row
    expect(await rows('select bot_user, host_user, slot from public.versus_test_bots')).toEqual([{ bot_user: B2, host_user: HOST, slot: 2 }]);
  });
});

describe('the bots fill a Duos room and play it through (the browser adapter over the real SQL)', () => {
  it('four bots gate, pick, shop, lock and play a Duos match to its end; hearts are by team', async () => {
    const roomId = await duosRoom();
    // Team b never buys: team a's random minions win.
    const ds = drivers(roomId, { [B3]: { maxActions: 0 }, [B4]: { maxActions: 0 } });
    await as(HOST, 'select public.versus_start_game($1)', [roomId]);
    await stepAll(ds, async () => (await theMatch())?.phase === 'complete', 8000);
    const m = await theMatch();
    const seats = await rows<any>('select seat, team, hearts, placement from public.versus_group_seats where match_id = $1 order by seat', [m.id]);
    expect(seats.map((s) => s.placement)).toEqual([1, 1, 2, 2]);
    expect(seats[0].hearts).toBe(seats[1].hearts);
    expect(seats[2].hearts).toBe(0);
    // The bots' own runs agree with the server's rounds (each from its own seat).
    const n = (await rows<any>('select count(*)::int n from public.versus_group_rounds where match_id = $1', [m.id]))[0].n;
    expect(ds[0]!.run!.history.length).toBeGreaterThanOrEqual(n - 1);
    expect(ds[0]!.realSeat).toBe('p1');
    expect(ds[3]!.realSeat).toBe('p4');
  }, 240_000);

  it('a bot passes to its teammate bot (landed, 1 Gold); an armed full-hand race comes back refused and refunded', async () => {
    const roomId = await duosRoom();
    const ds = drivers(roomId);
    for (const d of ds) d.hooks = { holdLock: () => true }; // the shop stays open while the passes fly
    await as(HOST, 'select public.versus_start_game($1)', [roomId]);
    const [p1, p2] = [ds[0]!, ds[1]!];
    await stepAll(ds, async () => (await theMatch())?.phase === 'shop' && !!(await theMatch()).shop_deadline && !!p1.run?.duos && !!p2.run?.duos);
    const gold = p1.run!.embers;
    p1.edit((r) => withAddedCard({ ...r, embers: Math.max(r.embers, 2) }, 'sandbag', 'hand'));
    expect(p1.forcePass()).toBeNull();
    await stepAll(ds, async () => (await rows<any>(`select status from public.versus_duos_passes where seq = 0`))[0]?.status === 'landed');
    expect(p2.run!.duos!.received).toEqual(['p1:0']);
    expect(p2.run!.hand.some((c) => c.passedWave === p2.run!.wave)).toBe(true);
    expect(p1.run!.embers).toBe(Math.max(gold, 2) - 1);
    // The race: the server takes the pass (one slot reported), then the hand fills before it lands.
    p2.raceArmed = true;
    await stepAll(ds, async () => true); // the armed room goes up first
    p1.edit((r) => withAddedCard(r, 'sandbag', 'hand'));
    expect(p1.forcePass()).toBeNull();
    await stepAll(ds, async () => !!p1.run!.duos!.outbox[1]?.refunded);
    expect((await rows<any>('select status from public.versus_duos_passes where seq = 1'))[0].status).toBe('refused');
    expect(p2.run!.duos!.refused).toEqual(['p1:1']);
    // The bot never passes on its own (only the tuner's forcePass sends one).
    let n = 0;
    await stepAll(ds, async () => ++n >= 40);
    expect(p2.run!.duos!.outbox).toHaveLength(0);
  }, 240_000);
});

describe('the dev forcing RPCs', () => {
  async function running(register = true): Promise<string> {
    const roomId = await duosRoom(register);
    await as(HOST, 'select public.versus_start_game($1)', [roomId]);
    for (const u of ALL) await as(u, 'select public.versus_press_gate($1)', [roomId]);
    const m = await theMatch();
    for (const u of ALL) await as(u, `select public.versus_group_register_offer($1, array['warden','indy','keshi'])`, [m.id]);
    for (const u of ALL) await as(u, `select public.versus_group_pick_hero($1, 0)`, [m.id]);
    for (const u of ALL) await as(u, `select public.versus_group_intro_done($1)`, [m.id]);
    expect((await theMatch()).shop_deadline).toBeTruthy();
    return m.id;
  }

  it('host only, on a table of only the host\'s bots; using one marks the match dev_forced', async () => {
    const id = await running();
    expect((await theMatch()).dev_forced).toBe(false);
    expect(await fails(B2, 'select public.versus_dev_set_hearts($1, $2, 3)', [id, 'p1'])).toMatch(/not_host/);
    await as(HOST, `select public.versus_dev_set_hearts($1, 'p3', 2)`, [id]);
    const seats = await rows<any>('select seat, hearts from public.versus_group_seats where match_id = $1 order by seat', [id]);
    expect(seats.map((s) => s.hearts)).toEqual([7, 7, 2, 2]); // Duos: the team's hearts, both seats
    expect((await rows<any>(`select hearts from public.versus_group_teams where match_id = $1 and team = 'b'`, [id]))[0].hearts).toBe(2);
    expect((await theMatch()).dev_forced).toBe(true);
    expect(await fails(HOST, `select public.versus_dev_set_hearts($1, 'p1', 0)`, [id])).toMatch(/bad_hearts/);
  });

  it('refuses a table with anyone who is not one of the host\'s bots', async () => {
    const id = await running(false);
    expect(await fails(HOST, 'select public.versus_dev_skip_shop($1)', [id])).toMatch(/not_a_test_table/);
    expect((await theMatch()).dev_forced).toBe(false);
  });

  it('skip the shop: the clock jumps to 5 seconds (or stays, if less is left)', async () => {
    const id = await running();
    await as(HOST, 'select public.versus_dev_skip_shop($1)', [id]);
    expect(new Date((await theMatch()).shop_deadline).getTime()).toBe(clock + 5000);
    clock += 3000;
    await as(HOST, 'select public.versus_dev_skip_shop($1)', [id]);
    expect(new Date((await theMatch()).shop_deadline).getTime()).toBe(clock + 2000);
  });

  it('no XP: a row for a bot, or for a forced match, is refused; an ordinary one goes in', async () => {
    const id = await running();
    await as(HOST, 'select public.versus_dev_skip_shop($1)', [id]);
    const put = (u: string, run: string) => rows(`insert into public.progression_results (user_id, run_id, mode) values ($1, $2, 'versus')`, [u, run]);
    await expect(put(HOST, `versus:${id}`)).rejects.toThrow(/source_not_found/);
    await expect(put(STRANGER, `watch:group:${id}`)).rejects.toThrow(/source_not_found/);
    await expect(put(B2, 'versus:00000000-0000-0000-0000-000000000abc')).rejects.toThrow(/source_not_found/);
    await put(HOST, 'versus:00000000-0000-0000-0000-000000000abc');
    expect((await rows<any>('select count(*)::int n from public.progression_results'))[0].n).toBe(1);
  });
});
