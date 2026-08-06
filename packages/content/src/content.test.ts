import { describe, it, expect } from 'vitest';
import { ALL_CARDS, CARD_INDEX, QUEST_DEFS, QUEST_INDEX, referencedCardIds, validateCards, validateQuests } from './index';
import { SETS } from './sets';
import { TOKENS } from './cards/set1/tokens';
import { SET2_TOKENS } from './cards/set2/tokens';
import { HENCHMEN } from './cards/henchmen';
import { ENEMY } from './cards/set1/enemy';
import { ARCHIVED_CARDS } from './cards/archive';

describe('content', () => {
  it('all cards pass schema validation', () => {
    expect(() => validateCards()).not.toThrow();
  });

  describe('referencedCardIds — cards named in effects (hover-preview source)', () => {
    it("derives Spark Capacitor's Waking Rift (avengeGrantSpell)", () => {
      expect(referencedCardIds(CARD_INDEX['sparkcapacitor']!)).toContain('sparkplug');
    });
    it('derives the spell a minion CASTS so the hover-preview shows it (Hoardbreaker/Taragosa → Growth, Watcher → Lantern)', () => {
      expect(referencedCardIds(CARD_INDEX['hoardbreaker']!)).toContain('growth'); // rallyCastSpell + onKillCastSpell
      expect(referencedCardIds(CARD_INDEX['taragosa']!)).toContain('growth'); // onAllyAttackCastGrowth (reference-only spellId)
      expect(referencedCardIds(CARD_INDEX['watcher']!)).toContain('lanternofsouls'); // rallyCastTribeAttack
      expect(referencedCardIds(CARD_INDEX['ropewrangler']!)).toContain('lasso'); // castSpell (EoT)
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

  it('no id is defined in two different card lists (a shadowed duplicate is invisible)', () => {
    // ALL_CARDS de-dupes by id keeping the FIRST occurrence, so a second definition of an existing id is
    // silently discarded — the author sees their card in the source and the game plays the other one. That
    // cost us Chicken Brawl's charge (2026-08-06): a `dw_soldier` with `attackOnSummon` was authored in
    // set2/tokens.ts while Anvilshade's flag-less `dw_soldier` in set2/dwarves.ts kept winning the de-dupe.
    //
    // Sets legitimately SHARE cards (the same object appears in two sets' `own`), so identity — not id — is
    // what makes a repeat benign: two lists may name the same id only when it is literally the same object.
    const lists: [string, readonly { id: string }[]][] = [
      ['sets.own', Object.values(SETS).flatMap((s) => s.own)],
      ['set1 TOKENS', TOKENS],
      ['SET2_TOKENS', SET2_TOKENS],
      ['HENCHMEN', HENCHMEN],
      ['ENEMY', ENEMY],
      ['ARCHIVED_CARDS', ARCHIVED_CARDS],
    ];
    const byId = new Map<string, { list: string; card: { id: string } }[]>();
    for (const [list, cards] of lists) {
      for (const card of cards) byId.set(card.id, [...(byId.get(card.id) ?? []), { list, card }]);
    }
    const shadowed = [...byId.entries()]
      .filter(([, entries]) => entries.some((e) => e.card !== entries[0]!.card))
      .map(([id, entries]) => `${id} (${entries.map((e) => e.list).join(' + ')})`);
    expect(shadowed, 'distinct card objects sharing one id').toEqual([]);
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
