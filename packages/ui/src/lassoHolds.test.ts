import { describe, expect, it } from 'vitest';
import {
  EMPTY_LASSO_HOLDS, foldLassoHolds, holdLassoSteals, lassoBeamSchedule, lassoCascadeMs,
  lassoHoldsForPhase, releaseLassoSteal, resolveAllLassoHolds, LASSO_CONTACT_MS, type LassoSteal,
} from './lassoHolds';
import type { RunState } from '@game/sim';

/**
 * THE LASSO HOLDS (owner ask 2026-09-22: "make sure that the beam hits the target before the card is stolen
 * from shop and granted to hand").
 *
 * The reducer resolved the theft the instant the spell was played. These holds put the moment back on screen
 * without touching what resolved. What is pinned here is the part that can strand a card:
 *
 *   · the Shop row is rebuilt EXACTLY as it was, for any number of steals in one action;
 *   · a release lets go of ONE card, by uid, on both sides;
 *   · leaving the shop resolves every outstanding hold, with no timer involved.
 */

const steal = (offerUid: string, cardId: string, index: number, handUid: string, origin = 'spell'): LassoSteal =>
  ({ offer: { uid: offerUid, cardId }, index, handUid, origin }) as LassoSteal;

describe('lasso holds — the Shop row while the rope is in the air', () => {
  it('puts one stolen offer back in its own slot', () => {
    const row = [{ uid: 'a' }, { uid: 'c' }, { uid: 'd' }];
    const holds = holdLassoSteals(EMPTY_LASSO_HOLDS, [steal('b', 'stray', 1, 'h1')]);
    expect(foldLassoHolds(row, holds).map((o) => o.uid)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('rebuilds the row for SEVERAL steals in one action — the indices are relative to the shrinking row', () => {
    // [A,B,C,D,E] → steal B at index 1 → [A,C,D,E] → steal D at index 2 → [A,C,E].
    const row = [{ uid: 'A' }, { uid: 'C' }, { uid: 'E' }];
    const holds = holdLassoSteals(EMPTY_LASSO_HOLDS, [steal('B', 'stray', 1, 'h1'), steal('D', 'stray', 2, 'h2')]);
    expect(foldLassoHolds(row, holds).map((o) => o.uid)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('is identity when nothing is held (the row object itself, so no render churn)', () => {
    const row = [{ uid: 'a' }, { uid: 'b' }];
    expect(foldLassoHolds(row, EMPTY_LASSO_HOLDS)).toBe(row);
  });

  it('never doubles a uid already held (a re-entrant seed, or a second action naming the same offer)', () => {
    const one = holdLassoSteals(EMPTY_LASSO_HOLDS, [steal('b', 'stray', 1, 'h1')]);
    const again = holdLassoSteals(one, [steal('b', 'stray', 1, 'h1')]);
    expect(again.shop).toHaveLength(1);
    expect(again).toBe(one);
  });
});

describe('lasso holds — the hand arrival', () => {
  it('holds the arrival by ITS OWN uid, never a blanket flag', () => {
    const holds = holdLassoSteals(EMPTY_LASSO_HOLDS, [steal('b', 'stray', 1, 'h1'), steal('c', 'stray', 1, 'h2')]);
    expect([...holds.hand].sort()).toEqual(['h1', 'h2']);
    // Anything else conjured in the same tick is untouched — that is the whole point of keying on uids.
    expect(holds.hand.has('someOtherFreshCard')).toBe(false);
  });

  it('a contact releases ONE card on both sides and leaves the rest held', () => {
    const holds = holdLassoSteals(EMPTY_LASSO_HOLDS, [steal('b', 'stray', 1, 'h1'), steal('c', 'stray', 1, 'h2')]);
    const after = releaseLassoSteal(holds, 'b', 'h1');
    expect(after.shop.map((h) => h.offer.uid)).toEqual(['c']);
    expect([...after.hand]).toEqual(['h2']);
  });
});

describe('lasso holds — the escape hatches (a stranded card is the failure mode)', () => {
  it('LEAVING THE SHOP resolves every outstanding hold, with no timer involved', () => {
    const holds = holdLassoSteals(EMPTY_LASSO_HOLDS, [steal('b', 'stray', 1, 'h1'), steal('c', 'stray', 2, 'h2')]);
    const inCombat = lassoHoldsForPhase(holds, 'combat' as RunState['phase']);
    expect(inCombat.shop).toEqual([]);
    expect(inCombat.hand.size).toBe(0);
    // …and nothing is filtered out of the hand fan any more, so no card can be invisible.
    expect(['h1', 'h2'].some((u) => inCombat.hand.has(u))).toBe(false);
  });

  it('keeps the holds while the shop IS on screen', () => {
    const holds = holdLassoSteals(EMPTY_LASSO_HOLDS, [steal('b', 'stray', 1, 'h1')]);
    expect(lassoHoldsForPhase(holds, 'recruit' as RunState['phase'])).toBe(holds);
  });

  it('a cancelled cascade (a second lasso mid-flight, an unmount) lets everything go at once', () => {
    const holds = holdLassoSteals(EMPTY_LASSO_HOLDS, [steal('b', 'stray', 1, 'h1'), steal('c', 'stray', 2, 'h2')]);
    expect(resolveAllLassoHolds(holds)).toBe(EMPTY_LASSO_HOLDS);
    expect(resolveAllLassoHolds(EMPTY_LASSO_HOLDS)).toBe(EMPTY_LASSO_HOLDS);
  });
});

describe('lasso holds — the cascade clock', () => {
  it('stages the steals ~300 ms apart, each landing 200 ms after its own launch', () => {
    expect(lassoBeamSchedule(3)).toEqual([
      { launchAt: 0, contactAt: 200 },
      { launchAt: 300, contactAt: 500 },
      { launchAt: 600, contactAt: 800 },
    ]);
  });

  it('the card NEVER leaves before its own beam lands', () => {
    for (const { launchAt, contactAt } of lassoBeamSchedule(5)) {
      expect(contactAt).toBe(launchAt + LASSO_CONTACT_MS);
      expect(contactAt).toBeGreaterThan(launchAt);
    }
  });

  it('five casts read as one rapid sequence, not five separate waits', () => {
    expect(lassoBeamSchedule(5)[4]!.launchAt).toBe(1200); // the owner asked for ~1.5 s end to end
    expect(lassoCascadeMs(5)).toBe(1900);
    expect(lassoCascadeMs(0)).toBe(0);
    expect(lassoCascadeMs(1)).toBe(700);
  });
});
