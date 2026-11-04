// @vitest-environment jsdom
/**
 * R-PHONE-DIAG-COST-01 (owner 2026-11-04, iPhone 17: "the game becomes near unplayable after a few turns. really huge
 * hitching and freezing throughout"). The phone's own diagnostics (crash log + perf log, on for every phone session)
 * must not cost frames in play: a step that repeats every round never reads every element's style or forces a layout,
 * and the perf log measures its payload once instead of re-stringifying it per trim step.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPerfRow, MAX_PERF_PAYLOAD_CHARS, PERSIST_MS } from './phonePerfLog';

const src = (f: string): string => fs.readFileSync(path.join(__dirname, f), 'utf8');

describe('crash log ticks (every-round steps)', () => {
  afterEach(() => { vi.doUnmock('./phoneArt'); vi.restoreAllMocks(); localStorage.clear(); vi.resetModules(); document.body.innerHTML = ''; });

  async function phoneLog() {
    vi.resetModules();
    vi.doMock('./phoneArt', async (orig) => ({ ...(await orig<typeof import('./phoneArt')>()), LITE_ART: true }));
    document.body.innerHTML = '<div id="root">' + '<div class="x"></div>'.repeat(50) + '</div>';
    return import('./crashLog');
  }

  it('crumbTick and crumbProgress read no element style and no element box', async () => {
    const log = await phoneLog();
    expect(log.crashLogActive()).toBe(true);
    const styles = vi.spyOn(window, 'getComputedStyle');
    const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    log.crumbTick('gate coverIn');
    log.crumbProgress('art stream', { loaded: 100 });
    expect(styles).not.toHaveBeenCalled();
    expect(rects).not.toHaveBeenCalled();
  });

  it('a one-off step still runs the full scan (the crash hunt keeps its detail)', async () => {
    const log = await phoneLog();
    const styles = vi.spyOn(window, 'getComputedStyle');
    log.crumb('hero select shown');
    expect(styles.mock.calls.length).toBeGreaterThanOrEqual(50);
  });

  it('every per-round call site uses a tick', () => {
    expect(src('Recruit.tsx')).toContain("crumbTick(`gate ${wipe}`)");
    expect(src('Recruit.tsx')).not.toContain('crumbLight(');
    expect(src('rankedGate/gateFx.ts')).toContain("crumbTick('gate fx created')");
    expect(src('rankedGate/gateFx.ts')).not.toMatch(/\bcrumb\('/);
    expect(src('artPreload.ts')).toContain("crumbProgress('art stream'");
  });
});

describe('perf log store', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('measures the whole payload once however many trims it takes', () => {
    const windows = Array.from({ length: 400 }, (_, i) => ({ t: i * 10, sc: 'shop', n: 600, p95: 9.5, worst: 40, o17: 3, o33: 1, fx: 4, miss: 0 }));
    const events = Array.from({ length: 400 }, (_, i) => ({ t: i, k: 'note', d: 'x'.repeat(40) }));
    const payload = { v: 1, kind: 'perf', windows, events, fx: { busiest: { a: 1 } }, device: { ua: 'iPhone', standalone: true }, build: 'b' };
    const real = JSON.stringify;
    let whole = 0;
    vi.spyOn(JSON, 'stringify').mockImplementation(((v: unknown, ...rest: unknown[]) => {
      if (v && typeof v === 'object' && 'windows' in (v as object)) whole++;
      return (real as (...a: unknown[]) => string)(v, ...rest);
    }) as typeof JSON.stringify);
    const row = buildPerfRow(payload, { ua: 'iPhone', standalone: true, build: 'b' }, 'perf:abc@1');
    vi.restoreAllMocks();
    expect(whole).toBe(1);
    expect(JSON.stringify(row.payload).length).toBeLessThanOrEqual(MAX_PERF_PAYLOAD_CHARS);
    const kept = (row.payload as { windows: { t: number }[] }).windows;
    expect(kept[kept.length - 1]!.t).toBe(3990); // the newest window survives
  });

  it('the stored copy is refreshed at most once a minute (hidden / pagehide still store at once)', () => {
    expect(PERSIST_MS).toBeGreaterThanOrEqual(60_000);
    const s = src('phonePerfLog.ts');
    expect(s).toContain('if (t - lastPersistAt >= PERSIST_MS)');
    expect(s).toContain("window.addEventListener('pagehide', () => persist());");
  });
});
