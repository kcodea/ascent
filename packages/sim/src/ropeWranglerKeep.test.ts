import { describe, it, expect } from 'vitest';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { CARD_INDEX } from '@game/content';

/** Rope Wrangler no longer eats the card it summons (owner report 2026-08-08). */
const bc = (uid: string, cardId: string, a = 3, h = 3): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });

describe('Rope Wrangler keeps the hand card it summons', () => {
  it('a fight where its Echo fires leaves the hand minion in hand afterwards', () => {
    // A fragile Wrangler dies early; its Echo summons a hand minion into the fight. The card must still be
    // in hand at the next recruit — the summoned body is combat-only, like every other summon.
    let s: RunState = {
      // Seed 1 is chosen deliberately: its Echo DOES summon the hand card ('h'), so the assertion below
      // cannot pass vacuously. On the pre-fix code this seed left the hand empty.
      ...createRun(1, 'runesmith'), wave: 7, phase: 'recruit', embers: 10,
      board: [bc('w', 'ropewrangler', 5, 1)],
      hand: [bc('h', 'alley', 2, 2)],
    } as RunState;
    s = reduce(s, { type: 'faceOmen' }) as RunState;
    s = reduce(s, { type: 'settleCombat' }) as RunState;
    expect(s.lastCombat?.playerHandSummoned, 'the fixture must actually summon the hand card').toContain('h');
    expect(s.hand.some((c) => c.uid === 'h'), 'the Echo summoned it and settle then ATE the card').toBe(true);
  });
});
