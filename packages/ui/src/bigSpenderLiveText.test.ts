import { describe, it, expect } from 'vitest';
import { createRun, type BoardCard, type RunState } from '@game/sim';
import { CARD_INDEX } from '@game/content';
import { liveBoardView } from './instView';
import { runeTally } from './runeTally';

/**
 * BIG SPENDER live text (owner ruling 2026-11-17, R-BIG-SPENDER-ALL-01; the CLAUDE.md live-text rule): every card that
 * prints a number derived from Gold spent prints the COUNTED Gold (Big Spender's extra included), not the real Gold.
 * 20 real Gold spent with one Big Spender = 40 counted (`goldSpentExtra*` carries the extra 20).
 */
const card = (cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid: 'c', cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
const spent = (extra: number): RunState => ({
  ...createRun(3), goldSpent: 20, goldSpentThisTurn: 20, goldSpentExtra: extra, goldSpentExtraThisTurn: extra,
  questRecurringEndOfTurn: ['runeSpending'],
} as RunState);

describe('Big Spender: live texts print the counted Gold', () => {
  it('Rope Wrangler prints 1 + floor(counted / 10) Lassos', () => {
    expect(liveBoardView(card('ropewrangler'), spent(0)).text).toContain('{{(×3)}}');
    expect(liveBoardView(card('ropewrangler'), spent(20)).text).toContain('{{(×5)}}');
  });
  it('Baby Gastrid prints its Health from the counted Gold', () => {
    expect(liveBoardView(card('dw_dorrin'), spent(0)).text).toContain('{{+40 Health}}');
    expect(liveBoardView(card('dw_dorrin'), spent(20)).text).toContain('{{+80 Health}}');
  });
  it('Rune of Spending\'s badge prints the counted Gold', () => {
    expect(runeTally(spent(0), 'rune_spending')).toBe('20g');
    expect(runeTally(spent(20), 'rune_spending')).toBe('40g');
  });
});
