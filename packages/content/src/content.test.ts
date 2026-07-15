import { describe, it, expect } from 'vitest';
import { ALL_CARDS, CARD_INDEX, QUEST_DEFS, QUEST_INDEX, referencedCardIds, validateCards, validateQuests } from './index';

describe('content', () => {
  it('all cards pass schema validation', () => {
    expect(() => validateCards()).not.toThrow();
  });

  describe('referencedCardIds — cards named in effects (hover-preview source)', () => {
    it("derives Spark Capacitor's Spark Plug (avengeGrantSpell)", () => {
      expect(referencedCardIds(CARD_INDEX['sparkcapacitor']!)).toContain('sparkplug');
    });
    it('derives the spell a minion CASTS so the hover-preview shows it (Hoardbreaker/Taragosa → Growth, Watcher → Lantern)', () => {
      expect(referencedCardIds(CARD_INDEX['hoardbreaker']!)).toContain('growth'); // rallyCastSpell + onKillCastSpell
      expect(referencedCardIds(CARD_INDEX['taragosa']!)).toContain('growth'); // onAllyAttackCastGrowth (reference-only spellId)
      expect(referencedCardIds(CARD_INDEX['watcher']!)).toContain('lanternofsouls'); // rallyCastTribeAttack
      expect(referencedCardIds(CARD_INDEX['vineweaver']!)).toContain('growth'); // endOfTurnCastSpellEscalating
    });
    it('every referenced id resolves to a real card, and never lists the card itself', () => {
      for (const c of ALL_CARDS) {
        const refs = referencedCardIds(c);
        expect(refs).not.toContain(c.id);
        for (const id of refs) expect(CARD_INDEX[id], `${c.id} → ${id}`).toBeDefined();
      }
    });
  });

  it('all quests pass schema validation + have unique ids', () => {
    expect(() => validateQuests()).not.toThrow();
    expect(Object.keys(QUEST_INDEX).length).toBe(QUEST_DEFS.length);
  });

  it('card ids are unique', () => {
    expect(Object.keys(CARD_INDEX).length).toBe(ALL_CARDS.length);
  });

  it('every buyable card conveys its meaning — body text or a keyword', () => {
    // Keyword-only cards (e.g. a plain Taunt) ship empty text on purpose: the
    // keyword badge + hover tooltip carry the meaning. So a card must have one.
    // Tokens are runtime filler (the Omen's stats/keywords come from the threat
    // generator), so they're exempt.
    for (const card of ALL_CARDS) {
      if (card.token) continue;
      expect(card.text.length > 0 || card.keywords.length > 0).toBe(true);
    }
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
