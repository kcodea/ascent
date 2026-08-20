import { describe, it, expect } from 'vitest';
import { liveCardText, type LiveTextParams } from './instView';

/**
 * RUNE OF REBIRTH's blue text tag (owner ask 2026-08-20): while the rune is held, every MINION card's text
 * carries the word "Rebirth" in blue — the `[[…]]` marker Card renders as `.descrune`. One source
 * (`liveCardText`), so the shop/board/hand/Discover/end-screen chain AND combat (`Unit.tsx`) all agree.
 */
const base: LiveTextParams = {
  tier: 3, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0,
  spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0, undeadBuyAtk: 0, soulsmanGold: 0,
};

describe('Rune of Rebirth prints blue "Rebirth" on minions', () => {
  it('a minion gains the [[Rebirth]] tag while the rune is held — both variants', () => {
    const { text, goldenText } = liveCardText('grim', { ...base, golden: true, runeFlags: { rebirth: true } });
    expect(text).toContain('[[Rebirth]]');
    expect(goldenText).toContain('[[Rebirth]]');
  });

  it('without the rune, nothing changes', () => {
    expect(liveCardText('grim', base).text).not.toContain('[[Rebirth]]');
    expect(liveCardText('grim', { ...base, runeFlags: {} }).text).not.toContain('[[Rebirth]]');
  });

  it('spells and Rubies are untouched — minions only', () => {
    // Any spell id: the chain resolves spells through spellDisplayText; the tag must not ride along.
    const spell = liveCardText('discoverspell', { ...base, runeFlags: { rebirth: true } });
    expect(spell.text).not.toContain('[[Rebirth]]');
  });

  it('the tag composes with a live-value rule (Grim tally class) rather than replacing it', () => {
    const { text } = liveCardText('grim', { ...base, deathrattlesTriggered: 4, runeFlags: { rebirth: true } });
    expect(text.startsWith('**Echo:**'), 'the printed rule survives').toBe(true);
    expect(text.endsWith('[[Rebirth]]'), 'the granted rule is appended').toBe(true);
  });
});
