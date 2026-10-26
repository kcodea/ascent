/**
 * RANKED DUOS, EXECUTED (owner design 2026-10-26; R-RANKED-DUOS-GATE-01, R-RANKED-DUOS-RATING-01, R-RANKED-DUOS-NAME-01,
 * R-RANKED-DUOS-SEATING-01, R-RANKED-DUOS-LEAVE-01). PGlite runs every Versus migration in order, then
 * `2026-10-29-ranked-duos.sql` (twice: idempotent), against a stubbed `auth.uid()`:
 *
 * - a Ranked Duos party starts with exactly its two, as team `a` of four, with the pair's team identity;
 * - team names (format, the guides word filter in SQL agreeing with the TS filter, either teammate, not while in a game);
 * - `settle_duos_rank` agrees with `resolveRank(DUOS_RANK_RULES)` over random walks, and settles once per match;
 * - the table seating through the REAL `handleRankedDuosSeat` (pinned, idempotent, validated);
 * - the end-turn gate: both ended = at once; one ended = 0:00 + 5 s; nobody at 0:00 = the first End Turn + 5 s; the
 *   30 s backstop; re-ordering accepted past 0:00 until the close; a disconnect counts as ended; no pause;
 * - leaving: one leaver plays on auto, both gone = placed in the lowest open place and settled; the abandoned sweep;
 * - the live team's placement settles the rating (rated tables only) and records the duo run exactly as fought.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { combatSide, type BoardMinion } from '@game/core';
import type { PreparedCombatSide } from '../state';
import { DUOS_RANK_RULES, resolveRank, type RankPosition } from '../rank';
import { isBlockedText, isReservedByline } from '../../../guides/src/wordFilter';
import { handleRankedDuosSeat, type RankedDuosSeatStore, type RankedDuosSoloRow } from './rankedDuosSeat';
import { RANKED_DUOS_END_GRACE_MS, RANKED_DUOS_OVERTIME_BACKSTOP_MS } from './rankedDuos';
import { handleRankedDuosFinalize, type RankedDuosFinalizeStore } from './rankedDuosFinalize';

const root = join(__dirname, '../../../..');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql', '2026-10-25-versus-duos-random-order.sql',
  '2026-10-25-versus-duos-pass-back.sql', '2026-10-26-versus-lock-order.sql', '2026-10-27-versus-egress.sql', '2026-10-28-versus-health.sql',
];
const BASE = FILES.map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8')).join('\n');
const RANKED = readFileSync(join(root, 'supabase/migrations/2026-10-29-ranked-duos.sql'), 'utf8');
const CLIENT = readFileSync(join(root, 'supabase/migrations/2026-10-30-ranked-duos-client.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const U = (n: number): string => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const [A, B, C, D] = [1, 2, 3, 4].map(U) as [string, string, string, string];
const NAMES: Record<string, string> = { [A]: 'Kevin', [B]: 'Lemon', [C]: 'Ionlime', [D]: 'Dan' };
const CONTENT = 'rev1';
const OPT_RANKED = JSON.stringify({ v: 1, mode: 'ranked_duos', modifiers: [] });

let db: PGlite;
let clock = Date.parse('2026-10-25T12:00:00Z');
const at = (ms: number): void => { clock += ms; };
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
const q = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const matchRow = async (id: string): Promise<any> => (await q<{ m: any }>('select to_jsonb(m) m from public.versus_group_matches m where id = $1', [id]))[0]!.m;
const seatRows = async (id: string): Promise<Record<string, any>> =>
  Object.fromEntries((await q<any>('select * from public.versus_group_seats where match_id = $1', [id])).map((r) => [r.seat, r]));
/** Everyone in the room is "seen" now (the heartbeat), so a reconcile does not read a lapsed lease. */
const beat = async (): Promise<void> => { await db.query('update public.versus_members set last_seen_at = $1', [new Date(clock).toISOString()]); };

