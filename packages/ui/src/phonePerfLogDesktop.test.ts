// @vitest-environment jsdom
/**
 * R-PHONE-PERFLOG-01, the desktop guard: off a phone and without `?perflog=1` the perf log records nothing, wraps no FX
 * method, registers no Pixi app, schedules nothing, sends nothing and writes no storage.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.useRealTimers(); vi.doUnmock('./phoneArt'); localStorage.clear(); vi.resetModules(); });

describe('the perf log on desktop', () => {
  it('a desktop load without the flag is a no-op', { timeout: 30_000 }, async () => {
    vi.resetModules();
    window.history.replaceState(null, '', '/');
    vi.doMock('./phoneArt', async (orig) => ({ ...(await orig<typeof import('./phoneArt')>()), LITE_ART: false }));
    vi.useFakeTimers();
    const log = await import('./phonePerfLog');
    const ledger = await import('./fxLedger');
    expect(log.perfLogActive()).toBe(false);
    expect(ledger.FX_LEDGER_ON).toBe(false);
    const insert = vi.fn();
    const cancel = log.installPerfLog(() => insert, () => insert);
    expect(vi.getTimerCount()).toBe(0);
    expect(await log.uploadPerfNow()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(insert).not.toHaveBeenCalled();
    ledger.fxNote('def:x', 'started');
    ledger.trackPixiApp({ renderer: { resolution: 1 } });
    expect(ledger.fxLedgerSnapshot().rows).toEqual({});
    expect(ledger.pixiAppsSnapshot().made).toBe(0);
    expect(localStorage.length).toBe(0);
    cancel();
  });
  it('?perflog=1 opts a desktop in', { timeout: 30_000 }, async () => {
    vi.resetModules();
    window.history.replaceState(null, '', '/?perflog=1');
    vi.doMock('./phoneArt', async (orig) => ({ ...(await orig<typeof import('./phoneArt')>()), LITE_ART: false }));
    const log = await import('./phonePerfLog');
    expect(log.perfLogActive()).toBe(true);
  });
});
