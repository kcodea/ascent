import { describe, it, expect } from 'vitest';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import type { ConsequenceEvent } from '@game/core';
import { CONFIG, createRun, reduce, reduceWithPresentation, type Action, type BoardCard, type RunState } from '@game/sim';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import { EMPTY_PROJECTION, applyConsequencesToProjection } from './projection';
import { foldShopRefills, pendingRefillSlots } from './shopRefillRow';

/**
 * SHOP MADNESS ON ITS BEATS (owner report 2026-11-13, R-SHOPMADNESS-REALTIME-01): with Hydraskus and seven Demons the
 * Shop did not visibly get eaten and refilled one bite at a time, and the Demons' stats only jumped at the end.
 *
 * Two causes, both pinned here against the REAL End-of-Turn batch:
 *   1. the seven bites were paced as a REPEAT CHAIN (Kringle's accelerating ticks), so seven 530 ms eats were packed
 *      into ~2 s and the last ones overlapped at the very end. A tick that eats now keeps its full beat;
 *   2. the refills were never announced, so the row emptied on screen and later Demons ate invisible cards. Each
 *      refill is now its own delivery, after its meal and before the next Demon bites.
 */

const faceOmen = { type: 'faceOmen' } as Action;
const body = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
function feast(madness: boolean, demons = 7): RunState {
  let s = {
    ...createRun(11, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: [...SETS.set2.tribes], wave: 7, tier: 3, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
  } as RunState;
  if (madness) s = { ...(reduce({ ...s, runeforgeOffer: ['rune_shop_madness'], runeforgeEpic: false }, { type: 'buyRune', index: 0 }) as RunState), embers: 60 };
  s = reduce(s, { type: 'roll' }) as RunState;
  return { ...s, board: [body('hy', 'dm_hydraskus'), ...Array.from({ length: demons - 1 }, (_, i) => body(`d${i}`, 'dm_hank'))] } as RunState;
}
const compile = (s: RunState) => {
  const { batch } = reduceWithPresentation(s, faceOmen, true);
  return { batch: batch!, timeline: compileTimeline(normalizePresentationBatch(batch!)) };
};
const kindOf = (c: unknown): string => {
  const e = c as ConsequenceEvent;
  return e.type === 'shopChanged' ? `shop:${e.change}` : e.type;
};

describe('Shop Madness x Hydraskus: the compiled End of Turn', () => {
  const { timeline } = compile(feast(true));
  const bites = timeline.beats.filter((b) => b.policyKey === 'factory:endOfTurnDemonsConsumeShop:endOfTurn');
  const deliveriesOf = (beatId: string) => timeline.consequenceDeliveries.filter((d) => d.beatId === beatId);

  it('one beat per Demon, none of them accelerated: each keeps its full window', () => {
    expect(bites).toHaveLength(7);
    for (const b of bites) expect(b.pace, `${b.id} is not a paced repeat tick`).toBeUndefined();
    for (let k = 1; k < bites.length; k++) {
      expect(bites[k]!.startMs - bites[k - 1]!.startMs, `bite ${k} waits for bite ${k - 1}`).toBeGreaterThanOrEqual(700);
    }
  });

  it('inside each beat: the gain and the meal land first, the refill lands after them, before the next bite', () => {
    bites.forEach((b, k) => {
      const ds = deliveriesOf(b.id);
      const at = (kind: string) => ds.find((d) => kindOf(d.consequence.payload) === kind)!.atMs;
      expect(at('shop:refilled'), `beat ${k}`).toBeGreaterThan(at('fodderEaten'));
      expect(at('shop:refilled')).toBeGreaterThan(at('statsChanged'));
      const next = bites[k + 1];
      if (next) {
        const nextMeal = deliveriesOf(next.id).find((d) => kindOf(d.consequence.payload) === 'fodderEaten')!.atMs;
        expect(at('shop:refilled'), `the refill of bite ${k} is on screen before bite ${k + 1} eats`).toBeLessThan(nextMeal);
      }
    });
  });

  it('reserves time per eat: the End of Turn grows with the number of Demons eating', () => {
    const three = compile(feast(true, 3)).timeline;
    expect(timeline.durationMs - three.durationMs).toBeGreaterThanOrEqual(4 * 700);
  });

  it('the projection carries each refill (not as a stat climb) and the row reads the right minions after every beat', () => {
    const s0 = feast(true);
    const { batch } = compile(s0);
    const all = timeline.consequenceDeliveries.map((d) => d.consequence.payload as ConsequenceEvent);
    const projected = applyConsequencesToProjection(EMPTY_PROJECTION, all);
    expect(projected.shopRefills).toHaveLength(7);
    for (const r of projected.shopRefills) expect(projected.shopStats.has(r.uid), 'a refill is not a buff').toBe(false);
    // Fold the row the way the Shop does (refills in, eaten offers out) and compare with the real resolved Shop.
    const row = foldShopRefills(s0.shop, projected.shopRefills).filter((o) => !projected.destroyedUids.has(o.uid));
    const after = reduce(s0, faceOmen) as RunState;
    expect(row.map((o) => o.uid)).toEqual(after.shop.map((o) => o.uid));
    expect(batch.events.length).toBeGreaterThan(0);
  });
});

describe('shopRefillRow', () => {
  const row = ['a', 'b', 'c'].map((uid) => ({ uid, cardId: 'x' }));
  it('a refill sits right after the offer it replaced; an unpaired one goes to its index', () => {
    expect(foldShopRefills(row, [{ uid: 'r', cardId: 'y', index: 1, replaces: 'b' }]).map((o) => o.uid)).toEqual(['a', 'b', 'r', 'c']);
    expect(foldShopRefills(row, [{ uid: 'r', cardId: 'y', index: 0 }]).map((o) => o.uid)).toEqual(['r', 'a', 'b', 'c']);
    // A chain (the next Demon eats the refill): each lands after its own predecessor.
    expect(foldShopRefills(row, [{ uid: 'r', cardId: 'y', index: 1, replaces: 'b' }, { uid: 's', cardId: 'y', index: 1, replaces: 'r' }]).map((o) => o.uid)).toEqual(['a', 'b', 'r', 's', 'c']);
    // Already committed: untouched.
    expect(foldShopRefills(row, [{ uid: 'b', cardId: 'x', index: 1 }]).map((o) => o.uid)).toEqual(['a', 'b', 'c']);
  });
  it('pending slots are the eaten offers whose refill has not been delivered yet', () => {
    const all = [{ uid: 'r', cardId: 'y', index: 1, replaces: 'b' }, { uid: 's', cardId: 'y', index: 0, replaces: 'a' }];
    expect([...pendingRefillSlots(all, [])]).toEqual(['b', 'a']);
    expect([...pendingRefillSlots(all, [all[0]!])]).toEqual(['a']);
  });
});