async function rankedRoom(users: string[] = [A, B]): Promise<string> {
  const room = await as<any>(users[0]!, `select public.versus_create_room('Party', $1, '{}', 'set3', $2, 1, $3::jsonb)`, [NAMES[users[0]!], CONTENT, OPT_RANKED]);
  for (const u of users.slice(1)) await as(u, `select public.versus_join_room($1, 'player', $2, '{}', $3, 1)`, [room.id, NAMES[u], CONTENT]);
  return room.id;
}
async function startRanked(users: [string, string] = [A, B]): Promise<[string, string]> {
  const room = await rankedRoom(users);
  await as(users[0], `select public.versus_start_game($1)`, [room]);
  let r: any;
  for (const u of users) r = await as(u, `select public.versus_press_gate($1)`, [room]);
  expect(r.status).toBe('in_game');
  return [room, r.current_match_id];
}
async function toShop(m: string, users: string[] = [A, B]): Promise<void> {
  const offers = [['warden', 'indy', 'keshi'], ['indy', 'warden', 'keshi']];
  for (const [i, u] of users.entries()) await as(u, `select public.versus_group_register_offer($1, $2::text[])`, [m, offers[i]]);
  for (const u of users) await as(u, `select public.versus_group_pick_hero($1, 0)`, [m]);
  for (const u of users) await as(u, `select public.versus_group_intro_done($1)`, [m]);
}
const sideOf = (board: BoardMinion[]): PreparedCombatSide => ({ board, state: combatSide(), config: {} });
const bag = (tag: string): BoardMinion[] => [{ cardId: 'sandbag', attack: 1, health: 1, sourceUid: tag }];
const submit = (u: string, m: string, round: number, final: boolean, seq = 1, side = sideOf(bag(u.slice(-2)))) =>
  as(u, `select public.versus_ranked_duos_submit($1, $2, $3, $4::jsonb, $5, null, null)`, [m, round, seq, JSON.stringify(side), final]);
const reconcile = (u: string, m: string) => as(u, 'select public.versus_ranked_duos_reconcile($1)', [m]);
const deadlineOf = async (m: string): Promise<number> => Date.parse((await matchRow(m)).shop_deadline);
const gotoMs = (t: number): void => { clock = t; };

/** A served table the SQL accepts: three teams, heroes away from the live pair's (warden, indy). */
function fakeTable(unrated = false): Record<string, unknown> {
  const heroes = [['keshi', 'nadja'], ['drumline', 'mimic'], ['yazzus', 'fi']];
  return {
    unrated,
    teams: ['b', 'c', 'd'].map((team, i) => ({
      team, kind: unrated ? 'generated' : 'pair', order: 'random', recordedOrder: null,
      members: [0, 1].map((member) => ({
        member, kind: unrated ? 'generated' : 'solo', key: `run-${team}${member}`, ownerId: null, name: `P${team}${member}`,
        heroId: heroes[i]![member], recording: unrated ? { kind: 'generated', heroId: heroes[i]![member], seed: 1 } : { kind: 'solo', boards: [] },
      })),
    })),
  };
}
const seat = (m: string, table = fakeTable()) => as(null, 'select public.versus_ranked_duos_seat($1, $2::jsonb)', [m, JSON.stringify(table)]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(BASE);
  await db.exec(RANKED);
  await db.exec(RANKED); // idempotent
  await db.exec(CLIENT);
  await db.exec(CLIENT); // idempotent
}, 90_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`delete from public.versus_group_matches; delete from public.versus_matches; delete from public.versus_rooms;
    delete from public.duo_runs; delete from public.duos_rank_results; delete from public.duos_team_ranks; delete from public.duos_teams;
    drop table if exists public.versus_test_bots;`);
});

describe('the Ranked Duos party (R-RANKED-DUOS-01)', () => {
  it('a party seats two, refuses modifiers, and starts as team a of four with the pair as its team', async () => {
    expect(await fails(A, `select public.versus_create_room('X', 'Kevin', '{}', 'set3', $1, 1, $2::jsonb)`,
      [CONTENT, JSON.stringify({ v: 1, mode: 'ranked_duos', modifiers: ['summit'] })])).toMatch(/bad_modifiers/);
    const lone = await rankedRoom([A]);
    expect(await fails(A, 'select public.versus_start_game($1)', [lone])).toMatch(/need_two_players/);
    await db.exec('delete from public.versus_rooms');
    const [, m] = await startRanked();
    const row = await matchRow(m);
    expect([row.options.mode, row.seat_count, row.phase]).toEqual(['ranked_duos', 2, 'hero_select']);
    expect(Object.values(await seatRows(m)).map((s: any) => [s.seat, s.team])).toEqual([['p1', 'a'], ['p2', 'a']]);
    expect((await q<any>('select team from public.versus_group_teams where match_id = $1 order by team', [m])).map((t) => t.team)).toEqual(['a', 'b', 'c', 'd']);
    const team = (await q<any>('select * from public.duos_teams where id = $1', [row.ranked_team]))[0];
    expect([team.user_lo, team.user_hi]).toEqual([A, B]);
  });

  it('two different pairs are two teams; the same pair (either order) is one', async () => {
    const t1 = await as(null, 'select public.duos__ensure_team($1, $2)', [A, B]);
    expect(await as(null, 'select public.duos__ensure_team($1, $2)', [B, A])).toBe(t1);
    expect(await as(null, 'select public.duos__ensure_team($1, $2)', [A, C])).not.toBe(t1);
  });
});

