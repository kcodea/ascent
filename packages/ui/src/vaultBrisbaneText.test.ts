import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { liveCardText, type LiveTextParams } from './instView';
import { stepProgress } from './cardText';

/**
 * LIVE TEXT for the owner's 2026-10-13 reworks: both cards print the number they will really produce (the hard
 * live-value rule), through the one `liveCardText` chain the Shop and combat share, and each shows its countdown on
 * the step counter rather than as a fraction in the text.
 */
const base: LiveTextParams = {
  tier: 1, golden: false,
  spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0,
  spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0,
  undeadBuyAtk: 0, soulsmanGold: 0,
};

describe('Vaultkeeper: the current gain and the N/3 counter', () => {
  const V = CARD_INDEX['d2_herzog']!;
  it('prints its base until the first 3 are played, then the improved gain in green', () => {
    for (const tally of [0, 1, 2]) expect(liveCardText('d2_herzog', { ...base, spiritTally: tally }).text, `tally ${tally}`).toBe(V.text);
    expect(liveCardText('d2_herzog', { ...base, spiritTally: 3 }).text)
      .toBe('When you play a **Dragon**, gain **{{+6/+6}}**. Play **3 Dragons or Dwarves** to improve this.');
    expect(liveCardText('d2_herzog', { ...base, spiritTally: 8 }).text).toContain('{{+9/+9}}');
  });
  it('Gilded doubles it', () => {
    expect(liveCardText('d2_herzog', { ...base, golden: true, spiritTally: 0 }).goldenText).toBe(V.goldenText);
    expect(liveCardText('d2_herzog', { ...base, golden: true, spiritTally: 3 }).goldenText).toContain('{{+12/+12}}');
  });
  it('the step counter reads the Dragons and Dwarves played toward the next step', () => {
    expect(stepProgress('d2_herzog', { spiritTally: 0 })).toMatchObject({ current: 0, total: 3 });
    expect(stepProgress('d2_herzog', { spiritTally: 2 })).toMatchObject({ current: 2, total: 3 });
    expect(stepProgress('d2_herzog', { spiritTally: 3 })).toMatchObject({ current: 3, total: 3 });
    expect(stepProgress('d2_herzog', { spiritTally: 4 })).toMatchObject({ current: 1, total: 3 });
  });
});

describe('Alchemist Brisbane: the current Ruby grant and the Gold counter', () => {
  const B = CARD_INDEX['k_alchemist']!;
  it('prints its base until an improvement is earned, then the improved grant in green', () => {
    expect(liveCardText('k_alchemist', { ...base, summonBonus: 0 }).text).toBe(B.text);
    expect(liveCardText('k_alchemist', { ...base, summonBonus: 1 }).text)
      .toBe('**Shout, Echo and Rally:** Your Rubies gain **{{+4/+4}}**. Spend **30 Gold** to improve this.');
    expect(liveCardText('k_alchemist', { ...base, summonBonus: 3 }).text).toContain('{{+8/+8}}');
  });
  it('Gilded doubles it', () => {
    expect(liveCardText('k_alchemist', { ...base, golden: true, summonBonus: 0 }).goldenText).toBe(B.goldenText);
    expect(liveCardText('k_alchemist', { ...base, golden: true, summonBonus: 1 }).goldenText).toContain('{{+8/+8}}');
  });
  it('the step counter is the Gold meter toward the next improvement (Shop only)', () => {
    expect(stepProgress('k_alchemist', { goldTick: 12 })).toMatchObject({ current: 12, total: 30 });
    expect(stepProgress('k_alchemist', {}), 'no Gold meter in combat').toBeNull();
  });
  it('a Ruby-strength card with no improve step keeps its printed text, whatever it has accrued', () => {
    expect(liveCardText('k_faultline', { ...base, summonBonus: 4 }).text).toBe(CARD_INDEX['k_faultline']!.text);
  });
});
