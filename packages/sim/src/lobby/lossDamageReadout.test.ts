import { describe, it, expect } from 'vitest';
import type { CombatResult } from '@game/core';
import { lossDamageCap } from '../reducer';
import { createRunLobby, playerLossDamage, settleRunLobbyRound, stallPressure } from './runLobby';

/**
 * THE NUMBER ON SCREEN MUST BE THE HIT YOU TOOK.
 *
 * Owner report 2026-08-04: *"I just had 13 hp and it said I took 11 but I died."*
 *
 * Both numbers were correct in isolation. The loss counter showed `min(cap, playerDamage)` — the FIGHT's
 * damage — while the seat was additionally charged STALL PRESSURE, the growing extra hit every loser takes
 * once the lobby goes several rounds without an elimination. 11 + 2 pressure = 13, so the player died at
 * exactly the health the HUD said they would survive on, and it read as a health bug rather than a mechanic.
 *
 * `playerLossDamage` is now the one answer to "how much does the player lose this round", shared by the settle
 * and the HUD. The load-bearing test is the last one: it settles a real lobby round and asserts the seat's
 * actual HP drop equals what the readout would have printed — which is a claim about the SETTLE, not just
 * about arithmetic agreeing with itself.
 */

const result = (over: Partial<CombatResult> = {}): CombatResult =>
  ({ result: 'lose', playerDamage: 11, enemyDamage: 0, events: [], initial: undefined, ...over } as unknown as CombatResult);

const lobbyWith = (quietRounds: number, round = 5) => {
  const l = createRunLobby(1234, 'warden', {}, 'set1');
  return { ...l, round, quietRounds };
};

describe('stall pressure', () => {
  it('is zero until the lobby has been quiet for the configured number of rounds', () => {
    const l = lobbyWith(0);
    expect(stallPressure({ quietRounds: 0, rules: l.rules })).toBe(0);
    expect(stallPressure({ quietRounds: l.rules.pressureAfterQuietRounds - 1, rules: l.rules })).toBe(0);
  });

  it('starts at 1 on the threshold round and grows by 1 per further quiet round', () => {
    const { rules } = lobbyWith(0);
    const at = (q: number) => stallPressure({ quietRounds: q, rules });
    expect(at(rules.pressureAfterQuietRounds)).toBe(1);
    expect(at(rules.pressureAfterQuietRounds + 1)).toBe(2);
    expect(at(rules.pressureAfterQuietRounds + 3)).toBe(4);
  });
});

describe('what the HUD reports', () => {
  it('a WIN costs nothing', () => {
    expect(playerLossDamage(lobbyWith(99), result({ result: 'win' }))).toBe(0);
  });

  it('with no pressure, it is just the capped fight damage', () => {
    const l = lobbyWith(0, 5);
    expect(playerLossDamage(l, result())).toBe(Math.min(lossDamageCap(5), 11));
  });

  it('INCLUDES stall pressure — the whole bug in one assertion', () => {
    // Round 8 (cap 15) so the 11 isn't capped and the arithmetic is the reported one exactly: 11 + 2 = 13,
    // the health the player had. At round 5 the cap is 10 and the sum would be 12 for a different reason.
    const l = lobbyWith(lobbyWith(0).rules.pressureAfterQuietRounds + 1, 8); // pressure = 2
    expect(lossDamageCap(8)).toBeGreaterThan(11);
    expect(playerLossDamage(l, result())).toBe(13);
    expect(playerLossDamage(l, result()), 'reporting the fight damage alone is what killed a player at "11"')
      .not.toBe(11);
  });

  it('a DRAW is charged pressure too, matching the settle', () => {
    const l = lobbyWith(lobbyWith(0).rules.pressureAfterQuietRounds, 5); // pressure = 1
    expect(playerLossDamage(l, result({ result: 'draw', playerDamage: 0 }))).toBe(1);
  });

  it('caps the FIGHT damage but not the pressure on top of it', () => {
    // Round 2 caps a loss at 5. A 40-damage fight is charged 5 + pressure, not capped after the addition.
    const l = lobbyWith(lobbyWith(0).rules.pressureAfterQuietRounds + 1, 2); // pressure = 2
    expect(lossDamageCap(2)).toBe(5);
    expect(playerLossDamage(l, result({ playerDamage: 40 }))).toBe(7);
  });
});

describe('the readout against a real settle', () => {
  it("equals the player seat's actual HP drop", () => {
    // Drive the pressure high enough that omitting it would be visible, then settle for real.
    const base = createRunLobby(4242, 'warden', {}, 'set1');
    const lobby = { ...base, round: 5, quietRounds: base.rules.pressureAfterQuietRounds + 1 };
    const me = lobby.seats[0]!;
    const before = me.resolve + me.armor;

    const predicted = playerLossDamage(lobby, result()); // what the HUD would print
    const settled = settleRunLobbyRound(
      { ...lobby, seats: lobby.seats.map((s) => ({ ...s })), encounters: [...lobby.encounters] },
      result(),
    );
    const after = settled.seats[0]!;
    const actual = before - (after.resolve + after.armor);

    expect(predicted, 'the fixture must exercise pressure, or this proves nothing').toBeGreaterThan(11);
    expect(actual, 'the HUD number and the hit the seat took must be the same number').toBe(predicted);
  });
});