describe('team names (R-RANKED-DUOS-NAME-01)', () => {
  it('either teammate names the team; the name is cleaned; blank resets to the default', async () => {
    expect((await as<any>(A, 'select public.duos_team_set_name($1, $2)', [B, '  CITRUS  '])).name).toBe('CITRUS');
    expect((await as<any>(B, 'select public.duos_team_set_name($1, $2)', [A, 'Citrus   Kings'])).name).toBe('Citrus Kings');
    expect((await as<any>(A, 'select public.duos_team_set_name($1, $2)', [C, 'Goats'])).name).toBe('Goats');
    expect((await as<any>(B, 'select public.duos_team_set_name($1, $2)', [A, ' '])).name).toBeNull();
    expect((await q<any>('select count(*)::int n from public.duos_teams'))[0].n).toBe(2);
  });

  it('refuses bad names, itself, and a team in a game', async () => {
    expect(await fails(A, 'select public.duos_team_set_name($1, $2)', [B, 'x'])).toMatch(/name_length/);
    expect(await fails(A, 'select public.duos_team_set_name($1, $2)', [B, 'Goats!'])).toMatch(/name_chars/);
    expect(await fails(A, 'select public.duos_team_set_name($1, $2)', [B, 'Sh1t Team'])).toMatch(/name_blocked/);
    expect(await fails(A, 'select public.duos_team_set_name($1, $2)', [B, 'Team Ascent'])).toMatch(/name_reserved/);
    expect(await fails(A, 'select public.duos_team_set_name($1, $2)', [A, 'Solo'])).toMatch(/bad_team/);
    await startRanked();
    expect(await fails(B, 'select public.duos_team_set_name($1, $2)', [A, 'Mid Game'])).toMatch(/team_in_game/);
    expect((await as<any>(A, 'select public.duos_team_set_name($1, $2)', [C, 'Goats'])).name).toBe('Goats'); // another team is free
  });

  it('the SQL filter agrees with the guides word filter on every allowed-character name', async () => {
    const names = ['Citrus', 'Sh1t Team', 'shiiit', 'big dick', 'Dickens', 'fuckers', 'Bullsh1t', 'admin', 'Aadmin squad',
      'Team Ascent', 'Ascent Team', 'Teaam Ascent', 'Steam Ascent', 'Nazi', 'Ass', 'Classic', 'Scunthorpe', 'Niger', 'raper',
      'Goats 2', 'Hitler 4', 'b1tch', 'ASSHOLE', 'Spic', 'spicy', 'official', 'Moderator 1', 'developers'];
    for (const n of names) {
      const sql = await as<string | null>(null, 'select public.duos__name_blocked($1)', [n]);
      expect([n, sql !== null]).toEqual([n, isBlockedText(n) || isReservedByline(n)]);
    }
  });
});

describe('the team rating (R-RANKED-DUOS-RATING-01)', () => {
  it('settle_duos_rank agrees with resolveRank(DUOS_RANK_RULES) over random walks, once per match', async () => {
    const team = await as<string>(null, 'select public.duos__ensure_team($1, $2)', [A, B]);
    let pos: RankPosition = { divisionIndex: 0, points: 0, demotionReady: false };
    let rng = 12345;
    const next = (): number => { rng = (Math.imul(rng, 1103515245) + 12345) >>> 0; return rng; };
    for (let i = 0; i < 160; i++) {
      // Bias up so the walk reaches gates, promotions and demotions.
      const placement = [1, 1, 2, 2, 3, 4][next() % 6]!;
      const match = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const out = await as<any>(null, 'select public.settle_duos_rank($1, $2, $3)', [team, match, placement]);
      const ts = resolveRank(pos, placement, DUOS_RANK_RULES);
      expect(out.result.after).toEqual(ts.after);
      expect([out.result.appliedDelta, out.result.promoted, out.result.demoted, out.result.wasPromotionGame, out.result.wasDemotionGame])
        .toEqual([ts.appliedDelta, ts.promoted, ts.demoted, ts.wasPromotionGame, ts.wasDemotionGame]);
      pos = ts.after;
    }
    expect(pos.divisionIndex).toBeGreaterThan(2);
    const again = await as<any>(null, 'select public.settle_duos_rank($1, $2, 4)', [team, '00000000-0000-4000-8000-000000000000']);
    expect(again.status).toBe('deduped');
    expect(await fails(A, 'select public.settle_duos_rank($1, $2, 1)', [team, '00000000-0000-4000-8000-000000000999'])).toMatch(/permission denied/);
  });
});

