import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GAUNTLET_CLOCK_GOLD, GAUNTLET_CLOCK_SECONDS, GAUNTLET_CLOCK_WAITING,
  gauntletClockState, gauntletClockWaiting, gauntletTurnClock,
} from './gauntletClock';
import { turnClockMayTick } from '../turnClock';

/**
 * THE GAUNTLET SHOP TIMER: no clock until the player has spent 30 Gold in the round, then a 60-second countdown
 * (at 0 the normal game's timeout locks apply unchanged).
 */
describe('the Gauntlet shop timer rule', () => {
  it('is 30 Gold, then 60 seconds', () => {
    expect(GAUNTLET_CLOCK_GOLD).toBe(30);
    expect(GAUNTLET_CLOCK_SECONDS).toBe(60);
    expect(GAUNTLET_CLOCK_WAITING).toBeGreaterThan(GAUNTLET_CLOCK_SECONDS);
  });

  it('waits below 30 Gold spent and runs from 30', () => {
    expect(gauntletClockState(0)).toBe('waiting');
    expect(gauntletClockState(29)).toBe('waiting');
    expect(gauntletClockState(30)).toBe('running');
    expect(gauntletClockState(45)).toBe('running');
  });

  it('a clock still parked on the waiting value reads as waiting; any real countdown value does not', () => {
    expect(gauntletClockWaiting(GAUNTLET_CLOCK_WAITING)).toBe(true);
    expect(gauntletClockWaiting(GAUNTLET_CLOCK_SECONDS)).toBe(false);
    expect(gauntletClockWaiting(12)).toBe(false);
    expect(gauntletClockWaiting(0)).toBe(false);
  });
});

describe('what the clock is set to as Gold is spent', () => {
  it('leaves a waiting clock alone below the threshold', () => {
    expect(gauntletTurnClock({ goldSpent: 29, current: GAUNTLET_CLOCK_WAITING })).toBeNull();
  });

  it('starts the 60-second countdown the moment 30 Gold is spent', () => {
    expect(gauntletTurnClock({ goldSpent: 30, current: GAUNTLET_CLOCK_WAITING })).toBe(GAUNTLET_CLOCK_SECONDS);
  });

  it('never restarts a countdown already running (more Gold spent later in the round)', () => {
    expect(gauntletTurnClock({ goldSpent: 41, current: 37 })).toBeNull();
    expect(gauntletTurnClock({ goldSpent: 41, current: 0 }), 'time up stays up').toBeNull();
  });

  it('Continue mid-countdown keeps the saved seconds (the resume path restored them first)', () => {
    expect(gauntletTurnClock({ goldSpent: 33, current: 18 })).toBeNull();
  });

  it('Continue on a turn that had not reached 30 Gold stays waiting', () => {
    expect(gauntletTurnClock({ goldSpent: 12, current: GAUNTLET_CLOCK_WAITING })).toBeNull();
  });
});

describe('the countdown gate while the Gauntlet clock is waiting', () => {
  const shopTurn = {
    recruitPhase: true, decisionOpen: false, heroSelecting: false, overlayOpen: false, introPlaying: false,
  };

  it('holds while waiting and ticks once the clock runs', () => {
    expect(turnClockMayTick({ ...shopTurn, clockWaiting: true })).toBe(false);
    expect(turnClockMayTick({ ...shopTurn, clockWaiting: false })).toBe(true);
  });

  it('a caller that predates the flag keeps its old answer', () => {
    expect(turnClockMayTick(shopTurn)).toBe(true);
  });
});

describe('Recruit wires the Gauntlet clock', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'Recruit.tsx'), 'utf8');

  it('opens every Gauntlet turn parked, and leaves the other modes on their normal formula', () => {
    expect(src).toMatch(/const turnSeconds = run\.mode === 'gauntlet' \? GAUNTLET_CLOCK_WAITING : infiniteClock \? 99999 :/);
  });

  it('holds the countdown while waiting, and re-runs the gate when that flips', () => {
    const at = src.indexOf('if (!turnClockMayTick({');
    const call = src.slice(at, src.indexOf('})) return;', at));
    expect(call).toMatch(/clockWaiting: gauntletClockWaits,/);
    expect(src).toMatch(/wipe, sotPlaying, gauntletClockWaits\]\);/);
  });

  it('starts the clock AFTER the turn reset, and the plaque knows the mode', () => {
    expect(src.indexOf('gauntletTurnClock({')).toBeGreaterThan(src.indexOf('turnClockReset({'));
    expect(src).toContain("gauntlet={mode === 'gauntlet'}");
  });
});
