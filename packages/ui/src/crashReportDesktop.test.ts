// @vitest-environment jsdom
/**
 * R-TOUCH-CRASH-REPORT-01, the desktop guard (owner 2026-10-22: "We don't want to break desktop for this."). Off the
 * phone path and without `?crashlog=1` the crash log records nothing and the crash report sends nothing: no request,
 * no timer, no storage write, even with an unclean session left in storage by an earlier `?crashlog=1` load.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrashLogStore } from './crashLog';

const LOG_KEY = 'ascent.crashlog.v1';
const leftover: CrashLogStore = { cur: { id: 'old', at: 1, clean: false, crumbs: [{ s: 'boot', t: 0 }, { s: 'play pressed', t: 900 }] }, crashes: [] };

async function load(query: string, lite: boolean) {
  vi.resetModules();
  window.history.replaceState(null, '', `/${query}`);
  vi.doMock('./phoneArt', () => ({ LITE_ART: lite }));
  vi.doMock('./phoneDiag', () => ({ activeDiagLabel: () => '' }));
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  const log = await import('./crashLog');
  const report = await import('./crashReport');
  return { log, report, getContextPatched: HTMLCanvasElement.prototype.getContext !== origGetContext };
}

afterEach(() => { vi.useRealTimers(); vi.doUnmock('./phoneArt'); vi.doUnmock('./phoneDiag'); localStorage.clear(); });

describe('crash reports on desktop', () => {
  it('a desktop load without the flag records nothing and never uploads', async () => {
    localStorage.setItem(LOG_KEY, JSON.stringify(leftover));
    vi.useFakeTimers();
    const { log, report, getContextPatched } = await load('', false);
    expect(log.crashLogActive()).toBe(false);
    expect(getContextPatched).toBe(false); // no WebGL wrapper on desktop
    const getInsert = vi.fn(() => (() => Promise.resolve({ error: null })));
    const cancel = report.scheduleCrashReportUpload(getInsert);
    expect(vi.getTimerCount()).toBe(0); // nothing even scheduled
    await vi.advanceTimersByTimeAsync(120_000);
    expect(getInsert).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOG_KEY)).toBe(JSON.stringify(leftover)); // the old log is untouched
    expect(localStorage.getItem(report.CRASH_REPORTED_KEY)).toBeNull();
    cancel();
  });

  it('?crashlog=1 on desktop opts in: the leftover crash is found and sent once', async () => {
    localStorage.setItem(LOG_KEY, JSON.stringify(leftover));
    vi.useFakeTimers();
    const { log, report } = await load('?crashlog=1', false);
    expect(log.crashLogActive()).toBe(true);
    const rows: unknown[] = [];
    report.scheduleCrashReportUpload(() => (row) => { rows.push(row); return Promise.resolve({ error: null }); });
    await vi.advanceTimersByTimeAsync(report.UPLOAD_DELAY_MS + 11_000);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(report.CRASH_REPORTED_KEY)!).done).toEqual(['old@1']);
  });
});
