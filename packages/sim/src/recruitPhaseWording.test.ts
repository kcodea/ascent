/**
 * R-TEXT-RECRUIT-PHASE-01 (owner 2026-11-17): text that means the shopping part of the turn says "Recruit phase";
 * "the Shop" means only the offer row. Pins the texts the sweep corrected so a later edit cannot quietly revert them.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { ANCIENT_PAIRINGS } from './ancients';

const runeText = (name: string): string => [...RUNES, ...EPIC_RUNES].find((r) => r.name === name)!.text;
const cardByName = (name: string) => Object.values(CARD_INDEX).find((c) => c?.name === name)!;
/** Phase phrasings the sweep removed. "in the Shop" alone is legitimate (the offer row), so it is checked per text. */
const PHASE_AS_SHOP = /\bduring the Shop phase\b|\bshop or combat\b|\bshop and combat\b|\bshop turns?\b/i;

describe('Recruit-phase wording (R-TEXT-RECRUIT-PHASE-01)', () => {
  it('the runes that meant the phase say "Recruit phase"', () => {
    for (const name of ['Last Rites', 'Crowded Crypt', 'Gravedigger', 'Open Grave']) {
      const t = runeText(name);
      expect(t, name).toMatch(/Recruit phase/);
      expect(t, name).not.toMatch(/in the \**Shop\b|Shop phase/);
    }
  });
  it('the cards that meant the phase say "Recruit phase", plain and Gilded', () => {
    for (const name of ['Pack Leader', 'Archmagus Guel']) {
      const c = cardByName(name);
      for (const t of [c.text ?? '', c.goldenText ?? '']) {
        expect(t, name).toMatch(/Recruit phase/);
        expect(t, name).not.toMatch(PHASE_AS_SHOP);
        expect(t, name).not.toMatch(/in the \**Shop\b/);
      }
    }
  });
  it('the Soren and Auctioneer Fortune pairings say "Recruit phase" or nothing about the Shop', () => {
    for (const t of [ANCIENT_PAIRINGS.soren!.fortune!.offerText, ANCIENT_PAIRINGS.soren!.fortune!.powerText,
      ANCIENT_PAIRINGS.myra!.fortune!.offerText, ANCIENT_PAIRINGS.myra!.fortune!.powerText]) {
      expect(t).not.toMatch(/in the Shop/);
    }
    expect(ANCIENT_PAIRINGS.myra!.fortune!.offerText).toMatch(/in the Recruit phase/);
  });
  it('the offer-row meaning keeps "in the Shop"', () => {
    expect(cardByName('Contract Butcher').text).toMatch(/minions in the Shop/);
    expect(runeText('Gravedigger')).not.toMatch(PHASE_AS_SHOP);
  });
});
