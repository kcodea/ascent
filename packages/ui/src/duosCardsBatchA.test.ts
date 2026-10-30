import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { BoardCard } from '@game/sim';
import { cardTypeTallyText, duosTurnCapText } from './cardText';
import { instView, liveCardText } from './instView';
import { detectCardKeywords } from './detectCardKeywords';

/**
 * DUOS-ONLY CARDS, batch A (owner design 2026-10-30): the live-text surfaces. Engine behaviour is pinned in
 * `packages/sim/src/duosCardsBatchA.test.ts`.
 */
const bag = { tier: 5, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0, undeadBuyAtk: 0, soulsmanGold: 0 };
const card = (cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid: 'u1', cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};

describe('Salandaman: its live total and death count, in place (Spear Warden\'s helper)', () => {
  it('printed with no deaths; the total and the count after two', () => {
    expect(cardTypeTallyText('duo_salandaman', undefined)).toBeNull();
    const t = cardTypeTallyText('duo_salandaman', { attack: 8, health: 8 })!;
    expect(t).toContain('{{+8/+8}}');
    expect(t).toContain('{{2}} so far');
    expect(liveCardText('duo_salandaman', { ...bag, cardBuffs: { duo_salandaman: { attack: 4, health: 4 } } }).text).toContain('{{1}} so far');
  });
});

describe('the Duos "(Once / Twice per turn)" caps count down live', () => {
  it('printed before the first use; N left after (Bratworst of 2, Galfagan and Hippie Hulk of 1)', () => {
    expect(duosTurnCapText('duo_bratworst', false, 0)).toBe(CARD_INDEX['duo_bratworst']!.text);
    expect(duosTurnCapText('duo_bratworst', false, 1)).toContain('{{(1 left this turn)}}');
    expect(duosTurnCapText('duo_bratworst', true, 2)).toContain('{{(0 left this turn)}}');
    expect(duosTurnCapText('duo_galfagan', false, 1)).toContain('{{(0 left this turn)}}');
    expect(duosTurnCapText('duo_hippiehulk', true, 1)).toContain('double');
    expect(duosTurnCapText('duo_roo', false, 1)).toBeNull();
    // The board view reads the copy's own count.
    const v = instView(card('duo_bratworst', { duosUses: { aleCastGiftTeammate: 1 } }), 3);
    expect(v.text).toContain('1 left this turn');
  });
});

describe('Broshake folds spell power into both printed values', () => {
  it('+3/+5 goes live with spell power', () => {
    expect(liveCardText('duo_broshake', { ...bag, spellBonus: 2, spellBonusH: 1 }).text).toContain('{{+5/+6}}');
  });
});

describe('every batch A pass card raises the Pass pill', () => {
  it('Roo, Proxus and Galfagan', () => {
    for (const id of ['duo_roo', 'duo_proxus', 'duo_galfagan']) {
      const d = CARD_INDEX[id]!;
      expect(detectCardKeywords({ text: d.text, keywords: d.keywords }).some((k) => k.id === 'pass'), id).toBe(true);
    }
  });
});

describe('no batch A text breaks the player text style', () => {
  it('no em dash, no "--", never "Oath" or "climb"', () => {
    for (const id of ['duo_antsy', 'duo_salandaman', 'duo_bratworst', 'duo_spencer', 'duo_roo', 'duo_toottoot', 'duo_proxus', 'duo_hippiehulk', 'duo_galfagan', 'duo_monstrocity', 'duo_broshake', 'duo_tribebundle']) {
      const d = CARD_INDEX[id]!;
      for (const t of [d.text, d.goldenText ?? '']) expect(/—|--|Oath|climb/i.test(t), `${id}: ${t}`).toBe(false);
    }
  });
});
