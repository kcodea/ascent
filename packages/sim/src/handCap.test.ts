import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { CONFIG, createRun, type BoardCard, type RunState } from './index';
import { grantMinionToHandOrBoard } from './recruit';

// The hand is a hard 10-card cap: no grant/discover/reward may push it past CONFIG.handMax. Grants overflow to
// the board when the hand is full, and are DROPPED only when the board is full too (never over-capped).
describe('hand is hard-capped at CONFIG.handMax', () => {
  const filler = (n: number, prefix: string): BoardCard[] =>
    Array.from({ length: n }, (_, i) => ({ uid: `${prefix}${i}`, cardId: 'alley', tribe: 'neutral' as const, attack: 1, health: 1, keywords: [], golden: false }));
  const def = CARD_INDEX['alley']!;

  it('grants to the hand while there is room', () => {
    const s: RunState = { ...createRun(1), hand: filler(9, 'h'), board: [] };
    grantMinionToHandOrBoard(s, def, false);
    expect(s.hand.length).toBe(10);
  });

  it('overflows to the board when the hand is full', () => {
    const s: RunState = { ...createRun(1), hand: filler(CONFIG.handMax, 'h'), board: filler(3, 'b') };
    grantMinionToHandOrBoard(s, def, false);
    expect(s.hand.length).toBe(CONFIG.handMax); // unchanged — still capped
    expect(s.board.length).toBe(4); // went to the board instead
  });

  it('drops the grant when BOTH hand and board are full (never over-caps the hand)', () => {
    const s: RunState = { ...createRun(1), hand: filler(CONFIG.handMax, 'h'), board: filler(CONFIG.boardMax, 'b') };
    grantMinionToHandOrBoard(s, def, false);
    expect(s.hand.length).toBe(CONFIG.handMax);
    expect(s.board.length).toBe(CONFIG.boardMax);
  });

  it('quest/rune REWARD cards (overflow) DO over-cap the hand rather than being dropped', () => {
    const s: RunState = { ...createRun(1), hand: filler(CONFIG.handMax, 'h'), board: filler(CONFIG.boardMax, 'b') };
    grantMinionToHandOrBoard(s, def, false, true); // overflow = true (a quest/rune reward)
    expect(s.hand.length).toBe(CONFIG.handMax + 1); // reward is never lost — it over-caps
  });
});
