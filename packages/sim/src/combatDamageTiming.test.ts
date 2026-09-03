/**
 * WHEN the player's health number moves (owner report 2026-08-25: "the actual health number does not change to
 * reflect the damage taken until returning to shop").
 *
 * In a lobby-family run the SEAT owns health and the table settles at `resolveCombat` — deliberately, so the
 * eliminations / next opponent appear together when you leave the fight. That left the player's own Resolve
 * frozen through the whole defeat sequence. It must now land at `settleCombat` (end of the replay), and the
 * later seat sync must agree exactly rather than moving it again.
 */
import { describe, expect, it } from 'vitest';
import { createLobbyRun, reduce, type RunState, type Action } from './index';

/** Drive one combat with a hopeless board so the player certainly loses. */
function fightAndLose(s: RunState): RunState {
  s = { ...s, board: [] as never }; // no minions → guaranteed loss
  for (const a of [{ type: 'faceOmen' }] as Action[]) s = reduce(s, a);
  return s;
}

describe('the player\'s Resolve reflects combat damage at END OF COMBAT', () => {
  it('drops on settleCombat, and resolveCombat does not move it again', () => {
    let s = createLobbyRun(11, 'aster', {}, 'lobby');
    const before = s.resolve + s.armor;
    s = fightAndLose(s);
    expect(s.lastCombat?.result, 'an empty board loses').toBe('lose');

    s = reduce(s, { type: 'settleCombat' } as Action);
    const afterSettle = s.resolve + s.armor;
    expect(afterSettle, 'the hit lands at end of combat, not later').toBeLessThan(before);

    s = reduce(s, { type: 'resolveCombat' } as Action);
    const afterResolve = s.resolve + s.armor;
    expect(afterResolve, 'the seat sync agrees — no second charge, no jump').toBe(afterSettle);
  });

  it('the amount equals exactly one application of the round damage', () => {
    let s = createLobbyRun(11, 'aster', {}, 'lobby');
    const before = s.resolve + s.armor;
    s = fightAndLose(s);
    const dealt = Math.min(s.lastCombat!.playerDamage, before);
    s = reduce(s, { type: 'settleCombat' } as Action);
    s = reduce(s, { type: 'resolveCombat' } as Action);
    expect(before - (s.resolve + s.armor)).toBe(dealt);
  });

  it('PRACTICE invulnerability still shrugs it off (the run must not leak damage into the seat)', () => {
    let s = createLobbyRun(11, 'aster', {}, 'practice', {
      opponents: 'players', botDifficulty: 3, health: 'unlimited', timeMult: 1, tribeSurge: null,
    });
    const before = s.resolve + s.armor;
    s = fightAndLose(s);
    s = reduce(s, { type: 'settleCombat' } as Action);
    s = reduce(s, { type: 'resolveCombat' } as Action);
    expect(s.resolve + s.armor, 'unlimited health takes nothing').toBe(before);
    expect(s.lobby!.seats[0]!.alive).toBe(true);
  });

  it('PRACTICE on normal health DOES take it at end of combat', () => {
    let s = createLobbyRun(11, 'aster', {}, 'practice', {
      opponents: 'players', botDifficulty: 3, health: 'normal', timeMult: 1, tribeSurge: null,
    });
    const before = s.resolve + s.armor;
    s = fightAndLose(s);
    s = reduce(s, { type: 'settleCombat' } as Action);
    expect(s.resolve + s.armor).toBeLessThan(before);
  });
});
