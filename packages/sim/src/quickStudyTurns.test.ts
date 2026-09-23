import { describe, it, expect } from 'vitest';
import { RUNE_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * Rune of Quick Study (balance 9/23: "Get a Quick Study and Gold Font. Repeat next turn.") — the pair lands the
 * moment the rune is bought, and ONCE more at the next turn's setup through the `repeatInTurns` channel (the
 * Gilded Spark's "get another in N turns"), then never again. It used to be a 2-turn End-of-Turn recurrence
 * (a Gold Font + 2 random spells), which is why this file exists at all.
 */
const withRune: RunState = { ...createRun(1), phase: 'recruit', tier: 3 };
const tank: BoardCard = { uid: 't', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 50, keywords: ['T'], golden: false };
const pair = (s: RunState): string[] => s.hand.map((c) => c.cardId).filter((id) => id === 'quickstudy' || id === 'manafont').sort();

describe('Rune of Quick Study pays now and once more next turn', () => {
  it('grants on purchase and at the next turn, then never again', () => {
    let s: RunState = { ...withRune, runeforgeOffer: ['rune_quick_study'], embers: 20, hand: [], board: [tank],
      resolve: 999, maxResolve: 999, armor: 999 };
    s = reduce(s, { type: 'buyRune', index: 0 });
    expect(pair(s), 'the pair lands on purchase').toEqual(['manafont', 'quickstudy']);
    expect(s.pendingQuestRewards, 'one repeat is booked for next turn').toEqual([{ questId: 'rune_quick_study', turnsLeft: 1 }]);

    const turn = (): void => {
      s = reduce(s, { type: 'faceOmen' }) as RunState;
      s = reduce(s, { type: 'resolveCombat' }) as RunState;
    };
    s.hand = [];
    turn();
    expect(pair(s), 'next turn pays the pair again').toEqual(['manafont', 'quickstudy']);
    expect(s.pendingQuestRewards ?? [], 'the repeat is spent, not re-booked').toHaveLength(0);

    s.hand = [];
    turn();
    expect(pair(s), 'the turn after must grant NOTHING').toEqual([]);
  });

  it('an UNBOUNDED recurring rune is unaffected — it still uses the run-long list', () => {
    let s: RunState = { ...withRune, runeforgeOffer: ['rune_facetwright'], embers: 20 };
    s = reduce(s, { type: 'buyRune', index: 0 });
    expect(s.questRecurringEndOfTurn, 'no `turns` → the run-long list, as before').toContain('grantFacetwright');
    expect(s.questRecurringLimited ?? []).toHaveLength(0);
  });

  it('the def ships as a grant that repeats in 1 turn, with the new text', () => {
    const r = RUNE_INDEX['rune_quick_study']!;
    expect(r.reward).toEqual({ kind: 'grant', cards: ['quickstudy', 'manafont'], repeatInTurns: 1 });
    expect(r.text).toContain('Repeat **next turn**');
  });
});