describe('the table seating (R-RANKED-DUOS-SEATING-01)', () => {
  const soloRows: RankedDuosSoloRow[] = ['keshi', 'nadja', 'drumline', 'mimic', 'yazzus', 'fi', 'tamby'].map((h, i) => ({
    run_key: `P${i}|${h}|${i}`, author: `P${i}`, user_id: null, strength: null, strength_early: null, strength_late: null,
    boards: [{ heroId: h, wave: 1, minions: [] }, { heroId: h, wave: 2, minions: [{ cardId: 'sandbag' }] }],
  }));
  const store = (_m: string): RankedDuosSeatStore => ({
    async match(id) { return (await q<any>('select id, phase, seed, set_id, options, ranked_team, seated_at from public.versus_group_matches where id = $1', [id]))[0] ?? null; },
    async liveHeroes(id) { return (await q<any>("select hero from public.versus_group_seats where match_id = $1 and seat in ('p1','p2') order by seat", [id])).map((r) => r.hero); },
    async teamDivision(t) { return (await q<any>('select division from public.duos_team_ranks where team_id = $1', [t]))[0]?.division ?? 0; },
    async soloSample() { return soloRows; },
    async duoSample(a) { return as<any>(null, 'select coalesce(jsonb_agg(to_jsonb(s)), \'[]\') from public.duo_runs_sample($1, $2, $3) s', [a.p_limit, a.p_set, a.p_seed]); },
    async commit(a) { return as(null, 'select public.versus_ranked_duos_seat($1, $2::jsonb)', [a.p_match, JSON.stringify(a.p_table)]); },
    log: () => undefined,
  });

  it('waits for both heroes, then seats three pinned teams once (idempotent), heroes unique', async () => {
    const [, m] = await startRanked();
    expect((await handleRankedDuosSeat(A, { matchId: m }, store(m))).body.error).toBe('heroes_not_locked');
    await toShop(m);
    const res = await handleRankedDuosSeat(A, { matchId: m }, store(m));
    expect(res.body).toMatchObject({ seated: true, unrated: false });
    const served = await q<any>('select team, member, kind, hero, recording from public.versus_ranked_duos_served where match_id = $1 order by team, member', [m]);
    expect(served).toHaveLength(6);
    const heroes = [...served.map((s) => s.hero), 'warden', 'indy'];
    expect(new Set(heroes).size).toBe(8);
    expect(served.filter((s) => s.kind === 'solo').every((s) => s.recording.boards.length === 2)).toBe(true);
    expect((await matchRow(m)).seated_at).not.toBeNull();
    expect((await handleRankedDuosSeat(B, { matchId: m }, store(m))).body).toMatchObject({ already: true });
    expect((await q<any>('select count(*)::int n from public.versus_ranked_duos_served where match_id = $1', [m]))[0].n).toBe(6);
  });

  it('the commit validates the table and refuses a client', async () => {
    const [, m] = await startRanked();
    await toShop(m);
    const bad = fakeTable();
    ((bad.teams as any[])[0].members[0]).heroId = 'warden';
    expect(await fails(null, 'select public.versus_ranked_duos_seat($1, $2::jsonb)', [m, JSON.stringify(bad)])).toMatch(/hero_taken/);
    expect(await fails(null, 'select public.versus_ranked_duos_seat($1, $2::jsonb)', [m, JSON.stringify({ teams: [] })])).toMatch(/bad_table/);
    expect(await fails(A, 'select public.versus_ranked_duos_seat($1, $2::jsonb)', [m, JSON.stringify(fakeTable())])).toMatch(/permission denied/);
    expect(await fails(A, 'select * from public.versus_ranked_duos_served')).toMatch(/permission denied|0 rows|did not fail/);
  });

  it('all three teams generated: the match is unrated', async () => {
    const [, m] = await startRanked();
    await toShop(m);
    await seat(m, fakeTable(true));
    expect((await matchRow(m)).unrated).toBe('generated');
  });
});

