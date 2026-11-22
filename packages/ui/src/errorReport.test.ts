/**
 * R-CRASH-REPORT-DESKTOP-01 (owner 2026-11-22): errors and crashes from every client reach client_crash_reports,
 * deduped per session, capped per session and per day, redacted, small, and never thrown into the game.
 */
import { describe, expect, it } from 'vitest';
import type { CrashInsert, CrashReportRow } from './crashReport';
import {
  buildErrorRow, captureRecord, crashSessionRecord, createReporter, dayOf, desktopRecord, errorSignature, ERR_DAY_KEY,
  ERR_PENDING_KEY, gate, MAX_PER_DAY, MAX_PER_SESSION, MAX_ROW_CHARS, MAX_TRIES, mergeDesktopCrashes, parsePending,
  readSentinel, redact, redactStack, SENTINEL_STALE_MS, UPLOAD_DELAY_MS, type ErrorRecord, type ReporterDeps, type SentinelEntry,
} from './errorReport';

const APP = { version: '1.2.3', sha: 'abc1234', date: '2026-11-22T00:00:00Z', dirty: false };
const ENV = { ua: 'Mozilla/5.0 Electron', standalone: false, screen: { w: 1920, h: 1080, dpr: 1, vw: 1920, vh: 1080 } };
const NOW = Date.UTC(2026, 10, 22, 12);

describe('redaction', () => {
  it('takes out emails, tokens, keys, URL queries and the home folder', () => {
    expect(redact('mail kevin.x@example.com now')).toBe('mail [email] now');
    expect(redact('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N')).toBe('Bearer [redacted]');
    expect(redact('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N here')).toBe('jwt [jwt] here');
    expect(redact('fetch https://x.supabase.co/auth/v1/verify?token=abc&type=magiclink failed'))
      .toBe('fetch https://x.supabase.co/auth/v1/verify?[redacted] failed');
    expect(redact('https://ascent.gg/#access_token=abc123&refresh_token=zzz')).toBe('https://ascent.gg/?[redacted]');
    expect(redact('key sb_publishable_AbCdEf1234567890 used')).toBe('key [key] used');
    expect(redact('password=hunter2; token: abc')).toBe('password=[redacted]; token: [redacted]');
    expect(redact('at C:\\Users\\kevin\\AppData\\Local\\ascent\\main.cjs:3')).toBe('at C:\\Users\\~\\AppData\\Local\\ascent\\main.cjs:3');
    expect(redact('/home/kevin/ascent/main.cjs')).toBe('/home/~/ascent/main.cjs');
    expect(redact('x'.repeat(50))).toBe('[redacted]');
  });

  it('keeps ordinary error text and caps length', () => {
    expect(redact("Cannot read properties of undefined (reading 'hp')")).toBe("Cannot read properties of undefined (reading 'hp')");
    expect(redact('Unexpected token < in JSON at position 0')).toBe('Unexpected token < in JSON at position 0');
    expect(redact('a b '.repeat(500)).length).toBeLessThanOrEqual(300);
    const stack = Array.from({ length: 40 }, (_, i) => `    at fn${i} (app://ascent/assets/index-abc.js:1:${i})`).join('\n');
    expect(redactStack(stack).split('\n')).toHaveLength(15);
  });
});

