/**
 * R-ANCIENT-ORDER-01 (owner 2026-11-19): an Ancient the last fight awakened is answered BEFORE the rune select.
 */
import { describe, expect, it } from 'vitest';
import { ANCIENT_IDS, ancientLeadsRuneforge, createRun, enableAncients, reduce, type RunState } from './index';

/** A rune turn's Shop with the forge open and an awakening offer beside it, filled by `why`. */
const forgeTurn = (why: 'combat' | 'refresh', over: Partial<RunState> = {}): RunState => {
  const s = enableAncients({ ...createRun(7, 'indy'), phase: 'recruit', embers: 60, hand: [] } as RunState);
  return {
    ...s, runeforgeOffer: ['x', 'y', 'z'],
    ancients: { ...s.ancients!, points: s.ancients!.cost, offer: ANCIENT_IDS.slice(0, 3), offerSeq: 1, lastGain: { amount: 2, why } },
    ...over,
  } as RunState;
};

describe('the awakening leads the Runeforge (R-ANCIENT-ORDER-01)', () => {
  it('a combat-filled awakening is pickable through the open forge, and the forge stays open for after', () => {
    const s = forgeTurn('combat');
    expect(ancientLeadsRuneforge(s)).toBe(true);
    const after = reduce(s, { type: 'pickAncient', id: ANCIENT_IDS[0]! });
    expect(after.ancients!.picked).toBe(ANCIENT_IDS[0]);
    expect(after.ancients!.offer).toBeUndefined();
    expect(after.runeforgeOffer).toEqual(['x', 'y', 'z']);
    expect(ancientLeadsRuneforge(after)).toBe(false);
  });

  it('the forge still answers first when asked (an older recording made the rune pick first)', () => {
    const after = reduce(forgeTurn('combat'), { type: 'skipRuneforge' });
    expect(after.runeforgeOffer).toBeUndefined();
    expect(after.ancients!.offer).toHaveLength(3);
  });

  it('only a combat fill leads: any other awakening still waits for the forge', () => {
    const s = forgeTurn('refresh');
    expect(ancientLeadsRuneforge(s)).toBe(false);
    expect(reduce(s, { type: 'pickAncient', id: ANCIENT_IDS[0]! })).toBe(s);
  });

  it('a quest offer still goes first', () => {
    const s = forgeTurn('combat', { questOffer: ['q'] } as unknown as Partial<RunState>);
    expect(ancientLeadsRuneforge(s)).toBe(false);
    expect(reduce(s, { type: 'pickAncient', id: ANCIENT_IDS[0]! })).toBe(s);
  });
});
