// @vitest-environment jsdom
/**
 * R-TOUCH-CRASH-REPORT-02 (owner 2026-10-23: two real iPhone crashes, and no crash report arrived). The upload path as
 * iOS Safari runs it: no requestIdleCallback, a page that may start offline, a Supabase client insert that may fail or
 * hang (then the plain REST route carries the row), and a page restored from the back/forward cache.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrashLogStore } from './crashLog';
import type { CrashInsert, CrashReportRow } from './crashReport';

const LOG_KEY = 'ascent.crashlog.v1';
const leftover: CrashLogStore = { cur: { id: 'old', at: 1, clean: false, crumbs: [{ s: 'boot', t: 0 }, { s: 'hero picked', t: 900 }] }, crashes: [] };

async function load() {
  vi.resetModules();
  window.history.replaceState(null, '', '/');
  vi.doMock('./phoneArt', () => ({ LITE_ART: true }));
  vi.doMock('./phoneDiag', () => ({ activeDiagLabel: () => '' }));
  const log = await import('./crashLog');
  const report = await import('./crashReport');
  return { log, report };
}

const w = window as unknown as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
let online = true;
Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });

afterEach(() => {
  vi.useRealTimers(); vi.doUnmock('./phoneArt'); vi.doUnmock('./phoneDiag'); localStorage.clear();
  delete w.requestIdleCallback; delete w.cancelIdleCallback; online = true;
});

const ok = (rows: CrashReportRow[]): CrashInsert => (row) => { rows.push(row); return Promise.resolve({ error: null }); };

describe('crash reports on iOS Safari', () => {
  it('without requestIdleCallback (Safari) the delay timer sends it, on time', async () => {
    localStorage.setItem(LOG_KEY, JSON.stringify(leftover));
    vi.useFakeTimers();
    const { report } = await load();
    expect(w.requestIdleCallback).toBeUndefined();
    const rows: CrashReportRow[] = [];
    report.scheduleCrashReportUpload(() => ok(rows));
    await vi.advanceTimersByTimeAsync(report.UPLOAD_DELAY_MS - 1);
    expect(rows).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.last_step).toBe('hero picked');
  });

  it('with requestIdleCallback it waits for idle, and an unmount cancels it', async () => {
    localStorage.setItem(LOG_KEY, JSON.stringify(leftover));
    vi.useFakeTimers();
    const idle: Array<() => void> = [];
    w.requestIdleCallback = (cb: () => void) => { idle.push(cb); return idle.length; };
    w.cancelIdleCallback = vi.fn();
    const { report } = await load();
    const rows: CrashReportRow[] = [];
    const cancel = report.scheduleCrashReportUpload(() => ok(rows));
    await vi.advanceTimersByTimeAsync(report.UPLOAD_DELAY_MS);
    expect(idle).toHaveLength(1);
    cancel();
    idle[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(rows).toHaveLength(0); // cancelled: nothing sent, no try spent
    expect(localStorage.getItem(report.CRASH_REPORTED_KEY)).toBeNull();
  });

  it('a load that starts offline spends no try and sends once the network is back', async () => {
    localStorage.setItem(LOG_KEY, JSON.stringify(leftover));
    vi.useFakeTimers();
    online = false;
    const { report } = await load();
    const rows: CrashReportRow[] = [];
    report.scheduleCrashReportUpload(() => ok(rows));
    await vi.advanceTimersByTimeAsync(report.UPLOAD_DELAY_MS + 30_000);
    expect(rows).toHaveLength(0);
    expect(localStorage.getItem(report.CRASH_REPORTED_KEY)).toBeNull();
    online = true;
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(rows).toHaveLength(1);
  });

  it('a failing or hung client insert falls back to the plain REST insert in the same try', async () => {
    localStorage.setItem(LOG_KEY, JSON.stringify(leftover));
    vi.useFakeTimers();
    const { report } = await load();
    const rows: CrashReportRow[] = [];
    const hung: CrashInsert = () => new Promise(() => {});
    report.scheduleCrashReportUpload(() => hung, () => ok(rows));
    await vi.advanceTimersByTimeAsync(report.UPLOAD_DELAY_MS + 10_000);
    expect(rows).toHaveLength(1);
    const st = JSON.parse(localStorage.getItem(report.CRASH_REPORTED_KEY)!);
    expect(st.done).toEqual(['old@1']);
    expect(st.tries).toEqual({});
  });

  it('only the fallback (no client) still sends', async () => {
    const { report } = await load();
    const rows: CrashReportRow[] = [];
    let stored: string | null = null;
    const env = { ua: 'iPhone', standalone: true, screen: { w: 1, h: 1, dpr: 3, vw: 1, vh: 1 }, build: 'b', buildDate: 'd', lite: true, diag: '' };
    const n = await report.uploadCrashReports({ crashes: [leftover.cur!], insert: null, fallback: ok(rows), env, read: () => stored, write: (v) => { stored = v; } });
    expect(n).toBe(1);
  });

  it('a page restored from the back/forward cache is live again (not left marked clean)', async () => {
    const { log } = await load();
    expect(log.crashLogActive()).toBe(true);
    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(localStorage.getItem(LOG_KEY)!).cur.clean).toBe(true);
    const ev = new Event('pageshow') as Event & { persisted: boolean };
    Object.defineProperty(ev, 'persisted', { value: true });
    window.dispatchEvent(ev);
    const cur = JSON.parse(localStorage.getItem(LOG_KEY)!).cur;
    expect(cur.clean).toBe(false);
    expect(cur.crumbs.at(-1).s).toBe('resumed');
  });

  it('a light step records the layer estimate and the GL buffers without the full style scan', async () => {
    const { log } = await load();
    log.crumbLight('gate coverIn');
    const c = JSON.parse(localStorage.getItem(LOG_KEY)!).cur.crumbs.at(-1);
    expect(c.s).toBe('gate coverIn');
    expect(typeof c.ly).toBe('number');
    expect(c.wc).toBeUndefined(); // no per-element style read
    log.crumb('full step');
    const f = JSON.parse(localStorage.getItem(LOG_KEY)!).cur.crumbs.at(-1);
    expect(typeof f.wc).toBe('number');
    expect(log.describeCrumb({ s: 'x', t: 0, ly: 87, ln: 3, gs: '1278x590', xf: 1 })).toContain('layers est 87 MB (3), GL buffers 1278x590, stage transform');
  });
});