describe('the end-turn gate (R-RANKED-DUOS-GATE-01)', () => {
  async function shop(): Promise<{ m: string; deadline: number }> {
    const [, m] = await startRanked();
    await toShop(m);
    await seat(m);
    await beat();
    const deadline = await deadlineOf(m);
    expect((await matchRow(m)).phase).toBe('shop');
    return { m, deadline };
  }

  it('both ended: the round goes at once, with time left', async () => {
    const { m } = await shop();
    at(3000);
    await submit(A, m, 1, true);
    expect((await matchRow(m)).phase).toBe('shop');
    await submit(B, m, 1, true);
    expect((await matchRow(m)).phase).toBe('resolving');
  });

  it('one ended with time left: the other has until 0:00 + 5 s, and may re-order past 0:00', async () => {
    const { m, deadline } = await shop();
    at(2000);
    await submit(A, m, 1, true);
    gotoMs(deadline + 1000);
    await beat();
    expect((await reconcile(A, m)).phase).toBe('shop');
    await submit(B, m, 1, false, 2); // a re-order at 0:00 + 1 s still lands
    gotoMs(deadline + RANKED_DUOS_END_GRACE_MS - 100);
    await beat();
    expect((await reconcile(B, m)).phase).toBe('shop');
    gotoMs(deadline + RANKED_DUOS_END_GRACE_MS);
    await beat();
    const r = await reconcile(B, m);
    expect(r.phase).toBe('resolving');
    const subs = await q<any>('select seat, source, candidate_seq from public.versus_group_submissions where match_id = $1 and round = 1 order by seat', [m]);
    expect(subs.map((s) => [s.seat, s.source, s.candidate_seq])).toEqual([['p1', 'lock', 1], ['p2', 'deadline', 2]]);
  });

  it('nobody ended at 0:00: it waits; the first End Turn opens 5 s; the second closes it at once', async () => {
    const { m, deadline } = await shop();
    gotoMs(deadline + 12_000);
    await beat();
    expect((await reconcile(A, m)).phase).toBe('shop');
    await submit(A, m, 1, true);
    expect(Date.parse((await reconcile(A, m)).closeAt)).toBe(deadline + 12_000 + RANKED_DUOS_END_GRACE_MS);
    gotoMs(deadline + 14_000);
    await submit(B, m, 1, true);
    expect((await matchRow(m)).phase).toBe('resolving');
  });

  it('nobody ends at all: the 30 s backstop closes the round', async () => {
    const { m, deadline } = await shop();
    gotoMs(deadline + RANKED_DUOS_OVERTIME_BACKSTOP_MS - 1);
    await beat();
    expect((await reconcile(A, m)).phase).toBe('shop');
    gotoMs(deadline + RANKED_DUOS_OVERTIME_BACKSTOP_MS);
    await beat();
    expect((await reconcile(A, m)).phase).toBe('resolving');
  });

  it('a lock after the close (plus its 250 ms grace) is refused', async () => {
    const { m, deadline } = await shop();
    await submit(A, m, 1, true);
    gotoMs(deadline + RANKED_DUOS_END_GRACE_MS + 300);
    expect(await fails(B, 'select public.versus_ranked_duos_submit($1, 1, 5, $2::jsonb, true, null, null)', [m, JSON.stringify(sideOf([]))])).toMatch(/deadline_passed/);
  });

  it('no pause: a lapsed teammate goes on auto and counts as ended; coming back takes them off auto', async () => {
    const { m, deadline } = await shop();
    at(15_000);
    await db.query('update public.versus_members set last_seen_at = $1 where user_id = $2', [new Date(clock).toISOString(), A]);
    let r = await reconcile(A, m);
    expect(r.paused_at).toBeNull();
    expect((await seatRows(m)).p2.auto).toBe(true);
    // A ends with time left: both ended (B on auto) -> at once.
    await submit(A, m, 1, true);
    expect((await matchRow(m)).phase).toBe('resolving');
    expect((await q<any>("select source from public.versus_group_submissions where match_id = $1 and seat = 'p2'", [m]))[0].source).toMatch(/auto|empty|deadline/);
    // B back: their own reconcile clears auto.
    await beat();
    r = await reconcile(B, m);
    expect((await seatRows(m)).p2.auto).toBe(false);
    expect(deadline).toBeGreaterThan(0);
  });

  it('the group RPCs hand a Ranked Duos match over (no lock at 0:00, no pause)', async () => {
    const { m, deadline } = await shop();
    gotoMs(deadline + 2000);
    await beat();
    const r = await as<any>(A, 'select public.versus_group_reconcile($1)', [m]);
    expect([r.phase, r.paused_at]).toEqual(['shop', null]);
    await as(A, 'select public.versus_group_submit($1, 1, 1, $2::jsonb, true, null, null)', [m, JSON.stringify(sideOf([]))]);
    expect((await seatRows(m)).p1.locked_at).not.toBeNull();
  });
});

