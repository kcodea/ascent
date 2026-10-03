import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { stepProgress } from './cardText';
import { detectCardKeywords } from './detectCardKeywords';

/**
 * Owner changes 2026-10-03 — the LIVE surfaces.
 *  - Tauntbreaker's new "Pummel (25)" prints its live progress toward the next payout on the step-counter badge
 *    (the shared Pummel tracker: `total mod 25`, the same reading in the shop and in combat), and its text pills
 *    Rally, Taunt, Rise and Pummel.
 *  - Venom's body now reads "Execute." so the Execute pill + glossary show.
 */
describe('Tauntbreaker: the Pummel (25) badge prints live progress', () => {
  it('reads total mod 25 (0/25 fresh, 20/25, 5/25 after one payout at 30)', () => {
    expect(stepProgress('tauntbreaker', { damageDealt: 0 })).toMatchObject({ current: 0, total: 25 });
    expect(stepProgress('tauntbreaker', { damageDealt: 20 })).toMatchObject({ current: 20, total: 25 });
    expect(stepProgress('tauntbreaker', { damageDealt: 30 })).toMatchObject({ current: 5, total: 25 });
  });

  it('pills Rally, Taunt, Rise and Pummel from its text', () => {
    const ids = detectCardKeywords(CARD_INDEX['tauntbreaker']!).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['rally', 'taunt', 'rise', 'pummel']));
  });
});

describe('Venom: the Execute keyword shows', () => {
  it('pills Execute from its body text', () => {
    expect(detectCardKeywords(CARD_INDEX['venom']!).map((e) => e.id)).toContain('execute');
  });
});
