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
    const prevRunic = ANOMALIES.runic.enabled;
    try {
      ANOMALIES.freedom.enabled = true;
      ANOMALIES.runic.enabled = false;
      expect(activeAnomaly()?.id).toBe('freedom');
      expect(createRun(1, 'warden').anomaly).toBe('freedom');

      ANOMALIES.freedom.enabled = false;
      expect(activeAnomaly()).toBeNull();
      expect(createRun(1, 'warden').anomaly).toBeNull();
    } finally {
      ANOMALIES.freedom.enabled = prev;
      ANOMALIES.runic.enabled = prevRunic;
    }
  });
});

// The "Runic Behavior" anomaly: EVERY hero visits the basic Runeforge on turn 7. Drive it by pinning
// `anomaly` on the run state, then win the turn-5 combat so the turn-6 shop opens.
describe('Runic Behavior anomaly (all heroes hit the basic Runeforge on turn 6)', () => {
  const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };
  const advanceTo = (heroId: string, fromWave: number, anomaly: 'runic' | null): RunState =>
    reduce({ ...createRun(1, heroId), anomaly, wave: fromWave, phase: 'combat', hand: [], lastCombat: win }, { type: 'resolveCombat' });

  it('opens the basic (no-charge) Runeforge on turn 6 for a non-Runesmith hero', () => {
    const s = advanceTo('warden', 5, 'runic');
    expect(s.wave).toBe(6);
    expect(s.runeforgeOffer?.length).toBeGreaterThan(0);
    expect(s.runeforgeEpic).toBeFalsy(); // basic, not epic
    expect(s.runeforgeNoCharge).toBe(true); // free — buying it spends no hero-power charge
  });

  it('does NOT open on turn 6 without the anomaly, and not on other turns with it', () => {
    expect(advanceTo('warden', 5, null).runeforgeOffer).toBeFalsy();
    expect(advanceTo('warden', 6, 'runic').runeforgeOffer).toBeFalsy(); // → turn 7, not 6
    expect(advanceTo('warden', 3, 'runic').runeforgeOffer).toBeFalsy(); // → turn 4, not 6
  });
});