describe('records', () => {
  const ctx = { session: 'sess01', at: NOW, steps: [{ s: 'title', t: 10 }], platform: 'desktop' as const };

  it('describes any thrown value and drops browser noise', () => {
    const r = captureRecord({ kind: 'error', error: new TypeError('x is undefined'), source: 'app://ascent/assets/a.js?v=1', line: 1, col: 9 }, ctx)!;
    expect(r.name).toBe('TypeError');
    expect(r.message).toBe('x is undefined');
    expect(r.detail).toEqual({ source: 'app://ascent/assets/a.js?[redacted]', line: 1, col: 9 });
    expect(r.key.length).toBeLessThanOrEqual(64);
    expect(captureRecord({ kind: 'rejection', error: 'plain string' }, ctx)!.message).toBe('plain string');
    expect(captureRecord({ kind: 'rejection', error: { code: 7 } }, ctx)!.message).toBe('{"code":7}');
    expect(captureRecord({ kind: 'rejection', error: undefined }, ctx)!.message).toBe('undefined');
    expect(captureRecord({ kind: 'error', error: 'ResizeObserver loop completed with undelivered notifications.' }, ctx)).toBeNull();
    expect(captureRecord({ kind: 'error', error: 'Script error.' }, ctx)).toBeNull();
    expect(captureRecord({ kind: 'rejection', error: new DOMException('aborted', 'AbortError') }, ctx)).toBeNull();
  });

  it('the same error has one signature; a different one does not', () => {
    const a = new Error('boom 12'); a.stack = 'Error: boom 12\n    at f (a.js:1:2)';
    const b = new Error('boom 99'); b.stack = 'Error: boom 99\n    at f (a.js:1:2)';
    const c = new Error('boom 12'); c.stack = 'Error: boom 12\n    at g (a.js:5:2)';
    const sig = (e: Error) => captureRecord({ kind: 'error', error: e }, ctx)!.sig;
    expect(sig(a)).toBe(sig(b)); // numbers in the message folded
    expect(sig(a)).not.toBe(sig(c));
    expect(errorSignature('error', 'E', 'm', '')).not.toBe(errorSignature('rejection', 'E', 'm', ''));
  });

  it('a row stays under its budget and carries platform, kind and app', () => {
    const rec = captureRecord({ kind: 'render', error: new Error('bad'), componentStack: '\n    at Shop\n    at Game' }, ctx)!;
    rec.stack = 'x\n'.repeat(20_000);
    rec.steps = Array.from({ length: 12 }, (_, i) => ({ s: `step ${i}`, t: i }));
    const row = buildErrorRow(rec, ENV, APP);
    expect(JSON.stringify(row.payload).length).toBeLessThanOrEqual(MAX_ROW_CHARS);
    expect(row.payload).toMatchObject({ v: 2, kind: 'render', platform: 'desktop', app: APP });
    expect(row.last_step).toBe('render: Error: bad');
    expect(row.build).toBe('1.2.3+abc1234');
    expect(row.session_key.length).toBeLessThanOrEqual(64);
  });
});

describe('caps', () => {
  const today = dayOf(NOW);
  it('dedupes, caps a session, caps a day', () => {
    expect(gate('a', new Set(), 0, null, today)).toBe('ok');
    expect(gate('a', new Set(['a']), 1, null, today)).toBe('dup');
    expect(gate('b', new Set(), MAX_PER_SESSION, null, today)).toBe('session-cap');
    expect(gate('b', new Set(), MAX_PER_SESSION, null, today, true)).toBe('ok'); // a handed-over crash
    expect(gate('b', new Set(), 0, { d: today, n: MAX_PER_DAY }, today)).toBe('day-cap');
    expect(gate('b', new Set(), 0, { d: '2026-11-21', n: MAX_PER_DAY }, today)).toBe('ok'); // a new day
  });
});

