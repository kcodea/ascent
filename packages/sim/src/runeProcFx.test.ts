import { describe, it, expect } from 'vitest';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { RUNE_INDEX } from '@game/content';

/**
 * `runeProcs` — "how many times has this rune's effect actually fired", the signal a rune badge bursts on.
 *
 * Owner report 2026-08-19: Rune of Bulk Order never burst. Its payout is a SHOP-phase threshold ("every 5
 * Gold you spend"), which is neither a combat `questTrigger` nor an End-of-Turn recurring proc — the only two
 * signals the badge knew about — so the rune fired and nothing marked it.
 *
 * The threshold is the part worth pinning: "paid out" and "banked below the line" are one line apart in the
 * reducer, and a signal that fired on banking would burst the badge on every Gold spent.
 */

const card = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false });

const RUNE_ID = 'rune_scale'; // Rune of Bulk Order (the id predates the 2026-07-31 rename)

/** A run with Bulk Order installed, as buying the rune leaves it. */
function withBulkOrder(over: Partial<RunState> = {}): RunState {
  const r = RUNE_INDEX[RUNE_ID]!.reward as { count: number; attack: number; health: number; per: number };
  return {
    ...createRun(1), phase: 'recruit', embers: 50,
    board: [card('b1', 'spore'), card('b2', 'stray')],
    ownedRunes: [RUNE_ID],
    runeScale: { count: r.count, attack: r.attack, health: r.health, per: r.per, tick: 0 },
    // What `procRune` resolves through — recorded at purchase by `applyQuestRewardInner`.
    runeIdByKind: { runeScale: RUNE_ID },
    ...over,
  };
}

describe('runeProcs (the rune-badge fire signal)', () => {
  it('is undefined on a fresh run — nothing has fired yet', () => {
    expect(createRun(1).runeProcs).toBeUndefined();
  });

  it('attributes a proc through the reward-kind map, not through the reward record itself', () => {
    // `runeScale` (the reward payload) never knew which rune installed it. `runeIdByKind` is that link, and
    // it is what lets a trigger site deep in the reducer stamp with a one-line `procRune(s, 'runeScale')`.
    expect(withBulkOrder().runeIdByKind?.runeScale).toBe(RUNE_ID);
  });

  it('Bulk Order is a `per`-threshold reward, which is why banking exists at all', () => {
    const r = RUNE_INDEX[RUNE_ID]!.reward as { per?: number };
    expect(r.per).toBeGreaterThan(0);
  });

  it('counts a proc on the action that CROSSES the threshold, not on the one that banks', () => {
    const per = (RUNE_INDEX[RUNE_ID]!.reward as { per: number }).per;
    // Sitting one Gold short: the next spend of >= 1 Gold crosses.
    const primed = withBulkOrder();
    primed.runeScale!.tick = per - 1;
    const shop = [{ uid: 's1', cardId: 'spore' }];
    const crossed = reduce({ ...primed, shop }, { type: 'buy', uid: 's1' });
    expect(crossed.runeProcs?.[RUNE_ID] ?? 0).toBeGreaterThan(0);

    // Starting from empty, a single buy costs less than the threshold, so it banks and must NOT count.
    const fresh = withBulkOrder();
    const banked = reduce({ ...fresh, shop }, { type: 'buy', uid: 's1' });
    if ((banked.runeScale?.tick ?? 0) > 0) expect(banked.runeProcs?.[RUNE_ID] ?? 0).toBe(0);
  });

  it('counts a payout PER threshold crossed, so one big spend that pays twice reads as two', () => {
    const per = (RUNE_INDEX[RUNE_ID]!.reward as { per: number }).per;
    const primed = withBulkOrder();
    primed.runeScale!.tick = per * 2 - 1; // one Gold short of TWO payouts
    const shop = [{ uid: 's1', cardId: 'spore' }];
    const next = reduce({ ...primed, shop }, { type: 'buy', uid: 's1' });
    expect(next.runeProcs?.[RUNE_ID] ?? 0).toBeGreaterThanOrEqual(2);
  });
});
