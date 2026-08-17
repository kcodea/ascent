import { describe, it, expect } from 'vitest';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * Keshi's Crown — "Get a Triple Reward every 25 shop tiers worth of cards you purchase."
 *
 * Every PAID card purchase banks that card's tavern tier in `keshiTierPoints`; at 25 the run gets a Triple
 * Reward (the same `discoverspell` a golden minion grants when played) and the counter resets to 0 — overflow
 * is discarded, not carried (owner spec 2026-08-16). The one exception is a full hand: the reward can't land,
 * so the bank is HELD at 25+ rather than spent into nothing.
 *
 * Card ids used: sandbag = Target Dummy (t1 minion, no triggers), taurus = Taurus (t6 minion),
 * shatter = t3 spell, perfectvision = t6 spell.
 */

/** A Keshi run parked in recruit with money, empty zones, and nothing else in flight. */
const keshiRun = (over: Partial<RunState> = {}): RunState => ({
  ...createRun(1, 'keshi'),
  embers: 99,
  board: [],
  hand: [],
  shop: [],
  spell: null,
  ...over,
});

/** Buy a card that we place into the minion row ourselves — the ordinary Shop purchase path. */
const buyFromRow = (s: RunState, cardId: string): RunState => {
  const withOffer: RunState = { ...s, shop: [...s.shop, { uid: `o_${cardId}_${s.uidSeq}`, cardId }] };
  const uid = withOffer.shop[withOffer.shop.length - 1]!.uid;
  return reduce(withOffer, { type: 'buy', uid });
};

/** A minimal filler card for stuffing the hand up to the cap. Deliberately a SPELL (`shatter`): spells are
 *  excluded from `checkTriples`, so nine identical fillers can't collapse into goldens and skew hand.length. */
const filler = (n: number): BoardCard => ({
  uid: `f${n}`, cardId: 'shatter', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false,
});

const rewards = (s: RunState): number => s.hand.filter((c) => c.cardId === 'discoverspell').length;

describe("Keshi's Crown", () => {
  it('starts at 0 and banks the tier of a minion bought from the Shop', () => {
    let s = keshiRun();
    expect(s.keshiTierPoints).toBe(0);
    s = buyFromRow(s, 'taurus'); // tier 6
    expect(s.keshiTierPoints).toBe(6);
    s = buyFromRow(s, 'sandbag'); // tier 1
    expect(s.keshiTierPoints).toBe(7);
    expect(rewards(s)).toBe(0); // nowhere near 25
  });

  it('banks a spell bought from the right-hand spell slot', () => {
    let s = keshiRun({ spell: { uid: 'sp', cardId: 'perfectvision' } }); // tier 6 spell
    s = reduce(s, { type: 'buy', uid: 'sp' });
    expect(s.hand.some((c) => c.cardId === 'perfectvision')).toBe(true); // the buy really happened
    expect(s.keshiTierPoints).toBe(6);
  });

  it('banks a spell bought out of the minion row (Spell Cart)', () => {
    let s = keshiRun();
    s = buyFromRow(s, 'shatter'); // tier 3 spell offered in the minion row
    expect(s.hand.some((c) => c.cardId === 'shatter')).toBe(true);
    expect(s.keshiTierPoints).toBe(3);
  });

  it('banks a held (displaced) minion bought back out of the tavern', () => {
    const held: BoardCard = {
      uid: 'held1', cardId: 'taurus', tribe: 'neutral', attack: 9, health: 9, keywords: [], golden: false,
    };
    let s = keshiRun({ shop: [{ uid: 'h', cardId: 'taurus', held }] });
    s = reduce(s, { type: 'buy', uid: 'h' });
    expect(s.hand.some((c) => c.cardId === 'taurus')).toBe(true);
    expect(s.keshiTierPoints).toBe(6); // tier 6, same as a fresh Taurus
  });

  it('grants exactly one Triple Reward at 25, frozen to the current tavern tier', () => {
    let s = keshiRun({ keshiTierPoints: 24, tier: 3 });
    s = buyFromRow(s, 'sandbag'); // +1 → exactly 25
    expect(rewards(s)).toBe(1);
    const reward = s.hand.find((c) => c.cardId === 'discoverspell')!;
    expect(reward.grantedTier).toBe(3); // peeks one tier above the tavern it was earned on
    expect(s.keshiTierPoints).toBe(0);
  });

  it('discards the overflow — 24 + a tier 6 buy resets to 0, not 5', () => {
    let s = keshiRun({ keshiTierPoints: 24 });
    s = buyFromRow(s, 'taurus'); // +6 → 30
    expect(rewards(s)).toBe(1);
    expect(s.keshiTierPoints).toBe(0);
  });

  it('is repeatable — a second 25 pays out again', () => {
    let s = keshiRun({ keshiTierPoints: 24 });
    s = buyFromRow(s, 'sandbag');
    expect(rewards(s)).toBe(1);
    s = { ...s, keshiTierPoints: 24 };
    s = buyFromRow(s, 'sandbag');
    expect(rewards(s)).toBe(2);
    expect(s.keshiTierPoints).toBe(0);
  });

  it('holds the bank when the hand is full instead of eating the reward', () => {
    // handCap is 10. Nine fillers + the bought minion = exactly full, so the reward cannot land.
    let s = keshiRun({ keshiTierPoints: 24, hand: Array.from({ length: 9 }, (_, i) => filler(i)) });
    s = buyFromRow(s, 'sandbag');
    expect(s.hand.length).toBe(10); // the buy itself succeeded
    expect(rewards(s)).toBe(0); // …but the Triple Reward had nowhere to go
    expect(s.keshiTierPoints).toBe(25); // held, NOT reset

    // Free a slot and buy again — the held bank pays out now.
    s = { ...s, hand: s.hand.slice(0, 5) };
    s = buyFromRow(s, 'sandbag');
    expect(rewards(s)).toBe(1);
    expect(s.keshiTierPoints).toBe(0);
  });

  it('does nothing for a hero who is not Keshi', () => {
    let s: RunState = { ...createRun(1, 'indy'), embers: 99, board: [], hand: [], shop: [], spell: null };
    s = buyFromRow(s, 'taurus');
    expect(s.keshiTierPoints).toBe(0);
    expect(s.hand.filter((c) => c.cardId === 'discoverspell').length).toBe(0);
  });

  it('banks only PURCHASES — spending Gold on a roll, or selling, never advances it', () => {
    const sold: BoardCard = {
      uid: 'own1', cardId: 'taurus', tribe: 'neutral', attack: 9, health: 9, keywords: [], golden: false,
    };
    let s = keshiRun({ keshiTierPoints: 10, board: [sold] });
    s = reduce(s, { type: 'roll' }); // Gold spent, but no card acquired
    expect(s.keshiTierPoints).toBe(10);
    s = reduce(s, { type: 'sell', uid: 'own1' }); // a tier 6 minion leaves the board
    expect(s.keshiTierPoints).toBe(10);
  });
});
