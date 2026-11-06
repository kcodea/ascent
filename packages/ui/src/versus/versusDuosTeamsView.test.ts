/**
 * VERSUS DUOS, THREE AND FOUR TEAMS on the client (R-VERSUS-EIGHT-01): the schedule shown in the shop, who I fight, and a
 * seat of team c or d finding its own fight.
 */
import { describe, expect, it } from 'vitest';
import type { CombatResult } from '@game/core';
import type { VersusGroupSeat } from '@game/sim';
import { duosCombatAt, duosFirstAt, foeIn, groupPairingAt, projectGroupRounds, resultsOf } from './versusGroupView';
import type { VersusGroupFightRow, VersusGroupMatchRaw, VersusGroupRoundRaw } from './versusRemote';

const SEATS: VersusGroupSeat[] = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
const raw = (n: number, out: Partial<Record<VersusGroupSeat, number>> = {}): VersusGroupMatchRaw => ({
  id: 'm', seed: 99, round: 1, options: { mode: 'duos' },
  seats: SEATS.slice(0, n).map((seat) => ({ seat, userId: `u-${seat}`, name: seat, eliminatedRound: out[seat] ?? null })),
}) as unknown as VersusGroupMatchRaw;

const result = (a: VersusGroupSeat, b: VersusGroupSeat): CombatResult => ({ result: 'win', duosFirst: { a, b }, events: [], initial: { player: [], enemy: [] } }) as unknown as CombatResult;
const fight = (i: number, a: VersusGroupSeat, b: VersusGroupSeat, copy = false): VersusGroupFightRow => ({
  round: 1, fight: i, a_seat: a, b_seat: b, b_copy: copy, chair: 'a', outcome: 'a', heart_lost_by: copy ? null : b, damage: copy ? 0 : 3,
  a_result: result(a, b), b_result: result(a, b), a_scout: null, b_scout: null,
}) as unknown as VersusGroupFightRow;
const round = (fights: VersusGroupFightRow[]): VersusGroupRoundRaw => ({ round: 1, fights, vitals: {}, eliminated: [] }) as unknown as VersusGroupRoundRaw;

describe('Duos client with more than two teams (R-VERSUS-EIGHT-01)', () => {
  it('four teams: two fights, and every seat of a team has the same foe', () => {
    const m = raw(8);
    const ps = groupPairingAt(m, 1);
    expect(ps).toHaveLength(2);
    for (const [x, y] of [['p5', 'p6'], ['p7', 'p8']] as const) expect(foeIn(ps, x)).toEqual(foeIn(ps, y));
    expect(foeIn(ps, 'p7')!.copy).toBe(false);
    expect(Object.keys(duosFirstAt(m, 1)).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('three teams: the odd team faces a Copy; the copied team still has its real fight', () => {
    const ps = groupPairingAt(raw(6), 1);
    expect(ps).toHaveLength(2);
    const copy = ps.find((p) => p.copy)!;
    const odd = foeIn(ps, copy.a)!;
    expect(odd.copy).toBe(true);
    expect(foeIn(ps, copy.b)!.copy).toBe(false);
  });

  it('a team knocked out leaves the schedule the round after', () => {
    expect(groupPairingAt(raw(8, { p7: 1, p8: 1 }), 2).filter((p) => p.copy)).toHaveLength(1);
  });

  it('a seat of team c finds its own fight, and nobody owns a Copy', () => {
    const m = raw(6);
    const r = round([fight(0, 'p1', 'p3'), fight(1, 'p5', 'p1', true)]);
    const results = resultsOf(r);
    expect(results.p5).toBeTruthy();
    expect(results.p6).toBeTruthy();
    expect(results.p1!.duosFirst).toEqual({ a: 'p1', b: 'p3' }); // team a's real fight, not the Copy of it
    expect(projectGroupRounds(m, [r], 'u-p6')[1]!.group).toBe(r);
    expect(projectGroupRounds(m, [r], 'u-p6')[1]!.heart_lost_by).toBeNull();
  });

  it('the fight screen reads each side by the fight, not by team letter', () => {
    const m = raw(8);
    const combat = result('p7', 'p3');
    const events = [{ type: 'tagIn', side: 'enemy' }] as never;
    const now = duosCombatAt(combat, m, 'p3', events, 1);
    expect(now.tag?.seat).toBe('p8'); // viewer on team b: the enemy side is team d, whose second board is p8
  });
});
