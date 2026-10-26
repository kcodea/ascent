/**
 * RANKED DUOS through the client (R-RANKED-DUOS-CLIENT-01): the recorded teams seated virtually (p3..p8), this round's
 * opponent by the SAME pairing the resolver runs, the committed rounds in the Duos shape (my fight in full, the other a
 * result only), the end-turn gate's close moment, the pill counting the two players only, the 8-row rail with team rows
 * together and team names, and the spectator's view (only the two live teammates).
 */
import { describe, expect, it } from 'vitest';
import { combatSide, type BoardMinion } from '@game/core';
import { resolveRankedDuosRound, versusGroupLobby, RANKED_DUOS_END_GRACE_MS, RANKED_DUOS_OVERTIME_BACKSTOP_MS, type PreparedCombatSide, type VersusGroupSeat } from '@game/sim';
import type { RankedDuosFightRow, RankedDuosRoundRow, RankedDuosTableRaw, RankedDuosTeamRead, VersusGroupMatchRaw, VersusGroupSeatRow } from './versusRemote';
import { rankedCloseAtMs, rankedFoeAt, rankedRoundsAsGroup, rankedTeamLabels, withServedSeats, type RankedDuosContext } from './rankedDuosView';
import { duosFirstAt, duosLobbySeatId, groupDuosRailRows, projectGroupMatch, projectGroupRounds } from './versusGroupView';

const seat = (s: 'p1' | 'p2', over: Partial<VersusGroupSeatRow> = {}): VersusGroupSeatRow => ({
  seat: s, userId: s === 'p1' ? 'u1' : 'u2', name: s === 'p1' ? 'Kevin' : 'Lemon', health: null, armor: null, hero: s === 'p1' ? 'warden' : 'indy',
  locked: false, ready: false, intro: true, auto: false, missed: 0, eliminatedRound: null, outReason: null, placement: null, team: 'a', ...over,
});
const raw = (over: Partial<VersusGroupMatchRaw> = {}): VersusGroupMatchRaw => ({
  id: 'm1', room_id: 'r1', seed: 7, set_id: 'set3', content_revision: 'rev', protocol: 2, options: { v: 1, mode: 'ranked_duos', modifiers: [] },
  phase: 'shop', revision: 3, round: 1, seat_count: 2, heroes_revealed: true, hero_deadline: null, shop_starts_at: null,
  shop_deadline: '2026-10-26T12:00:30.000Z', intro_deadline: null, combat_deadline: null, paused_seat: null, paused_at: null,
  pause_grace_until: null, resume_at: null, winner_seat: null, end_reason: null, completed_at: null, seated_at: '2026-10-26T12:00:00Z',
  seats: [seat('p1'), seat('p2')], teamName: 'CITRUS', ...over,
});
const HEROES: Record<string, [string, string]> = { b: ['keshi', 'nadja'], c: ['drumline', 'mimic'], d: ['yazzus', 'fi'] };
const table = (over: Partial<RankedDuosTableRaw> = {}): RankedDuosTableRaw => ({
  round: 1, teamName: 'CITRUS',
  served: (['b', 'c', 'd'] as const).flatMap((team) => ([0, 1] as const).map((member) => ({
    team, member, name: `${team.toUpperCase()}${member}`, hero: HEROES[team]![member]!, kind: 'solo' as const,
    board: { minions: [{ cardId: 'sandbag', attack: 1, health: 1, sourceUid: `${team}${member}` }], tier: 2 },
  }))),
  teamNames: { c: 'Goats' },
  ...over,
});
const teams = (over: Partial<Record<string, Partial<RankedDuosTeamRead>>> = {}): RankedDuosTeamRead[] =>
  ['a', 'b', 'c', 'd'].map((team) => ({ team, health: null, armor: null, eliminated_round: null, placement: null, served_kind: team === 'a' ? null : 'pair', ...over[team] }));
const ctx = (over: Partial<RankedDuosContext> = {}): RankedDuosContext => ({ table: table(), teams: teams(), rounds: [], ...over });
const side = (board: BoardMinion[]): PreparedCombatSide => ({ board, state: combatSide(), config: {} });
const bags = (n: number, attack: number, tag: string): BoardMinion[] => Array.from({ length: n }, (_, i) => ({ cardId: 'sandbag', attack, health: attack, sourceUid: `${tag}${i}` }));

/** A committed round as the client reads it, from the REAL resolver. */
function committed(round: number, history: RankedDuosRoundRow[] = []): RankedDuosRoundRow {
  const out = resolveRankedDuosRound({
    matchSeed: 7, round, liveTeam: 'a', fallen: [],
    history: history.flatMap((r) => r.fights.map((f) => ({ round: f.round, a: f.a_team, b: f.b_team }))),
    alive: ['a', 'b', 'c', 'd'].map((team) => ({ team, sides: [side(bags(team === 'a' ? 3 : 1, team === 'a' ? 9 : 1, team)), side(bags(1, 1, `${team}x`))], first: 0, vitals: { health: 30, armor: 5 } })),
  });
  const fights: RankedDuosFightRow[] = out.fights.map((f) => ({
    round, fight: f.fight, a_team: f.a, b_team: f.b, ghost: f.ghost, chair: f.chair, outcome: f.outcome, loser: f.loser, damage: f.damage,
    first: f.first, live_result: f.liveResult ?? null,
  }));
  return { round, vitals: out.vitals, fights };
}

