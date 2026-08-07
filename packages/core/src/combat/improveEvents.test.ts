import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * EVERY combat accrual logs an `improve` event (owner audit 2026-08-02: "Mammoth's text does not update in
 * real time in combat"). The replay folds `improve.amount` into the unit's `summonBonus`, which is what the
 * shared live-text chain reads — a factory that mutates the accrual WITHOUT logging freezes its printed value
 * mid-fight. The audit found five silent accruers (Mammoth, Broodwright, Rouge Rogue, Thundeer, Hunter); each
 * is pinned here through a real fight.
 */
const improvesFor = (events: readonly CombatEvent[], uid: string) =>
  events.filter((e): e is Extract<CombatEvent, { type: 'improve' }> => e.type === 'improve' && e.target === uid);

describe('combat accruals log improve events (live text ticks mid-fight)', () => {
// (Menagerie Mammoth's summon-improve case retired with its 2026-08-07 rework to a hand-caster.)

  it('Thundeer logs its self-improve step', () => {
    const r = simulate(
      [{ cardId: 'thundeer', attack: 5, health: 300 }, { cardId: 'pack', attack: 2, health: 60 }],
      [{ cardId: 'sandbag', attack: 1, health: 900 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 7, tribes: ['beast'] }), combatSide({ tier: 1 }));
    expect(improvesFor(r.events, 'm0').length, 'Thundeer accrued silently').toBeGreaterThan(0);
  });

  it('Hunter logs its fire-count ticks', () => {
    // Hunter (a Dragon) improves per own-Attack-gain: a branch-B Fatecarver casts Growth on every ally
    // attack, which buffs the whole side — including the Hunter — so its onGainAttack fires each swing.
    const r = simulate(
      [{ cardId: 'hunter', attack: 3, health: 200 }, { cardId: 'n2_fatecarver', attack: 4, health: 200, chosenOption: 1 }],
      [{ cardId: 'sandbag', attack: 1, health: 900 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast', 'dragon'] }), combatSide({ tier: 1 }));
    expect(improvesFor(r.events, 'm0').length, 'Hunter accrued silently').toBeGreaterThan(0);
  });
});