describe('the crashed-session sentinel', () => {
  const entry = (id: string, last: number, clean = false, steps = [{ s: 'shop', t: 1 }]): SentinelEntry => ({ id, at: last - 1000, last, clean, steps });
  it('an unclean, quiet entry crashed; a fresh one may be another tab; clean ones go', () => {
    const { crashed, next } = readSentinel([
      entry('dead', NOW - SENTINEL_STALE_MS - 1), entry('alive', NOW - 1000), entry('left', NOW - 999_999, true),
      entry('empty', NOW - SENTINEL_STALE_MS - 1, false, []), entry('ancient', NOW - 4 * 86_400_000),
    ], 'me', NOW);
    expect(crashed.map((e) => e.id)).toEqual(['dead']);
    expect(next.map((e) => e.id)).toEqual(['alive', 'me']);
    const rec = crashSessionRecord(crashed[0]!, 'me', 'web');
    expect(rec.kind).toBe('crash-session');
    expect(rec.message).toBe('ended without leaving the page after shop');
  });

  it('one desktop crash told by the shell and by the sentinel becomes one report with the steps', () => {
    const sess = crashSessionRecord(entry('dead', NOW - 60_000), 'me', 'desktop');
    const gone = desktopRecord({ id: 'k1', at: NOW - 58_000, kind: 'renderer-gone', reason: 'oom', exitCode: -536870904 }, 'me')!;
    const hang = desktopRecord({ id: 'k2', at: NOW - 58_000, kind: 'renderer-hang' }, 'me')!;
    const merged = mergeDesktopCrashes([sess], [gone, hang]);
    expect(merged.map((r) => r.kind)).toEqual(['renderer-gone', 'renderer-hang']);
    expect(merged[0]!.steps).toEqual([{ s: 'shop', t: 1 }]);
    expect(merged[0]!.detail).toMatchObject({ reason: 'oom', exitCode: -536870904, durationMs: 1000 });
    // Too far apart in time: both stay.
    const far = desktopRecord({ id: 'k3', at: NOW + 3_600_000, kind: 'renderer-gone', reason: 'crashed' }, 'me')!;
    expect(mergeDesktopCrashes([sess], [far]).map((r) => r.kind)).toEqual(['renderer-gone', 'crash-session']);
  });

  it('a desktop report is validated and redacted field by field', () => {
    expect(desktopRecord(null, 's')).toBeNull();
    expect(desktopRecord({ id: 'x', at: 1, kind: 'nope' }, 's')).toBeNull();
    expect(desktopRecord({ id: 'bad id!', at: 1, kind: 'child-gone' }, 's')).toBeNull();
    const r = desktopRecord({
      id: 'a1', at: 5, kind: 'main-exception', name: 'TypeError', message: 'oops mail a@b.co',
      stack: 'TypeError: oops\n    at C:\\Users\\kevin\\x\\main.cjs:1:1', app: { version: '0.9.0', electron: '44.2.0' }, extra: 'ignored',
    }, 's')!;
    expect(r.message).toBe('oops mail [email]');
    expect(r.stack).toContain('C:\\Users\\~\\x');
    expect(r.detail).toEqual({ exeVersion: '0.9.0', electron: '44.2.0' });
    expect(r.platform).toBe('desktop');
  });
});

/** A reporter on fake storage, a manual clock and a manual "later" queue. */
function rig(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const queue: { fn: () => void; delay: number }[] = [];
  let online = true;
  const deps: ReporterDeps = {
    read: (k) => store.get(k) ?? null,
    write: (k, v) => { store.set(k, v); },
    now: () => NOW,
    env: () => ENV,
    later: (fn, delay) => { queue.push({ fn, delay }); },
    online: () => online,
    whenOnline: (fn) => { queue.push({ fn, delay: -1 }); },
  };
  const rows: CrashReportRow[] = [];
  const ok: CrashInsert = (row) => { rows.push(row); return Promise.resolve({ error: null }); };
  const fail: CrashInsert = (row) => { rows.push(row); return Promise.resolve({ error: 'nope' }); };
  const runQueue = async (rep: { idle: () => Promise<void> }) => {
    while (queue.length) { queue.shift()!.fn(); await rep.idle(); }
  };
  return { store, queue, deps, rows, ok, fail, runQueue, setOnline: (v: boolean) => { online = v; } };
}
const err = (m: string) => { const e = new Error(m); e.stack = `Error: ${m}\n    at x (a.js:1:${m.length})`; return e; };

