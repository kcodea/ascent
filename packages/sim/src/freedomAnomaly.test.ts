import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CONFIG, createRun, reduce, type RunState } from './index';

// The "Freedom" anomaly: the FIRST minion bought each turn is free (0 Gold). The global test setup neutralizes
// CONFIG.anomaly (the base economy tests assert the un-bent game), so this suite opts back in around its body.
describe('Freedom anomaly (first minion each turn is free)', () => {
  const prev = CONFIG.anomaly;
  beforeEach(() => { CONFIG.anomaly = 'freedom'; });
  afterEach(() => { CONFIG.anomaly = prev; });

  it('first minion of the turn costs 0, the second pays the normal cost', () => {
    let s: RunState = {
      ...createRun(1, 'warden'),
      embers: 10,
      shop: [{ uid: 'a', cardId: 'alley' }, { uid: 'b', cardId: 'alley' }],
      hand: [],
    };
    // First buy: free — embers untouched, freebie consumed.
    s = reduce(s, { type: 'buy', uid: 'a' });
    expect(s.embers).toBe(10);
    expect(s.freeBuyUsedThisTurn).toBe(true);
    // Second buy: full price this turn.
    s = reduce(s, { type: 'buy', uid: 'b' });
    expect(s.embers).toBe(10 - CONFIG.minionCost);
  });

  it('the freebie refreshes once freeBuyUsedThisTurn is cleared (next turn)', () => {
    let s: RunState = {
      ...createRun(1, 'warden'),
      embers: 10,
      shop: [{ uid: 'a', cardId: 'alley' }, { uid: 'c', cardId: 'alley' }],
      hand: [],
    };
    s = reduce(s, { type: 'buy', uid: 'a' });
    expect(s.embers).toBe(10);
    // Simulate the start-of-turn reset (the reducer clears this at the top of each recruit turn).
    s.freeBuyUsedThisTurn = false;
    s = reduce(s, { type: 'buy', uid: 'c' });
    expect(s.embers).toBe(10); // free again
  });

  it('disabled when the anomaly is off — the first buy pays normally', () => {
    CONFIG.anomaly = null;
    let s: RunState = {
      ...createRun(1, 'warden'),
      embers: 10,
      shop: [{ uid: 'a', cardId: 'alley' }],
      hand: [],
    };
    s = reduce(s, { type: 'buy', uid: 'a' });
    expect(s.embers).toBe(10 - CONFIG.minionCost);
    expect(s.freeBuyUsedThisTurn).toBeFalsy();
  });
});
