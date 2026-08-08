import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { ARCHIVED_CARDS, CARD_INDEX, RUNES, EPIC_RUNES } from '@game/content';
import { createRun, poolOf, type BoardCard, type RunState } from './index';
import { fireOnRubyCast } from './recruit';

/** The 2026-08-08 owner batch (second pass): Gemgorge's counter, the loss-damage breakdown, Scavvers out. */

const minion = (uid: string, cardId: string, a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });

describe('Gemgorge Fiend counts its OWN casts, and shows a counter', () => {
  const armed = (): RunState => {
    const s: RunState = { ...createRun(7), phase: 'recruit' };
    s.board = [minion('g', 'k_gemgorge', 6, 6)];
    s.shop = [{ uid: 'o1', cardId: 'dm_clerk' }, { uid: 'o2', cardId: 'dm_hungerling' }] as never;
    return s;
  };

  it('a freshly played Fiend starts at 0/3 — it does not inherit the run’s cast total', () => {
    const s = armed();
    expect(s.board[0]!.rubyCastTick ?? 0, 'a fresh body has witnessed nothing').toBe(0);
    // The run is already 2 casts deep; under the old GLOBAL rule the next cast crossed 2→3 and fired at once.
    fireOnRubyCast(s, 2, 3);
    expect(s.board[0]!.rubyCastTick, 'it should have seen exactly one cast').toBe(1);
    expect(s.shop.length, 'it must NOT have consumed yet — it has seen one cast, not three').toBe(2);
  });

  it('the counter climbs 1/3 → 2/3 → fires and wraps', () => {
    const s = armed();
    const tick = () => {
      const before = (s.spellsCast ?? 0) + (s.rubyCasts ?? 0);
      fireOnRubyCast(s, before, before + 1);
      s.spellsCast = (s.spellsCast ?? 0) + 1;
      return s.board[0]!.rubyCastTick ?? 0;
    };
    expect(tick()).toBe(1);
    expect(tick()).toBe(2);
    expect(s.shop.length, 'still nothing eaten at 2/3').toBe(2);
    expect(tick()).toBe(3);
    expect(s.shop.length, 'the third cast it witnessed should consume').toBe(1);
  });
});

describe('the loss-damage counter tallies the fight’s own numbers', () => {
  it('a losing combat reports a breakdown that sums to playerDamage', () => {
    // The defeat animation used to recompute the contributions from `nextOpponent()` and the replay frame;
    // any drift showed as the counter saying one number while Resolve dropped by another (owner report).
    const player: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }];
    const enemy: BoardMinion[] = [
      { cardId: 'stray', attack: 9, health: 40 }, { cardId: 'emissary', attack: 9, health: 40 },
    ];
    const r = simulate(player, enemy, makeRng(5), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 4 }));
    expect(r.result).toBe('lose');
    const bd = r.damageBreakdown;
    expect(bd, 'a loss must carry its breakdown').toBeDefined();
    const summed = bd!.oppTier + bd!.survivorTiers.reduce((a, b) => a + b, 0);
    expect(summed, 'the itemized contributions must equal the damage that lands').toBe(r.playerDamage);
    expect(bd!.oppTier, 'the opponent tier is the FIGHT’s, not a re-derived one').toBe(4);
  });

  it('a win carries no breakdown', () => {
    const player: BoardMinion[] = [{ cardId: 'stray', attack: 9, health: 40 }];
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }];
    const r = simulate(player, enemy, makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 4 }));
    expect(r.result).toBe('win');
    expect(r.damageBreakdown).toBeUndefined();
  });
});

describe('Scavvers is archived', () => {
  it('it belongs to no set, so nothing can draw, offer or Discover it', () => {
    expect(ARCHIVED_CARDS.some((c) => c.id === 'b2_scavenger'), 'not recorded as archived').toBe(true);
    expect(CARD_INDEX['b2_scavenger'], 'a saved run holding one must still resolve it').toBeDefined();
    // The real contract: absent from every set pool.
    for (const setId of ['set1', 'set2'] as const) {
      const s: RunState = { ...createRun(3), setId } as RunState;
      expect(poolOf(s).all.some((c) => c.id === 'b2_scavenger'), `still in the ${setId} pool`).toBe(false);
    }
  });

  it('Rune of the Second Life went with it — nothing left for it to modify', () => {
    expect([...RUNES, ...EPIC_RUNES].some((r) => r.id === 'rune_second_life'), 'still stocked').toBe(false);
  });
});