describe('the round (R-RANKED-DUOS-ROUND-01, R-LOBBY-SERVE-01 for served teams)', () => {
  const snap = (wave: number, n: number, atk: number, hero: string) => ({
    id: `id-${hero}-${wave}`, wave, heroId: hero, tier: Math.min(6, 1 + Math.floor(wave / 2)), setId: 'set3', power: n * atk, tribes: [],
    minions: Array.from({ length: n }, (_, i) => ({ cardId: 'sandbag', attack: atk, health: atk, sourceUid: `${hero}${wave}${i}` })),
  });
  const memberBoard = (rec: unknown, round: number) => q<any>('select public.versus_ranked_duos__member_board($1::jsonb, $2) b', [JSON.stringify(rec), round]).then((r) => r[0].b);

  it('a served member fields EXACTLY its round: its own board, a hole = empty in the previous state, before = nothing, after = its final', async () => {
    const rec = { kind: 'solo', boards: [snap(2, 1, 1, 'keshi'), snap(3, 2, 2, 'keshi'), snap(5, 3, 3, 'keshi'), snap(6, 4, 4, 'keshi')] };
    expect((await memberBoard(rec, 1)).form).toBe('none');
    expect((await memberBoard(rec, 3)).board).toEqual(snap(3, 2, 2, 'keshi'));
    const hole = (await memberBoard(rec, 4)).board;
    expect([hole.wave, hole.minions, hole.tier, hole.id]).toEqual([3, [], snap(3, 2, 2, 'keshi').tier, undefined]);
    expect((await memberBoard(rec, 9)).board).toEqual(snap(6, 4, 4, 'keshi'));
    const duo = { kind: 'duo', rounds: [{ round: 1, side: sideOf(bag('x')) }, { round: 2, side: sideOf([]) }] };
    expect(await memberBoard(duo, 1)).toEqual({ form: 'side', board: JSON.parse(JSON.stringify(sideOf(bag('x')))) });
    expect((await memberBoard(duo, 2)).board.board).toEqual([]); // an empty round is a round
    expect((await memberBoard(duo, 7)).board.board).toEqual([]); // past its end: its final side
    expect((await memberBoard({ kind: 'generated', heroId: 'x', seed: 1 }, 3)).form).toBe('none');
  });

  it('the client table read (phase 2): the recorded teams, this round\'s boards by the round-exact rule, only for room members', async () => {
    const [, m] = await startRanked();
    await toShop(m);
    const heroes = [['keshi', 'nadja'], ['drumline', 'mimic'], ['yazzus', 'fi']];
    await seat(m, {
      unrated: false,
      teams: ['b', 'c', 'd'].map((team, i) => ({
        team, kind: i === 0 ? 'duo' : 'pair', order: i === 0 ? 'recorded' : 'random', recordedOrder: i === 0 ? { 1: 1, 2: 0 } : null,
        members: [0, 1].map((member) => ({
          member, kind: i === 0 ? 'duo' : 'solo', key: `run-${team}${member}`, ownerId: null, name: `P${team}${member}`, heroId: heroes[i]![member],
          recording: i === 0
            ? { kind: 'duo', rounds: [{ round: 1, side: sideOf(bag(`${team}${member}`)) }] }
            : { kind: 'solo', boards: [2, 3].map((w) => snap(w, 2, 2, heroes[i]![member]!)) },
        })),
      })),
    });
    const t = await as<any>(A, 'select public.versus_ranked_duos_table($1)', [m]);
    expect(t.served).toHaveLength(6);
    expect(t.served.find((x: any) => x.team === 'b' && x.member === 0).board.minions).toHaveLength(1); // a duo side's board
    expect(t.served.find((x: any) => x.team === 'c' && x.member === 0).board).toBeNull(); // its recording starts at round 2
    expect(t.orders).toEqual({ b: 1 });
    expect(await fails(D, 'select public.versus_ranked_duos_table($1)', [m])).toMatch(/not_a_member/);
  });

  it('a whole match: four teams, the lobby pairing, team pools, only the live fight in full, placement settles the TEAM', async () => {
    const [, m] = await startRanked();
    await toShop(m);
    const heroes = [['keshi', 'nadja'], ['drumline', 'mimic'], ['yazzus', 'fi']];
    const table = {
      unrated: false,
      teams: ['b', 'c', 'd'].map((team, i) => ({
        team, kind: 'pair', order: 'random', recordedOrder: null,
        members: [0, 1].map((member) => ({
          member, kind: 'solo', key: `run-${team}${member}`, ownerId: null, name: `P${team}${member}`, heroId: heroes[i]![member],
          // Weak recorded teams: one 1/1 per round, so the live pair's 7 x 20/20 wins every fight it plays.
          recording: { kind: 'solo', boards: [1, 2, 3, 4].map((w) => snap(w, 1, 1, heroes[i]![member]!)) },
        })),
      })),
    };
    await seat(m, table);
    const fstore: RankedDuosFinalizeStore = {
      async input(id, round) { return (await q<any>('select public.versus_ranked_duos_round_input($1, $2) x', [id, round]))[0].x; },
      async commit(a) { return q('select public.versus_ranked_duos_commit_round($1, $2, $3::jsonb, $4)', [a.p_match, a.p_round, JSON.stringify(a.p_result), a.p_digest]); },
      log: () => undefined,
    };
    const strong = (tag: string) => sideOf(Array.from({ length: 7 }, (_, i) => ({ cardId: 'sandbag', attack: 20, health: 20, sourceUid: `${tag}${i}` })));
    let round = 1;
    for (; round <= 25; round++) {
      await beat();
      await submit(A, m, round, true, 1, strong('a'));
      await submit(B, m, round, true, 1, strong('b'));
      expect((await matchRow(m)).phase).toBe('resolving');
      const res = await handleRankedDuosFinalize(A, { matchId: m, round }, CONTENT, fstore);
      expect(res.body.status).toBe('committed');
      const again = await handleRankedDuosFinalize(B, { matchId: m, round }, CONTENT, fstore);
      expect(again.body.status).toBe('not_resolving'); // idempotent: a second caller only catches up
      if ((await matchRow(m)).phase === 'complete') break;
      for (const u of [A, B]) await as(u, 'select public.versus_group_combat_ready($1, $2)', [m, round]);
      expect((await matchRow(m)).phase).toBe('shop');
    }
    const row = await matchRow(m);
    expect([row.phase, row.winner_seat]).toEqual(['complete', 'p1']);
    const fights = await q<any>('select round, fight, a_team, b_team, ghost, loser, damage, live_result is not null as full from public.versus_ranked_duos_fights where match_id = $1 order by round, fight', [m]);
    // Every round the live team fought exactly once, in full; every other fight kept only its result.
    for (let r = 1; r <= round; r++) {
      const ours = fights.filter((f) => f.round === r && (f.a_team === 'a' || f.b_team === 'a'));
      expect(ours).toHaveLength(1);
      expect(ours[0].full).toBe(true);
      expect(fights.filter((f) => f.round === r && f.a_team !== 'a' && f.b_team !== 'a').every((f) => !f.full)).toBe(true);
    }
    // No pairing repeats inside the first 3 rounds while 4 teams are in.
    const early = fights.filter((f) => f.round <= 3 && !f.ghost).map((f) => [f.a_team, f.b_team].sort().join(''));
    expect(new Set(early).size).toBe(early.length);
    const teams = await q<any>('select team, health, armor, placement from public.versus_group_teams where match_id = $1 order by team', [m]);
    expect(teams[0]).toMatchObject({ team: 'a', placement: 1 });
    expect(teams.slice(1).every((t) => t.placement >= 2 && t.health === 0)).toBe(true);
    const seats = await seatRows(m);
    expect([seats.p1.placement, seats.p2.placement]).toEqual([1, 1]);
    expect(seats.p1.health).toBe(teams[0].health);
    expect((await q<any>('select placement, applied_delta from public.duos_rank_results where match_id = $1', [m]))).toEqual([{ placement: 1, applied_delta: 34 }]);
    const run = (await q<any>('select * from public.duo_runs where match_id = $1', [m]))[0];
    expect(run.round_count).toBe(round);
    const firsts = (await q<any>('select first from public.duo_run_rounds where duo_run_id = $1 order by round', [run.id])).map((r) => r.first);
    expect(firsts.every((f) => f === 'p1' || f === 'p2')).toBe(true);
  }, 120_000);
});

