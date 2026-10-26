// @vitest-environment jsdom
/**
 * R-PHONE-PERFLOG-01 (owner 2026-10-26, on his iPhone: "Lots of animations aren't showing on phone, and general
 * performance is abysmal. How do we optimize this??"). The phone measures itself: frames per scene, WebGL / Pixi state
 * and an FX ledger, shown with ?perflog=1 and uploaded into the crash-report table. These pin the maths (histogram,
 * quantiles, scene classification, trimming) and the upload routes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HIST_BINS, addFrame, binOf, binUpper, buildPerfRow, classifyFrame, inSpans, ledgerForPayload, newAcc, quantile,
  summarizeAcc, MAX_PERF_PAYLOAD_CHARS, PERF_REPORT_STEP,
} from './phonePerfLog';
import { perfLogWantedFor, perfReadoutWantedFor } from './perfLogFlag';
import { fxLedgerMisses, fxLedgerTotals, type FxLedgerRow } from './fxLedger';
import { anchorsOffscreen } from './fx/playDef';

describe('the frame histogram', () => {
  it('bins cover 0 to 1000 ms without gaps and every bin upper edge is past its lower', () => {
    let prev = 0;
    for (let i = 0; i < HIST_BINS - 1; i++) { expect(binUpper(i)).toBeGreaterThan(prev); prev = binUpper(i); }
    expect(binUpper(HIST_BINS - 2)).toBe(1000);
    for (const ms of [0, 0.4, 4.2, 8.3, 16.7, 33.4, 49.9, 50, 120, 249, 250, 999, 1000, 5000]) {
      const b = binOf(ms);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(HIST_BINS);
      expect(ms).toBeLessThan(binUpper(b));
      if (b > 0) expect(ms).toBeGreaterThanOrEqual(binUpper(b - 1));
    }
  });
  it('quantiles come from the histogram and never pass the worst frame', () => {
    const a = newAcc();
    for (let i = 0; i < 98; i++) addFrame(a, 8.3);
    addFrame(a, 40); addFrame(a, 140);
    expect(quantile(a, 0.5)).toBe(8.5);
    expect(quantile(a, 0.95)).toBe(8.5);
    expect(quantile(a, 0.99)).toBe(40.5);
    expect(quantile(a, 1)).toBe(140);
    const s = summarizeAcc(a);
    expect(s).toMatchObject({ n: 100, worst: 140, o17: 2, o33: 2, o50: 1, o100: 1 });
    expect(summarizeAcc(newAcc()).p95).toBe(0);
  });
});

describe('scenes', () => {
  it('a drag wins in a run, then a warm-up is a transition, then the screen, then the phase', () => {
    const shop = 1 << 1; const combat = 2 << 1; const rf = 3 << 1; const over = 4 << 1;
    expect(classifyFrame(shop, 'run', true)).toBe('drag');
    expect(classifyFrame(shop | 1, 'run', false)).toBe('transition');
    expect(classifyFrame(shop, 'menu', false)).toBe('menu');
    expect(classifyFrame(shop, 'menu', true)).toBe('menu'); // a drag only counts in a run
    expect(classifyFrame(combat, 'heroselect', false)).toBe('heroselect');
    expect(classifyFrame(shop, 'run', false)).toBe('shop');
    expect(classifyFrame(combat, 'run', false)).toBe('combat');
    expect(classifyFrame(rf, 'run', false)).toBe('runeforge');
    expect(classifyFrame(over, 'run', false)).toBe('gameover');
    expect(classifyFrame(0, 'run', false)).toBe('other');
  });
  it('a frame interval overlapping a span counts as inside it (open spans run to Infinity)', () => {
    const spans = [{ from: 100, to: 200 }, { from: 500, to: Infinity }];
    expect(inSpans(spans, 90, 110)).toBe(true);
    expect(inSpans(spans, 200, 216)).toBe(false);
    expect(inSpans(spans, 600, 616)).toBe(true);
    expect(inSpans([], 0, 1)).toBe(false);
  });
});

describe('the flag', () => {
  it('records on every phone and with ?perflog=1; shows only with the flag', () => {
    expect(perfLogWantedFor(true, null, false)).toBe(true);
    expect(perfLogWantedFor(false, null, false)).toBe(false);
    expect(perfLogWantedFor(false, '1', false)).toBe(true);
    expect(perfLogWantedFor(false, null, true)).toBe(true);
    expect(perfLogWantedFor(false, '0', true)).toBe(false);
    expect(perfReadoutWantedFor(null, false)).toBe(false);
    expect(perfReadoutWantedFor('1', false)).toBe(true);
    expect(perfReadoutWantedFor('0', true)).toBe(false);
  });
});

describe('the FX ledger', () => {
  const rows: Record<string, FxLedgerRow> = {
    'def:a': { req: 10, out: { started: 7, 'ctx-lost': 3 } },
    'pixi:pulse': { req: 4, out: { 'not-ready': 4 } },
    'def:b': { req: 5, out: { started: 5, thinned: 2 } },
    'gate:land': { req: 2, out: { degraded: 2, started: 2 } },
  };
  it('totals and the misses (drawn, thinned, degraded and waiting are not misses)', () => {
    expect(fxLedgerTotals(rows).req).toBe(21);
    const m = fxLedgerMisses(rows);
    expect(m.map((x) => x.kind)).toEqual(['pixi:pulse', 'def:a']);
    expect(m[1]).toMatchObject({ missed: 3, why: 'ctx-lost 3' });
    expect(ledgerForPayload(rows, 0)).toHaveProperty('misses');
  });
  it('an effect whose every anchor is off the screen is offscreen; a camera-only one is not', () => {
    expect(anchorsOffscreen({ source: { x: -200, y: 10 } }, 800, 400)).toBe(true);
    expect(anchorsOffscreen({ source: { x: -200, y: 10 }, target: { x: 100, y: 100 } }, 800, 400)).toBe(false);
    expect(anchorsOffscreen({ camera: { x: 400, y: 200 } }, 800, 400)).toBe(false);
  });
});

describe('the row', () => {
  it('is a perf-report row under the size cap, trimming the oldest windows first', () => {
    const windows = Array.from({ length: 400 }, (_, i) => ({ t: i * 10, sc: 'shop', n: 600, p95: 9.5, worst: 40, o17: 3, o33: 1, fx: 4, miss: 0 }));
    const payload = { v: 1, kind: 'perf', windows, events: [], fx: { busiest: {} }, device: { ua: 'iPhone', standalone: true }, build: 'b' };
    const row = buildPerfRow(payload, { ua: 'iPhone', standalone: true, build: 'b' }, 'perf:abc@1');
    expect(row.last_step).toBe(PERF_REPORT_STEP);
    expect(row.session_key).toBe('perf:abc@1');
    expect(JSON.stringify(row.payload).length).toBeLessThanOrEqual(MAX_PERF_PAYLOAD_CHARS);
    const kept = (row.payload as { windows: { t: number }[] }).windows;
    expect(kept[kept.length - 1]!.t).toBe(3990); // the newest window survives
  });
});

describe('on a phone', () => {
  afterEach(() => { vi.useRealTimers(); vi.doUnmock('./phoneArt'); localStorage.clear(); vi.resetModules(); });

  async function phone() {
    vi.resetModules();
    window.history.replaceState(null, '', '/');
    vi.doMock('./phoneArt', async (orig) => ({ ...(await orig<typeof import('./phoneArt')>()), LITE_ART: true }));
    return import('./phonePerfLog');
  }

  it('Send uploads the session as one perf-report row, client first, REST when it fails', { timeout: 30_000 }, async () => {
    const log = await phone();
    expect(log.perfLogActive()).toBe(true);
    const insert = vi.fn(() => Promise.resolve({ error: 'rls' }));
    const rest = vi.fn(() => Promise.resolve({ error: null }));
    const cancel = log.installPerfLog(() => insert, () => rest);
    expect(await log.uploadPerfNow()).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(rest).toHaveBeenCalledTimes(1);
    const row = (rest.mock.calls[0] as unknown as [{ last_step: string; session_key: string; payload: Record<string, unknown> }])[0];
    expect(row.last_step).toBe('perf-report');
    expect(row.session_key).toMatch(/^perf:/);
    expect(row.payload).toHaveProperty('scenes');
    expect(row.payload).toHaveProperty('fx');
    expect(row.payload).toHaveProperty('state.gl');
    cancel();
  });

  it('caps uploads per session', { timeout: 30_000 }, async () => {
    const log = await phone();
    const rest = vi.fn(() => Promise.resolve({ error: null }));
    log.installPerfLog(() => null, () => rest);
    for (let i = 0; i < 6; i++) await log.uploadPerfNow();
    expect(rest).toHaveBeenCalledTimes(log.MAX_UPLOADS);
  });

  it('a previous load that never sent its frames is sent on the next load, once', { timeout: 30_000 }, async () => {
    const prevRow = { last_step: 'perf-report', ua: 'iPhone', standalone: true, build: 'b', session_key: 'perf:old@1', payload: { v: 1 } };
    localStorage.setItem('ascent.perflog.v1', JSON.stringify({ key: 'perf:old@1', frames: 900, sentFrames: 0, tries: 0, row: prevRow }));
    vi.useFakeTimers();
    const log = await phone();
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    log.installPerfLog(() => insert, () => null);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(insert).toHaveBeenCalledTimes(1);
    const sent = (insert.mock.calls[0] as unknown as [{ session_key: string; payload: Record<string, unknown> }])[0];
    expect(sent.session_key).toBe('perf:old@1');
    expect(sent.payload.sentNextLoad).toBe(true);
    expect(localStorage.getItem('ascent.perflog.v1')).toBeNull();
  });
});
