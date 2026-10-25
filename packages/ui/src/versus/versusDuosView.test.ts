/**
 * VERSUS DUOS through the client (R-DUOS-01, R-DUOS-TAGTEAM-01): the projection from one seat (my foe is the other
 * team's FIRST board; my round result is my own board's view; the outcome and the hearts are my team's; my teammate's
 * win is mine), the rail (my teammate right under me; every seat's locked board), the replay fold of a hand-off (the
 * row becomes the teammate's board), and the rail seat ids.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, type BoardMinion, type CombatEvent } from '@game/core';
import { resolveVersusDuosRound, versusGroupLobby, type PreparedCombatSide, type VersusGroupSeat } from '@game/sim';
import type { VersusGroupFightRow, VersusGroupMatchRaw, VersusGroupRoundRaw, VersusGroupSeatRow } from './versusRemote';
import { duosLobbySeatId, groupPairingAt, projectGroupMatch, projectGroupRounds } from './versusGroupView';
import { computeFrame } from '../useCombatReplay';

const U: Record<VersusGroupSeat, string> = { p1: 'u1', p2: 'u2', p3: 'u3', p4: 'u4' };
const seat = (s: VersusGroupSeat, over: Partial<VersusGroupSeatRow> = {}): VersusGroupSeatRow => ({
  seat: s, userId: U[s], name: s.toUpperCase(), hearts: 7, hero: 'warden', locked: false, ready: false, intro: true, auto: false,
  missed: 0, eliminatedRound: null, outReason: null, placement: null, ...over,
});
const raw = (over: Partial<VersusGroupMatchRaw> = {}, seats?: VersusGroupSeatRow[]): VersusGroupMatchRaw => ({
  id: 'm1', room_id: 'r1', seed: 5, set_id: 'set3', content_revision: 'rev', protocol: 1, options: { v: 1, mode: 'duos', modifiers: [] },
  phase: 'shop', revision: 3, round: 1, seat_count: 4, heroes_revealed: true, hero_deadline: null, shop_starts_at: null,
  shop_deadline: '2026-10-25T12:00:30Z', intro_deadline: null, combat_deadline: null, paused_seat: null, paused_at: null,
  pause_grace_until: null, resume_at: null, winner_seat: null, end_reason: null, completed_at: null, duos_first: { a: 'p1', b: 'p3' },
  seats: seats ?? (['p1', 'p2', 'p3', 'p4'] as VersusGroupSeat[]).map((s) => seat(s)),
  ...over,
});
const side = (board: BoardMinion[]): PreparedCombatSide => ({ board, state: combatSide(), config: {} });
const bags = (n: number, attack: number, health: number, tag: string): BoardMinion[] =>
  Array.from({ length: n }, (_, i) => ({ cardId: 'sandbag', attack, health, sourceUid: `${tag}${i}` }));

/** A committed Duos round, as the client reads it (one fight row): p1 falls, p2 steps in and wins. */
function round(): VersusGroupRoundRaw {
  const out = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: { p1: side(bags(1, 1, 1, 'a')), p2: side(bags(1, 40, 400, 'b')), p3: side(bags(1, 2, 3, 'c')), p4: side(bags(1, 2, 3, 'd')) } });
  const f: VersusGroupFightRow = {
    round: 1, fight: 0, a_seat: out.first.a, b_seat: out.first.b, b_copy: false, chair: out.chair, outcome: out.outcome,
    heart_lost_by: out.losingTeam === 'b' ? out.first.b : out.losingTeam === 'a' ? out.first.a : null,
    a_result: out.aResult, b_result: out.bResult, a_scout: null, b_scout: null,
  };
  return { round: 1, hearts: { p1: 7, p2: 7, p3: 6, p4: 6 }, eliminated: [], fights: [f] };
}

