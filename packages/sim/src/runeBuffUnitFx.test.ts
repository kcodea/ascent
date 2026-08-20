import { describe, it, expect } from 'vitest';
import { createRun, isRuneBuffSource, runeBuffMagnitude, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';

/**
 * `runeBuffFxUnits` — the units a rune buffed this shop action, driving the `rune-buff-unit` sparkle.
 * Diffed off `runeBuffMagnitude` (the source label on `card.buffs`), so it needs no per-rune wiring.
 */
const card = (uid: string, cardId: string, tribe: BoardCard['tribe'] = 'neutral'): BoardCard =>
  ({ uid, cardId, tribe, attack: 3, health: 3, keywords: [], golden: false });

describe('isRuneBuffSource', () => {
  it('accepts Rune-labelled and the flavor labels, rejects card buffs', () => {
    expect(isRuneBuffSource('Rune of Scales')).toBe(true);
    expect(isRuneBuffSource("Rune of the Seller's Market")).toBe(true);
    expect(isRuneBuffSource('Twin Sun Oath')).toBe(true); // Drake Skull
    expect(isRuneBuffSource('Ruby')).toBe(false);
    expect(isRuneBuffSource('Soulbind')).toBe(false);
    expect(isRuneBuffSource('Karwind')).toBe(false);
  });
});

describe('runeBuffMagnitude', () => {
  it('sums only rune-sourced buffs', () => {
    const c = card('a', 'spore');
    c.buffs = [{ source: 'Rune of Scales', attack: 4, health: 5, count: 1 }, { source: 'Ruby', attack: 1, health: 1, count: 1 }];
    expect(runeBuffMagnitude(c)).toBe(9); // 4+5, the Ruby excluded
  });
});

describe('runeBuffFxUnits (the shop diff signal)', () => {
  it('lists a minion whose rune-buff total rose, when Seller\'s Market fires on a sell', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [card('b1', 'spore'), card('b2', 'stray')],
      ownedRunes: ['rune_sellers_market'],
      runeSellersMarket: true as never,
    };
    // sell b2 → Seller's Market gives the remaining board +4/+3
    const next = reduce({ ...s }, { type: 'sell', uid: 'b2' });
    expect(next.runeBuffFxSeq).toBeGreaterThan(0);
    expect(next.runeBuffFxUnits).toContain('b1'); // the survivor got the rune buff
  });

  it('does not fire on an action with no rune buff', () => {
    const s: RunState = { ...createRun(1), phase: 'recruit', embers: 20, board: [card('b1', 'spore')], shop: [{ uid: 's1', cardId: 'spore' }] };
    const next = reduce(s, { type: 'roll' });
    expect(next.runeBuffFxSeq).toBeUndefined();
  });
});
