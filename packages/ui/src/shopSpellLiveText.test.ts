// @vitest-environment jsdom
/**
 * SHOP SPELLS PRINT THEIR CURRENT VALUE — the tavern chain forwards EVERY live input `spellDisplayText` reads.
 *
 * Owner report 2026-09-13: a Stellar Chorus in the shop kept reading "+2/+2" after spells had been cast, while
 * the same card in hand read "+8/+8". `shopView`'s spell branch built its own `extra` object for
 * `spellDisplayText` and dropped `anySpellsThisTurn` (and `clueBonus`) even though `ShopViewOpts` carried them
 * — the third time a surface-local extras object starved a live value (Veinstorm 2026-08-08, Growth 2026-08-27).
 * This pins the shop row + spell slot against the hand/board chain (`instView`), through the SAME opts builder
 * the screen uses, so the two surfaces cannot disagree again.
 */
import { describe, expect, it } from 'vitest';
import { createRun, spellAttackBonus, spellHealthBonus, type RunState, type ShopCard } from '@game/sim';
import { shopView } from './Recruit';
import { instView } from './instView';

const offer = (cardId: string): ShopCard => ({ uid: `o-${cardId}`, cardId, atk: 0, hp: 0 } as ShopCard);

function runWith(patch: Partial<RunState>): RunState {
  return { ...createRun(11, 'warden', 'practice'), ...patch } as RunState;
}

describe('shop spell live text (owner 2026-09-13)', () => {
  it('Stellar Chorus in the SHOP reads the same current total as in HAND once spells were cast', () => {
    const run = runWith({ spellsThisTurn: 2 }); // +2/+2 base + 3/+3 × 2 = +8/+8
    const shop = shopView(offer('stellarchorus'), { spellsThisTurn: run.spellsThisTurn, anySpellsThisTurn: 2, clueBonus: run.clueBonus });
    expect(shop.text).toContain('{{+8/+8}}');
    const hand = instView(
      { uid: 'h', cardId: 'stellarchorus', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
      run.tier, undefined, 0, 0, run.spellsThisTurn, 0, 0, 0, 0, 1, 0, undefined, undefined, { anySpellsThisTurn: 2 },
    );
    expect(hand.text).toBe(shop.text);
  });

  it('a Clue in the shop reads the run\'s live Clue value', () => {
    const shop = shopView(offer('clue'), { clueBonus: 2 });
    expect(shop.text).toContain('{{+3/+3}}');
  });

  it('with nothing cast the shop prints the base (no false green)', () => {
    expect(shopView(offer('stellarchorus'), { anySpellsThisTurn: 0 }).text).toContain('**+2/+2**');
  });

  it('Sugarnova pending +4/+4 (owner 2026-09-18) greens every Shop spell offer AND hand spell in place, through the same spell-power read the cast uses', () => {
    const run = runWith({ nextSpellBonus: { attack: 4, health: 4 } });
    const a = spellAttackBonus(run), h = spellHealthBonus(run);
    expect([a, h], 'the banked bonus rides the spell-power read').toEqual([4, 4]);
    // The shop row: a Star Crash offer and a Stellar Chorus offer both print base + 4.
    const crash = shopView(offer('starcrash'), { spellBonus: a, spellBonusH: h, anySpellsThisTurn: 0 });
    expect(crash.text).toContain('{{+9/+11}}');
    expect(crash.text).not.toContain('+5/+7');
    expect(shopView(offer('stellarchorus'), { spellBonus: a, spellBonusH: h, anySpellsThisTurn: 0 }).text).toContain('{{+6/+6}}');
    // The hand: the same Star Crash reads the same line (the hand chain threads `nextSpellBonus` for Gifts only).
    const hand = instView(
      { uid: 'h', cardId: 'starcrash', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
      run.tier, undefined, a, h, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { nextSpellBonus: run.nextSpellBonus, anySpellsThisTurn: 0 },
    );
    expect(hand.text).toBe(crash.text);
    // A Gift in hand (Tower Shield) never reads it: its flat base, no green.
    const gift = instView(
      { uid: 'g', cardId: 'tower_shield', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
      run.tier, undefined, a, h, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { nextSpellBonus: run.nextSpellBonus, anySpellsThisTurn: 0 },
    );
    expect(gift.text).not.toContain('{{');
  });
});
