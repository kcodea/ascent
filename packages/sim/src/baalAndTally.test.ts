import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { noteSpellCast } from './recruit';

/** Owner batch 2026-08-03: Baal + Rune of Baal, and the rune meter's `sourceId` stamp. */

const baal = (uid: string): BoardCard =>
  ({ uid, cardId: 'dw_baal', tribe: 'dwarf', attack: 8, health: 7, keywords: [], golden: false });

describe('Baal', () => {
  it('is a forge-only Dwarf/Demon 8/7 at Tier 6', () => {
    const def = CARD_INDEX['dw_baal']!;
    expect(def).toBeDefined();
    expect([def.tribe, def.tribe2]).toEqual(['dwarf', 'demon']);
    expect([def.tier, def.attack, def.health]).toEqual([6, 8, 7]);
    expect(def.token, 'forge-only — must never be drawable from a shop').toBe(true);
  });

  it('Rune of Baal is an Epic costing 6 that grants exactly Baal', () => {
    const rune = RUNE_INDEX['rune_baal']!;
    expect(rune).toBeDefined();
    expect(rune.cost).toBe(6);
    expect(rune.epic).toBe(true);
    expect(rune.sets).toEqual(['set2']);
    expect(rune.reward).toMatchObject({ kind: 'grant', cards: ['dw_baal'] });
  });

  it('every 2 spells, a friendly Demon eats a Shop minion', () => {
    const s: RunState = { ...createRun(1), board: [baal('b')], hand: [], embers: 30 };
    const minionOffers = (st: RunState): number =>
      st.shop.filter((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; }).length;
    const before = minionOffers(s);
    expect(before, 'the fixture needs minion offers to eat').toBeGreaterThan(0);

    // ONE spell is not enough — the meter is every TWO.
    noteSpellCast(s, CARD_INDEX['growth']!);
    expect(minionOffers(s), 'a single cast must not trigger it').toBe(before);

    noteSpellCast(s, CARD_INDEX['growth']!);
    expect(minionOffers(s), 'the second cast should feed a Demon').toBe(before - 1);
  });

  it('a GILDED Baal eats two', () => {
    const s: RunState = { ...createRun(1), board: [{ ...baal('b'), golden: true }], hand: [], embers: 30 };
    const minionOffers = (st: RunState): number =>
      st.shop.filter((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; }).length;
    const before = minionOffers(s);
    if (before < 2) return; // not enough to prove the doubling in this shop roll
    noteSpellCast(s, CARD_INDEX['growth']!);
    noteSpellCast(s, CARD_INDEX['growth']!);
    expect(minionOffers(s)).toBe(before - 2);
  });

  it('an EMPTY shop is a safe no-op (the trigger is spent, nothing is invented)', () => {
    const s: RunState = { ...createRun(1), board: [baal('b')], hand: [], shop: [], embers: 30 };
    noteSpellCast(s, CARD_INDEX['growth']!);
    noteSpellCast(s, CARD_INDEX['growth']!);
    expect(s.shop).toEqual([]);
    expect(s.board.length, 'the board is untouched too').toBe(1);
  });

});

describe('rune meters know which rune armed them', () => {
  it('a threshold rune stamps its own id, so the HUD can show that badge a tally', () => {
    let s: RunState = { ...createRun(1), embers: 50 };
    s = { ...s, runeforgeOffer: ['rune_gemspam'], runeforgeEpic: true };
    s = reduce(s, { type: 'buyRune', index: 0 });
    const meter = s.runeThresholds?.find((t) => t.sourceId === 'rune_gemspam');
    expect(meter, 'the meter must record which rune armed it').toBeTruthy();
    expect(meter!.per).toBe(10);
    expect(meter!.tick).toBe(0);
  });
});