describe('Ranked Duos: the table on the client (R-RANKED-DUOS-CLIENT-01)', () => {
  it('seats the recorded teams virtually by team letter; the pill counts the two players only', () => {
    const r = withServedSeats(raw(), ctx());
    expect(r.seats.map((s) => s.seat)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    expect(r.seats.filter((s) => s.served).map((s) => s.name)).toEqual(['B0', 'B1', 'C0', 'C1', 'D0', 'D1']);
    const m = projectGroupMatch(r, 'u1');
    expect(m.group?.counts.living).toBe(2);
    expect(m.group?.duos?.mate).toBe('p2');
  });

  it('this round\'s opponent is the one the resolver pairs (the same pure pairing over the same data)', () => {
    let history: RankedDuosRoundRow[] = [];
    for (let round = 1; round <= 4; round++) {
      const c = ctx({ rounds: history });
      const foe = rankedFoeAt(raw({ round }), c, round)!;
      const real = committed(round, history);
      const mine = real.fights.find((f) => f.a_team === 'a' || f.b_team === 'a')!;
      expect(foe.team).toBe(mine.a_team === 'a' ? mine.b_team : mine.a_team);
      // The projected match names that team's first board as my foe.
      const m = projectGroupMatch(withServedSeats(raw({ round }), c), 'u1');
      expect(m.group?.foe?.seat).toBe(foe.seat);
      expect(m.p2_name).toBe(withServedSeats(raw({ round }), c).seats.find((s) => s.seat === foe.seat)!.name);
      history = [...history, real];
    }
  });

  it('a committed round plays as a Duos fight: my own view, my team\'s outcome and pool; the other fight is a result only', () => {
    const r1 = committed(1);
    const rows = rankedRoundsAsGroup([r1]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fights).toHaveLength(2);
    expect(rows[0]!.fights[0]!.a_result.duosFirst).toBeDefined();
    expect(rows[0]!.fights[1]!.a_result.events).toEqual([]); // never watchable (owner Q11)
    const view = withServedSeats(raw({ round: 1, phase: 'combat' }), ctx({ rounds: [r1] }));
    const proj = projectGroupRounds(view, rows, 'u1');
    expect(proj[1]!.p1_result).toBeTruthy();
    expect(proj[1]!.outcome).toBe('p1'); // the 3 x 9/9 live pair wins
    expect(proj[1]!.p1_health).toBe(30);
    // Every team's pool rides its seats.
    expect(rows[0]!.vitals.p1).toEqual(r1.vitals.a);
    expect((rows[0]!.vitals as Record<string, unknown>).p5).toEqual(r1.vitals.c);
  });

  it('the end-turn gate: one ended = 0:00 + 5 s; nobody = the 30 s backstop; both = at once', () => {
    const D = Date.parse('2026-10-26T12:00:30.000Z');
    expect(rankedCloseAtMs(raw({ seats: [seat('p1', { locked: true, lockedAt: '2026-10-26T12:00:10.000Z' }), seat('p2')] }))).toBe(D + RANKED_DUOS_END_GRACE_MS);
    expect(rankedCloseAtMs(raw())).toBe(D + RANKED_DUOS_OVERTIME_BACKSTOP_MS);
    expect(rankedCloseAtMs(raw({ seats: [seat('p1', { locked: true, lockedAt: '2026-10-26T12:00:10.000Z' }), seat('p2', { auto: true, autoSince: '2026-10-26T12:00:12.000Z' })] })))
      .toBe(Date.parse('2026-10-26T12:00:12.000Z'));
    expect(rankedCloseAtMs(raw({ closeAt: '2026-10-26T12:00:41.000Z' }))).toBe(Date.parse('2026-10-26T12:00:41.000Z'));
  });

  it('the rail: eight rows, my teammate under me, each team kept together, team names on each team\'s first row', () => {
    const r = withServedSeats(raw(), ctx());
    const lobby = versusGroupLobby({
      matchSeed: 7, me: 'p1', wave: 1, inCombat: false, combatSettled: false,
      seats: r.seats.map((s) => ({ seat: s.seat as VersusGroupSeat, label: s.name, heroId: s.hero ?? 'warden', eliminatedRound: s.eliminatedRound, placement: s.placement })),
      rounds: [], pairing: [], duos: { first: duosFirstAt(r, 1) },
      current: Object.fromEntries(table().served.map((x) => [`p${2 * (x.team.charCodeAt(0) - 97) + 1 + x.member}`, x.board!])),
    });
    expect(lobby.seats.map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']);
    expect(lobby.seats[1]!.label).toBe('Lemon');
    expect(lobby.seats[2]!.authoredBoards?.[0]?.length).toBe(1); // a recorded member's board for this round
    expect(lobby.seats.every((s) => s.resolve === 30)).toBe(true); // every team on its 30 Health pool
    expect(lobby.forcedOpponent?.seatId).toBe(duosLobbySeatId(r, 'p1', duosFirstAt(r, 1).b));
    const order = groupDuosRailRows([{ id: 's5' }, { id: 's0' }, { id: 's2' }, { id: 's4' }, { id: 's1' }, { id: 's7' }, { id: 's3' }, { id: 's6' }]);
    expect(order.map((x) => x.id)).toEqual(['s5', 's4', 's0', 's1', 's2', 's3', 's7', 's6']);
    expect(rankedTeamLabels(r, 'p1', { c: 'Goats' })).toEqual({ s0: 'CITRUS', s2: 'B0 & B1', s4: 'Goats', s6: 'D0 & D1' });
  });
});
