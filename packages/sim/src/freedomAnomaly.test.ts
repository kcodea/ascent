import { describe, it, expect } from 'vitest';
import { ANOMALIES, activeAnomaly, CONFIG, createRun, reduce, type RunState } from './index';

// The "Freedom" anomaly: the FIRST minion bought each turn is free (0 Gold). The active anomaly is pinned onto
// each run at creation (RunState.anomaly); the reducer reads that pin. These tests set the pin directly so they
// don't depend on the global registry switch (which the test setup retires).
describe('Freedom anomaly (first minion each turn is free)', () => {
  it('first minion of the turn costs 0, the second pays the normal cost', () => {
    let s: RunState = {
      ...createRun(1, 'warden'),
      anomaly: 'freedom',
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
      anomaly: 'freedom',
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

  it('a run with no anomaly pays normally on the first buy', () => {
    let s: RunState = {
      ...createRun(1, 'warden'),
      anomaly: null,
      embers: 10,
      shop: [{ uid: 'a', cardId: 'alley' }],
      hand: [],
    };
    s = reduce(s, { type: 'buy', uid: 'a' });
    expect(s.embers).toBe(10 - CONFIG.minionCost);
    expect(s.freeBuyUsedThisTurn).toBeFalsy();
  });

  // The system wiring: an enabled registry entry becomes the active anomaly and is pinned onto new runs; a
  // disabled one is not. This is the one-line on/off switch the live-ops flow uses.
  it('createRun pins the active anomaly, and only while it is enabled', () => {
    const prev = ANOMALIES.freedom.enabled;
    try {
      ANOMALIES.freedom.enabled = true;
      expect(activeAnomaly()?.id).toBe('freedom');
      expect(createRun(1, 'warden').anomaly).toBe('freedom');

      ANOMALIES.freedom.enabled = false;
      expect(activeAnomaly()).toBeNull();
      expect(createRun(1, 'warden').anomaly).toBeNull();
    } finally {
      ANOMALIES.freedom.enabled = prev;
    }
  });
});
