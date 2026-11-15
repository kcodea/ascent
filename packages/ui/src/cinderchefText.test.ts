import { describe, it, expect } from 'vitest';
import { liveCardText, type LiveTextParams } from './instView';

/** CINDERCHEF (owner 2026-11-15, R-CINDERCHEF-01): the printed rate stays and the next Rally's CURRENT gain is
 *  appended green, on every surface that runs `liveCardText` (Shop, hand, board, Discover, end screen, combat). */
const base: LiveTextParams = {
  tier: 1, golden: false,
  spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0,
  spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0,
  undeadBuyAtk: 0, soulsmanGold: 0,
};

describe('Cinderchef live text: the current per-Rally gain', () => {
  it('0 Shop spells prints (+0/+0); 3 prints (+3/+3); gilded with 3 prints (+6/+6)', () => {
    expect(liveCardText('d2_cinderchef', { ...base, shopSpellsThisTurn: 0 }).text)
      .toBe('**Rally:** gain **+1/+1** for each **Shop spell** cast this turn. {{(+0/+0)}}');
    expect(liveCardText('d2_cinderchef', { ...base, shopSpellsThisTurn: 3 }).text)
      .toBe('**Rally:** gain **+1/+1** for each **Shop spell** cast this turn. {{(+3/+3)}}');
    expect(liveCardText('d2_cinderchef', { ...base, golden: true, shopSpellsThisTurn: 3 }).goldenText)
      .toBe('**Rally:** gain **+2/+2** for each **Shop spell** cast this turn. {{(+6/+6)}}');
  });

  it('reads the Shop-spell tally, not the any-spell one (a Clue or Ruby raises only spellsThisTurn)', () => {
    expect(liveCardText('d2_cinderchef', { ...base, spellsThisTurn: 4, shopSpellsThisTurn: 1 }).text).toContain('{{(+1/+1)}}');
  });
});
