import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { ALE_IDS, RUBY_ID, applyEndOfTurn, consumeShopMinion, noteSpellCast, rubyCastCount } from './recruit';

/**
 * Rune batch 4 — the recruit-phase runes. Each hangs off a single existing chokepoint (the sell path, the
 * Consume path, the Ruby Broker cap, `noteSpellCast`), which is why this batch carried no combat risk.
 */
const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const byName = (n: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.name === n);
const rubies = (s: RunState) => s.hand.filter((c) => c.cardId === RUBY_ID).length;
const ales = (s: RunState) => s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length;
const minionIdx = (s: RunState) => s.shop.findIndex((o) => !CARD_INDEX[o.cardId]?.spell && !CARD_INDEX[o.cardId]?.ruby);
const shopMinions = (s: RunState) => s.shop.filter((o) => !CARD_INDEX[o.cardId]?.spell && !CARD_INDEX[o.cardId]?.ruby).length;

describe('Rune of Investment — selling mints Rubies', () => {
  const pack = CARD_INDEX['pack']!;
  const onBoard = (): BoardCard => ({ uid: 'x', cardId: 'pack', tribe: pack.tribe, attack: pack.attack, health: pack.health, keywords: [], golden: false });

  it("mints at the run's live Ruby strength, not a base copy", () => {
    const s: RunState = { ...set2(), runeSellRubies: 2, rubyBonus: { attack: 5, health: 5 }, board: [onBoard()], hand: [] };
    const next = reduce(s, { type: 'sell', uid: 'x' });
    expect(rubies(next), 'selling did not mint the Rubies').toBe(2);
    expect(next.hand.find((c) => c.cardId === RUBY_ID)!.attack, 'minted at base instead of live strength')
      .toBe(CARD_INDEX[RUBY_ID]!.attack + 5);
  });

  it('does nothing without the rune', () => {
    const s: RunState = { ...set2(), board: [onBoard()], hand: [] };
    expect(rubies(reduce(s, { type: 'sell', uid: 'x' }))).toBe(0);
  });
});

describe('Rune of the Open Market', () => {
  const demon = (): BoardCard => ({ uid: 'd', cardId: 'pack', tribe: 'demon', attack: 3, health: 3, keywords: [], golden: false });

  it('buffs the Shop once per turn, then re-arms', () => {
    const s: RunState = { ...set2(), runeOpenMarket: { attack: 3, health: 3, usedThisTurn: false } };
    consumeShopMinion(s, demon(), minionIdx(s));
    expect(s.tavernBuyBonus.atk).toBe(3);
    consumeShopMinion(s, demon(), minionIdx(s));
    expect(s.tavernBuyBonus.atk, 'the per-turn latch did not hold').toBe(3);
    s.runeOpenMarket!.usedThisTurn = false; // what the turn rollover does
    consumeShopMinion(s, demon(), minionIdx(s));
    expect(s.tavernBuyBonus.atk).toBe(6);
  });

  it('keeps its own latch — holding Bottomless Banquet too pays both', () => {
    // They share the Consume trigger but not the effect; one shared latch would let the quest suppress the rune.
    const s: RunState = { ...set2(), runeOpenMarket: { attack: 3, health: 3, usedThisTurn: false }, consumeDoubleFirstEachTurn: true };
    const before = shopMinions(s);
    consumeShopMinion(s, demon(), minionIdx(s));
    expect(s.tavernBuyBonus.atk, 'the Open Market did not fire').toBe(3);
    expect(before - shopMinions(s), 'Bottomless Banquet did not double the Consume').toBe(2);
  });
});

describe('Rune of the Brokerage — the cap comes off', () => {
  it('a Ruby Broker keeps paying past its per-turn cap', () => {
    const broker = Object.values(CARD_INDEX).find((c) => c.effects.some((e) => e.do === 'rubyPlayedGold'));
    expect(broker, 'no Ruby Broker card exists to test against').toBeDefined();
    const cap = Number((broker!.effects.find((e) => e.do === 'rubyPlayedGold')!.params as { cap?: number } | undefined)?.cap ?? 2);
    const goldAfter = (rune: boolean): number => {
      let s: RunState = { ...set2(), runeBrokerage: rune, embers: 0, hand: [],
        board: [{ uid: 'b', cardId: broker!.id, tribe: broker!.tribe, attack: broker!.attack, health: broker!.health, keywords: [], golden: false }] };
      for (let i = 0; i < cap + 3; i++) {
        s = { ...s, hand: [...s.hand, { uid: `r${i}`, cardId: RUBY_ID, tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }] };
        s = reduce(s, { type: 'play', uid: `r${i}`, targetUid: 'b' });
      }
      return s.embers;
    };
    const capped = goldAfter(false);
    expect(capped, 'the capped run should still earn something').toBeGreaterThan(0);
    expect(goldAfter(true), 'the rune did not lift the cap').toBeGreaterThan(capped);
  });
});

describe('Rune of Runic Exchange — the meter excludes Ales', () => {
  it('an Ale cast does not advance it, so the rune cannot feed itself', () => {
    const s: RunState = { ...set2(), runeThresholds: [{ meter: 'spellCastNonAle', per: 3, tick: 0, grantAle: 1 }] };
    for (let i = 0; i < 5; i++) noteSpellCast(s, CARD_INDEX[ALE_IDS[0]!]!);
    expect(ales(s), 'Ales advanced their own meter').toBe(0);
    for (let i = 0; i < 3; i++) noteSpellCast(s, CARD_INDEX['growth']!);
    expect(ales(s)).toBe(1);
  });
});

describe('Rune of Resonance — both halves', () => {
  it("gives the turn's first Ruby an extra cast", () => {
    const s: RunState = { ...set2(), rubyFirstExtraCasts: 1 };
    expect(rubyCastCount({ ...s, rubyCastsThisTurn: 0 })).toBe(2);
    expect(rubyCastCount({ ...s, rubyCastsThisTurn: 1 })).toBe(1);
  });

  it('mints a Ruby at End of Turn, at live strength', () => {
    const s: RunState = { ...set2(), questRecurringEndOfTurn: ['grantRuby'], rubyBonus: { attack: 2, health: 2 }, hand: [] };
    applyEndOfTurn(s);
    expect(rubies(s)).toBe(1);
    expect(s.hand.find((c) => c.cardId === RUBY_ID)!.attack).toBe(CARD_INDEX[RUBY_ID]!.attack + 2);
  });
});

describe('the five runes ship as specced', () => {
  it("exist at the sheet's costs and tiers", () => {
    const want: [string, number, boolean][] = [
      ['Rune of Resonance', 1, false], ['Rune of Investment', 1, false],
      ['Rune of the Open Market', 2, true], ['Rune of Runic Exchange', 2, true], ['Rune of the Brokerage', 2, true],
    ];
    for (const [name, cost, epic] of want) {
      const r = byName(name);
      expect(r, `${name} is missing`).toBeDefined();
      expect(r!.cost, `${name} cost`).toBe(cost);
      expect(!!r!.epic, `${name} epic`).toBe(epic);
    }
  });

  it('all five are set-2 scoped — each names a set-2 mechanic', () => {
    for (const n of ['Rune of Resonance', 'Rune of Investment', 'Rune of the Open Market', 'Rune of Runic Exchange', 'Rune of the Brokerage']) {
      expect(byName(n)!.sets, `${n} leaks into set 1`).toEqual(['set2']);
    }
  });
});
