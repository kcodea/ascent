import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseProgressionResult, spectateRunId, versusLobbyPlacement, versusRunId, xpForSettlement, type ProgressionResult, type SpectateKind } from './rules';
import { settlementParity, validateSubmitBody, SQL_ERROR_STATUS } from './server';

/**
 * VERSUS + SPECTATOR XP, EXECUTED (owner 2026-10-24: "versus modes should grant account xp. just make it 50% of a
 * 'normal' game for now / also add this for spectating - watching a player's game rewards 50% of the xp at the end of
 * the match"; R-PROG-VERSUS-XP-01, R-PROG-SPECTATE-XP-01). PGlite runs the progression chain in production order through
 * the 2026-10-20 milestone file, the live-game and Versus Group files, then 2026-10-24-versus-spectator-xp.sql (twice:
 * idempotent), and settles real rows: 1v1 and Group players at half the Ranked XP for the lobby-scale placement, a
 * spectator who watched to the end at half a game's completion XP, and every refusal of the watch evidence.
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = [
  '2026-09-27-account-progression.sql', '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql',
  '2026-09-29-crate-fixed-rarity-odds.sql', '2026-09-29-crate-uniform-within-rarity.sql', '2026-09-29-gauntlet-progress.sql', '2026-10-02-ancient-rarity.sql',
  '2026-10-03-placement-xp.sql', '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-14-versus-progression.sql', '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
];
const STARTER_CHECK = ((t: string): string => t.slice(0, t.indexOf('-- ── 2. equip_cosmetic')))(read('2026-10-13-emotes.sql'));
const LATER = ['2026-10-18-aether.sql', '2026-10-19-aether-launch-grant.sql', '2026-10-20-milestone-chests-epic.sql', '2026-10-15-lobby-live.sql',
  '2026-10-15-lobby-live-watcher-identity.sql', '2026-10-24-versus-group.sql'];
const MINE = read('2026-10-24-versus-spectator-xp.sql');
/** Versus Duos (2026-10-25): its migration, then its XP file (the newest settle_progression: placement by TEAM). The
 *  1v1 / Group / spectate cases below run against it, so they prove the Duos branch changed nothing else. */
const DUOS = read('2026-10-25-versus-duos.sql');
const DUOS_XP = read('2026-10-25-versus-duos-xp.sql');

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.profiles (user_id uuid primary key references auth.users(id), rating int not null default 0,
    rank_highest_division int not null default 0, updated_at timestamptz not null default now());
  alter table public.profiles enable row level security;
  create table public.rank_results (user_id uuid, run_id text, placement int, seed bigint, created_at timestamptz default now(),
    promoted boolean not null default false, division_before int not null default 0, was_demotion_game boolean not null default false,
    demoted boolean not null default false, lobby_strength int, primary key (user_id, run_id));
  create table public.run_history (user_id uuid, mode text, entry jsonb, wins int, created_at timestamptz default now());
  create table public.practice_games (id bigserial primary key, user_id uuid, hero_id text, placement int, config jsonb, record jsonb, created_at timestamptz default now());
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;
const API_GRANTS = `grant select, insert, update, delete on all tables in schema public to anon, authenticated;`;

