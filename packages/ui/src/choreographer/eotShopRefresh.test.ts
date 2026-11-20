import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { ConsequenceEvent } from '@game/core';
import {
  ANCIENT_IDS, createRun, enableAncients, poolOf, reduce, reduceWithPresentation,
  type Action, type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from '@game/sim';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import { EMPTY_PROJECTION, applyConsequencesToProjection } from './projection';
import { foldShopRefills, pendingRefillSlots } from './shopRefillRow';

/**
 * AN END-OF-TURN SHOP REFRESH LOOKS LIKE A REFRESH (player report 2026-11-20, R-EOT-SHOP-REFRESH-01):
 *
 *   "Gorr with Ancient of Time - When the end of turn happens to refresh the shop with my tribe type it doesnt clear
 *    the shop it adds to it and it spills over on the sides of the shop."
 *
 * The resolved state was always right (the refresh REPLACES the unfrozen row). The End-of-Turn batch announced each
 * new offer (`shopChanged: refilled`, paired with the slot it took) but said nothing about the offers the refresh rolled
 * away, so the Shop row, which renders the pre-End-of-Turn row plus the delivered consequences, kept the old five and
 * folded the new five in beside them: ten cards in a five-slot row. Every offer that leaves the row without being eaten
 * now rides a `shopChanged: replaced` departure, so the old cards leave and the new ones arrive in their slots.
 */

const faceOmen = { type: 'faceOmen' } as Action;
const body = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
const foes = (wave: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 400,
  minions: [{ cardId: 'sandbag', attack: 0, health: 400, keywords: [] }], seed: 1, origin: 'self',
});
function gorrTime(): RunState {
  const id: AncientId = 'time';
  let s = enableAncients({ ...createRun(7, 'gorr'), phase: 'recruit', embers: 99, hand: [], wave: 3 } as RunState);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  const tribe = s.tribes.find((t) => t !== 'neutral')!;
  const ids = poolOf(s).buyable.filter((c) => c.tier === 1 && !c.spell && !c.ruby && c.tribe === tribe && !c.tribe2 && !c.universalTribe).map((c) => c.id);
  return { ...s, frozen: false, board: [body('a', ids[0]!), body('b', ids[0]!)], servedBoards: { [s.wave]: foes(s.wave) } } as RunState;
}

describe('Gorr × Time: the End-of-Turn refresh replaces the Shop row on screen', () => {
  const s0 = gorrTime();
  const { batch } = reduceWithPresentation(s0, faceOmen, true);
  const after = reduce(s0, faceOmen) as RunState;
  const timeline = compileTimeline(normalizePresentationBatch(batch!));
  const deliveries = [...timeline.consequenceDeliveries].sort((x, y) => x.atMs - y.atMs);
  const all = deliveries.map((d) => d.consequence.payload as ConsequenceEvent);
  const refills = applyConsequencesToProjection(EMPTY_PROJECTION, all).shopRefills;
  const slots = s0.shop.length;

  /** The row the Shop draws after the first `n` deliveries (Recruit.tsx `displayShop`: refills folded in, departed
   *  offers out unless their refill is still on the way, which holds the slot as an invisible placeholder). */
  const rowAt = (n: number) => {
    const p = applyConsequencesToProjection(EMPTY_PROJECTION, all.slice(0, n));
    const pending = pendingRefillSlots(refills, p.shopRefills);
    return foldShopRefills(s0.shop, p.shopRefills).filter((o) => !p.destroyedUids.has(o.uid) || pending.has(o.uid));
  };

  it('the resolved state is a full replacement (engine was never wrong)', () => {
    expect(after.shop.length).toBe(slots);
    expect(after.shop.some((o) => s0.shop.some((p) => p.uid === o.uid))).toBe(false);
    expect(refills.length).toBe(slots);
  });

  it('every rolled-away offer departs on its beat, and the row never holds more cards than the Shop has slots', () => {
    const departed = all.filter((c) => c.type === 'shopChanged' && c.change === 'replaced').map((c) => (c as { target: { uid?: string } }).target.uid);
    expect(new Set(departed)).toEqual(new Set(s0.shop.map((o) => o.uid)));
    for (let n = 0; n <= all.length; n++) expect(rowAt(n).length, `after ${n} deliveries`).toBeLessThanOrEqual(slots);
  });

  it('old cards leave before the new ones arrive in their slots, and the final row is the committed Shop', () => {
    const at = (pred: (c: ConsequenceEvent) => boolean) => deliveries.filter((d) => pred(d.consequence.payload as ConsequenceEvent)).map((d) => d.atMs);
    const leaves = at((c) => c.type === 'shopChanged' && c.change === 'replaced');
    const arrives = at((c) => c.type === 'shopChanged' && c.change === 'refilled');
    expect(Math.max(...leaves)).toBeLessThanOrEqual(Math.min(...arrives));
    expect(rowAt(all.length).map((o) => o.uid)).toEqual(after.shop.map((o) => o.uid));
  });
});
