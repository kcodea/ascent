import { describe, it, expect } from 'vitest';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import type { ConsequenceEvent, GamePresentationEvent, SourceTriggerEvent } from '@game/core';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { reduceWithPresentation } from './reducer';
import { shopArrivals } from './recruit';

/**
 * SHOP MADNESS ON ITS BEATS (owner report 2026-11-13, R-SHOPMADNESS-REALTIME-01): "minions should replace each other in
 * real time ... the consumed stats didnt go up in real time, but at the end of turn resolve".
 *
 * Hydraskus + Demons at End of Turn: every Demon eats, and with Shop Madness each eaten slot refills at once. The
 * End-of-Turn batch must carry that per bite: the eater's gain, the meal leaving (with the eaten offer's uid), and
 * the refill taking that same slot (`shopChanged: refilled` + `replaces`), so the screen can play eat, climb, refill,
 * then the next Demon eats a minion that is actually on screen. Presentation only: the resolved state is unchanged.
 */

const faceOmen = { type: 'faceOmen' } as Action;
type ShopChange = Extract<ConsequenceEvent, { type: 'shopChanged' }>;
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const body = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
function shopRun(madness: boolean, tier = 3): RunState {
  let s = {
    ...createRun(11, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: [...SETS.set2.tribes], wave: 7, tier, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
  } as RunState;
  if (madness) s = { ...act({ ...s, runeforgeOffer: ['rune_shop_madness'], runeforgeEpic: false }, { type: 'buyRune', index: 0 }), embers: 60 };
  return act(s, { type: 'roll' });
}
const DEMONS = ['hy', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5'];
const feast = (madness: boolean): RunState =>
  ({ ...shopRun(madness), board: [body('hy', 'dm_hydraskus'), ...DEMONS.slice(1).map((u) => body(u, 'dm_hank'))] }) as RunState;

/** The batch's root triggers, each with its own consequences in emission order. */
function beatsOf(events: GamePresentationEvent[]): { trigger: SourceTriggerEvent; cs: ConsequenceEvent[] }[] {
  const out: { trigger: SourceTriggerEvent; cs: ConsequenceEvent[] }[] = [];
  const byId = new Map<string, { trigger: SourceTriggerEvent; cs: ConsequenceEvent[] }>();
  for (const e of events) {
    if (e.type === 'sourceTrigger') { const b = { trigger: e, cs: [] as ConsequenceEvent[] }; byId.set(e.id, b); if (!e.parentId) out.push(b); continue; }
    byId.get(e.parentId ?? '')?.cs.push(e);
  }
  return out;
}

describe('Shop Madness x Hydraskus: one eat-then-refill beat per Demon', () => {
  const s0 = feast(true);
  const { state, batch } = reduceWithPresentation(s0, faceOmen, true);
  const bites = beatsOf(batch!.events).filter((b) => b.trigger.policyKey === 'factory:endOfTurnDemonsConsumeShop:endOfTurn');

  it('seven beats, one per Demon, left to right; each has the gain, the meal, then the refill in that slot', () => {
    expect(bites).toHaveLength(7);
    bites.forEach((b, k) => {
      const eater = DEMONS[k]!;
      const stats = b.cs.filter((c) => c.type === 'statsChanged');
      expect(stats.map((c) => c.target.uid), `beat ${k} gain`).toEqual([eater]);
      const consumed = b.cs.filter((c): c is ShopChange => c.type === 'shopChanged' && c.change === 'consumed');
      const meals = b.cs.filter((c) => c.type === 'fodderEaten');
      const refills = b.cs.filter((c) => c.type === 'shopChanged' && c.change === 'refilled');
      expect([consumed.length, meals.length, refills.length], `beat ${k}`).toEqual([1, 1, 1]);
      const eaten = consumed[0]!.target.uid!;
      const meal = meals[0]! as Extract<ConsequenceEvent, { type: 'fodderEaten' }>;
      expect(meal.eaterUid).toBe(eater);
      expect(meal.offerUid, 'the meal names the slot it left').toBe(eaten);
      // The gain IS this meal's gain, on this beat (not deferred to the end of the End of Turn).
      expect([stats[0]!.type === 'statsChanged' && stats[0]!.attack, stats[0]!.type === 'statsChanged' && stats[0]!.health]).toEqual([meal.gainAttack, meal.gainHealth]);
      const refill = refills[0]! as Extract<ConsequenceEvent, { type: 'shopChanged' }>;
      expect(refill.replaces, `beat ${k}: the refill takes the eaten slot`).toBe(eaten);
      expect(refill.deliveryKey).toBe('consume.refill');
      expect(b.cs.indexOf(refill)).toBeGreaterThan(b.cs.indexOf(consumed[0]!)); // eat first, then refill
    });
  });

  it('every Demon eats a minion that is ON SCREEN at that moment, and the replayed row ends as the real Shop', () => {
    let row = s0.shop.map((o) => o.uid);
    for (const [k, b] of bites.entries()) {
      const eaten = b.cs.find((c): c is ShopChange => c.type === 'shopChanged' && c.change === 'consumed')!.target.uid!;
      expect(row, `beat ${k} eats ${eaten}`).toContain(eaten);
      const refill = b.cs.find((c) => c.type === 'shopChanged' && c.change === 'refilled') as Extract<ConsequenceEvent, { type: 'shopChanged' }>;
      row = row.map((u) => (u === eaten ? refill.target.uid! : u));
    }
    expect(row).toEqual(state.shop.map((o) => o.uid));
  });

  it('the refill shows its full Shop stats (the +3/+3 included)', () => {
    for (const b of bites) {
      const r = b.cs.find((c) => c.type === 'shopChanged' && c.change === 'refilled') as Extract<ConsequenceEvent, { type: 'shopChanged' }>;
      const d = CARD_INDEX[r.target.cardId!]!;
      expect([r.attack! - d.attack, r.health! - d.health]).toEqual([3, 3]);
    }
  });

  it('presentation only: the resolved state is byte-for-byte the plain reduce', () => {
    expect(state).toEqual(reduce(feast(true), faceOmen));
  });

  it('without the rune nothing refills, and the bites still carry their meal uid', () => {
    const { batch: plain } = reduceWithPresentation(feast(false), faceOmen, true);
    const evs = plain!.events.filter((e) => e.type !== 'sourceTrigger') as ConsequenceEvent[];
    expect(evs.some((c) => c.type === 'shopChanged' && c.change === 'refilled')).toBe(false);
    const meals = evs.filter((c) => c.type === 'fodderEaten') as Extract<ConsequenceEvent, { type: 'fodderEaten' }>[];
    expect(meals.length).toBeGreaterThan(0);
    for (const m of meals) expect(m.offerUid).toBeTruthy();
  });
});

describe('shopArrivals: which new offer took which slot', () => {
  it('a bought minion: the refill is paired with it, in its own slot', () => {
    const s = shopRun(true);
    const before = s.shop.map((o) => o.uid);
    const after = act(s, { type: 'buy', uid: before[2]! } as Action);
    expect(shopArrivals(before, after.shop)).toEqual([{ index: 2, replaces: before[2] }]);
  });

  it('pairs each arrival with the offer that left the same gap; a pure growth has no partner', () => {
    const row = (...u: string[]) => u.map((uid) => ({ uid }));
    expect(shopArrivals(['a', 'b', 'c'], row('a', 'x', 'c'))).toEqual([{ index: 1, replaces: 'b' }]);
    expect(shopArrivals(['a', 'b', 'c'], row('x', 'b', 'y'))).toEqual([{ index: 0, replaces: 'a' }, { index: 2, replaces: 'c' }]);
    expect(shopArrivals(['a', 'b'], row('a', 'b', 'z'))).toEqual([{ index: 2 }]);
    expect(shopArrivals(['a', 'b'], row('a', 'b'))).toEqual([]);
  });
});
