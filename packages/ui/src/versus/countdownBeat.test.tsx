// @vitest-environment jsdom
/**
 * THE COUNTDOWN BEAT: the 5 s End Combat window and Ranked Duos overtime tick FIVE..ONE
 * aloud, the number re-keys once a second, and the seconds never reach the Shop screen's render.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../renderedText.mount';
import { sfx } from '../sfx';
import { CountdownTail, countdownSeconds, countdownShown, driveCountdown, resetCountdownBeatForTests } from './countdownBeat';
import { versusTurnNote } from './versusTurn';

let tick: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  resetCountdownBeatForTests();
  tick = vi.spyOn(sfx, 'turnTick').mockImplementation(() => {});
  vi.spyOn(sfx, 'warmTurnTick').mockImplementation(() => {});
});
let ui: ReturnType<typeof mount> | null = null;
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); vi.restoreAllMocks(); });

const now = (): number => Date.now();

describe('the countdown driver', () => {
  it('rounds the seconds up and never below zero', () => {
    expect([5000, 4999, 4001, 1, 0, -50].map(countdownSeconds)).toEqual([5, 5, 5, 1, 0, 0]);
  });

  it('the 5 s window ticks FIVE, FOUR, THREE, TWO, ONE, once each, then clears', () => {
    const stop = driveCountdown({ key: 'm|3|fight', deadlineMs: now() + 5000 }, now);
    expect(countdownShown()).toBe(5);
    expect(tick.mock.calls.map((c) => c[0])).toEqual([5]);
    vi.advanceTimersByTime(5200);
    expect(tick.mock.calls.map((c) => c[0])).toEqual([5, 4, 3, 2, 1]);
    expect(countdownShown()).toBeNull(); // the deadline passed: nothing left to show
    stop();
  });

  it('each tick lands just past its whole-second edge (not up to a poll late)', () => {
    const at: number[] = [];
    tick.mockImplementation((() => { at.push(Date.now() - 1_000_000); }) as never);
    const stop = driveCountdown({ key: 'm|4|fight', deadlineMs: now() + 4400 }, now);
    vi.advanceTimersByTime(4500);
    // 4.4 s out: FIVE at once, then FOUR at 0.4 s, THREE at 1.4 s ...
    expect(at.length).toBe(5);
    for (const [i, t] of at.slice(1).entries()) { expect(t).toBeGreaterThanOrEqual(400 + i * 1000); expect(t).toBeLessThan(400 + i * 1000 + 40); }
    stop();
  });

  it('a 30 s overtime shows every second and ticks only the last five', () => {
    const stop = driveCountdown({ key: 'm|2|overtime', deadlineMs: now() + 30_000 }, now);
    expect(countdownShown()).toBe(30);
    vi.advanceTimersByTime(24_500);
    expect(countdownShown()).toBe(6);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5600);
    expect(tick.mock.calls.map((c) => c[0])).toEqual([5, 4, 3, 2, 1]);
    stop();
  });

  it('a remount of the same countdown never repeats a second already ticked (a teammate-view swap, a reconnect)', () => {
    const deadline = now() + 5000;
    const stop = driveCountdown({ key: 'm|5|fight', deadlineMs: deadline }, now);
    vi.advanceTimersByTime(2100); // 5, 4, 3 ticked
    stop();
    expect(countdownShown()).toBeNull();
    const stop2 = driveCountdown({ key: 'm|5|fight', deadlineMs: deadline }, now);
    expect(countdownShown()).toBe(3);
    expect(tick.mock.calls.map((c) => c[0])).toEqual([5, 4, 3]);
    vi.advanceTimersByTime(3000);
    expect(tick.mock.calls.map((c) => c[0])).toEqual([5, 4, 3, 2, 1]);
    stop2();
    // a NEW countdown (the next round) starts fresh
    const stop3 = driveCountdown({ key: 'm|6|fight', deadlineMs: now() + 5000 }, now);
    expect(tick.mock.calls.map((c) => c[0])).toEqual([5, 4, 3, 2, 1, 5]);
    stop3();
  });

  it('stopping clears the number and its timers', () => {
    const stop = driveCountdown({ key: 'm|7|fight', deadlineMs: now() + 5000 }, now);
    stop();
    expect(countdownShown()).toBeNull();
    vi.advanceTimersByTime(6000);
    expect(tick.mock.calls.map((c) => c[0])).toEqual([5]);
  });
});

describe('the leaf in the gem pill', () => {
  it('renders nothing with no countdown, then the seconds, re-keyed each second so the pop restarts', () => {
    const m = (ui = mount(<span data-testid="tip">Ann is ready<CountdownTail /></span>));
    expect(m.container.textContent).toBe('Ann is ready');
    let stop = (): void => {};
    act(() => { stop = driveCountdown({ key: 'm|8|fight', deadlineMs: now() + 5000 }, now); });
    expect(m.container.textContent).toBe('Ann is ready · 5s');
    const first = m.container.querySelector('.vscd-num');
    expect(first?.className).toContain('hot');
    act(() => { vi.advanceTimersByTime(1010); });
    expect(m.container.textContent).toBe('Ann is ready · 4s');
    expect(m.container.querySelector('.vscd-num')).not.toBe(first); // a new node: the one-shot pop plays again
    act(() => { stop(); });
    expect(m.container.textContent).toBe('Ann is ready');
  });

  it('seconds above the ticking five are not "hot"', () => {
    const m = (ui = mount(<CountdownTail />));
    let stop = (): void => {};
    act(() => { stop = driveCountdown({ key: 'm|9|overtime', deadlineMs: now() + 20_000 }, now); });
    expect(m.container.querySelector('.vscd-num')?.className).toBe('vscd-num');
    act(() => { stop(); });
  });
});

describe('source contracts', () => {
  const hud = readFileSync(join(__dirname, 'VersusHud.tsx'), 'utf8');
  it('the Shop screen\'s Versus hook holds no per-second state (the seconds are the leaf\'s)', () => {
    const hook = hud.slice(hud.indexOf('export function useVersusRecruit'), hud.indexOf('function useSecondsTo'));
    expect(hook).not.toContain('useSecondsUntil(');
    expect(hook).not.toContain('setInterval(tick');
    expect(hook).toContain('driveCountdown(');
    expect(hook).toContain("bare: true");
  });
  it('the pill text carries no seconds when bare, and still does for older callers', () => {
    expect(versusTurnNote({ kind: 'foeReady', mate: 'Ann' }, 4, { bare: true })).toBe('Ann is ready');
    expect(versusTurnNote({ kind: 'foeReady' }, 4)).toBe('Opponent is ready · 4s');
  });
  it('the pop is transform / opacity only, one-shot, and still under reduced motion', () => {
    const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
    const pop = /@keyframes vscdpophot \{([^}]*\}){2}/.exec(css)?.[0] ?? '';
    expect(pop).toContain('transform');
    expect(pop).not.toMatch(/box-shadow|filter|background/);
    expect(css).toMatch(/\.vscd-num \{[^}]*animation: vscdpop 0\.36s[^}]*both; \}/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.vscd-num, \.vscd-num\.hot \{ animation: none; \} \}/);
  });
});