describe('leaving and placement (R-RANKED-DUOS-LEAVE-01, R-RANKED-DUOS-RATING-01)', () => {
  async function seatedShop(): Promise<string> {
    const [, m] = await startRanked();
    await toShop(m);
    await seat(m);
    await beat();
    return m;
  }

  it('one leaver: their seat plays on auto and the team plays on; both gone: 4th, settled, match over', async () => {
    const m = await seatedShop();
    await as(B, 'select public.versus_group_forfeit($1)', [m]);
    let s = await seatRows(m);
    expect([s.p2.auto, s.p2.left_at !== null, s.p2.eliminated_round]).toEqual([true, true, null]);
    expect((await matchRow(m)).phase).toBe('shop');
    expect(await fails(B, 'select public.versus_ranked_duos_submit($1, 1, 9, $2::jsonb, true, null, null)', [m, JSON.stringify(sideOf([]))])).toMatch(/eliminated/);
    // The leaver's own reconcile never takes them off auto; even if the room heartbeat clears the flag, a seat that
    // left still counts as ended: A's End Turn closes the round at once.
    await reconcile(B, m);
    expect((await seatRows(m)).p2.auto).toBe(true);
    await db.query("update public.versus_group_seats set auto = false where match_id = $1 and seat = 'p2'", [m]);
    await submit(A, m, 1, true);
    expect((await matchRow(m)).phase).toBe('resolving');
    expect((await q<any>("select source from public.versus_group_submissions where match_id = $1 and seat = 'p2' and round = 1", [m]))[0].source).toMatch(/auto|empty/);
    await as(A, 'select public.versus_group_forfeit($1)', [m]);
    const row = await matchRow(m);
    expect([row.phase, row.end_reason]).toEqual(['complete', 'abandoned']);
    s = await seatRows(m);
    expect([s.p1.placement, s.p2.placement]).toEqual([4, 4]);
    const res = (await q<any>('select placement, applied_delta from public.duos_rank_results where match_id = $1', [m]))[0];
    expect(res).toEqual({ placement: 4, applied_delta: 0 }); // Bronze I floor
  });

  it('the live team placed 1st: +34 to the TEAM, once; the duo run is recorded exactly as fought', async () => {
    const m = await seatedShop();
    // Rounds 1-4 as fought (the round commit of part 2 writes these; here they are written directly).
    for (let round = 1; round <= 4; round++) {
      for (const [seat, u] of [['p1', A], ['p2', B]] as const) {
        await db.query(`insert into public.versus_group_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source)
          values ($1, $2, $3, $4, 1, $5::jsonb, true, $6) on conflict (match_id, round, seat) do update set prepared_side = excluded.prepared_side, final = true, source = excluded.source`,
          [m, round, seat, u, JSON.stringify(sideOf(round === 2 && seat === 'p2' ? [] : bag(`${seat}${round}`))), round === 3 && seat === 'p2' ? 'auto' : 'lock']);
      }
      await db.query(`insert into public.versus_group_rounds (match_id, round, digest, hearts, first) values ($1, $2, 'x', '{}', $3::jsonb) on conflict do nothing`,
        [m, round, JSON.stringify({ a: round % 2 ? 'p1' : 'p2' })]);
    }
    const row = await matchRow(m);
    await q(`select public.versus_ranked_duos__place_team(m, 'a', 1, 'hearts') from public.versus_group_matches m where id = $1`, [m]);
    const after = await matchRow(m);
    expect([after.phase, after.winner_seat, after.unrated]).toEqual(['complete', 'p1', null]);
    const rank = (await q<any>('select division, points from public.duos_team_ranks where team_id = $1', [row.ranked_team]))[0];
    expect(rank).toEqual({ division: 0, points: 34 });
    await q(`select public.versus_ranked_duos__place_team(m, 'a', 1, 'hearts') from public.versus_group_matches m where id = $1`, [m]);
    expect((await q<any>('select count(*)::int n from public.duos_rank_results where match_id = $1', [m]))[0].n).toBe(1);
    const run = (await q<any>('select * from public.duo_runs where match_id = $1', [m]))[0];
    expect([run.round_count, run.first_round, run.placement, run.eligible, run.members.map((x: any) => x.heroId)])
      .toEqual([4, 1, 1, true, ['warden', 'indy']]);
    const rounds = await q<any>('select round, sides, sources, first from public.duo_run_rounds where duo_run_id = $1 order by round', [run.id]);
    expect(rounds.map((r) => r.first)).toEqual(['p1', 'p2', 'p1', 'p2']);
    expect(rounds[1].sides.p2.board).toEqual([]); // an empty board is a round of the run
    expect(rounds[2].sources.p2).toBe('auto');
    // The sample serves it.
    const sample = await as<any[]>(null, `select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.duo_runs_sample(10, 'set3', 'x') s`);
    expect(sample).toHaveLength(1);
    expect(sample[0].rounds).toHaveLength(4);
  });

  it('an unrated table (all generated) records the run but settles nothing; a test bot makes it unrated too', async () => {
    const [, m] = await startRanked();
    await toShop(m);
    await seat(m, fakeTable(true));
    await q(`select public.versus_ranked_duos__place_team(m, 'a', 2, 'hearts') from public.versus_group_matches m where id = $1`, [m]);
    expect((await q<any>('select count(*)::int n from public.duos_rank_results where match_id = $1', [m]))[0].n).toBe(0);

    await db.exec('create table if not exists public.versus_test_bots (user_id uuid primary key)');
    await db.query('insert into public.versus_test_bots values ($1) on conflict do nothing', [B]);
    await db.exec('delete from public.versus_rooms');
    const [, m2] = await startRanked();
    await toShop(m2);
    await seat(m2);
    await q(`select public.versus_ranked_duos__place_team(m, 'a', 1, 'hearts') from public.versus_group_matches m where id = $1`, [m2]);
    expect((await matchRow(m2)).unrated).toBe('bot');
    expect((await q<any>('select count(*)::int n from public.duos_rank_results where match_id = $1', [m2]))[0].n).toBe(0);
    await db.exec('drop table public.versus_test_bots');
  });

  it('both silent for 10 minutes: the sweep places and settles the team (a disconnect cannot dodge a loss)', async () => {
    const m = await seatedShop();
    at(9 * 60_000);
    expect(await as<number>(null, 'select public.versus_ranked_duos_sweep_abandoned()')).toBe(0);
    at(2 * 60_000);
    expect(await as<number>(null, 'select public.versus_ranked_duos_sweep_abandoned()')).toBe(1);
    const row = await matchRow(m);
    expect([row.phase, row.end_reason, row.unrated]).toEqual(['complete', 'abandoned', null]);
    expect((await q<any>('select placement from public.duos_rank_results where match_id = $1', [m]))[0]?.placement).toBe(4);
  });
});
