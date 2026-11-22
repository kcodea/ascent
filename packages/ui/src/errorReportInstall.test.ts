// @vitest-environment jsdom
/**
 * R-CRASH-REPORT-DESKTOP-01, wired: on the desktop exe the reporter catches window errors and rejections, finds a
 * crashed session, takes the shell's crash file over and merges the two tellings of one crash; nothing is sent before
 * the transport arrives, and then only on idle after the delay.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers(); vi.doUnmock('./phoneArt'); vi.doUnmock('./phoneDiag');
  delete (globalThis as { ascentDesktop?: unknown }).ascentDesktop;
  localStorage.clear();
});

async function load(desktopReports: unknown[]) {
  vi.resetModules();
  window.history.replaceState(null, '', '/');
  vi.doMock('./phoneArt', () => ({ LITE_ART: false }));
  vi.doMock('./phoneDiag', () => ({ activeDiagLabel: () => '' }));
  const take = vi.fn(() => Promise.resolve(desktopReports));
  (globalThis as { ascentDesktop?: unknown }).ascentDesktop = { isDesktop: true, quit: () => {}, toggleFullscreen: () => {}, takeCrashReports: take };
  const log = await import('./crashLog');
  const rep = await import('./errorReport');
  return { log, rep, take };
}

describe('error reporting on the desktop exe', () => {
  it('captures, hands over, merges, and sends only after the transport + delay', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 22, 12) });
    const now = Date.now();
    // A session that died 60 s ago, after the shop opened (left by the previous launch's sentinel)...
    localStorage.setItem('ascent.errreport.sessions.v1', JSON.stringify([{ id: 'prev', at: now - 120_000, last: now - 60_000, clean: false, steps: [{ s: 'shop open', t: 5 }] }]));
    // ...and the shell's report of the same crash.
    const { log, rep, take } = await load([{ id: 'k1', at: now - 59_000, kind: 'renderer-gone', reason: 'oom', exitCode: -1 }]);
    expect(log.crashLogActive()).toBe(false); // the heavy phone crash log stays off on desktop
    rep.installErrorReporting();
    rep.installErrorReporting(); // idempotent
    expect(take).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);

    log.crumb('combat start'); // a step's name is remembered, cheaply
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('boom'), message: 'boom', filename: 'app://ascent/assets/i.js', lineno: 1, colno: 2 }));
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = new Error('lost promise');
    window.dispatchEvent(rejection);
    rep.reportError('render', new Error('render broke'), '\n    at Shop');

    const pending = JSON.parse(localStorage.getItem('ascent.errreport.pending.v1') ?? '[]') as { kind: string; steps: { s: string }[]; platform: string }[];
    expect(pending.map((p) => p.kind)).toEqual(['renderer-gone', 'error', 'rejection', 'render']);
    expect(pending[0]!.steps.map((s) => s.s)).toEqual(['shop open']); // merged: one report for the crash
    expect(pending[1]!.steps.map((s) => s.s)).toContain('combat start');
    expect(pending.every((p) => p.platform === 'desktop')).toBe(true);

    const rows: { payload: { kind: string } }[] = [];
    rep.setErrorReportTransport(() => (row) => { rows.push(row as never); return Promise.resolve({ error: null }); });
    await vi.advanceTimersByTimeAsync(5000);
    expect(rows).toHaveLength(0); // still waiting: UPLOAD_DELAY_MS
    await vi.advanceTimersByTimeAsync(20_000);
    expect(rows.map((r) => r.payload.kind)).toEqual(['renderer-gone', 'error', 'rejection', 'render']);
    expect(JSON.parse(localStorage.getItem('ascent.errreport.pending.v1') ?? '[]')).toEqual([]);
  });

  it('a page that leaves cleanly is not reported as a crash next time', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 22, 12) });
    const { rep } = await load([]);
    rep.installErrorReporting();
    window.dispatchEvent(new Event('pagehide'));
    const saved = JSON.parse(localStorage.getItem('ascent.errreport.sessions.v1') ?? '[]') as { clean: boolean }[];
    expect(saved.at(-1)!.clean).toBe(true);
  });
});
