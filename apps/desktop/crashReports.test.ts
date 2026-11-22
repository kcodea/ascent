/**
 * R-CRASH-REPORT-DESKTOP-01: the desktop shell records a renderer / GPU process gone, a hang and its own uncaught
 * errors to a small file, hands the file over ONCE to the next session's page, and offers Reload after a renderer crash.
 */
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Report = Record<string, unknown> & { id: string; kind: string; at: number };
const cr = createRequire(import.meta.url)('./crashReports.cjs') as {
  MAX_REPORTS: number;
  FILE_NAME: string;
  scrubPaths: (s: string) => string;
  makeReport: (kind: string, fields: Record<string, unknown>, meta: Record<string, unknown> | null, now: number) => Report;
  parseReports: (raw: string | null) => Report[];
  appendReport: (file: string, r: Report, fsx: typeof fs) => boolean;
  takeReports: (file: string, fsx: typeof fs) => Report[];
  worthRecording: (d: { reason: string } | null, quitting: boolean) => boolean;
  reloadDialogOptions: (reason: string) => { message: string; detail: string; buttons: string[] };
  promptReload: (win: unknown, reason: string, deps: Record<string, unknown>) => Promise<'reload' | 'quit'>;
  installCrashRecording: (deps: Record<string, unknown>) => { record: (k: string, f: Record<string, unknown>) => boolean; watchWindow: (w: unknown, o: { onGone: (d: unknown) => void }) => void; file: () => string };
};

let dir = '';
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ascent-crash-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('the crash file', () => {
  it('appends (newest MAX_REPORTS kept), hands over once, then is gone', () => {
    const file = path.join(dir, cr.FILE_NAME);
    expect(cr.takeReports(file, fs)).toEqual([]); // nothing yet: no throw
    for (let i = 0; i < cr.MAX_REPORTS + 3; i++) cr.appendReport(file, cr.makeReport('child-gone', { reason: 'crashed', exitCode: i, processType: 'GPU' }, null, 1000 + i), fs);
    const got = cr.takeReports(file, fs);
    expect(got).toHaveLength(cr.MAX_REPORTS);
    expect(got[got.length - 1]!.exitCode).toBe(cr.MAX_REPORTS + 2);
    expect(new Set(got.map((r) => r.id)).size).toBe(got.length);
    expect(fs.existsSync(file)).toBe(false);
    expect(cr.takeReports(file, fs)).toEqual([]);
  });

  it('survives a broken file and drops junk entries', () => {
    const file = path.join(dir, cr.FILE_NAME);
    fs.writeFileSync(file, '{not json');
    expect(cr.appendReport(file, cr.makeReport('main-exception', { message: 'x' }, null, 1), fs)).toBe(true);
    expect(cr.takeReports(file, fs).map((r) => r.kind)).toEqual(['main-exception']);
    expect(cr.parseReports(JSON.stringify([{ kind: 'nope', id: 'a' }, null, { kind: 'renderer-gone', id: 'b' }]))).toHaveLength(1);
  });

  it('is small and keeps the player name out of paths', () => {
    const r = cr.makeReport('main-exception', {
      message: 'm'.repeat(5000), stack: `Error\n    at C:\\Users\\kevin\\AppData\\Local\\Programs\\ascent\\resources\\app.asar\\main.cjs:1:1\n${'x'.repeat(9000)}`,
      name: undefined,
    }, null, 1);
    expect((r.message as string).length).toBe(300);
    expect((r.stack as string).length).toBe(2000);
    expect(r.stack).toContain('C:\\Users\\~\\AppData');
    expect(r.stack).not.toContain('kevin');
    expect('name' in r).toBe(false);
    expect(cr.scrubPaths('/home/kevin/x and /Users/kev/y')).toBe('/home/~/x and /Users/~/y');
    expect(() => cr.makeReport('bogus', {}, null, 1)).toThrow();
  });

  it('records a crash, not a clean exit, and nothing while the app quits', () => {
    expect(cr.worthRecording({ reason: 'crashed' }, false)).toBe(true);
    expect(cr.worthRecording({ reason: 'oom' }, false)).toBe(true);
    expect(cr.worthRecording({ reason: 'clean-exit' }, false)).toBe(false);
    expect(cr.worthRecording({ reason: 'killed' }, true)).toBe(false);
  });
});

