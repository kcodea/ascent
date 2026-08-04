import { describe, it, expect } from 'vitest';
import type { CombatResult } from '@game/core';
import { lossDamageCap } from '../reducer';
import { createRunLobby, pairRunLobby, playerLossDamage, settleRunLobbyRound } from './runLobby';

/**
 * TWO LOBBY RULES THE OWNER SET ON 2026-08-04.
 *
 * **1. Combat damage only.** *"Remove the stall pressure — this was never something I wanted in the game at
 * all. Players should only take dmg from combat dmg."* Stall pressure was a per-round extra hit every loser
 * (and both sides of a draw) took once the table went several rounds with nobody knocked out. It is gone;
 * `maxRounds` is the remaining stalemate backstop.
 *
 * It is also what produced the report that found it: the HUD showed `min(cap, playerDamage)` while the seat
 * was charged that PLUS pressure, so *"I had 13 hp and it said I took 11 but I died."* With pressure removed
 * the two agree by construction — but `playerLossDamage` stays as the single definition both the HUD and the
 * settle read, because the two silently diverging is the failure mode worth keeping closed.
 *
 * **2. Only the bottom three may face a ghost.** *"If there are 5 players left, the first and second place
 * players should never be able to face ghost."*
 */

const result = (over: Partial<CombatResult> = {}): CombatResult =>
  ({ result: 'lose', playerDamage: 11, enemyDamage: 0, events: [], initial: undefined, ...over } as unknown as CombatResult);

const lobbyAt = (round: number) => ({ ...createRunLobby(1234, 'warden', {}, 'set1'), round });

describe('the player takes COMBAT damage and nothing else', () => {
  it('a WIN costs nothing', () => {
    expect(playerLossDamage(lobbyAt(9), result({ result: 'win' }))).toBe(0);
  });

  it('a loss costs exactly the fight damage, capped by the round', () => {
    expect(lossDamageCap(9)).toBeGreaterThan(11);
    expect(playerLossDamage(lobbyAt(9), result())).toBe(11);
    // Round 2 caps a loss at 5, so a 40-damage rout still only takes 5.
    expect(lossDamageCap(2)).toBe(5);
    expect(playerLossDamage(lobbyAt(2), result({ playerDamage: 40 }))).toBe(5);
  });

  it('a DRAW costs nothing — there is no per-round attrition left', () => {
    // The assertion that fails first if stall pressure ever returns: a draw used to charge BOTH sides.
    expect(playerLossDamage(lobbyAt(9), result({ result: 'draw', playerDamage: 0 }))).toBe(0);
  });

  it("the readout equals the player seat's actual HP drop, at every round", () => {
    // The load-bearing case: it settles a REAL round and compares, so it is a claim about the settle rather
    // than about arithmetic agreeing with itself. Several rounds, because the cap varies across the course.
    for (const round of [2, 5, 9, 13, 17]) {
      const lobby = { ...createRunLobby(4242, 'warden', {}, 'set1'), round };
      const me = lobby.seats[0]!;
      const before = me.resolve + me.armor;
      const predicted = playerLossDamage(lobby, result());
      const settled = settleRunLobbyRound(
        { ...lobby, seats: lobby.seats.map((s) => ({ ...s })), encounters: [...lobby.encounters] },
        result(),
      );
      const after = settled.seats[0]!;
      expect(before - (after.resolve + after.armor), `round ${round}: HUD and seat disagree`).toBe(predicted);
    }
  });

  it('settling the same round repeatedly always costs the same — no per-round attrition accrues', () => {
    // The SHAPE of the old bug rather than its arithmetic: pressure grew with the number of quiet rounds, so
    // the identical fight got more expensive over time. Every settle here must cost the same 11.
    const base = { ...createRunLobby(77, 'warden', {}, 'set1'), round: 9 };
    const costs = [0, 1, 2, 3, 4, 5, 6].map(() => {
      const before = base.seats[0]!.resolve + base.seats[0]!.armor;
      const settled = settleRunLobbyRound(
        { ...base, seats: base.seats.map((s) => ({ ...s })), encounters: [...base.encounters] },
        result(),
      );
      return before - (settled.seats[0]!.resolve + settled.seats[0]!.armor);
    });
    expect(new Set(costs).size, 'the cost drifted between settles — per-round attrition is back').toBe(1);
    expect(costs[0]).toBe(11);
  });
});

describe('only the bottom three may face a ghost', () => {
  /** An odd-sized table with hand-set health, so "standing" is unambiguous. */
  const table = (hps: number[]) => {
    const l = createRunLobby(999, 'warden', {}, 'set1');
    const seats = l.seats.slice(0, hps.length).map((s, i) => ({ ...s, alive: true, armor: 0, resolve: hps[i]! }));
    return { ...l, seats, round: 6 };
  };

  it('with 5 alive, neither 1st nor 2nd can hold the bye', () => {
    // s0 = 50 (1st), s1 = 40 (2nd) — both excluded; the bye must come from s2/s3/s4. This is the owner's
    // example verbatim.
    const { bye } = pairRunLobby(table([50, 40, 30, 20, 10]));
    expect(bye, 'an odd table must produce a bye').toBeTruthy();
    expect(['s2', 's3', 's4'], `1st/2nd took the ghost: ${bye!.id}`).toContain(bye!.id);
  });

  it('follows STANDING, not seat index', () => {
    // Reverse the health order: s0 is now last and eligible, s4 is healthiest and must not be picked.
    const { bye } = pairRunLobby(table([10, 20, 30, 40, 50]));
    expect(['s0', 's1', 's2']).toContain(bye!.id);
  });

  it('counts Armor as part of standing, not Resolve alone', () => {
    const l = table([10, 10, 10, 10, 10]);
    const seats = l.seats.map((s, i) => (i < 2 ? { ...s, armor: 40 } : s)); // s0/s1 become 1st and 2nd
    const { bye } = pairRunLobby({ ...l, seats });
    expect(['s2', 's3', 's4']).toContain(bye!.id);
  });

  it('with 7 alive it is still the bottom THREE, not a fraction of the table', () => {
    const { bye } = pairRunLobby(table([70, 60, 50, 40, 30, 20, 10]));
    expect(['s4', 's5', 's6']).toContain(bye!.id);
  });

  it('stops binding at 3 alive, where every seat IS the bottom three', () => {
    const { bye } = pairRunLobby(table([30, 20, 10]));
    expect(bye, 'the rule must never leave an odd table with no eligible bye').toBeTruthy();
    expect(['s0', 's1', 's2']).toContain(bye!.id);
  });

  it('an EVEN table has no bye at all, so the rule never fires', () => {
    expect(pairRunLobby(table([60, 50, 40, 30, 20, 10])).bye).toBeNull();
  });

  it('is deterministic — the same table byes the same seat every time', () => {
    const lobby = table([50, 40, 30, 20, 10]);
    const ids = [0, 1, 2, 3].map(() => pairRunLobby(lobby).bye!.id);
    expect(new Set(ids).size).toBe(1);
  });
});
