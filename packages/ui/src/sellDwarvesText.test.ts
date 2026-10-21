/**
 * SET 3 SELL DWARVES (owner batch 2026-10-21): what each card shows while its sold meter fills.
 *
 * Owner 2026-10-21 on the first cut (which wrote "When you Sell 2 more minions" / "(3 more)" into the text): "i dont
 * think we use text for this, just integers". So the countdown is the game's standard integer counter under the card
 * (`stepProgress`, N/4, the Avenge-style tally every every-N card wears) and the printed sentence stays the authored
 * one. The live-text rule still holds: Leeds' current grant prints in place of +2/+2 once it has improved.
 */
import { describe, expect, it } from 'vitest';
import { liveCardText } from './instView';
import { stepProgress } from './cardText';

const base = { tier: 6, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0 };
const live = (id: string, soldProgress: number | undefined, golden = false) => {
  const r = liveCardText(id, { ...base, golden, soldProgress } as never);
  return golden ? r.goldenText ?? r.text : r.text;
};
/** No countdown prose on any surface: no "more", no "to go", no fraction in the text. */
const noProse = (t: string): void => {
  expect(t).not.toMatch(/\bmore\b|to go|\d+\/\d+(?!\/)/);
};

describe('Mark Eting: authored text, the countdown is the integer counter', () => {
  it('prints the authored text at every point of the meter', () => {
    for (const n of [0, 1, 2, 3]) {
      expect(live('dw3_marketing', n)).toBe('When you **Sell** **4 minions**, get a random **Shop Spell**.');
      noProse(live('dw3_marketing', n));
    }
    expect(live('dw3_marketing', 1, true)).toBe('When you **Sell** **4 minions**, get **2** random **Shop Spells**.');
  });
  it('wears the N/4 sold counter', () => {
    expect(stepProgress('dw3_marketing', { soldProgress: 3 })).toEqual({ current: 3, total: 4 });
    expect(stepProgress('dw3_marketing', { soldProgress: 0 })).toEqual({ current: 0, total: 4 });
  });
});

describe('Valyou: authored text, the countdown is the integer counter', () => {
  it('prints the authored text at every point of the meter, plain and Gilded', () => {
    for (const n of [0, 1, 3]) {
      expect(live('dw3_valyou', n)).toBe('When you **Sell** a minion, gain **+3/+3**. Every **4** triggers also grants **2 Gold**.');
      noProse(live('dw3_valyou', n));
    }
    expect(live('dw3_valyou', 3, true)).toBe('When you **Sell** a minion, gain **+6/+6**. Every **4** triggers also grants **4 Gold**.');
  });
  it('wears the N/4 sold counter', () => {
    expect(stepProgress('dw3_valyou', { soldProgress: 2 })).toEqual({ current: 2, total: 4 });
  });
});

describe('Leeds: the current grant in place, the countdown is the integer counter', () => {
  it('prints the authored text while the grant is still the printed one', () => {
    for (const n of [0, 1, 3]) {
      expect(live('dw3_leeds', n)).toBe('When you play a **Dwarf**, give your **Dwarves +2/+2**. Improves when you **Sell** **4 minions**.');
    }
  });
  it('prints the improved grant in place, the rest of the sentence authored', () => {
    expect(live('dw3_leeds', 4)).toBe('When you play a **Dwarf**, give your **Dwarves {{+4/+4}}**. Improves when you **Sell** **4 minions**.');
    expect(live('dw3_leeds', 9)).toBe('When you play a **Dwarf**, give your **Dwarves {{+6/+6}}**. Improves when you **Sell** **4 minions**.');
    noProse(live('dw3_leeds', 9));
  });
  it('Gilded doubles the base and every step', () => {
    expect(live('dw3_leeds', 4, true)).toBe('When you play a **Dwarf**, give your **Dwarves {{+8/+8}}**. Improves when you **Sell** **4 minions**.');
  });
  it('wears the N/4 sold counter (the lifetime tally, read mod 4)', () => {
    expect(stepProgress('dw3_leeds', { soldProgress: 6 })).toEqual({ current: 2, total: 4 });
  });
});
