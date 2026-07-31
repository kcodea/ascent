import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type RunState } from './index';
import { ALE_IDS, advanceRuneThresholds, applyCardsBought, applyGoldSpent } from './recruit';

/**
 * The threshold-rune dispatcher. These runes differ only in meter and payload, so ONE dispatcher owns the parts
 * that must not vary between them: banking the remainder, paying every threshold a single large transaction
 * crosses, and the per-turn cap. Those three are what the tests below pin — a per-rune hook would drift on
 * exactly these and each drift would look correct in isolation.
 */
const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const byName = (n: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.name === n);
const armed = (over: Partial<NonNullable<RunState['runeThresholds']>[number]>): RunState => ({
  ...set2(), embers: 40,
  runeThresholds: [{ meter: 'gold', per: 5, tick: 0, ...over } as NonNullable<RunState['runeThresholds']>[number]],
});

describe('banking and multi-payout', () => {
  it('banks the remainder across separate transactions', () => {
    const s = armed({ meter: 'gold', per: 15, grantAle: 1 });
    applyGoldSpent(s, 9);
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length, 'paid below the threshold').toBe(0);
    applyGoldSpent(s, 6); // 15 total
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length).toBe(1);
  });

  it('pays every threshold a single large spend crosses', () => {
    // A 32-Gold spend against a 15-Gold rune owes TWO payouts, not one. A naive `if (tick >= per)` pays once
    // and silently swallows the rest.
    const s = armed({ meter: 'gold', per: 15, grantAle: 1 });
    applyGoldSpent(s, 32);
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length).toBe(2);
    expect(s.runeThresholds![0]!.tick, 'the leftover 2 Gold should stay banked').toBe(2);
  });

  it('several threshold runes each keep their own bank', () => {
    const s: RunState = { ...set2(), runeThresholds: [
      { meter: 'gold', per: 5, tick: 0, grantAle: 1 },
      { meter: 'gold', per: 15, tick: 0, grantAle: 1 },
    ] };
    applyGoldSpent(s, 15);
    // per-5 pays 3, per-15 pays 1 → 4 Ales. A shared counter would give the wrong total.
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length).toBe(4);
  });
});

describe('oncePerTurn (the Merchant\'s Chorus)', () => {
  it('pays at most once a turn, and re-arms next turn', () => {
    const s = armed({ meter: 'shout', per: 3, buff: { target: 'shop', attack: 4, health: 4 }, oncePerTurn: true });
    advanceRuneThresholds(s, 'shout', 9); // three thresholds crossed
    expect(s.tavernBuyBonus.atk, 'the per-turn cap did not hold').toBe(4);
    s.runeThresholds![0]!.usedThisTurn = false; // what the turn rollover does
    advanceRuneThresholds(s, 'shout', 3);
    expect(s.tavernBuyBonus.atk).toBe(8);
  });

  it('without the cap, every threshold pays', () => {
    const s = armed({ meter: 'shout', per: 3, buff: { target: 'shop', attack: 4, health: 4 } });
    advanceRuneThresholds(s, 'shout', 9);
    expect(s.tavernBuyBonus.atk).toBe(12);
  });
});

describe('payload targets', () => {
  it('shopRightmost buffs the OFFER, not the run-wide buy bonus', () => {
    // The Showcase is about the row in front of you; leaking into `tavernBuyBonus` would silently buff every
    // future shop as well.
    const s = armed({ meter: 'gold', per: 10, buff: { target: 'shopRightmost', attack: 4, health: 4 } });
    applyGoldSpent(s, 10);
    expect(s.tavernBuyBonus.atk, 'the Showcase leaked into the run-wide bonus').toBe(0);
    const rightmost = [...s.shop].reverse().find((o) => !CARD_INDEX[o.cardId]?.spell && !CARD_INDEX[o.cardId]?.ruby)!;
    expect(rightmost.atk).toBe(4);
  });

  it('a granted Shop spell is never an Ale', () => {
    // Ales are Shop spells in set 2, so an unfiltered "random spell" grant would hand out Ales to runes that
    // never mention them.
    const s = armed({ meter: 'cardsBought', per: 1, grantSpell: 1 });
    applyCardsBought(s, 3);
    expect(s.hand.length).toBe(3);
    expect(s.hand.some((c) => ALE_IDS.includes(c.cardId)), 'a spell grant handed out an Ale').toBe(false);
  });
});

describe('the meters are wired to real play', () => {
  it('a Ruby cast advances castRuby', () => {
    const s: RunState = { ...set2(), runeThresholds: [{ meter: 'castRuby', per: 1, tick: 0, grantAle: 1 }] };
    const board = [{ uid: 't', cardId: 'pack', tribe: 'beast' as const, attack: 3, health: 3, keywords: [], golden: false }];
    const withRuby: RunState = { ...s, board, hand: [{ uid: 'r', cardId: 'ruby', tribe: 'neutral' as const, attack: 1, health: 1, keywords: [], golden: false }] };
    const next = reduce(withRuby, { type: 'play', uid: 'r', targetUid: 't' });
    expect(next.hand.filter((c) => ALE_IDS.includes(c.cardId)).length, 'casting a Ruby did not advance the meter').toBe(1);
  });

  it('a roll advances gold', () => {
    const s = armed({ meter: 'gold', per: 1, grantAle: 1 });
    const next = reduce(s, { type: 'roll' });
    expect(next.hand.filter((c) => ALE_IDS.includes(c.cardId)).length).toBeGreaterThan(0);
  });
});

describe('the seven runes', () => {
  it('ship at the sheet\'s costs', () => {
    const want: [string, number][] = [
      ['Rune of the Chorus', 3], ['Rune of Overtime', 1], ['Rune of Infernal Ink', 4],
      ['Rune of the Cindergem', 4], ['Rune of the Showcase', 3], ["Rune of the Merchant's Chorus", 3],
      ['Rune of the Long Shift', 2],
    ];
    for (const [name, cost] of want) {
      const r = byName(name);
      expect(r, `${name} is missing`).toBeDefined();
      expect(r!.cost, `${name} cost`).toBe(cost);
    }
  });

  it('Ale and Ruby runes are set-2 scoped', () => {
    // An Ale/Ruby payout is unreachable in set 1 — offering the rune there is a dead Runeforge slot.
    expect(byName('Rune of Overtime')!.sets).toEqual(['set2']);
    expect(byName('Rune of the Cindergem')!.sets).toEqual(['set2']);
  });
});
