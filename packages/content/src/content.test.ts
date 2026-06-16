import { describe, it, expect } from 'vitest';
import { ALL_CARDS, CARD_INDEX, validateCards } from './index';

describe('content', () => {
  it('all cards pass schema validation', () => {
    expect(() => validateCards()).not.toThrow();
  });

  it('card ids are unique', () => {
    expect(Object.keys(CARD_INDEX).length).toBe(ALL_CARDS.length);
  });

  it('every card ships non-empty newcomer text', () => {
    for (const card of ALL_CARDS) expect(card.text.length).toBeGreaterThan(0);
  });

  it('Deathrattle-summon effects reference tokens that exist', () => {
    for (const card of ALL_CARDS) {
      for (const effect of card.effects) {
        if (effect.do === 'deathrattleSummon') {
          const tokenId = (effect.params as { tokenId?: string } | undefined)?.tokenId;
          expect(tokenId && CARD_INDEX[tokenId]).toBeTruthy();
        }
      }
    }
  });
});
