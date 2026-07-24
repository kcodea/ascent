import { describe, it, expect } from 'vitest';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';

/**
 * The RUBY POWER FX signal (owner ask 2026-07-24) — the Ruby-side twin of `spellPowerFxSeq`.
 *
 * Two things are worth pinning down here. First the RULESET: the owner asked for "the same ruleset spell power
 * FX uses, but for Rubies", which the reducer implements as a before/after delta on `rubyBonus` — one bump per
 * ACTION in which Ruby strength went up, by any source and any amount, never per Ruby cast. Second the fact that
 * it's derived from state rather than stamped by each effect, which is what makes it pick up new Ruby-buff
 * sources for free.
 */
const card = (uid: string, cardId: string, tribe: BoardCard['tribe'] = 'kobold'): BoardCard =>
  ({ uid, cardId, tribe, attack: 1, health: 1, keywords: [], golden: false });

describe('rubyPowerFx stamp (the Ruby Power FX signal)', () => {
  it('a Ruby-strength gain bumps the seq and records the DELTA, not the running total', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      rubyBonus: { attack: 2, health: 2 }, // already-accumulated strength: the FX must report the gain, not this
      hand: [card('d1', 'k_deepvein')],
    };
    const next = reduce(s, { type: 'play', uid: 'd1' });
    // Only assert the FX contract if the card actually moved Ruby strength — otherwise this test would
    // silently pass on a content change that stopped it buffing Rubies at all.
    const rose = (next.rubyBonus?.attack ?? 0) > 2 || (next.rubyBonus?.health ?? 0) > 2;
    expect(rose).toBe(true);
    expect(next.rubyPowerFxSeq).toBe(1);
    const gainA = (next.rubyBonus?.attack ?? 0) - 2;
    const gainH = (next.rubyBonus?.health ?? 0) - 2;
    expect(next.rubyPowerFxAtk).toBe(gainA);
    expect(next.rubyPowerFxHp).toBe(gainH);
    // The acting card is carried so the flourish can play over it.
    expect(next.rubyPowerFxUid).toBe('d1');
  });

  it('does NOT bump when Ruby strength is unchanged', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      rubyBonus: { attack: 1, health: 1 },
      board: [card('k1', 'k_deepvein')],
    };
    const next = reduce(s, { type: 'roll' });
    expect(next.rubyBonus).toEqual({ attack: 1, health: 1 });
    expect(next.rubyPowerFxSeq).toBeUndefined();
  });

  it('is derived from the state delta, so it survives a run with no prior rubyBonus at all', () => {
    // Regression guard for the bug class the spell-power twin hit: a per-action scratch field can be swallowed
    // by batching. Starting from an absent `rubyBonus` also proves the undefined→value transition counts.
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      hand: [card('d1', 'k_deepvein')],
    };
    expect(s.rubyBonus).toBeUndefined();
    const next = reduce(s, { type: 'play', uid: 'd1' });
    expect((next.rubyBonus?.attack ?? 0) + (next.rubyBonus?.health ?? 0)).toBeGreaterThan(0);
    expect(next.rubyPowerFxSeq).toBe(1);
  });
});
