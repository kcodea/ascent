import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOLD_TTL_MS, anyStatHeld, heldFor, holdStat, releaseAllStats, releaseStat, statHoldKey,
  subscribeStatHolds,
} from './statHold';

afterEach(() => {
  releaseAllStats();
  vi.useRealTimers();
});

describe('holding a stat change', () => {
  it('withholds a delta and reports it', () => {
    holdStat('a', { attack: 2, health: 1 });
    expect(heldFor('a')).toEqual({ attack: 2, health: 1 });
  });

  it('reports nothing for a unit with no hold', () => {
    expect(heldFor('nobody')).toBeNull();
  });

  it('ACCUMULATES, so two gems in one moment withhold both', () => {
    holdStat('a', { attack: 1, health: 1 });
    holdStat('a', { attack: 1, health: 1 });
    expect(heldFor('a')).toEqual({ attack: 2, health: 2 });
  });

  it('treats a missing side as zero rather than NaN', () => {
    holdStat('a', { attack: 3 });
    expect(heldFor('a')).toEqual({ attack: 3, health: 0 });
  });

  it('does not store a zero delta — nothing to withhold is not a hold', () => {
    holdStat('a', { attack: 0, health: 0 });
    expect(heldFor('a')).toBeNull();
    expect(anyStatHeld()).toBe(false);
  });
});

describe('releasing', () => {
  it('drops the hold so the badge shows the truth', () => {
    holdStat('a', { attack: 2, health: 0 });
    releaseStat('a');
    expect(heldFor('a')).toBeNull();
  });

  it('is safe when nothing is held', () => {
    expect(() => releaseStat('a')).not.toThrow();
  });

  it('releases only the unit named', () => {
    holdStat('a', { attack: 1, health: 0 });
    holdStat('b', { attack: 1, health: 0 });
    releaseStat('a');
    expect(heldFor('a')).toBeNull();
    expect(heldFor('b')).toEqual({ attack: 1, health: 0 });
  });

  it('clears everything on a scene change', () => {
    holdStat('a', { attack: 1, health: 0 });
    holdStat('b', { attack: 1, health: 0 });
    releaseAllStats();
    expect(anyStatHeld()).toBe(false);
  });
});

describe('a hold nobody claims must not be permanent', () => {
  it('expires on its own, so an unclaimed hold fails OPEN', () => {
    // The case this guards: a def with no "carries the number" layer, which is every effect authored
    // before this existed. Without the TTL the badge would show a stale stat forever.
    vi.useFakeTimers();
    const t0 = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => t0);
    holdStat('a', { attack: 5, health: 5 });
    expect(heldFor('a')).not.toBeNull();

    vi.spyOn(performance, 'now').mockImplementation(() => t0 + HOLD_TTL_MS + 1);
    expect(heldFor('a')).toBeNull();
  });

  it('sweeps the expired entry rather than leaking it', () => {
    vi.useFakeTimers();
    const t0 = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => t0);
    holdStat('a', { attack: 5, health: 5 });
    vi.spyOn(performance, 'now').mockImplementation(() => t0 + HOLD_TTL_MS + 1);
    heldFor('a');
    expect(anyStatHeld()).toBe(false);
  });

  it('a fresh hold after expiry starts from zero, not from the dead delta', () => {
    vi.useFakeTimers();
    const t0 = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => t0);
    holdStat('a', { attack: 5, health: 0 });
    vi.spyOn(performance, 'now').mockImplementation(() => t0 + HOLD_TTL_MS + 1);
    holdStat('a', { attack: 2, health: 0 });
    expect(heldFor('a')).toEqual({ attack: 2, health: 0 });
  });
});

describe('the render subscription', () => {
  it('gives a PRIMITIVE snapshot, so getSnapshot is referentially stable', () => {
    holdStat('a', { attack: 2, health: 1 });
    expect(typeof statHoldKey('a')).toBe('number');
    expect(statHoldKey('a')).toBe(statHoldKey('a'));
  });

  it('reads 0 for an untouched unit, so its card never re-renders', () => {
    holdStat('a', { attack: 2, health: 1 });
    expect(statHoldKey('b')).toBe(0);
  });

  it('changes when the hold changes, and returns to 0 on release', () => {
    const before = statHoldKey('a');
    holdStat('a', { attack: 2, health: 1 });
    expect(statHoldKey('a')).not.toBe(before);
    releaseStat('a');
    expect(statHoldKey('a')).toBe(0);
  });

  it('distinguishes attack from health — a 2/0 hold is not a 0/2 hold', () => {
    holdStat('a', { attack: 2, health: 0 });
    const atkOnly = statHoldKey('a');
    releaseStat('a');
    holdStat('a', { attack: 0, health: 2 });
    expect(statHoldKey('a')).not.toBe(atkOnly);
  });

  it('notifies subscribers on hold and on release', () => {
    const fn = vi.fn();
    const off = subscribeStatHolds(fn);
    holdStat('a', { attack: 1, health: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
    releaseStat('a');
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    holdStat('b', { attack: 1, health: 0 });
    expect(fn).toHaveBeenCalledTimes(2); // unsubscribed
  });

  it('does not notify when a release changes nothing', () => {
    const fn = vi.fn();
    const off = subscribeStatHolds(fn);
    releaseStat('never-held');
    expect(fn).not.toHaveBeenCalled();
    off();
  });
});
