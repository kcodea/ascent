// @vitest-environment jsdom
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

// Vaultkeeper's live text: vaultkeeperRevertText1114.test.ts (owner revert 2026-11-14, R-VAULT-02).

describe('Alchemist Brisbane: the current Ruby grant and the Gold counter', () => {
  const B = CARD_INDEX['k_alchemist']!;
  it('prints its base until an improvement is earned, then the improved grant in green', () => {
    expect(liveCardText('k_alchemist', { ...base, summonBonus: 0 }).text).toBe(B.text);
    expect(liveCardText('k_alchemist', { ...base, summonBonus: 1 }).text)
      .toBe('**Shout and Rally:** Your Rubies gain **{{+2/+2}}**. Spend **40 Gold** to improve this.');
    expect(liveCardText('k_alchemist', { ...base, summonBonus: 3 }).text).toContain('{{+4/+4}}');
  });
  it('Gilded doubles it', () => {
    expect(liveCardText('k_alchemist', { ...base, golden: true, summonBonus: 0 }).goldenText).toBe(B.goldenText);
    expect(liveCardText('k_alchemist', { ...base, golden: true, summonBonus: 1 }).goldenText).toContain('{{+4/+4}}');
  });
  it('the step counter is the Gold meter toward the next improvement (Shop only)', () => {
    expect(stepProgress('k_alchemist', { goldTick: 12 })).toMatchObject({ current: 12, total: 40 });
    expect(stepProgress('k_alchemist', {}), 'no Gold meter in combat').toBeNull();
  });
  it('a Ruby-strength card with no improve step keeps its printed text, whatever it has accrued', () => {
    expect(liveCardText('k_faultline', { ...base, summonBonus: 4 }).text).toBe(CARD_INDEX['k_faultline']!.text);
  });
});
