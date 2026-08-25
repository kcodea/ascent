/**
 * Re-firing a TARGETED Battlecry with no manual aim (Resonance spell, Myra, Echoing Roar) must auto-pick a
 * RANDOM valid friendly and apply the effect — owner report 2026-08-25: Resonance on Baby Gastrid did nothing
 * because the replay path passed no target and the buff factory early-returned.
 */
import { describe, expect, it } from 'vitest';
import { createRun, type RunState } from './index';
import { replayBattlecry } from './recruit';

describe('Resonance re-firing Baby Gastrid buffs a random friendly Dwarf', () => {
  it('applies the +2 Health/Gold buff to a friendly Dwarf', () => {
    let s: RunState = createRun(5, 'aster', 'practice');
    s = { ...s, goldSpentThisTurn: 3, board: [
      { uid: 'g', cardId: 'dw_dorrin', tribe: 'dwarf', attack: 2, health: 4, keywords: [], buffs: [] },
      { uid: 'd2', cardId: 'dw_dorrin', tribe: 'dwarf', attack: 2, health: 4, keywords: [], buffs: [] },
    ] as never };
    const before = s.board.reduce((n, c) => n + c.health, 0);
    const fired = replayBattlecry(s, s.board[0]! as never);
    expect(fired).toBe(true);
    expect(s.board.reduce((n, c) => n + c.health, 0) - before).toBe(6); // +2/Gold × 3 Gold
  });

  it('with only Baby Gastrid itself as a Dwarf, it still lands (buffs itself)', () => {
    let s: RunState = createRun(5, 'aster', 'practice');
    s = { ...s, goldSpentThisTurn: 2, board: [
      { uid: 'g', cardId: 'dw_dorrin', tribe: 'dwarf', attack: 2, health: 4, keywords: [], buffs: [] },
    ] as never };
    expect(replayBattlecry(s, s.board[0]! as never)).toBe(true);
    expect(s.board[0]!.health).toBe(4 + 4); // +2 × 2 Gold
  });
});
