/**
 * VERSUS GROUP through the 1v1 client (owner 2026-10-24, R-VERSUS-GROUP-01/03): the projection of a 3-4 player match
 * onto the 1v1 row from one seat (p1 = me, p2 = my opponent this round, a Copy named as such), the table counts the
 * "Players ready N/M" pill reads, a seat that is out seeing its own end, and the per-seat round results.
 */
import { describe, expect, it } from 'vitest';
import type { CombatResult } from '@game/core';
import type { VersusGroupSeat } from '@game/sim';
import type { VersusGroupMatchRaw, VersusGroupRoundRaw, VersusGroupSeatRow } from './versusRemote';
import { projectGroupMatch, projectGroupRounds, roundResultFor } from './versusGroupView';
import { versusTurn, versusTurnNote } from './versusTurn';

const U: Record<VersusGroupSeat, string> = { p1: 'u1', p2: 'u2', p3: 'u3', p4: 'u4' };
const seat = (s: VersusGroupSeat, over: Partial<VersusGroupSeatRow> = {}): VersusGroupSeatRow => ({
  seat: s, userId: U[s], name: s.toUpperCase(), health: 30, armor: 0, hero: 'warden', locked: false, ready: false, intro: true, auto: false,
  missed: 0, eliminatedRound: null, outReason: null, placement: null, ...over,
});
const raw = (n: 3 | 4, over: Partial<VersusGroupMatchRaw> = {}, seats?: VersusGroupSeatRow[]): VersusGroupMatchRaw => ({
  id: 'm1', room_id: 'r1', seed: 5, set_id: 'set3', content_revision: 'rev', protocol: 1, options: { v: 1, mode: 'group', modifiers: [] },
  phase: 'shop', revision: 3, round: 1, seat_count: n, heroes_revealed: true, hero_deadline: null, shop_starts_at: null,
  shop_deadline: '2026-10-24T12:00:30Z', intro_deadline: null, combat_deadline: null, paused_seat: null, paused_at: null,
  pause_grace_until: null, resume_at: null, winner_seat: null, end_reason: null, completed_at: null,
  seats: seats ?? (['p1', 'p2', 'p3', 'p4'] as VersusGroupSeat[]).slice(0, n).map((s) => seat(s)),
  ...over,
});
const res = (tag: string, result: 'win' | 'lose' | 'draw'): CombatResult => ({ result, tag } as unknown as CombatResult);

