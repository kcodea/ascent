import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { liveCardText, type LiveTextParams } from './instView';

// Minimal all-zero params — the shape a combat ENEMY minion (no run economy) or a fresh preview passes. Per-card
// tests override just the fields that card needs, so each assertion isolates one live value.
const base: LiveTextParams = {
  tier: 1, golden: false,
  spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0,
  spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0,
  undeadBuyAtk: 0, soulsmanGold: 0,
};

describe('liveCardText — the single source of truth shared by shop + combat', () => {
  it('resolves Trail Forager’s live sell value from a carried sellBonus (the owner’s example)', () => {
    // Sells for 3g + 1g per Beast played. sellBonus 4 → 7g, greened. This is what combat now shows on mouseover
    // (sellBonus is carried into the snapshot), where it used to revert to the printed "3g".
    expect(liveCardText('trailforager', { ...base, sellBonus: 4 }).text).toContain('{{7g}}');
    // No accrual (enemy / fresh) → the printed base, not a stale green value.
    expect(liveCardText('trailforager', base).text).toBe(CARD_INDEX['trailforager']!.text);
  });

  it('resolves the combat-only helpers (Crypt Drake attackSeen, cadence eotTick) through the unified path', () => {
    // Crypt Drake counts attacks toward its next proc — attackSeen 1, every 2 → "1 to go". Only ever non-zero in
    // combat, so it's null in the shop; folding it into liveCardText lets combat reuse the same composer.
    expect(liveCardText('cryptdrake', { ...base, attackSeen: 1 }).text).toContain('to go');
    expect(liveCardText('cryptdrake', base).text).toBe(CARD_INDEX['cryptdrake']!.text); // shop: no attacks seen → base
  });

  it('folds in Ritualist’s per-tick grant + the run-wide Eternal Knight tally (metric append) in one call', () => {
    expect(liveCardText('ritualist', { ...base, eotBonus: 6 }).text).toContain('{{+9/+9}}'); // accrued 6 + step 3 (non-golden)
    // Eternal Knight (knit): run-wide card-type enchant shows as an appended metric, now available in combat too.
    expect(liveCardText('knit', { ...base, cardBuffs: { knit: { attack: 9, health: 6 } } }).text).toContain('{{Now +9/+6 this run.}}');
  });
});