describe('the reload prompt', () => {
  const win = (destroyed = false) => ({ isDestroyed: () => destroyed, webContents: { reload: vi.fn() } });
  it('reloads, quits, or opens a new window, and has no em dash', async () => {
    const opts = cr.reloadDialogOptions('oom');
    expect(opts.buttons).toEqual(['Reload', 'Quit']);
    expect(`${opts.message} ${opts.detail}`).not.toMatch(/\u2014|--/);
    expect(cr.reloadDialogOptions('crashed').message).toBe('The game stopped unexpectedly.');

    const w = win();
    const app = { quit: vi.fn() };
    const createWindow = vi.fn();
    expect(await cr.promptReload(w, 'crashed', { dialog: { showMessageBox: () => Promise.resolve({ response: 0 }) }, app, createWindow })).toBe('reload');
    expect(w.webContents.reload).toHaveBeenCalledTimes(1);
    expect(await cr.promptReload(w, 'crashed', { dialog: { showMessageBox: () => Promise.resolve({ response: 1 }) }, app, createWindow })).toBe('quit');
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(await cr.promptReload(win(true), 'crashed', { dialog: { showMessageBox: () => Promise.resolve({ response: 0 }) }, app, createWindow })).toBe('reload');
    expect(createWindow).toHaveBeenCalledTimes(1);
    // The dialog itself failing still reloads: never a white window with no way out.
    const w2 = win();
    expect(await cr.promptReload(w2, 'crashed', { dialog: { showMessageBox: () => Promise.reject(new Error('x')) }, app, createWindow })).toBe('reload');
    expect(w2.webContents.reload).toHaveBeenCalledTimes(1);
  });
});

describe('installCrashRecording', () => {
  function shell() {
    const app = Object.assign(new EventEmitter(), { getPath: () => dir, getVersion: () => '0.9.1' });
    const handlers = new Map<string, () => unknown>();
    const ipcMain = { handle: (ch: string, fn: () => unknown) => { handlers.set(ch, fn); } };
    const proc = Object.assign(new EventEmitter(), {
      versions: { electron: '44.2.0', chrome: '140' }, platform: 'win32', arch: 'x64', uptime: () => 12.4,
      getSystemMemoryInfo: () => ({ total: 16 * 1024 * 1024, free: 2 * 1024 * 1024 }),
    });
    const fakeOs = { release: () => '10.0.26200' };
    const rec = cr.installCrashRecording({ app, ipcMain, fs, path, os: fakeOs, process: proc, now: () => 5000 });
    return { app, proc, rec, take: () => handlers.get('ascent:take-crash-reports')!() as Report[] };
  }

  it('records each kind with the shell facts and hands them over through the IPC once', () => {
    const s = shell();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    s.app.emit('render-process-gone', {}, {}, { reason: 'oom', exitCode: -536870904 });
    s.app.emit('render-process-gone', {}, {}, { reason: 'clean-exit', exitCode: 0 });
    s.app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 3 });
    s.proc.emit('uncaughtException', new TypeError('main broke'));
    s.proc.emit('unhandledRejection', 'just a string');
    err.mockRestore();
    const got = s.take();
    expect(got.map((r) => r.kind)).toEqual(['renderer-gone', 'child-gone', 'main-exception', 'main-rejection']);
    expect(got[0]).toMatchObject({ reason: 'oom', exitCode: -536870904, app: { version: '0.9.1', electron: '44.2.0' }, os: { platform: 'win32', release: '10.0.26200' }, mem: { totalMB: 16384, freeMB: 2048 }, uptimeS: 12 });
    expect(got[1]).toMatchObject({ processType: 'GPU', reason: 'crashed' });
    expect(got[2]).toMatchObject({ name: 'TypeError', message: 'main broke' });
    expect(got[3]).toMatchObject({ message: 'just a string' });
    expect(s.take()).toEqual([]);
  });

  it('nothing is recorded once the app is quitting', () => {
    const s = shell();
    s.app.emit('before-quit');
    s.app.emit('child-process-gone', {}, { type: 'Utility', reason: 'killed', exitCode: 1 });
    expect(s.take()).toEqual([]);
  });

  it('the game window: one hang report a launch, and the reload prompt on a crash', () => {
    const s = shell();
    const win = Object.assign(new EventEmitter(), { webContents: new EventEmitter() });
    const onGone = vi.fn();
    s.rec.watchWindow(win, { onGone });
    win.emit('unresponsive'); win.emit('unresponsive');
    win.webContents.emit('render-process-gone', {}, { reason: 'clean-exit' });
    expect(onGone).not.toHaveBeenCalled();
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    expect(onGone).toHaveBeenCalledWith({ reason: 'crashed', exitCode: 1 });
    expect(s.take().map((r) => r.kind)).toEqual(['renderer-hang']);
  });
});
