// @vitest-environment jsdom
/**
 * THE DUTY-CYCLED SAMPLER (R-PERF-MONITOR-DUTY-01, perf pass 2026-11-18): the perf monitor's frame loop runs only
 * while there is something to measure, and parks otherwise. A pending `requestAnimationFrame` makes the browser
 * produce a main frame on every display frame, and every running CSS animation is then updated on the main thread,
 * so an always-on sampler made the game pay for every keyword aura on an idle board.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_HOLD_MS, HEARTBEAT_EVERY_MS, HEARTBEAT_MS, perfMonitor, shouldSampleFrames } from './perfMonitor';

describe('shouldSampleFrames', () => {
  const idle = { continuous: false, warming: false, inCombat: false, nowMs: 5000, activeUntilMs: 4000 };
  it('an idle screen with nothing asked for is not sampled', () => { expect(shouldSampleFrames(idle)).toBe(false); });
  it('recent activity, a fight, a warm-up or an explicit ask each keep the loop running', () => {
    expect(shouldSampleFrames({ ...idle, activeUntilMs: 5001 })).toBe(true);
    expect(shouldSampleFrames({ ...idle, inCombat: true })).toBe(true);
    expect(shouldSampleFrames({ ...idle, warming: true })).toBe(true);
    expect(shouldSampleFrames({ ...idle, continuous: true })).toBe(true);
  });
});

describe('perfMonitor duty cycle', () => {
  let now = 0;
  let pending: FrameRequestCallback | null = null;
  let phase = 'recruit';
  /** Present one frame `dt` ms after the last (if the monitor asked for one). Returns whether it had. */
  const frame = (dt: number): boolean => {
    now += dt;
    const cb = pending;
    pending = null;
    cb?.(now);
    return !!cb;
  };
  const frames = (n: number, dt: number): void => { for (let i = 0; i < n; i++) frame(dt); };
  /** Let wall time pass with no frames wanted: only timers run. */
  const wait = (ms: number): void => { for (let t = 0; t < ms; t += 50) { now += 50; vi.advanceTimersByTime(50); } };
  /** Start, and play the warm-up out so the monitor is in its steady state. */
  const startSettled = (): void => {
    perfMonitor.setWarmup({ ms: 100, frames: 10 });
    perfMonitor.start();
    frames(12, 10);
    expect(perfMonitor.warmupState().active).toBe(false);
  };

  beforeEach(() => {
    now = 0;
    pending = null;
    phase = 'recruit';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { pending = cb; return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => { pending = null; });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    localStorage.removeItem('ascent.perf.warmup');
    perfMonitor.clear();
    perfMonitor.registerContext(() => ({ phase, wave: 1 }));
  });
  afterEach(() => {
    perfMonitor.stop();
    perfMonitor.clear();
    perfMonitor.setWarmup({ ms: 2000, frames: 120 });
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('parks its frame loop once the screen has been quiet for the hold, and asks for no more frames', () => {
    startSettled();
    expect(perfMonitor.isSampling).toBe(true);
    // Quiet frames until the hold runs out.
    for (let i = 0; i < 400 && perfMonitor.isSampling; i++) frame(10);
    expect(perfMonitor.isSampling).toBe(false);
    expect(pending).toBeNull();
    expect(now).toBeGreaterThanOrEqual(ACTIVE_HOLD_MS);
    expect(now).toBeLessThan(ACTIVE_HOLD_MS + 200);
  });

  it('a mark, a measured span or a recorded render wakes it in the same call', () => {
    startSettled();
    for (let i = 0; i < 400 && perfMonitor.isSampling; i++) frame(10);
    for (const wake of [() => perfMonitor.mark('fx:tendril'), () => perfMonitor.measure('reduce', () => 1), () => perfMonitor.record('render:recruit', 2)]) {
      expect(perfMonitor.isSampling).toBe(false);
      wake();
      expect(perfMonitor.isSampling).toBe(true);
      expect(pending).not.toBeNull();
      for (let i = 0; i < 400 && perfMonitor.isSampling; i++) frame(10);
    }
  });

  it('the FX ticker\'s own per-frame spans do not hold it awake (a looping effect never ends)', () => {
    startSettled();
    for (let i = 0; i < 400 && perfMonitor.isSampling; i++) frame(10);
    for (const label of ['fx:tick', 'fx:sim', 'fx:render', 'fx:def:test-ascent-frame-attack']) { perfMonitor.begin(label); perfMonitor.end(); }
    expect(perfMonitor.isSampling).toBe(false);
  });

  it('the frame that follows a wake is kept only when it is long: a slow action is measured, a fast one invents nothing', () => {
    startSettled();
    for (let i = 0; i < 400 && perfMonitor.isSampling; i++) frame(10);
    const ring = perfMonitor.frameRing();
    const before = ring.n;
    perfMonitor.mark('buy');
    frame(3);            // 3 ms from the wake to the next display frame: not a real interval
    expect(ring.n).toBe(before);
    frame(10);           // a real one
    expect(ring.n).toBe(before + 1);
    for (let i = 0; i < 400 && perfMonitor.isSampling; i++) frame(10);
    const mid = ring.n;
    perfMonitor.mark('slow buy');
    frame(180);          // the action blocked the main thread for 180 ms: that frame is the one worth having
    expect(ring.n).toBe(mid + 1);
    expect(ring.dt[(ring.head - 1 + ring.dt.length) % ring.dt.length]).toBe(180);
  });

  it('a parked second writes no bucket, and what happened in it is carried into the next one, never dropped', () => {
    startSettled();
    for (let i = 0; i < 400 && perfMonitor.isSampling; i++) frame(10);
    const n0 = perfMonitor.history().length;
    wait(3000);                                  // three parked seconds: a longtask lands in one of them
    perfMonitor.noteLongTask(now - 500, 120);
    expect(perfMonitor.history().length).toBe(n0);
    perfMonitor.mark('roll');
    frames(150, 10);                             // a sampled second and a half
    const added = perfMonitor.history().slice(n0);
    expect(added.length).toBeGreaterThanOrEqual(1);
    expect(added[0]!.marks.roll).toBe(1);
    expect(added[0]!.longTasks?.[0]?.ms).toBe(120);
    expect(added[0]!.fps).toBeGreaterThan(90);   // frames over the span they covered, not over the idle gap
  });

  it('an idle screen is still sampled: one second in every ten', () => {
    startSettled();
    for (let i = 0; i < 400 && perfMonitor.isSampling; i++) frame(10);
    wait(HEARTBEAT_EVERY_MS + 100); // the timer woke it somewhere in the last 150 ms of this wait
    expect(perfMonitor.isSampling).toBe(true);
    let sampled = 0;
    for (let i = 0; i < 400 && perfMonitor.isSampling; i++) { frame(10); sampled += 10; }
    expect(sampled).toBeGreaterThanOrEqual(HEARTBEAT_MS - 250);
    expect(sampled).toBeLessThan(HEARTBEAT_MS + 200);
  });

  it('a fight is sampled throughout, with no activity needed', () => {
    startSettled();
    phase = 'combat';
    perfMonitor.mark('phase:recruit->combat');
    frames(600, 10); // six quiet seconds of combat
    expect(perfMonitor.isSampling).toBe(true);
    phase = 'recruit';
    for (let i = 0; i < 600 && perfMonitor.isSampling; i++) frame(10);
    expect(perfMonitor.isSampling).toBe(false);
  });

  it('the HUD (or any explicit ask) gets every frame; giving it back lets the loop park again', () => {
    startSettled();
    perfMonitor.setContinuous(true);
    frames(600, 10);
    expect(perfMonitor.isSampling).toBe(true);
    perfMonitor.setContinuous(false);
    for (let i = 0; i < 400 && perfMonitor.isSampling; i++) frame(10);
    expect(perfMonitor.isSampling).toBe(false);
    perfMonitor.setContinuous(true); // asked for while parked: it wakes at once
    expect(perfMonitor.isSampling).toBe(true);
    perfMonitor.setContinuous(false);
  });
});
