import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { holdMs, KEYED_HOLD_KINDS } from './clock';
import type { Moment } from './compile';

/**
 * BEAT CHOREOGRAPHER PR 23 regression — the authored-hold override must be scoped to plain read-kinds.
 *
 * Found by PAIRED MEASUREMENT, not review: with `ascent.combatbeats` on, an Oona+Pack fight never settled
 * (12s cap vs a 1.7s flag-off baseline). Once minion effects were stamped (this PR), summon moments carried
 * keys too — and a summon's pacing is engine-coupled (withholding, cue release, death leads). Overriding its
 * hold stalls that machinery. The uncommitted fix was then lost to a branch switch in the shared checkout,
 * so this test exists to make the scoping impossible to lose again.
 */
const stubStorage = (on: boolean) => {
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (k === 'ascent.combatbeats' && on ? '1' : null),
    setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
  } as unknown as Storage;
};
const cleanup = () => { delete (globalThis as { localStorage?: Storage }).localStorage; };

const keyedMoment = (kind: string, type: string): Moment => ({
  start: 0, end: 1,
  primary: { type, target: 'x', attack: 1, health: 1, source: 'OO', key: 'factory:onSummonTribeBuffThenDouble:onSummon', srcCard: 'b2_oona' } as never,
  stepGroups: [[0]], kind: kind as Moment['kind'],
});
const next = (): Moment => ({ start: 1, end: 2, primary: { type: 'dmg', target: 'y', amount: 1, remainingHp: 1 } as never, stepGroups: [[1]], kind: 'damage' });

describe('the authored hold applies ONLY to plain read-kinds', () => {
  beforeEach(() => stubStorage(true));
  afterEach(cleanup);

  it('a keyed buffWave (a read) takes the compiled hold', () => {
    const withOverride = holdMs(next(), keyedMoment('buffWave', 'buff'), 1);
    cleanup(); stubStorage(false);
    const native = holdMs(next(), keyedMoment('buffWave', 'buff'), 1);
    expect(withOverride).not.toBe(native); // the config governs the read
  });

  it('a keyed SUMMON keeps its native, engine-coupled pacing — the hang this scoping fixes', () => {
    const withFlag = holdMs(next(), keyedMoment('summon', 'summon'), 1);
    cleanup(); stubStorage(false);
    const native = holdMs(next(), keyedMoment('summon', 'summon'), 1);
    expect(withFlag).toBe(native);
  });

  it('the safe list never contains engine-coupled kinds', () => {
    for (const k of ['summon', 'attackExchange', 'damage', 'death', 'riseDeath', 'reborn', 'rally', 'shieldPop']) {
      expect(KEYED_HOLD_KINDS.has(k), `${k} must keep native scheduling`).toBe(false);
    }
  });
});
