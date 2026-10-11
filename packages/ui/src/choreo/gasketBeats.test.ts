import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { compileMoments, DEFAULT_RULES } from './compile';
import { attackerOfImpact, meleePairOfImpact } from '../combatBeats';
import { wavesAheadOf } from './channels/windupWaves';
import { struckUidsIn } from './cardFx';
import { fanIntensity, FAN_PARTICLE_BUDGETS } from '../fx/fanBudget';

/**
 * GASKET'S SWING, PRESENTED (owner add 2026-10-10). Graded on a SIMULATED fight so the shape is the simulator's:
 *
 *   attack (wind-up) → wave 1 (the Rally pass) [→ wave 2 when Gilded] → the clash
 *
 * - each pass is its own moment, and its struck set is every unit the pass hit (the per-target FX fan-out);
 * - a pass is NOT the melee exchange: the defender it hit keeps its blast, and the clash after the passes IS the
 *   exchange (its melee pair + attacker number resolve past the waves);
 * - the swing PARKS at the top of its wind-up while the passes play (`wavesAheadOf`).
 */
const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], ...extra });
const fight = (golden = false) => simulate(
  [bm('dm_gasket', 7, 3, { keywords: ['RL'], golden }), bm('dm_clerk', 0, 40), bm('trainingdummy', 0, 40), bm('dm_clerk', 0, 40)],
  [bm('dm_clerk', 0, 40), bm('trainingdummy', 0, 40)],
  makeRng(7), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 4 }));

function firstSwing(events: CombatEvent[]) {
  const moments = compileMoments(events, DEFAULT_RULES);
  const ai = moments.findIndex((m) => m.primary.type === 'attack' && m.primary.attacker === 'm0');
  expect(ai).toBeGreaterThanOrEqual(0);
  return { moments, ai };
}

describe('Gasket presentation: one moment per pass, parked swing, the clash keeps its melee pair', () => {
  it('plain: attack → one wave moment (every victim struck) → the clash', () => {
    const { events } = fight();
    const { moments, ai } = firstSwing(events);
    const wave = moments[ai + 1]!;
    expect(wave.primary.wave).toBeDefined();
    // m2 friendly neutral, m4 enemy Demon, m5 enemy neutral (m1/m3 friendly Demons and Gasket are spared)
    expect(struckUidsIn(events, wave.start, wave.end).sort()).toEqual(['m2', 'm4', 'm5']);
    expect(moments[ai + 2]!.primary.wave, 'the clash is not a wave').toBeUndefined();
  });

  it('Gilded: two wave moments, each striking every victim', () => {
    const { events } = fight(true);
    const { moments, ai } = firstSwing(events);
    for (const k of [1, 2]) {
      const w = moments[ai + k]!;
      expect(w.primary.wave).toBeDefined();
      expect(struckUidsIn(events, w.start, w.end).sort()).toEqual(['m2', 'm4', 'm5']);
    }
    expect(moments[ai + 1]!.primary.wave).not.toBe(moments[ai + 2]!.primary.wave);
  });

  it('a pass is not the melee exchange (its defender keeps the blast); the clash after the passes is', () => {
    const { events } = fight(true);
    const { moments, ai } = firstSwing(events);
    const atk = moments[ai]!.primary as Extract<CombatEvent, { type: 'attack' }>;
    expect(meleePairOfImpact(moments, ai + 1)).toBeNull();
    expect(meleePairOfImpact(moments, ai + 2)).toBeNull();
    expect(meleePairOfImpact(moments, ai + 3)).toEqual({ attacker: 'm0', defender: atk.defender });
    expect(attackerOfImpact(moments, ai + 1)).toBeNull();
    expect(attackerOfImpact(moments, ai + 3)).toBe('m0');
  });

  it('the swing parks: a wave sits between the wind-up and the strike', () => {
    const { events } = fight();
    const { moments, ai } = firstSwing(events);
    expect(wavesAheadOf(moments[ai]!, events, 'm0')).toBe(true);
  });

  it('an ordinary swing (no wave ahead) does not park', () => {
    const events = simulate([bm('dm_clerk', 3, 40), bm('dm_clerk', 0, 40)], [bm('trainingdummy', 0, 40)],
      makeRng(7), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 4 })).events;
    const moments = compileMoments(events, DEFAULT_RULES);
    const ai = moments.findIndex((m) => m.primary.type === 'attack');
    const atk = moments[ai]!.primary as Extract<CombatEvent, { type: 'attack' }>;
    expect(wavesAheadOf(moments[ai]!, events, atk.attacker)).toBe(false);
  });
});

describe('fan budget', () => {
  it('one target, or a fan that fits, plays as authored', () => {
    expect(fanIntensity(FAN_PARTICLE_BUDGETS['gasket'], 372, 1)).toBe(1);
    expect(fanIntensity(1200, 372, 3)).toBe(1);
    expect(fanIntensity(undefined, 372, 13)).toBe(1);
  });
  it('a wide fan is scaled evenly to the budget', () => {
    const k = fanIntensity(FAN_PARTICLE_BUDGETS['gasket'], 372, 13);
    expect(k * 372 * 13).toBeCloseTo(FAN_PARTICLE_BUDGETS['gasket']!, 5);
  });
});
