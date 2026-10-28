/**
 * EMPTY BOARDS IN EVERY VERSUS MODE (owner 2026-10-27, after Group / Duos with friends: "on round 1 i think only 1 board
 * fight because an opponent board was empty? make sure empty boards don't halt or break something"; R-VERSUS-EMPTY-01).
 *
 * An empty board (nothing bought, a missing or refused side) is an ordinary fight: it ends at once, the side with
 * minions wins and charges the lobby damage (its tier + its survivors' tiers), two empty sides draw and cost nobody.
 * DUOS (tag-team, docs/design/2026-10-25-versus-duos.md): an empty FIRST board hands straight over to its teammate; a
 * teammate whose board is empty never steps in, so when the other team's first board wins, its second board never
 * fights: "only one board fought" is the rule, not a stall.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, type BoardMinion } from '@game/core';
import type { PreparedCombatSide } from '../state';
import { resolveVersusFight } from './combat';
import { duosMateOf, duosRandomFirst, resolveVersusDuosRound } from './duos';
import { resolveVersusGroupRound, type VersusGroupSeat } from './group';
import type { VersusVitals } from './vitals';

const side = (board: BoardMinion[]): PreparedCombatSide => ({ board, state: combatSide(), config: {} });
const bags = (n: number, attack: number, health: number, tag: string): BoardMinion[] =>
  Array.from({ length: n }, (_, i) => ({ cardId: 'sandbag', attack, health, sourceUid: `${tag}${i}` }));
const EMPTY = (): PreparedCombatSide => side([]);
const POOL: VersusVitals = { health: 30, armor: 0 };

describe('Versus: an empty board never stalls a round (R-VERSUS-EMPTY-01)', () => {
  it('1v1: one empty side loses at once and pays the lobby damage; both empty is a draw that costs nobody', () => {
    const one = resolveVersusFight({ matchSeed: 4, round: 1, p1: side(bags(2, 2, 2, 'a')), p2: EMPTY(), vitals: { p1: POOL, p2: POOL } });
    expect([one.outcome, one.loser]).toEqual(['p1', 'p2']);
    expect(one.damage.p2).toBeGreaterThan(0);
    expect(one.vitals!.p2!.health).toBe(30 - one.damage.p2);
    // A missing / malformed side reads as empty (the resolver logs it) and fights exactly the same.
    const both = resolveVersusFight({ matchSeed: 4, round: 1, p1: EMPTY(), p2: EMPTY(), vitals: { p1: POOL, p2: POOL } });
    expect([both.outcome, both.damage]).toEqual(['draw', { p1: 0, p2: 0 }]);
    expect(both.vitals).toEqual({ p1: POOL, p2: POOL });
  });

  it('GROUP: an empty seat, an empty Copy and an all-empty table all resolve; a Copy is never charged', () => {
    const seats: VersusGroupSeat[] = ['p1', 'p2', 'p3', 'p4'];
    const four = resolveVersusGroupRound({
      matchSeed: 7, round: 1, seats, eliminated: {},
      sides: { p1: side(bags(1, 3, 3, 'a')), p3: side(bags(1, 1, 1, 'c')) }, // p2 and p4 sent nothing
      vitals: { p1: POOL, p2: POOL, p3: POOL, p4: POOL },
    });
    expect(four.fights.map((f) => [f.a, f.b, f.outcome, f.loser])).toEqual([['p1', 'p2', 'a', 'p2'], ['p3', 'p4', 'a', 'p4']]);
    expect(four.vitals!.p2!.health).toBeLessThan(30);
    // Three players, round 1: p1-p2, p3 vs a Copy of p1. p1's board is empty, so the Copy is empty too.
    const three = resolveVersusGroupRound({
      matchSeed: 7, round: 1, seats: ['p1', 'p2', 'p3'], eliminated: {},
      sides: { p2: side(bags(1, 2, 2, 'b')), p3: side(bags(1, 2, 2, 'c')) },
      vitals: { p1: POOL, p2: POOL, p3: POOL },
    });
    const copy = three.fights.find((f) => f.copy)!;
    expect([copy.a, copy.b, copy.outcome, copy.loser, copy.damage]).toEqual(['p3', 'p1', 'a', null, 0]);
    expect(three.vitals!.p1!.health).toBeLessThan(30); // p1 lost its own (real) fight to p2, not the copy's
    const none = resolveVersusGroupRound({ matchSeed: 7, round: 1, seats, eliminated: {}, sides: {}, vitals: { p1: POOL, p2: POOL, p3: POOL, p4: POOL } });
    expect(none.fights.every((f) => f.outcome === 'draw' && f.damage === 0)).toBe(true);
  });

  it('DUOS: an empty first board hands over; an empty reserve never steps in; an empty team loses; an empty table draws', () => {
    const pick = duosRandomFirst(5, 1);
    const [a1, a2, b1, b2] = [pick.a, duosMateOf(pick.a), pick.b, duosMateOf(pick.b)];
    const vitals = { a: POOL, b: POOL };
    // Team A's drawn first board is empty: its teammate fights first.
    const handover = resolveVersusDuosRound({ matchSeed: 5, round: 1, sides: { [a2]: side(bags(2, 5, 5, 'x')), [b1]: side(bags(1, 1, 1, 'y')), [b2]: side(bags(1, 1, 1, 'z')) }, vitals });
    expect(handover.first.a).toBe(a2);
    expect(handover.losingTeam).toBe('b');
    // Team A's first board wins outright against team B's first board whose reserve is EMPTY: one board fought each.
    const reserveEmpty = resolveVersusDuosRound({ matchSeed: 5, round: 1, sides: { [a1]: side(bags(2, 5, 5, 'x')), [b1]: side(bags(1, 1, 1, 'y')) }, vitals });
    expect([reserveEmpty.first, reserveEmpty.losingTeam]).toEqual([{ a: a1, b: b1 }, 'b']);
    expect(reserveEmpty.damage).toBeGreaterThan(0);
    expect(reserveEmpty.vitals!.b!.health).toBe(30 - reserveEmpty.damage);
    expect(reserveEmpty.vitals!.a).toEqual(POOL);
    // Team B sent nothing at all: team A wins and charges team B's pool.
    const emptyTeam = resolveVersusDuosRound({ matchSeed: 5, round: 1, sides: { [a1]: side(bags(1, 1, 1, 'x')) }, vitals });
    expect(emptyTeam.losingTeam).toBe('b');
    expect(emptyTeam.damage).toBeGreaterThan(0);
    // Nobody bought anything: a draw, nobody pays.
    const none = resolveVersusDuosRound({ matchSeed: 5, round: 1, sides: {}, vitals });
    expect([none.outcome, none.losingTeam, none.damage]).toEqual(['draw', null, 0]);
    expect(none.vitals).toEqual(vitals);
    void b2;
  });
});
