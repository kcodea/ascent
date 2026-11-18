// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Ticker } from 'pixi.js';
import { PIXI_SYSTEM_TICK_MS, parkPixiSystemTicker } from './pixiAppSafety';

/**
 * PIXI'S SYSTEM TICKER IS PARKED (R-PERF-PIXI-SYSTEM-TICKER-01, perf pass 2026-11-18). Every renderer's scheduler adds
 * a listener to `Ticker.system`, which auto-starts and then holds a `requestAnimationFrame` loop for the whole
 * session: the third always-on frame loop on an idle shop, and with a frame loop live every CSS animation on the
 * board is updated on the main thread each display frame.
 */
describe('parkPixiSystemTicker', () => {
  it('stops the frame loop for good and steps the ticker from a timer instead', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const sys = Ticker.system;
    parkPixiSystemTicker();
    expect(sys.started).toBe(false);
    expect(sys.autoStart).toBe(false);
    // A renderer created later adds its scheduler: the frame loop must not come back.
    const task = vi.fn();
    sys.add(task);
    expect(sys.started).toBe(false);
    expect(raf).not.toHaveBeenCalled();
    // ...and its housekeeping still runs, on the timer.
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => (t += PIXI_SYSTEM_TICK_MS));
    vi.advanceTimersByTime(PIXI_SYSTEM_TICK_MS * 3 + 10);
    expect(task.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(raf).not.toHaveBeenCalled();
    sys.remove(task);
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
