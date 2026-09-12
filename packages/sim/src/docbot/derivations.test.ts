/**
 * DOC BOT LANE `derivations` — declared derivation pairs: two code paths that must compute the same thing, held equal
 * by fuzz instead of by comment.
 *
 * The codebase is honest about having these — `offerBuyStats`'s own docblock says "Mirrors the reducer's buy
 * case" — but a comment claiming two functions agree is a testable assertion nobody was testing. Two bugs in
 * one day (2026-08-26) were exactly this drift:
 *
 *   • Merchant's Chorus: `offerBuyStats` summed BOTH shop-buff layers; the reducer's buy path summed one.
 *     The shop advertised 41/41 and sold you a 1/1.
 *   • beastsPlayed: the reducer's combat derivation was fixed to count all-types minions (#1216); the
 *     IDENTICAL inline derivation in `snapshotBoard` wasn't — so a served board's Pack Leader fought weaker
 *     than its owner's did.
 *
 * Each pair here is fuzzed over seeded random states (mulberry32 — same determinism rules as the game). When
 * you find yourself writing "mirrors X" in a docblock, that comment belongs HERE as a pair instead.
 */
import { describe, expect, it } from 'vitest';
import { makeRng } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, offerBuyPrice, reduce, snapshotBoard, type RunState, type ShopCard } from '../index';
import { defIsTribe, offerBuyStats } from '../recruit';

const NON_FODDER = Object.values(CARD_INDEX).filter(
  (c) => c && !c.spell && !c.token && !c.ruby && !c.keywords.includes('FD') && CARD_INDEX[c.id],
);

describe('Doc Bot — derivation pairs', () => {
  it('PAIR: offerBuyPrice ↔ the reducer buy path — the coin shows what buying charges, under every discount (100 fuzzed states)', () => {
    // Owner report 2026-09-12: the coin read `minionCostOf − Cadence` while the buy also subtracted Trade-In,
    // the Friends-and-Family Gift and Festival Treasurer's Spirit discount. One function now serves both; this
    // pair keeps it that way for every discount source, alone and stacked, free-first-buy included.
    const rng = makeRng(0x5e11e4);
    const TRIBES = ['beast', 'demon', 'dragon', 'dwarf', 'kobold', 'undead', 'spirit', 'celestial', 'mech'] as const;
    let charged = 0;
    for (let i = 0; i < 100; i++) {
      const def = NON_FODDER[rng.int(NON_FODDER.length)]!;
      const offer: ShopCard = { uid: 'offer', cardId: def.id, ...(rng.int(4) === 0 ? { cost: 1 + rng.int(3) } : {}) };
      const tribe = TRIBES[rng.int(TRIBES.length)]!;
      const s: RunState = {
        ...createRun(5000 + i),
        embers: 50, board: [], hand: [], shop: [offer],
        ...(rng.int(3) === 0 ? { spiritDiscount: 1 + rng.int(3) } : {}),
        ...(rng.int(3) === 0 ? { runeTradeIn: true, tradeInTribe: tribe, questFlags: { runeTradeIn: 1 } } : {}),
        ...(rng.int(3) === 0 ? { cadenceMinionOff: 1 } : {}),
        ...(rng.int(3) === 0 ? { minionCostOffTurn: 1 + rng.int(2) } : {}),
        ...(rng.int(4) === 0 ? { minionCostOverride: 2 + rng.int(4) } : {}),
        ...(rng.int(5) === 0 ? { questFreeFirstBuy: true, freeBuyUsedThisTurn: rng.int(2) === 0 } : {}),
      } as RunState;
      const price = offerBuyPrice(s, offer);
      const after = reduce(s, { type: 'buy', uid: 'offer' });
      if (after === s) continue; // refused (hand cap etc.) — nothing to compare
      charged++;
      expect(s.embers - after.embers, `${def.id} under ${JSON.stringify({ spirit: s.spiritDiscount, ti: s.tradeInTribe, cad: s.cadenceMinionOff, gift: s.minionCostOffTurn, ovr: s.minionCostOverride, free: price.freeBuy })}`).toBe(price.cost);
    }
    expect(charged, 'the fuzz must actually buy').toBeGreaterThan(80);
  });

  it('PAIR: offerBuyStats ↔ the reducer buy path — an offer is worth what buying it pays (100 fuzzed states)', () => {
    const rng = makeRng(0xd0cb07);
    for (let i = 0; i < 100; i++) {
      const def = NON_FODDER[rng.int(NON_FODDER.length)]!;
      const golden = rng.int(4) === 0;
      const offer: ShopCard = {
        uid: 'offer',
        cardId: def.id,
        ...(golden ? { golden: true } : {}),
        ...(rng.int(2) ? { atk: rng.int(5), hp: rng.int(5) } : {}),
      };
      const s: RunState = {
        ...createRun(1000 + i),
        embers: 99,
        board: [],
        hand: [],
        shop: [offer],
        tavernBuyBonus: { atk: rng.int(4), hp: rng.int(4) },
        // the Merchant's-Chorus layer — the half the buy path used to drop
        ...(rng.int(2) ? { tavernBuyBonusTurn: { atk: rng.int(41), hp: rng.int(41) } } : {}),
        ...(rng.int(3) === 0 ? { cardBuffs: { [def.id]: { attack: rng.int(3), health: rng.int(3) } } } : {}),
      };
      const promised = offerBuyStats(s, offer);
      const after = reduce(s, { type: 'buy', uid: 'offer' });
      const bought = after.hand.find((c) => c.cardId === def.id);
      if (!bought) continue; // a hero/quest intercept path declined the buy — not this pair's concern
      expect([bought.attack, bought.health], `${def.id}${golden ? ' (golden)' : ''} seed ${1000 + i}: shop promised ${promised.attack}/${promised.health}, buy paid ${bought.attack}/${bought.health}`)
        .toEqual([promised.attack, promised.health]);
    }
  });

  it('PAIR: snapshotBoard.beastsPlayed ↔ the shared Beast predicate — a served Pack Leader matches the live one', () => {
    const allTypes = Object.values(CARD_INDEX).find((c) => c?.universalTribe && !c.spell)!;
    const beast = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && defIsTribe(c, 'beast'))!;
    const notBeast = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.universalTribe && !defIsTribe(c, 'beast'))!;
    const s: RunState = { ...createRun(7), playedThisTurn: [allTypes.id, beast.id, notBeast.id] };
    const expected = s.playedThisTurn!.filter((id) => defIsTribe(CARD_INDEX[id], 'beast')).length;
    expect(expected, 'the fixture must exercise the all-types case').toBe(2);
    expect(snapshotBoard(s).beastsPlayed ?? 0,
      `snapshotBoard counted a different Beasts-played than the shared predicate — a served board's Pack Leader diverges from the owner's (the all-types drift, fixed 2026-08-26)`)
      .toBe(expected);
  });
});