let db: PGlite;
let seq = 0;
const U = (n: number): string => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const [P1, P2, P3, P4, FAN, FAN2] = [1, 2, 3, 4, 5, 6].map(U) as [string, string, string, string, string, string];
const uuid = (): string => `22222222-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

async function settle(user: string, mode: 'versus' | 'spectate', runId: string): Promise<{ status: string; result: ProgressionResult }> {
  const r = await db.query<{ j: { status: string; result: unknown } }>('select public.settle_progression($1, $2, $3, null, false, 1, null) as j', [user, mode, runId]);
  return { status: r.rows[0]!.j.status, result: parseProgressionResult(r.rows[0]!.j.result)! };
}
async function raises(sql: string, params: unknown[]): Promise<string> {
  try { await db.query(sql, params); } catch (e) { return (e as Error).message; }
  return 'no error';
}
const settleFails = (user: string, mode: string, runId: string): Promise<string> =>
  raises('select public.settle_progression($1, $2, $3, null, false, 1, null)', [user, mode, runId]);

/** A beat as `user` (the client's `spectate_beat`). */
async function beat(user: string, kind: SpectateKind, target: string): Promise<{ runId: string; watchedMs: number; ended: boolean }> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user]);
  try {
    return (await db.query<{ j: { runId: string; watchedMs: number; ended: boolean } }>('select public.spectate_beat($1, $2) as j', [kind, target])).rows[0]!.j;
  } finally {
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
async function beatFails(user: string, kind: string, target: string): Promise<string> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user]);
  try { return await raises('select public.spectate_beat($1, $2)', [kind, target]); } finally { await db.query(`select set_config('request.jwt.claim.sub', '', false)`); }
}
/** Watch for `seconds`: beats 30 s apart (the presence row is wound back between them; real time does not pass). */
async function watch(user: string, kind: SpectateKind, target: string, seconds: number): Promise<void> {
  await beat(user, kind, target);
  for (let s = 0; s < seconds; s += 30) {
    await db.query(`update public.spectate_presence set at = at - interval '30 seconds' where user_id = $1`, [user]);
    await beat(user, kind, target);
  }
}

async function room(members: Array<[string, string]>): Promise<string> {
  const id = uuid();
  await db.query(`insert into public.versus_rooms (id, name, host_user_id, status, set_id, content_revision, protocol) values ($1, 'Room', $2, 'in_game', 'set3', 'x', 1)`, [id, members[0]![0]]);
  for (const [u, role] of members) {
    await db.query('delete from public.versus_members where user_id = $1', [u]);
    await db.query(`insert into public.versus_members (room_id, user_id, role, display_name) values ($1, $2, $3, 'N')`, [id, u, role]);
  }
  return id;
}
/** A 1v1 match, `minutes` long. Live (phase combat) unless `winner` is given (complete now). */
async function duel(opts: { winner?: 'p1' | 'p2' | null; minutes?: number; rounds?: number; roomId?: string | null }): Promise<string> {
  const id = uuid();
  const complete = opts.winner !== undefined;
  await db.query(
    `insert into public.versus_matches (id, room_id, seed, set_id, content_revision, protocol, phase, round, p1_user, p2_user, p1_name, p2_name, p1_hero, p2_hero, winner_seat, end_reason, created_at, completed_at)
     values ($1, $2, 1, 'set3', 'x', 1, $3, $4, $5, $6, 'A', 'B', 'warden', 'indy', $7, $8, now() - make_interval(mins => $9), case when $3 = 'complete' then now() end)`,
    [id, opts.roomId ?? null, complete ? 'complete' : 'combat', opts.rounds ?? 7, P1, P2, complete ? opts.winner : null, complete ? (opts.winner ? 'hearts' : 'abandoned') : null, opts.minutes ?? 10],
  );
  for (let r = 1; r <= (opts.rounds ?? 7); r++) {
    await db.query(`insert into public.versus_rounds (match_id, round, chair, outcome, heart_lost_by, p1_result, p2_result, digest, p1_hearts, p2_hearts)
      values ($1, $2, 'p1', 'p1', 'p2', '{}', '{}', 'd', 7, 7)`, [id, r]);
  }
  return id;
}
async function finishDuel(id: string, winner: 'p1' | 'p2'): Promise<void> {
  await db.query(`update public.versus_matches set phase = 'complete', winner_seat = $2, end_reason = 'hearts', completed_at = now() where id = $1`, [id, winner]);
}
type GroupSeat = { user: string; placement: number | null; out?: number; reason?: string };
async function group(seats: GroupSeat[], opts: { complete: boolean; rounds?: number; roomId?: string | null; minutes?: number }): Promise<string> {
  const id = uuid();
  await db.query(`insert into public.versus_group_matches (id, room_id, seed, set_id, content_revision, protocol, options, phase, round, seat_count, winner_seat, end_reason, created_at, completed_at)
    values ($1, $2, 1, 'set3', 'x', 1, '{"v":1,"mode":"group","modifiers":[]}', $3, $4, $5, $6, $7, now() - make_interval(mins => $8), case when $3 = 'complete' then now() end)`,
  [id, opts.roomId ?? null, opts.complete ? 'complete' : 'combat', opts.rounds ?? 5, seats.length, opts.complete ? 'p1' : null, opts.complete ? 'hearts' : null, opts.minutes ?? 10]);
  for (const [i, s] of seats.entries()) {
    await db.query(`insert into public.versus_group_seats (match_id, seat, user_id, name, hero, placement, eliminated_round, out_reason) values ($1, $2, $3, 'N', 'warden', $4, $5, $6)`,
      [id, `p${i + 1}`, s.user, s.placement, s.out ?? null, s.reason ?? null]);
  }
  for (let r = 1; r <= (opts.rounds ?? 5); r++) await db.query(`insert into public.versus_group_rounds (match_id, round, digest, hearts) values ($1, $2, 'd', '{}')`, [id, r]);
  return id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const u of [P1, P2, P3, P4, FAN, FAN2]) {
    await db.query('insert into auth.users (id) values ($1)', [u]);
    await db.query('insert into public.profiles (user_id, rating) values ($1, 1234)', [u]);
  }
  for (const f of FILES) { await db.exec(read(f)); await db.exec(API_GRANTS); }
  await db.exec(STARTER_CHECK);
  for (const f of LATER) { await db.exec(read(f)); await db.exec(API_GRANTS); }
  await db.exec(MINE);
  await db.exec(MINE); // idempotent
  await db.exec(DUOS); await db.exec(API_GRANTS);
  await db.exec(DUOS_XP);
  await db.exec(DUOS_XP); // idempotent
  await db.exec("update public.progression_config set epoch = now() - interval '2 days' where id = 1;");
}, 180_000);
afterAll(async () => { await db?.close(); });

/** A Duos match: four seats in two teams with their TEAM placements (1 = winners, 2 = losers). */
async function duos(placements: [number | null, number | null, number | null, number | null], complete: boolean): Promise<string> {
  const id = uuid();
  await db.query(`insert into public.versus_group_matches (id, room_id, seed, set_id, content_revision, protocol, options, phase, round, seat_count, winner_seat, end_reason, created_at, completed_at)
    values ($1, null, 1, 'set3', 'x', 1, '{"v":1,"mode":"duos","modifiers":[]}', $2, 5, 4, $3, $4, now() - make_interval(mins => 10), case when $2 = 'complete' then now() end)`,
  [id, complete ? 'complete' : 'combat', complete ? 'p1' : null, complete ? 'hearts' : null]);
  for (const team of ['a', 'b']) await db.query('insert into public.versus_group_teams (match_id, team, placement) values ($1, $2, $3)', [id, team, team === 'a' ? placements[0] : placements[2]]);
  for (const [i, user] of [P1, P2, P3, P4].entries()) {
    const out = placements[i] === 2;
    await db.query(`insert into public.versus_group_seats (match_id, seat, user_id, name, hero, placement, eliminated_round, out_reason, team) values ($1, $2, $3, 'N', 'warden', $4, $5, $6, $7)`,
      [id, `p${i + 1}`, user, placements[i], out ? 5 : null, out ? 'hearts' : null, i < 2 ? 'a' : 'b']);
  }
  for (let r = 1; r <= 5; r++) await db.query(`insert into public.versus_group_rounds (match_id, round, digest, hearts) values ($1, $2, 'd', '{}')`, [id, r]);
  return id;
}

describe('Versus Duos XP: placement by TEAM (R-DUOS-01: "In duos you only place 1 and 2 in a 2v2")', () => {
  it('the winning team earns 125 each (1st of 2 teams), the losing team 50 each (2nd of 2)', async () => {
    const m = await duos([1, 1, 2, 2], true);
    const out = [];
    for (const u of [P1, P2, P3, P4]) out.push((await settle(u, 'versus', versusRunId(m))).result);
    expect(out.map((r) => r.xp.total)).toEqual([125, 125, 50, 50]);
    expect(out.map((r) => r.placement)).toEqual([1, 1, 8, 8]);
    for (const r of out) expect(settlementParity(r)).toBe(true);
  });
});

describe('Versus XP: half a normal game for the same share of the table (R-PROG-VERSUS-XP-01)', () => {
  it('1v1: the winner earns 125 (half of a lobby 1st), the loser 50 (half of an 8th); the ledger stores the lobby-scale place; parity holds', async () => {
    const m = await duel({ winner: 'p2' });
    const w = await settle(P2, 'versus', versusRunId(m));
    const l = await settle(P1, 'versus', versusRunId(m));
    expect([w.result.xp.total, l.result.xp.total]).toEqual([125, 50]);
    expect([w.result.placement, l.result.placement]).toEqual([1, 8]);
    expect(w.result.xp).toEqual(xpForSettlement({ mode: 'versus', placement: versusLobbyPlacement(1, 2), comeback: false }));
    expect(settlementParity(w.result)).toBe(true);
    expect(settlementParity(l.result)).toBe(true);
    expect((await settle(P2, 'versus', versusRunId(m))).status).toBe('deduped');
    expect((await db.query('select * from public.rank_results')).rows).toHaveLength(0);
  });

  it('an abandoned 1v1 (no winner) pays half the completion XP', async () => {
    const m = await duel({ winner: null });
    expect((await settle(P1, 'versus', versusRunId(m))).result.xp.total).toBe(50);
  });

  it('a Group of 4 pays 125 / 80 / 50 / 50; a knocked-out seat settles before the match ends', async () => {
    const live = await group([{ user: P1, placement: null }, { user: P2, placement: null }, { user: P3, placement: null }, { user: P4, placement: 4, out: 3, reason: 'hearts' }], { complete: false });
    const early = await settle(P4, 'versus', versusRunId(live));
    expect([early.result.placement, early.result.xp.total]).toEqual([8, 50]);
    expect(await settleFails(P1, 'versus', versusRunId(live))).toMatch(/not_terminal/);

    const m = await group([{ user: P1, placement: 1 }, { user: P2, placement: 2, out: 5, reason: 'hearts' }, { user: P3, placement: 3, out: 4, reason: 'hearts' }, { user: P4, placement: 4, out: 2, reason: 'hearts' }], { complete: true });
    const out = [];
    for (const u of [P1, P2, P3, P4]) out.push((await settle(u, 'versus', versusRunId(m))).result);
    expect(out.map((r) => r.xp.total)).toEqual([125, 80, 50, 50]);
    expect(out.map((r) => r.placement)).toEqual([1, 4, 6, 8]);
    for (const r of out) expect(settlementParity(r)).toBe(true);
  });

  it('a Group of 3: 125 / 50 / 50; refusals: not a seat, left before any round was fought', async () => {
    const m = await group([{ user: P1, placement: 1 }, { user: P2, placement: 2, out: 3, reason: 'hearts' }, { user: P3, placement: 3, out: 1, reason: 'left' }], { complete: true });
    expect((await settle(P1, 'versus', versusRunId(m))).result.xp.total).toBe(125);
    expect((await settle(P2, 'versus', versusRunId(m))).result.xp.total).toBe(50);
    expect(await settleFails(P3, 'versus', versusRunId(m))).toMatch(/not_terminal/);
    expect(await settleFails(FAN, 'versus', versusRunId(m))).toMatch(/source_not_found/);
  });
});

describe('Spectator XP: watched to the end, half a game (R-PROG-SPECTATE-XP-01)', () => {
  it('a Versus spectator who watched to the end earns 50, no Aether, no achievements; once per match', async () => {
    const r = await room([[P1, 'p1'], [P2, 'p2'], [FAN, 'spectator']]);
    const m = await duel({ roomId: r, minutes: 10 });
    await watch(FAN, 'versus', m, 6 * 60);
    await finishDuel(m, 'p1');
    expect((await beat(FAN, 'versus', m)).ended).toBe(true);
    const runId = spectateRunId('versus', m);
    const s = await settle(FAN, 'spectate', runId);
    expect(s.status).toBe('ok');
    expect(s.result.xp).toEqual({ base: 50, topFour: 0, firstPlace: 0, comeback: 0, total: 50 });
    expect(s.result.xp).toEqual(xpForSettlement({ mode: 'spectate', placement: null, comeback: false }));
    expect([s.result.placement, s.result.achievements, s.result.mode]).toEqual([null, [], 'spectate']);
    expect(settlementParity(s.result)).toBe(true);
    expect((await settle(FAN, 'spectate', runId)).status).toBe('deduped');
  });

  it('half the game is enough, capped at 5 minutes; less is not; leaving before the end is not', async () => {
    // A 30 minute match: 5 minutes is enough (the cap).
    const r = await room([[P1, 'p1'], [P2, 'p2'], [FAN, 'spectator'], [FAN2, 'spectator']]);
    const long = await duel({ roomId: r, minutes: 30 });
    await watch(FAN, 'versus', long, 5 * 60);
    await watch(FAN2, 'versus', long, 2 * 60);
    await finishDuel(long, 'p2');
    await beat(FAN, 'versus', long);
    await beat(FAN2, 'versus', long);
    expect((await settle(FAN, 'spectate', spectateRunId('versus', long))).result.xp.total).toBe(50);
    expect(await settleFails(FAN2, 'spectate', spectateRunId('versus', long))).toMatch(/not_enough/);

    // Watched plenty, but left a minute before the end.
    const r2 = await room([[P3, 'p1'], [P4, 'p2'], [FAN, 'spectator']]);
    const m = await duel({ roomId: r2, minutes: 6 });
    await watch(FAN, 'versus', m, 5 * 60);
    await db.query(`update public.spectate_sessions set last_seen_at = last_seen_at - interval '60 seconds' where user_id = $1 and run_id = $2`, [FAN, spectateRunId('versus', m)]);
    await db.query(`update public.versus_matches set p1_user = $2, p2_user = $3 where id = $1`, [m, P3, P4]);
    await finishDuel(m, 'p1');
    expect(await settleFails(FAN, 'spectate', spectateRunId('versus', m))).toMatch(/not_enough/);
  });

  it('two watch screens at once accrue nothing: time counts only on the game beat last', async () => {
    const ra = await room([[P1, 'p1'], [P2, 'p2'], [FAN, 'spectator']]);
    const a = await duel({ roomId: ra });
    const rb = await room([[P3, 'p1'], [P4, 'p2'], [FAN2, 'spectator']]);
    const b = await duel({ roomId: rb });
    await db.query(`update public.versus_matches set p1_user = $2, p2_user = $3 where id = $1`, [b, P3, P4]);
    // FAN2 cannot beat game A (not in its room); give FAN a seat in neither and alternate the two games it CAN see.
    await db.query(`update public.versus_members set room_id = $1 where user_id = $2`, [ra, FAN]);
    const g = await group([{ user: P1, placement: null }, { user: P2, placement: null }, { user: P3, placement: null }], { complete: false, roomId: ra });
    for (let i = 0; i < 6; i++) {
      await db.query(`update public.spectate_presence set at = at - interval '20 seconds' where user_id = $1`, [FAN]);
      await beat(FAN, i % 2 ? 'versus' : 'group', i % 2 ? a : g);
    }
    const rows = (await db.query<{ watched_ms: string }>('select watched_ms from public.spectate_sessions where user_id = $1 and target in ($2, $3)', [FAN, a, g])).rows;
    expect(rows.map((x) => Number(x.watched_ms))).toEqual([0, 0]);
  });

  it('refusals at the beat: a player of the match, a member who is not a spectator, outside the room, a stale finished match', async () => {
    const r = await room([[P1, 'p1'], [P2, 'p2'], [FAN, 'spectator']]);
    const m = await duel({ roomId: r });
    expect(await beatFails(P1, 'versus', m)).toMatch(/own_game/);
    expect(await beatFails(FAN2, 'versus', m)).toMatch(/not_watching/);
    expect(await beatFails(FAN, 'versus', 'nope')).toMatch(/bad_target/);
    expect(await beatFails(FAN, 'duel', m)).toMatch(/bad_target/);
    await db.query(`update public.versus_matches set phase = 'complete', winner_seat = 'p1', completed_at = now() - interval '5 minutes' where id = $1`, [m]);
    expect(await beatFails(FAN, 'versus', m)).toMatch(/no_game/);
    // Never watched at all: nothing to settle.
    expect(await settleFails(FAN2, 'spectate', spectateRunId('versus', m))).toMatch(/source_not_found/);
  });

  it('a Group spectator settles at the match end; a seat holder of that match never can', async () => {
    const r = await room([[P1, 'p1'], [P2, 'p2'], [P3, 'p3'], [FAN, 'spectator']]);
    const g = await group([{ user: P1, placement: null }, { user: P2, placement: null }, { user: P3, placement: null }], { complete: false, roomId: r, minutes: 8 });
    await watch(FAN, 'group', g, 5 * 60);
    await db.query(`update public.versus_group_matches set phase = 'complete', completed_at = now(), winner_seat = 'p1' where id = $1`, [g]);
    await beat(FAN, 'group', g);
    expect((await settle(FAN, 'spectate', spectateRunId('group', g))).result.xp.total).toBe(50);
    expect(await beatFails(P2, 'group', g)).toMatch(/own_game|not_watching/);
  });

  it('a live ranked game: settles once the end was seen AND the player\'s rank row exists (retried until then); never your own game', async () => {
    const game = `run-${++seq}`;
    await db.query(`insert into public.lobby_live_games (game_id, user_id, display_name, hero_id, started_at, phase) values ($1, $2, 'Pro', 'warden', now() - interval '20 minutes', 'combat')`, [game, P3]);
    await db.query(`insert into public.lobby_live_watchers (game_id, user_id) values ($1, $2)`, [game, FAN]);
    expect(await beatFails(P3, 'lobby', game)).toMatch(/own_game/);
    expect(await beatFails(FAN2, 'lobby', game)).toMatch(/not_watching/);
    await watch(FAN, 'lobby', game, 5 * 60);
    const runId = spectateRunId('lobby', game);
    expect(await settleFails(FAN, 'spectate', runId)).toMatch(/not_terminal/);
    await db.query(`update public.lobby_live_games set phase = 'end', placement = 2, last_seen_at = now() where game_id = $1`, [game]);
    expect((await beat(FAN, 'lobby', game)).ended).toBe(true);
    const wait = await settleFails(FAN, 'spectate', runId);
    expect(wait).toMatch(/not_yet/);
    expect(SQL_ERROR_STATUS.not_yet).toBeGreaterThanOrEqual(500); // the client's queue retries it
    await db.query(`insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, 2, 1)`, [P3, game]);
    const s = await settle(FAN, 'spectate', runId);
    expect(s.result.xp.total).toBe(50);
    expect(settlementParity(s.result)).toBe(true);
  });

  it('the Edge Function accepts a spectate request by run id only (no facts, no amounts)', () => {
    const m = uuid();
    const ok = validateSubmitBody({ mode: 'spectate', runId: spectateRunId('versus', m), rulesVersion: 1, facts: null });
    expect(ok.ok && ok.request).toEqual({ mode: 'spectate', runId: `watch:versus:${m}`, sourceId: null, comeback: false, facts: null });
    expect(validateSubmitBody({ mode: 'spectate', runId: 'watch:versus:x', rulesVersion: 1 })).toMatchObject({ ok: false, error: 'bad_run_id' });
  });
});
