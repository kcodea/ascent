/**
 * R-TOUCH-CRASH-REPORT-01 (owner 2026-10-22): each crashed session the crash log found is sent to Supabase once,
 * with a capped number of tries, and nothing at all happens without a backend.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CrashSession } from './crashLog';
import { buildReport, MAX_ATTEMPTS, MAX_PAYLOAD_CHARS, parseReported, pendingReports, sessionKey, uploadCrashReports, type CrashInsert, type CrashReportEnv, type CrashReportRow } from './crashReport';

const env: CrashReportEnv = {
  ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', standalone: true,
  screen: { w: 430, h: 932, dpr: 3, vw: 932, vh: 430 }, build: '0.0.0-test+test', buildDate: '1970-01-01', lite: true, diag: '',
};
const crash = (id: string, at: number, steps: string[] = ['boot', 'title', 'play pressed']): CrashSession =>
  ({ id, at, clean: false, crumbs: steps.map((s, i) => ({ s, t: i * 1000, a: 4 })) });

function harness(initial: string | null = null) {
  let stored = initial;
  const rows: CrashReportRow[] = [];
  return {
    rows,
    stored: () => stored,
    read: () => stored,
    write: (v: string) => { stored = v; },
    insertOk: ((row) => { rows.push(row); return Promise.resolve({ error: null }); }) as CrashInsert,
    insertFail: ((row) => { rows.push(row); return Promise.resolve({ error: { message: 'relation does not exist' } }); }) as CrashInsert,
  };
}

describe('crash report upload decision', () => {
  it('sends every unreported crash, oldest first, exactly once across loads', async () => {
    const h = harness();
    const crashes = [crash('b', 2), crash('a', 1)]; // the log keeps newest first
    expect(await uploadCrashReports({ crashes, insert: h.insertOk, env, read: h.read, write: h.write })).toBe(2);
    expect(h.rows.map((r) => r.session_key)).toEqual(['a@1', 'b@2']);
    // The next load: the same crashes are still on record, nothing is sent again.
    expect(await uploadCrashReports({ crashes, insert: h.insertOk, env, read: h.read, write: h.write })).toBe(0);
    expect(h.rows).toHaveLength(2);
    // A new crash later: only it goes.
    expect(await uploadCrashReports({ crashes: [crash('c', 3), ...crashes], insert: h.insertOk, env, read: h.read, write: h.write })).toBe(1);
    expect(h.rows.map((r) => r.session_key)).toEqual(['a@1', 'b@2', 'c@3']);
  });

  it('is a no-op without a backend, and touches no storage', async () => {
    const h = harness();
    expect(await uploadCrashReports({ crashes: [crash('a', 1)], insert: null, env, read: h.read, write: h.write })).toBe(0);
    expect(h.stored()).toBeNull();
  });

  it('a failed insert is not marked sent, and stops after MAX_ATTEMPTS loads', async () => {
    const h = harness();
    const crashes = [crash('a', 1)];
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await uploadCrashReports({ crashes, insert: h.insertFail, env, read: h.read, write: h.write });
    expect(h.rows).toHaveLength(MAX_ATTEMPTS);
    expect(parseReported(h.stored()).done).toEqual([]);
  });

  it('a rejected or hung insert never throws and counts as a try', async () => {
    const h = harness();
    const reject: CrashInsert = () => Promise.reject(new Error('offline'));
    await expect(uploadCrashReports({ crashes: [crash('a', 1)], insert: reject, env, read: h.read, write: h.write })).resolves.toBe(0);
    const hang: CrashInsert = () => new Promise(() => {});
    await expect(uploadCrashReports({ crashes: [crash('a', 1)], insert: hang, env, read: h.read, write: h.write, timeoutMs: 5 })).resolves.toBe(0);
    expect(parseReported(h.stored()).tries['a@1']).toBe(2);
  });

  it('pendingReports skips sent sessions and spent ones, and survives junk storage', () => {
    const crashes = [crash('c', 3), crash('b', 2), crash('a', 1)];
    const st = { done: ['a@1'], tries: { 'b@2': MAX_ATTEMPTS } };
    expect(pendingReports(crashes, st).map(sessionKey)).toEqual(['c@3']);
    expect(parseReported('not json')).toEqual({ done: [], tries: {} });
    expect(parseReported('{"done":[1,"x"],"tries":{"y":"2","z":1}}')).toEqual({ done: ['x'], tries: { z: 1 } });
  });

  it('the row carries the last step, the device and the build, and stays under the size budget', () => {
    const row = buildReport(crash('a', 1), env, 1);
    expect(row.last_step).toBe('play pressed');
    expect(row.standalone).toBe(true);
    expect(row.build).toBe('0.0.0-test+test');
    expect((row.payload.session as { durationMs: number }).durationMs).toBe(2000);
    const big = crash('a', 1, Array.from({ length: 40 }, (_, i) => `step ${i} ${'x'.repeat(2000)}`));
    const trimmed = buildReport(big, env, 1);
    expect(JSON.stringify(trimmed.payload).length).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
    const kept = (trimmed.payload.session as { crumbs: { s: string }[] }).crumbs;
    expect(kept[0]!.s.startsWith('step 0 ')).toBe(true); // the boot crumb stays
    expect(kept[kept.length - 1]!.s.startsWith('step 39 ')).toBe(true); // and the last step
  });

  it('only runs while the crash log records, and Game.tsx schedules it', () => {
    const src = (f: string): string => fs.readFileSync(path.join(__dirname, f), 'utf8');
    expect(src('crashReport.ts')).toMatch(/!crashLogActive\(\)/);
    expect(src('Game.tsx')).toMatch(/scheduleCrashReportUpload\(/);
  });
});