describe('Versus Group projection (R-VERSUS-GROUP-01)', () => {
  it('p1 is me, p2 my opponent this round; a Copy is named "Copy of X"', () => {
    const m = projectGroupMatch(raw(4), 'u3');
    expect([m.p1_name, m.p2_name, m.group?.me, m.group?.foe]).toEqual(['P3', 'P4', 'p3', { seat: 'p4', copy: false }]);
    const c = projectGroupMatch(raw(3), 'u3'); // round 1 of three: p3 faces a Copy of p1
    expect([c.p2_name, c.group?.foe]).toEqual(['Copy of P1', { seat: 'p1', copy: true }]);
    expect(c.p2_user).not.toBe('u1'); // a Copy is never the copied player
  });

  it('the pill counts every living seat: "Players ready 3/4" when I locked and two others did', () => {
    const seats = [seat('p1', { locked: true }), seat('p2', { auto: true }), seat('p3'), seat('p4')];
    const m = projectGroupMatch(raw(4, {}, seats), 'u3');
    const t = versusTurn({ match: m, seat: 'p1', lockedRound: 1, run: { mode: 'versus', phase: 'recruit', wave: 1 }, now: 0 });
    expect(versusTurnNote(t)).toBe('Players ready 3/4');
  });

  it('a seat that is out sees its own match end at the round it went out in; the others play on', () => {
    const seats = [seat('p1'), seat('p2', { eliminatedRound: 3, outReason: 'hearts', health: 0, placement: 4 }), seat('p3'), seat('p4')];
    const out = projectGroupMatch(raw(4, { round: 4 }, seats), 'u2');
    expect([out.phase, out.round, out.end_reason, out.winner_seat]).toEqual(['complete', 3, 'hearts', 'p2']);
    const on = projectGroupMatch(raw(4, { round: 4 }, seats), 'u1');
    expect([on.phase, on.round]).toEqual(['shop', 4]);
    const left = projectGroupMatch(raw(4, { round: 4 }, [seat('p1'), seat('p2', { eliminatedRound: 4, outReason: 'left' }), seat('p3'), seat('p4')]), 'u2');
    expect(left.end_reason).toBe('forfeit'); // the end gate closes at once
  });

  it('the winner reads a won 1v1-shaped match; a spectator gets seats 1 and 2 and the table', () => {
    const done = raw(3, { phase: 'complete', winner_seat: 'p3', end_reason: 'hearts' });
    expect(projectGroupMatch(done, 'u3').winner_seat).toBe('p1');
    const spec = projectGroupMatch(raw(4), null);
    expect([spec.p1_name, spec.p2_name, spec.group?.me]).toEqual(['P1', 'P2', null]);
  });

  it('rounds: my fight from my side (p1_result), my opponent\x27s side as p2_result, and every seat\x27s own result', () => {
    const r: VersusGroupRoundRaw = {
      round: 1, vitals: { p1: { health: 30, armor: 0 }, p2: { health: 25, armor: 0 }, p3: { health: 30, armor: 0 }, p4: { health: 30, armor: 0 } }, eliminated: [],
      fights: [
        { round: 1, fight: 0, a_seat: 'p1', b_seat: 'p2', b_copy: false, chair: 'a', outcome: 'a', heart_lost_by: 'p2', a_result: res('A', 'win'), b_result: res('B', 'lose'), a_scout: null, b_scout: null },
        { round: 1, fight: 1, a_seat: 'p3', b_seat: 'p4', b_copy: false, chair: 'a', outcome: 'draw', heart_lost_by: null, a_result: res('C', 'draw'), b_result: res('D', 'draw'), a_scout: null, b_scout: null },
      ],
    };
    const mine = projectGroupRounds(raw(4), [r], 'u2')[1]!;
    expect([(mine.p1_result as { tag: string }).tag, (mine.p2_result as { tag: string }).tag, mine.heart_lost_by, mine.outcome, mine.p1_health]).toEqual(['B', 'A', 'p1', 'p2', 25]);
    expect((roundResultFor(mine, 'p4') as unknown as { tag: string }).tag).toBe('D');
    expect(roundResultFor({ p1_result: res('X', 'win'), p2_result: res('Y', 'lose') } as never, 'p2')).toEqual(res('Y', 'lose'));
  });
});

describe('Versus Group "Previous match stats" (R-VERSUS-GROUP-07)', () => {
  it('my fights round by round (each naming who I fought, a Copy included) and the whole table with places', async () => {
    const { buildGroupMatchRecord } = await import('./versusMatchRecord');
    const fr = (result: 'win' | 'lose' | 'draw'): CombatResult => ({ result, initial: { player: [], enemy: [] }, events: [], playerDamage: 0 } as unknown as CombatResult);
    const rounds: VersusGroupRoundRaw[] = [
      { round: 1, vitals: { p1: { health: 30, armor: 0 }, p2: { health: 25, armor: 0 }, p3: { health: 30, armor: 0 } }, eliminated: [], fights: [
        { round: 1, fight: 0, a_seat: 'p1', b_seat: 'p2', b_copy: false, chair: 'a', outcome: 'a', heart_lost_by: 'p2', a_result: fr('win'), b_result: fr('lose'), a_scout: null, b_scout: null },
        { round: 1, fight: 1, a_seat: 'p3', b_seat: 'p1', b_copy: true, chair: 'a', outcome: 'draw', heart_lost_by: null, a_result: fr('draw'), b_result: fr('draw'), a_scout: null, b_scout: null },
      ] },
    ];
    const seats = [seat('p1', { placement: null }), seat('p2', { eliminatedRound: 1, outReason: 'hearts', health: 0, placement: 3 }), seat('p3', { health: 30, eliminatedRound: 1, outReason: 'forfeit', placement: 2 })];
    const done = raw(3, { phase: 'complete', winner_seat: 'p1', end_reason: 'hearts', round: 1 }, seats);
    const mine = buildGroupMatchRecord(done, rounds, 'u3', null)!;
    expect(mine.rounds[0]!.foeName).toBe('Copy of P1');
    expect([mine.placement, mine.of, mine.outcome]).toEqual([2, 3, 'lose']);
    expect(mine.table!.map((t) => [t.name, t.placement, t.me])).toEqual([['P1', 1, false], ['P3', 2, true], ['P2', 3, false]]);
    const winner = buildGroupMatchRecord(done, rounds, 'u1', null)!;
    expect([winner.placement, winner.outcome, winner.rounds[0]!.foeName, winner.rounds[0]!.result]).toEqual([1, 'win', 'P2', 'win']);
  });
});
