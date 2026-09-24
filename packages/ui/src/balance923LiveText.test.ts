import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { liveCardText, type LiveTextParams } from './instView';

/**
 * BALANCE 9/23, TRANCHE 2 — the live-text SURFACES of the reworked minions (the hard live-text rule: a scaling
 * value prints its CURRENT number on shop / board / hand / Discover — `liveCardText` — and in combat, where
 * Unit.tsx threads the same per-instance fields — `summonBonus`, `goldSpent` — into the same chain).
 * The mechanics themselves are pinned in `packages/sim/src/balance923MinionReworks.test.ts`.
 */
const base: LiveTextParams = {
  tier: 1, golden: false,
  spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0,
  spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0,
  undeadBuyAtk: 0, soulsmanGold: 0,
};

describe('balance 9/23 live text on every surface', () => {
  it('Conductor prints (base + this copy\'s accrual) × golden, and the printed base at zero', () => {
    expect(liveCardText('n2_conductor', { ...base, summonBonus: 2 }).text).toContain('{{+4/+5}}');
    expect(liveCardText('n2_conductor', { ...base, summonBonus: 2, golden: true }).goldenText).toContain('{{+8/+10}}');
    expect(liveCardText('n2_conductor', base).text).toBe(CARD_INDEX['n2_conductor']!.text);
  });

  it('Rope Wrangler folds the live tick count into the Repeat sentence, gilded keeps "twice"', () => {
    expect(liveCardText('ropewrangler', { ...base, goldSpent: 25 }).text)
      .toBe('**End of Turn:** cast **Lasso**. Repeat for every **10 Gold** spent this turn {{(×3)}}.');
    expect(liveCardText('ropewrangler', { ...base, goldSpent: 10, golden: true }).goldenText)
      .toBe('**End of Turn:** cast **Lasso twice**. Repeat for every **10 Gold** spent this turn {{(×2)}}.');
    expect(liveCardText('ropewrangler', { ...base, goldSpent: 9 }).text, 'no repeat owed → printed').toBe(CARD_INDEX['ropewrangler']!.text);
  });

  it('Muster General prints the Trooper\'s current line off the 3/3 token, plain and gilded', () => {
    expect(liveCardText('n2_muster', { ...base, summonBonus: 3 }).text).toContain('**{{6/6}} Trooper**');
    expect(liveCardText('n2_muster', { ...base, summonBonus: 3, golden: true }).goldenText).toContain('**Gilded {{6/6}} Trooper**');
    expect(liveCardText('n2_muster', base).text).toBe(CARD_INDEX['n2_muster']!.text);
  });

  it('Soul Defiler, Moira, Todd, Skald and Exgalloper carry no on-card scaler: the printed text is the whole truth', () => {
    for (const id of ['dm_curator', 'b2_moira', 'dm_todd', 'd2_skald', 'dw_exgalloper']) {
      expect(liveCardText(id, { ...base, summonBonus: 3, goldSpent: 30 }).text, id).toBe(CARD_INDEX[id]!.text);
    }
  });
});
