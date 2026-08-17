import { describe, it, expect } from 'vitest';
import { createRun, reduce, KESHI_CROWN_THRESHOLD, type BoardCard, type RunState } from './index';

/**
 * Keshi's Crown — "Get a Triple Reward every 25 shop tiers worth of cards you purchase."
 *
 * Every card acquired by a SHOP PURCHASE — including one made free by a discount or the Freedom rift's free
 * first buy — banks that card's tavern tier in `keshiTierPoints`; at 25 (`KESHI_CROWN_THRESHOLD`) the run gets
 * a Triple Reward (the same `discoverspell` a golden minion grants when played) and the counter resets to 0 —
 * overflow is discarded, not carried (owner spec 2026-08-16). The one exception is a full hand: the reward
 * can't land, so the bank is HELD at 25+ rather than spent into nothing — and "full" also accounts for any
 * hand slots reserved by a pending Discover pick, since a Discover forfeits outright if the hand is full when
 * the player chooses (see `reservedHandSlots`).
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

  // Investigated for the 2026-08-16 final review's "pending Discover is protected" finding (the guard should
  // hold the bank rather than fill a hand slot reserved for an open Discover pick). Empirically: `reduceCore`'s
  // modalOpen guard already refuses `buy`/`buyHenchman` OUTRIGHT whenever `run.discover` is set — `buy` is not
  // on its exemption list (`discover`/`chooseOne`/`battlecryTarget`/`buyQuest`/`buyRune`/`skipRuneforge`/
  // `rerollRuneforge`/`devGrant`/`closeScout` are) — and minimizing the Discover panel (Recruit.tsx's
  // "Minimize / Return to Discover" toggle) is a local `useState`, not a dispatch: it never clears
  // `run.discover`. So a purchase can't even be ATTEMPTED while a Discover is open, successfully or held —
  // `keshiCrownBuy`'s `reservedHandSlots(s)` therefore reads 0 at every call site it fires from today. This
  // pins that invariant (rather than asserting the finding's literal "hand 9 → held at 25" scenario, which
  // doesn't reproduce: the dispatch below no-ops before the buy or the crown tally ever run) so a future
  // relaxation of the modalOpen exemption list — which WOULD make the reservedHandSlots guard load-bearing —
  // shows up here as a break, not silently.
  it('a purchase cannot even be attempted while a Discover is open (Keshi\'s reservedHandSlots guard is defense-in-depth, not reachable today)', () => {
    let s = keshiRun({
      keshiTierPoints: 24,
      hand: Array.from({ length: 8 }, (_, i) => filler(i)),
      discover: ['sandbag', 'taurus', 'perfectvision'], // an open Discover prompt — minimized or not, still open
    });
    const handBefore = s.hand.length;
    s = buyFromRow(s, 'sandbag'); // would cross the threshold if it landed
    expect(s.hand.length).toBe(handBefore); // refused outright — the buy never happened
    expect(s.shop.some((o) => o.cardId === 'sandbag')).toBe(true); // the offer is still sitting there, unbought
    expect(s.keshiTierPoints).toBe(24); // nothing banked
    expect(rewards(s)).toBe(0);
  });

  it('pays out on a buy that completes a triple, because checkTriples frees the hand before the guard checks it', () => {
    // 2 sandbags in hand + 7 fillers = 9; buying a 3rd sandbag pushes the hand to a transient 10 (handCap)
    // BEFORE checkTriples collapses the 3 sandbags into 1 golden, dropping it back to 8. Keshi's guard must
    // see the POST-triple hand, not the transient full one, or a triple-completing buy would be wrongly held.
    const sandbag = (n: number): BoardCard => ({
      uid: `sb${n}`, cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false,
    });
    let s = keshiRun({
      keshiTierPoints: KESHI_CROWN_THRESHOLD - 1,
      hand: [sandbag(1), sandbag(2), ...Array.from({ length: 7 }, (_, i) => filler(i))],
    });
    s = buyFromRow(s, 'sandbag'); // +1 tier → 25, AND completes the triple
    expect(s.hand.filter((c) => c.cardId === 'sandbag' && c.golden).length).toBe(1); // the triple resolved
    expect(rewards(s)).toBe(1); // …and the payout landed rather than being held
    expect(s.keshiTierPoints).toBe(0);
  });

  it('pays out via the right-hand spell slot, not just accumulates', () => {
    let s = keshiRun({ keshiTierPoints: KESHI_CROWN_THRESHOLD - 3, spell: { uid: 'sp', cardId: 'shatter' } }); // tier 3
    s = reduce(s, { type: 'buy', uid: 'sp' });
    expect(s.hand.some((c) => c.cardId === 'shatter')).toBe(true); // the buy itself happened
    expect(rewards(s)).toBe(1);
    expect(s.keshiTierPoints).toBe(0);
  });

  it('pays out via a spell offer bought out of the minion row, not just accumulates', () => {
    let s = keshiRun({ keshiTierPoints: KESHI_CROWN_THRESHOLD - 3 });
    s = buyFromRow(s, 'shatter'); // tier 3 spell offered in the minion row
    expect(s.hand.some((c) => c.cardId === 'shatter')).toBe(true);
    expect(rewards(s)).toBe(1);
    expect(s.keshiTierPoints).toBe(0);
  });

  it('a Freedom-rift free first buy still banks its tier — a card acquired for 0 Gold is still a shop purchase', () => {
    let s = keshiRun({ rift: 'freedom' });
    const embersBefore = s.embers;
    s = buyFromRow(s, 'taurus'); // tier 6, and free — the run's first minion buy this turn
    expect(s.embers).toBe(embersBefore); // confirms it really was free
    expect(s.keshiTierPoints).toBe(6);
  });

  // Investigated for the 2026-08-16 final review's "Runeforge hand cap" finding (the guard should use the
  // raised 20-slot cap, not the normal 10, while the Runeforge is open). Empirically: `handCap` DOES raise to
  // `CONFIG.handMaxRuneTurn` while `state.runeforgeOffer` is set, but `reduceCore`'s `modalOpen` guard refuses
  // `buy` (and `buyHenchman`) OUTRIGHT for the same reason it refuses them under an open Discover — `buy` is
  // not on the exemption list (`buyRune`/`skipRuneforge`/`rerollRuneforge`/… are), and `closeRuneforge` (called
  // from all three) clears `runeforgeOffer` before returning control to the shop. So a `buy` action — and
  // therefore `keshiCrownBuy` — can never observe a truthy `runeforgeOffer`; the raised cap it would read is
  // unreachable through the guard it's meant to protect. This pins that invariant (rather than asserting the
  // finding's literal "hand 11 pays out under the raised cap" scenario, which doesn't reproduce: the buy below
  // is refused before the crown tally ever runs) so a future relaxation of the modalOpen exemption list would
  // show up here as a break, not silently.
  it('a purchase cannot even be attempted while the Runeforge is open (the raised handCap Keshi\'s guard would use is unreachable today)', () => {
    let s = keshiRun({
      keshiTierPoints: KESHI_CROWN_THRESHOLD - 1,
      hand: Array.from({ length: 10 }, (_, i) => filler(i)), // full at the NORMAL cap; would fit under the raised one
      runeforgeOffer: ['someRune'], // an open Runeforge — handCap would read 20 here if the buy ever reached it
    });
    const handBefore = s.hand.length;
    s = buyFromRow(s, 'sandbag'); // would cross the threshold and land under the raised cap if it landed at all
    expect(s.hand.length).toBe(handBefore); // refused outright — the buy never happened
    expect(s.shop.some((o) => o.cardId === 'sandbag')).toBe(true); // the offer is still sitting there, unbought
    expect(s.keshiTierPoints).toBe(KESHI_CROWN_THRESHOLD - 1); // nothing banked
    expect(rewards(s)).toBe(0);
  });
});