describe('the reporter', () => {
  it('sends nothing until it has a transport, then once, after the delay, and never throws', async () => {
    const r = rig();
    const rep = createReporter(r.deps, 's1', 'desktop', () => [{ s: 'title', t: 1 }]);
    rep.capture({ kind: 'error', error: err('a') });
    rep.capture({ kind: 'error', error: err('a') }); // the same error: deduped
    expect(r.queue).toHaveLength(0);
    expect(parsePending(r.store.get(ERR_PENDING_KEY) ?? null)).toHaveLength(1);
    rep.setTransport(() => r.ok);
    expect(r.queue[0]!.delay).toBe(UPLOAD_DELAY_MS);
    await r.runQueue(rep);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.payload).toMatchObject({ kind: 'error', platform: 'desktop' });
    expect(rep.pending()).toHaveLength(0);
    // A throwing insert getter and a throwing env never escape.
    const bad = createReporter({ ...r.deps, env: () => { throw new Error('no dom'); } }, 's2', 'web', () => []);
    bad.capture({ kind: 'error', error: err('zz') });
    bad.setTransport(() => { throw new Error('no client'); }, () => r.ok);
    await r.runQueue(bad);
    expect(r.rows).toHaveLength(2);
  });

  it('caps a session at MAX_PER_SESSION and a device-day at MAX_PER_DAY', async () => {
    const r = rig();
    const rep = createReporter(r.deps, 's1', 'web', () => []);
    for (let i = 0; i < 12; i++) rep.capture({ kind: 'error', error: err(`e${'x'.repeat(i)}`) });
    expect(rep.pending()).toHaveLength(MAX_PER_SESSION);
    // The day is nearly spent by earlier loads: only what fits goes in.
    const r2 = rig({ [ERR_DAY_KEY]: JSON.stringify({ d: dayOf(NOW), n: MAX_PER_DAY - 2 }) });
    const rep2 = createReporter(r2.deps, 's2', 'web', () => []);
    for (let i = 0; i < 5; i++) rep2.capture({ kind: 'error', error: err(`f${'x'.repeat(i)}`) });
    expect(rep2.pending()).toHaveLength(2);
    // Crashes handed over from an earlier launch skip the session cap, not the day cap.
    const r3 = rig();
    const rep3 = createReporter(r3.deps, 's3', 'desktop', () => []);
    for (let i = 0; i < MAX_PER_SESSION; i++) rep3.capture({ kind: 'error', error: err(`g${'x'.repeat(i)}`) });
    rep3.handOver([desktopRecord({ id: 'z1', at: NOW, kind: 'renderer-gone', reason: 'crashed' }, 's3')!]);
    expect(rep3.pending().map((p) => p.kind)).toContain('renderer-gone');
  });

  it('a failed send waits for the next load, MAX_TRIES loads at most, one try per load', async () => {
    const r = rig();
    let rep = createReporter(r.deps, 'l1', 'web', () => []);
    rep.capture({ kind: 'rejection', error: err('net') });
    for (let load = 1; load <= MAX_TRIES + 1; load++) {
      if (load > 1) rep = createReporter(r.deps, `l${load}`, 'web', () => []);
      rep.setTransport(() => r.fail);
      await r.runQueue(rep);
    }
    expect(r.rows).toHaveLength(MAX_TRIES);
    expect(parsePending(r.store.get(ERR_PENDING_KEY) ?? null)).toHaveLength(0);
  });

  it('offline: waits for the network instead of spending a try', async () => {
    const r = rig();
    r.setOnline(false);
    const rep = createReporter(r.deps, 's', 'web', () => []);
    rep.capture({ kind: 'error', error: err('off') });
    rep.setTransport(() => r.ok);
    r.queue.shift()!.fn(); // the delayed run finds no network
    expect(r.rows).toHaveLength(0);
    expect(rep.pending()[0]!.tries).toBe(0);
    r.setOnline(true);
    await r.runQueue(rep);
    expect(r.rows).toHaveLength(1);
  });

  it('pending reports survive a reload and are not reported twice', async () => {
    const r = rig();
    const rep = createReporter(r.deps, 'a', 'web', () => []);
    rep.capture({ kind: 'error', error: err('kept') });
    const next = createReporter(r.deps, 'b', 'web', () => []);
    next.capture({ kind: 'error', error: err('kept') }); // the same signature still waiting: deduped
    expect(next.pending()).toHaveLength(1);
    next.setTransport(() => r.ok);
    await r.runQueue(next);
    expect(r.rows).toHaveLength(1);
    expect((r.rows[0]!.payload as { session: string }).session).toBe('a');
  });

  it('parsePending drops junk', () => {
    expect(parsePending('nope')).toEqual([]);
    expect(parsePending(JSON.stringify([{ key: 1 }, null]))).toEqual([]);
    const ok: Partial<ErrorRecord> = { key: 'k', kind: 'error', tries: 0, steps: [] };
    expect(parsePending(JSON.stringify([ok]))).toHaveLength(1);
  });
});
