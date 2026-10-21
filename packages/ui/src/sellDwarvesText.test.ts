/**
 * SET 3 SELL DWARVES (owner batch 2026-10-21): the live text prints what each card is doing right now.
 *   Mark Eting  the sales still owed to the next Shop Spell ("2 more minions"), plain and Gilded.
 *   Valyou      the triggers still owed to the next Gold.
 *   Leeds       the CURRENT grant in place (+2/+2 -> +4/+4 after 4 sales) and the sales owed to the next step.
 * All three also wear the shared sold-meter counter (N/4).
 */
import { describe, expect, it } from 'vitest';
import { liveCardText } from './instView';
import { stepProgress } from './cardText';

const base = { tier: 6, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0 };
const live = (id: string, soldProgress: number | undefined, golden = false) => {
  const r = liveCardText(id, { ...base, golden, soldProgress } as never);
  return golden ? r.goldenText ?? r.text : r.text;
};

describe('Mark Eting: counts down the Sells to the next Shop Spell', () => {
  it('prints the printed text with no progress, then the sales still owed', () => {
    expect(live('dw3_marketing', 0)).toBe('When you **Sell** **4 minions**, get a random **Shop Spell**.');
    expect(live('dw3_marketing', 2)).toBe('When you **Sell** {{2 more minions}}, get a random **Shop Spell**.');
    expect(live('dw3_marketing', 3)).toBe('When you **Sell** {{1 more minion}}, get a random **Shop Spell**.');
  });
  it('Gilded keeps its 2 spells while counting down', () => {
    expect(live('dw3_marketing', 1, true)).toBe('When you **Sell** {{3 more minions}}, get **2** random **Shop Spells**.');
  });
  it('wears the N/4 sold counter', () => {
    expect(stepProgress('dw3_marketing', { soldProgress: 3 })).toEqual({ current: 3, total: 4 });
  });
});

describe('Valyou: counts down the triggers to the next Gold', () => {
  it('prints the triggers still owed beside the threshold', () => {
    expect(live('dw3_valyou', 0)).toBe('When you **Sell** a minion, gain **+3/+3**. Every **4** triggers also grants **2 Gold**.');
    expect(live('dw3_valyou', 1)).toBe('When you **Sell** a minion, gain **+3/+3**. Every **4** triggers ({{3 more}}) also grants **2 Gold**.');
    expect(live('dw3_valyou', 3, true)).toBe('When you **Sell** a minion, gain **+6/+6**. Every **4** triggers ({{1 more}}) also grants **4 Gold**.');
  });
  it('wears the N/4 sold counter', () => {
    expect(stepProgress('dw3_valyou', { soldProgress: 2 })).toEqual({ current: 2, total: 4 });
  });
});

describe('Leeds: the current grant and the Sells to the next improve', () => {
  it('prints the base grant before any sale', () => {
    expect(live('dw3_leeds', 0)).toBe('When you play a **Dwarf**, give your **Dwarves +2/+2**. Improves when you **Sell** **4 minions**.');
  });
  it('counts down, then prints the improved grant in place', () => {
    expect(live('dw3_leeds', 3)).toBe('When you play a **Dwarf**, give your **Dwarves {{+2/+2}}**. Improves when you **Sell** {{1 more minion}}.');
    expect(live('dw3_leeds', 4)).toBe('When you play a **Dwarf**, give your **Dwarves {{+4/+4}}**. Improves when you **Sell** {{4 more minions}}.');
    expect(live('dw3_leeds', 9)).toBe('When you play a **Dwarf**, give your **Dwarves {{+6/+6}}**. Improves when you **Sell** {{3 more minions}}.');
  });
  it('Gilded doubles the base and every step', () => {
    expect(live('dw3_leeds', 4, true)).toBe('When you play a **Dwarf**, give your **Dwarves {{+8/+8}}**. Improves when you **Sell** {{4 more minions}}.');
  });
  it('wears the N/4 sold counter (the lifetime tally, read mod 4)', () => {
    expect(stepProgress('dw3_leeds', { soldProgress: 6 })).toEqual({ current: 2, total: 4 });
  });
});
