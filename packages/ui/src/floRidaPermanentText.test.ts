import { describe, it, expect } from 'vitest';
import { liveCardText, type LiveTextParams } from './instView';

// Flo Rida, owner 2026-10-08: "flo rida should add the word permanently to its text so it does not reset per round".
// The live text keeps printing the CURRENT grant (base + 5 per Beast this copy has seen, x golden) through the one
// chain the shop, board, hand and combat (`Unit.tsx`) all read, and keeps the new word. R-FLORIDA-01.
const base: LiveTextParams = {
  tier: 1, golden: false,
  spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0,
  spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0,
  undeadBuyAtk: 0, soulsmanGold: 0,
};

describe('Flo Rida live text: the current grant, permanently improving', () => {
  it('prints the live grant and the word permanently, plain and gilded', () => {
    expect(liveCardText('b2_florida', { ...base, summonBonus: 0 }).text)
      .toBe('When you summon a **Beast**, give it {{+5/+5}} and permanently improve this.');
    expect(liveCardText('b2_florida', { ...base, summonBonus: 2 }).text)
      .toBe('When you summon a **Beast**, give it {{+15/+15}} and permanently improve this.');
    expect(liveCardText('b2_florida', { ...base, summonBonus: 2, golden: true }).goldenText)
      .toBe('When you summon a **Beast**, give it {{+30/+30}} and permanently improve this.');
  });
});
