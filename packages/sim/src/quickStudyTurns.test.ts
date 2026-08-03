import { describe, it, expect } from 'vitest';
import { RUNE_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';
import { applyEndOfTurn } from './recruit';

/**
 * Rune of Quick Study is BOUNDED to 2 turns (owner rebalance 2026-08-02) — it used to recur for the whole
 * run. The mechanism is general: `recurringEndOfTurn` rewards may carry `turns`, which routes them into
 * `questRecurringLimited` (ticked down per End of Turn) instead of the run-long list.
 */
const withRune: RunState = { ...createRun(1), phase: 'recruit', tier: 3 };

describe('Rune of Quick Study lasts 2 turns', () => {
  it('grants on turns 1 and 2, then never again', () => {
    let s: RunState = { ...withRune, runeforgeOffer: ['rune_quick_study'], embers: 20 };
    s = reduce(s, { type: 'buyRune', index: 0 });
    expect(s.questRecurringLimited?.[0], 'the rune must arm a LIMITED recurrence').toMatchObject({ effect: 'quickStudy', turnsLeft: 2 });
    expect(s.questRecurringEndOfTurn ?? [], 'and NOT the run-long list').not.toContain('quickStudy');

    const handAfter = (st: RunState): number => st.hand.length;
    s.hand = [];
    applyEndOfTurn(s);
    const t1 = handAfter(s);
    expect(t1, 'turn 1 grants').toBeGreaterThan(0);
    expect(s.questRecurringLimited?.[0]?.turnsLeft).toBe(1);

    s.hand = [];
    applyEndOfTurn(s);
    expect(handAfter(s), 'turn 2 grants').toBeGreaterThan(0);
    expect(s.questRecurringLimited ?? [], 'the entry is spent and dropped').toHaveLength(0);

    s.hand = [];
    applyEndOfTurn(s);
    expect(handAfter(s), 'turn 3 must grant NOTHING').toBe(0);
  });

  it('an UNBOUNDED recurring rune is unaffected — it still uses the run-long list', () => {
    let s: RunState = { ...withRune, runeforgeOffer: ['rune_facetwright'], embers: 20 };
    s = reduce(s, { type: 'buyRune', index: 0 });
    expect(s.questRecurringEndOfTurn, 'no `turns` → the run-long list, as before').toContain('grantFacetwright');
    expect(s.questRecurringLimited ?? []).toHaveLength(0);
  });

  it('the def ships with turns: 2 and the new text', () => {
    const r = RUNE_INDEX['rune_quick_study']!;
    expect((r.reward as { turns?: number }).turns).toBe(2);
    expect(r.text).toContain('next 2 turns');
  });
});