describe('Versus Duos projection (R-DUOS-01)', () => {
  it('my foe is the other team first board this round, whichever board of mine fights first', () => {
    expect(projectGroupMatch(raw(), 'u2').group?.foe).toEqual({ seat: 'p3', copy: false });
    expect(projectGroupMatch(raw(), 'u4').group?.foe).toEqual({ seat: 'p1', copy: false });
    expect(projectGroupMatch(raw({ duos_first: { a: 'p2', b: 'p4' } }), 'u1').group?.duos).toEqual({ team: 'a', mate: 'p2', first: { a: 'p2', b: 'p4' } });
    expect(groupPairingAt(raw(), 1)).toEqual([{ a: 'p1', b: 'p3', copy: false, duos: true }]);
  });

  it('a teammate win is mine: placement is by team', () => {
    const done = raw({ phase: 'complete', winner_seat: 'p1', end_reason: 'hearts' }, [seat('p1', { placement: 1 }), seat('p2', { placement: 1 }),
      seat('p3', { placement: 2, eliminatedRound: 1, outReason: 'hearts' }), seat('p4', { placement: 2, eliminatedRound: 1, outReason: 'hearts' })]);
    expect(projectGroupMatch(done, 'u2').winner_seat).toBe('p1');
    expect(projectGroupMatch(done, 'u4').end_reason).toBe('hearts');
  });

  it('my round row: my own board view (its carry-backs only), my team outcome and hearts', () => {
    const r = round();
    const rows1 = projectGroupRounds(raw(), [r], 'u1');
    const rows2 = projectGroupRounds(raw(), [r], 'u2');
    const rows3 = projectGroupRounds(raw(), [r], 'u3');
    expect([rows1[1]!.outcome, rows2[1]!.outcome, rows3[1]!.outcome]).toEqual(['p1', 'p1', 'p2']);
    expect(rows3[1]!.heart_lost_by).toBe('p1');
    expect(rows1[1]!.heart_lost_by).toBe('p2');
    const mine1 = rows1[1]!.p1_result as { duosMember?: number; playerDeaths?: number };
    const mine2 = rows2[1]!.p1_result as { duosMember?: number; playerDeaths?: number };
    expect([mine1.duosMember, mine1.playerDeaths]).toEqual([0, 1]);
    expect([mine2.duosMember, mine2.playerDeaths]).toEqual([1, 0]);
    expect([rows3[1]!.p1_hearts, rows3[1]!.p2_hearts]).toEqual([6, 7]);
  });

  it('the rail: my teammate right under me, every seat locked board, my foe the other team first', () => {
    const r = round();
    const lobby = versusGroupLobby({
      matchSeed: 5, me: 'p3', wave: 2, inCombat: false, combatSettled: false,
      seats: (['p1', 'p2', 'p3', 'p4'] as VersusGroupSeat[]).map((s) => ({ seat: s, label: s.toUpperCase(), heroId: 'warden', eliminatedRound: null, placement: null })),
      rounds: [{ round: 1, hearts: r.hearts, fights: r.fights.map((f) => ({ a: f.a_seat, b: f.b_seat, copy: false, heartLostBy: f.heart_lost_by, aResult: f.a_result })) }],
      pairing: [{ a: 'p2', b: 'p4', copy: false, duos: true }],
      duos: { first: { a: 'p2', b: 'p4' } },
    });
    expect(lobby.seats.map((x) => x.label)).toEqual(['P3', 'P4', 'P1', 'P2']);
    expect(lobby.forcedOpponent?.seatId).toBe('s3'); // p2: team a first board in round 2
    const p4 = lobby.seats.find((x) => x.label === 'P4')!;
    expect(p4.authoredBoards?.[0]?.length).toBe(1); // a board that only stepped in still has its locked board
    expect(duosLobbySeatId(raw(), 'p3', 'p4')).toBe('s1');
    expect(duosLobbySeatId(raw(), 'p3', 'p2')).toBe('s3');
  });
});

describe('the hand-off in the replay (R-DUOS-TAGTEAM-01)', () => {
  it('a tagIn replaces that side row with the teammate bodies', () => {
    const r = round().fights[0]!.a_result;
    const i = r.events.findIndex((e: CombatEvent) => e.type === 'tagIn');
    expect(i).toBeGreaterThan(0);
    const tag = r.events[i] as Extract<CombatEvent, { type: 'tagIn' }>;
    const before = computeFrame(r.initial, r.events, i, i, new Map());
    const after = computeFrame(r.initial, r.events, i + 1, i, new Map());
    const row = (f: typeof after) => (tag.side === 'player' ? f.player : f.enemy);
    expect(row(after).map((u) => u.uid)).toEqual(tag.minions.map((m) => m.uid));
    expect(row(before).map((u) => u.uid)).not.toEqual(tag.minions.map((m) => m.uid));
  });
});
