import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GAUNTLET_CLOCK_GOLD, GAUNTLET_CLOCK_SECONDS, GAUNTLET_CLOCK_WAITING,
  gauntletClockReading, gauntletClockState, gauntletClockWaiting, gauntletTurnClock,
} from './gauntletClock';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from '@game/sim';
import { turnClockMayTick } from '../turnClock';
import { goldClockOf } from '../goldClock';

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
    expect(gauntletClockWaiting(GAUNTLET_CLOCK_WAITING - 1), 'only the exact parked value').toBe(false);
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

// Since 2026-10-06 Recruit wires the SHARED gold-spend clock (`goldClockOf`, R-TIMER-BRONZE-01); the Gauntlet is one
// config of it. These source checks pin that the Gauntlet still goes through it.
describe('Recruit wires the Gauntlet clock', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'Recruit.tsx'), 'utf8');

  it('opens every Gauntlet turn parked, and leaves the other modes on their normal formula', () => {
    expect(src).toMatch(/const goldClock = goldClockOf\(run\);/);
    expect(src).toMatch(/const turnSeconds = goldClock \? GOLD_CLOCK_WAITING : infiniteClock \? 99999 :/);
    expect(goldClockOf({ mode: 'gauntlet', wave: 1, lobby: undefined })).toEqual({ gold: GAUNTLET_CLOCK_GOLD, seconds: GAUNTLET_CLOCK_SECONDS });
    expect(goldClockOf({ mode: 'gauntlet', wave: 12, lobby: undefined }), 'no late-turn change for the Gauntlet').toEqual({ gold: 30, seconds: 60 });
  });

  it('holds the countdown while waiting, and re-runs the gate when that flips', () => {
    const at = src.indexOf('if (!turnClockMayTick({');
    const call = src.slice(at, src.indexOf('})) return;', at));
    expect(call).toMatch(/clockWaiting: goldClockWaits,/);
    expect(src).toMatch(/wipe, sotPlaying, goldClockWaits\]\);/);
  });

  it('starts the clock AFTER the turn reset, and the plaque knows the mode', () => {
    expect(src.indexOf('goldTurnClock({')).toBeGreaterThan(src.indexOf('turnClockReset({'));
    expect(src).toContain('goldGoal={goldClockGold}');
  });
});

/**
 * THYMEPIECE BEFORE THE CLOCK STARTS (review fix): a clock-window discount anchors to the clock's reading at
 * activation (`untilClock = reading − 8`). Anchored to the PARKED value, the window would expire on the first tick
 * after the jump to 60. A parked Gauntlet clock therefore READS as the 60 it will start from.
 */
describe('a Thymepiece window opened before the Gauntlet clock starts', () => {
  it('a parked Gauntlet clock reads as the countdown it will start from; everything else reads raw', () => {
    expect(gauntletClockReading('gauntlet', GAUNTLET_CLOCK_WAITING)).toBe(GAUNTLET_CLOCK_SECONDS);
    expect(gauntletClockReading('gauntlet', 42)).toBe(42);
    expect(gauntletClockReading('tutorial', 99999), 'other modes are untouched').toBe(99999);
    expect(gauntletClockReading('lobby', 30)).toBe(30);
  });

  it('keeps its full length once the clock starts', () => {
    const d = CARD_INDEX['dw3_thymes']!;
    const thymes: BoardCard = { uid: 'th', cardId: 'dw3_thymes', tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
    let s = { ...createRun(11), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, hand: [thymes] } as RunState;
    s = reduce(s, { type: 'play', uid: 'th', toIndex: 0 });
    // Activated while parked: the store stamps the clock through `gauntletClockReading`.
    s = reduce(s, { type: 'activateEquipment', clockSeconds: gauntletClockReading('gauntlet', GAUNTLET_CLOCK_WAITING) });
    const win = s.cardDiscountWindow!;
    expect(win.untilClock).toBe(GAUNTLET_CLOCK_SECONDS - 8);
    // The clock starts at 60 and Recruit's tick expires the window when `next <= untilClock`: 8 live seconds.
    const live = [];
    for (let next = GAUNTLET_CLOCK_SECONDS - 1; next > win.untilClock!; next--) live.push(next);
    expect(live).toHaveLength(7); // ticks 59..53 live; the 8th tick (52) closes it, exactly 8 seconds after the start
  });

  it('the store stamps and the readout counts through the Gauntlet reading', () => {
    const read = (f: string): string => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', f), 'utf8');
    expect(read('store.ts')).toContain('clockSeconds: goldClockReading(goldClockOf(prev), turnClock.get())');
    expect(read('DiscountWindowReadout.tsx')).toContain('goldClockReading(goldClockSeconds == null ? null : { seconds: goldClockSeconds }, useTurnSeconds())');
    expect(read('StatusBar.tsx')).toContain('<DiscountWindowReadout window={run.cardDiscountWindow} goldClockSeconds={goldClockOf(run)?.seconds ?? null} />');
  });
});
