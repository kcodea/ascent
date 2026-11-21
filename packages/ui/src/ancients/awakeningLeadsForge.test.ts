/** R-ANCIENT-ORDER-01: which of the awakening and the Runeforge the screen shows first. */
import { describe, expect, it } from 'vitest';
import { ANCIENT_IDS, createRun, enableAncients, type RunState } from '@game/sim';
import { awakeningHoldsForge, awakeningWaits } from './awakeningLeadsForge';

const IDLE = { stage: 'idle', seq: 0 } as const;
const run = (why: 'combat' | 'refresh' | null, over: Partial<RunState> = {}): RunState => {
  const s = enableAncients({ ...createRun(7, 'indy'), phase: 'recruit' } as RunState);
  return {
    ...s, runeforgeOffer: ['x', 'y', 'z'],
    ancients: why ? { ...s.ancients!, points: s.ancients!.cost, offer: ANCIENT_IDS.slice(0, 3), offerSeq: 1, lastGain: { amount: 2, why } } : s.ancients,
    ...over,
  } as RunState;
};

describe('the awakening leads the Runeforge (R-ANCIENT-ORDER-01)', () => {
  it('a combat-filled awakening does not wait for the forge; the forge waits for it', () => {
    const s = run('combat');
    expect(awakeningWaits(s)).toBe(false);
    expect(awakeningHoldsForge(s, IDLE)).toBe(true);
  });

  it('the forge stays held while the pick is still closing, then opens', () => {
    const pickedRun = run(null);
    expect(awakeningHoldsForge(pickedRun, { stage: 'closing', seq: 1 })).toBe(true);
    expect(awakeningHoldsForge(pickedRun, IDLE)).toBe(false);
  });

  it('a tuner demo never holds a forge', () => {
    expect(awakeningHoldsForge(run(null), { stage: 'reveal', seq: -1 })).toBe(false);
  });

  it('any other awakening, or another open decision, keeps the old order', () => {
    expect(awakeningWaits(run('refresh'))).toBe(true);
    expect(awakeningHoldsForge(run('refresh'), IDLE)).toBe(false);
    const quest = run('combat', { questOffer: ['q'] } as unknown as Partial<RunState>);
    expect(awakeningWaits(quest)).toBe(true);
    expect(awakeningHoldsForge(quest, IDLE)).toBe(false);
  });

  it('no forge: nothing to hold, and the awakening only waits for other decisions', () => {
    const s = run('combat', { runeforgeOffer: undefined });
    expect(awakeningHoldsForge(s, { stage: 'reveal', seq: 1 })).toBe(false);
    expect(awakeningWaits(s)).toBe(false);
  });
});
