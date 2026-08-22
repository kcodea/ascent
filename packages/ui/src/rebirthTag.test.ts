import { describe, it, expect } from 'vitest';
import { liveCardText, type LiveTextParams } from './instView';

/**
 * RUNE OF REBIRTH's blue text tag — the `[[…]]` marker Card renders as `.descrune`.
 *
 * PER-INSTANCE, not run-wide. The rune gives the exact-copy Echo to ONE random friendly minion at Start of
 * Combat, so the tag belongs on that body alone. It first shipped keyed off the run FLAG (owner ask
 * 2026-08-20, "while the rune is held, every minion's text carries Rebirth"), which printed the rule on all
 * seven bodies when only one of them would ever have it — owner report 2026-08-22: "it is putting the rebirth
 * text on all my minions I control, not the single one it triggers on. Functionally it is working correctly."
 *
 * `rebirthOwner` is set by the combat replay for the body `sc.grantsEcho` names. Nothing sets it in the shop
 * by design: before the fight starts no minion has been picked, so there is no true card to put it on.
 */
const base: LiveTextParams = {
  tier: 3, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0,
  spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0, undeadBuyAtk: 0, soulsmanGold: 0,
};

describe('Rune of Rebirth prints blue "Rebirth" on the granted minion only', () => {
  it('the body the grant landed on carries the tag — both variants', () => {
    const { text, goldenText } = liveCardText('grim', { ...base, golden: true, rebirthOwner: true });
    expect(text).toContain('[[Rebirth]]');
    expect(goldenText).toContain('[[Rebirth]]');
  });

  it('every OTHER minion is untouched — the reported bug', () => {
    // Holding the rune is not enough; this is the case that used to tag all seven bodies.
    expect(liveCardText('grim', base).text).not.toContain('[[Rebirth]]');
    expect(liveCardText('grim', { ...base, rebirthOwner: false }).text).not.toContain('[[Rebirth]]');
    // …and a run-wide rune flag can no longer reach the tag at all.
    expect(liveCardText('grim', { ...base, runeFlags: { matriarch: true } }).text).not.toContain('[[Rebirth]]');
  });

  it('spells and Rubies are untouched — minions only', () => {
    const spell = liveCardText('discoverspell', { ...base, rebirthOwner: true });
    expect(spell.text).not.toContain('[[Rebirth]]');
  });

  it('the tag composes with a live-value rule rather than replacing it', () => {
    const { text } = liveCardText('grim', { ...base, deathrattlesTriggered: 4, rebirthOwner: true });
    expect(text.startsWith('**Echo:**'), 'the printed rule survives').toBe(true);
    expect(text.endsWith('[[Rebirth]]'), 'the granted rule is appended').toBe(true);
  });
});
