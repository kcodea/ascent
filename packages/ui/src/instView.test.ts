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

  it('resolves Chef Raag’s Imp-Aura grant from the threaded run aura (and floors it without one)', () => {
    // Guards the PLUMBING, not just the helper: `impAura` has to survive the run → instView → liveCardText hop,
    // which is what actually breaks when a new live value is added (the helper can be right and never called).
    expect(liveCardText('chefraag', { ...base, impAura: { attack: 4, health: 3 } }).text).toContain('{{+4/+3}}');
    // No aura threaded (a fresh run, or a combat ENEMY Raag — enemyScalers carries none) → printed +1/+1 floor.
    expect(liveCardText('chefraag', base).text).toBe(CARD_INDEX['chefraag']!.text);
  });

  it('Ancient Wanderer prints the bonus it HAS right now, at two different run Gold totals', () => {
    // The rune-only batch's live-text card (2026-08-20). "+1/+1 for every 3 Gold you have spent this run" is a
    // RATE; what the card must print is the stat block it is carrying. `goldSpentRun` is the run-lifetime meter
    // — deliberately NOT the per-turn `goldSpent` every other helper here reads.
    const at9 = liveCardText('n2_wanderer', { ...base, goldSpentRun: 9 }).text;
    const at31 = liveCardText('n2_wanderer', { ...base, goldSpentRun: 31 }).text;
    expect(at9, '9 Gold = 3 steps').toContain('{{+3/+3}}');
    expect(at9, '…and the countdown to the next step').toContain('{{3 more}}');
    expect(at31, '31 Gold = 10 steps').toContain('{{+10/+10}}');
    expect(at31).toContain('{{2 more}}');
    expect(at9, 'the two totals must not print the same thing').not.toBe(at31);
    // Nothing spent (a fresh run, or a combat ENEMY Wanderer — no run is threaded) → the printed rate stands.
    expect(liveCardText('n2_wanderer', base).text).toBe(CARD_INDEX['n2_wanderer']!.text);
    // Golden doubles the printed value, not just the stats.
    expect(liveCardText('n2_wanderer', { ...base, golden: true, goldSpentRun: 9 }).text).toContain('{{+6/+6}}');
  });

  it('Muster General prints its Trooper’s CURRENT stat line, and Arcane Behemoth its countdown', () => {
    // Two more from the same batch whose printed numbers move with state: the General's token is 1/1 only until
    // its first Avenge (the improve rides `summonBonus`), and the Behemoth is a threshold card.
    expect(liveCardText('n2_muster', { ...base, summonBonus: 3 }).text).toContain('{{4/4}} Trooper');
    expect(liveCardText('n2_muster', base).text, 'no Avenge yet → the printed 1/1 is accurate').toBe(CARD_INDEX['n2_muster']!.text);
    expect(liveCardText('dm_behemoth', { ...base, spellProgress: 2 }).text).toContain('{{1 more Shop spell}}');
    expect(liveCardText('dm_behemoth', { ...base, spellProgress: 1 }).text).toContain('{{2 more Shop spells}}');
  });

  it('folds in Ritualist’s per-tick grant + the run-wide Eternal Knight tally (metric append) in one call', () => {
    expect(liveCardText('ritualist', { ...base, eotBonus: 6 }).text).toContain('{{+7/+7}}'); // accrued 6 + step 1 (non-golden)
    // Eternal Knight (knit): run-wide card-type enchant shows as an appended metric, now available in combat too.
    expect(liveCardText('knit', { ...base, cardBuffs: { knit: { attack: 9, health: 6 } } }).text).toContain('{{Now +9/+6 this run.}}');
  });
});
