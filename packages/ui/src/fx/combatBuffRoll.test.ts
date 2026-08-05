import { describe, expect, it } from 'vitest';
import { combatBuffDeltas } from './combatBuffRoll';

const frame = { player: [{ uid: 'a', attack: 5, health: 6 }], enemy: [] } as never;

describe('combatBuffDeltas', () => {
  it('sums a beat\'s buff events per target and returns the DELTA, not the absolute', () => {
    const events = [
      { type: 'buff', target: 'a', attack: 2, health: 1 },
      { type: 'buff', target: 'a', attack: 1, health: 0 },
    ] as never[];
    expect(combatBuffDeltas({ start: 0, end: 2 }, events, frame)).toEqual([{ uid: 'a', attack: 3, health: 1 }]);
  });

  it('skips a zero net delta and a target not on the frame', () => {
    const events = [{ type: 'buff', target: 'ghost', attack: 2, health: 0 }] as never[];
    expect(combatBuffDeltas({ start: 0, end: 1 }, events, frame)).toEqual([]);
  });
});
