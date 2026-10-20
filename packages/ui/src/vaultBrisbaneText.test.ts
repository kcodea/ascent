// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { liveBoardView, liveCardText, type LiveTextParams } from './instView';
import { discoverCardText, handCardView, handLiveOf, liveOptsFromRun, shopView } from './Recruit';
import { createRun, type BoardCard, type RunState, type ShopCard } from '@game/sim';
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

describe('Vaultkeeper (2026-10-20): the current gain and the N/4 counter, read off the RUN-WIDE tally', () => {
  const V = CARD_INDEX['d2_herzog']!;
  it('prints its base until the first 4 are played, then the improved gain in green', () => {
    for (const tally of [0, 1, 3]) expect(liveCardText('d2_herzog', { ...base, spiritTally: tally }).text, `tally ${tally}`).toBe(V.text);
    expect(liveCardText('d2_herzog', { ...base, spiritTally: 4 }).text)
      .toBe('When you play a **Dragon**, gain **{{+6/+6}}**. Improves every **4 Dragons or Dwarves** played this game.');
    expect(liveCardText('d2_herzog', { ...base, spiritTally: 11 }).text).toContain('{{+9/+9}}');
  });
  it('Gilded doubles it', () => {
    expect(liveCardText('d2_herzog', { ...base, golden: true, spiritTally: 0 }).goldenText).toBe(V.goldenText);
    expect(liveCardText('d2_herzog', { ...base, golden: true, spiritTally: 4 }).goldenText).toContain('{{+12/+12}}');
  });
  it('the step counter reads the Dragons and Dwarves played toward the next step', () => {
    expect(stepProgress('d2_herzog', { spiritTally: 0 })).toMatchObject({ current: 0, total: 4 });
    expect(stepProgress('d2_herzog', { spiritTally: 3 })).toMatchObject({ current: 3, total: 4 });
    expect(stepProgress('d2_herzog', { spiritTally: 5 })).toMatchObject({ current: 1, total: 4 });
  });
  // R-VAULT-02: the count lives on the run, so every surface (a Shop offer, a Discover option, a fresh copy in hand,
  // the board) prints the run's number, never a copy's own (zero) tally.
  it('the shop, Discover, hand and board all print the run-wide count', () => {
    const run = { ...createRun(1), setId: 'set2', phase: 'recruit', tier: 6, tribeUnionPlays: { 'dragon+dwarf': 8 } } as RunState;
    const fresh: BoardCard = { uid: 'v', cardId: 'd2_herzog', tribe: 'dwarf', attack: 6, health: 10, keywords: [], golden: false };
    const want = '{{+9/+9}}';
    expect(shopView({ uid: 's', cardId: 'd2_herzog' } as ShopCard, liveOptsFromRun(run)).text, 'Shop offer').toContain(want);
    expect(discoverCardText(run, 'd2_herzog', {}).text, 'Discover option').toContain(want);
    expect(handCardView(run, fresh, handLiveOf(run, {}, {} as never)).text, 'in hand').toContain(want);
    expect(liveBoardView(fresh, run).text, 'board / end screen').toContain(want);
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
