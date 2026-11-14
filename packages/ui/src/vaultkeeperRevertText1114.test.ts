// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { liveBoardView, liveCardText, type LiveTextParams } from './instView';
import { discoverCardText, handCardView, handLiveOf, liveOptsFromRun, shopView } from './Recruit';
import { createRun, type BoardCard, type RunState, type ShopCard } from '@game/sim';

/**
 * VAULTKEEPER live text, restored with the owner's revert 2026-11-14 (R-VAULT-02): every surface prints the CURRENT
 * per-Dragon grant (Shop Spells + Rubies cast this game) and the spells left to the next step. One `liveCardText`
 * chain, which Unit.tsx shares in combat (it passes the run's `spellsCast` + `rubyCasts`).
 */
const base: LiveTextParams = {
  tier: 1, golden: false,
  spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0,
  spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0,
  undeadBuyAtk: 0, soulsmanGold: 0,
};
const text = (p: Partial<LiveTextParams>): string => liveCardText('d2_herzog', { ...base, ...p }).text;

describe('Vaultkeeper (2026-11-14): the current grant and the countdown', () => {
  it('prints the base grant and the countdown with no spells cast', () => {
    expect(text({})).toBe('Gain {{+2/+2}} whenever you play a **Dragon**. Improves **+2/+2** for every **4 spells** cast this game. {{4 spells to next step}}');
  });
  it('the grant steps every 4 spells, Rubies included, and the countdown follows', () => {
    expect(text({ spellsCast: 3 })).toContain('{{1 spell to next step}}');
    expect(text({ spellsCast: 4 })).toContain('Gain {{+4/+4}}');
    expect(text({ spellsCast: 3, rubyCasts: 2 })).toContain('Gain {{+4/+4}}');
    expect(text({ spellsCast: 3, rubyCasts: 2 })).toContain('{{3 spells to next step}}');
    expect(text({ spellsCast: 9 })).toContain('Gain {{+6/+6}}');
  });
  it('Gilded doubles the printed grant', () => {
    expect(liveCardText('d2_herzog', { ...base, golden: true, spellsCast: 4 }).goldenText).toContain('Gain {{+8/+8}}');
  });
  it('the Shop, Discover, hand and board all print the run count', () => {
    const run = { ...createRun(1), setId: 'set2', phase: 'recruit', tier: 6, spellsCast: 4, rubyCasts: 1 } as RunState;
    const fresh: BoardCard = { uid: 'v', cardId: 'd2_herzog', tribe: 'dragon', attack: 6, health: 10, keywords: [], golden: false };
    const want = '{{+4/+4}}';
    expect(shopView({ uid: 's', cardId: 'd2_herzog' } as ShopCard, liveOptsFromRun(run)).text, 'Shop offer').toContain(want);
    expect(discoverCardText(run, 'd2_herzog', {}).text, 'Discover option').toContain(want);
    expect(handCardView(run, fresh, handLiveOf(run, {}, {} as never)).text, 'in hand').toContain(want);
    expect(liveBoardView(fresh, run).text, 'board / end screen').toContain(want);
  });
});
