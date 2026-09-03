/**
 * The bot DAMAGE RAMP must not break WHEN the player's health moves.
 *
 * Two independent changes meet here: the ramp multiplies what a lost round costs in a practice-BOTS game, and
 * `settleCombat` applies the player's own hit at END of combat so the number isn't frozen until the shop. They
 * only agree because the multiplier is folded into `combat.playerDamage` at `faceOmen` (before the round cap),
 * so the end-of-combat application and the later seat sync read the SAME number.
 *
 * If someone later moves the multiplier into `settleRunLobbyRound`'s player branch instead, the health would
 * drop once at end of combat and then JUMP again on returning to the shop — the exact bug the timing fix
 * removed. This pins that.
 */
import { describe, expect, it } from 'vitest';
import { createLobbyRun, reduce, type RunState, type Action } from './index';

describe('bot damage ramp × end-of-combat health timing', () => {
  for (const botDifficulty of [1, 3, 5, 10] as const) {
    it(`${botDifficulty}: the end-of-combat value is the final value (no second jump in the shop)`, () => {
      let s: RunState = createLobbyRun(11, 'aster', {}, 'practice', {
        opponents: 'bots', botDifficulty, health: 'normal', timeMult: 1, tribeSurge: null,
      });
      // A later round (bots have ramped) with an empty board, so the loss is certain and the hit is meaningful.
      s = { ...s, wave: 6, board: [] as never, lobby: { ...s.lobby!, round: 6 } };
      const before = s.resolve + s.armor;

      s = reduce(s, { type: 'faceOmen' } as Action);
      s = reduce(s, { type: 'settleCombat' } as Action);
      const atEndOfCombat = s.resolve + s.armor;

      s = reduce(s, { type: 'resolveCombat' } as Action);
      const backInShop = s.resolve + s.armor;

      expect(atEndOfCombat, 'the hit lands when combat ends').toBeLessThan(before);
      expect(backInShop, 'and the seat sync agrees — no second drop').toBe(atEndOfCombat);
    });
  }

  it('a harder difficulty costs more for the same fight', () => {
    const costOf = (botDifficulty: 1 | 5 | 10): number => {
      let s: RunState = createLobbyRun(11, 'aster', {}, 'practice', {
        opponents: 'bots', botDifficulty, health: 'normal', timeMult: 1, tribeSurge: null,
      });
      s = { ...s, wave: 6, board: [] as never, lobby: { ...s.lobby!, round: 6 } };
      const before = s.resolve + s.armor;
      for (const a of [{ type: 'faceOmen' }, { type: 'settleCombat' }] as Action[]) s = reduce(s, a);
      return before - (s.resolve + s.armor);
    };
    expect(costOf(5)).toBeGreaterThan(costOf(1));
    expect(costOf(10)).toBeGreaterThanOrEqual(costOf(5));
  });
});
