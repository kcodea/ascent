import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Marker = { version: string; attempts?: number } | null;
const updater = createRequire(import.meta.url)('./updater.cjs') as {
  isNewer: (a: string, b: string) => boolean;
  decideLaunch: (marker: Marker, current: string, skip?: { version: string } | null) => 'install' | 'boot';
  updatesAllowed: (o: { isPackaged: boolean; env: Record<string, string | undefined>; hasUpdateConfig: boolean }) => boolean;
  startUpdater: (deps: Record<string, unknown>) => Promise<void>;
};

describe('isNewer (semver a > b)', () => {
  it('orders patch, equal, pre-release and multi-digit parts', () => {
    expect(updater.isNewer('0.2.1', '0.2.0')).toBe(true);
    expect(updater.isNewer('0.2.0', '0.2.0')).toBe(false);
    expect(updater.isNewer('0.2.0', '0.2.0-test.1')).toBe(true);
    expect(updater.isNewer('0.2.0-test.1', '0.2.0')).toBe(false);
    expect(updater.isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(updater.isNewer('0.2.0-test.10', '0.2.0-test.9')).toBe(true);
    expect(updater.isNewer('v0.3.0', '0.2.9')).toBe(true);
    expect(updater.isNewer('garbage', '0.2.0')).toBe(false);
  });
});

describe('decideLaunch', () => {
  it('decideLaunch_ignoresStaleMarker', () => {
    expect(updater.decideLaunch({ version: '0.2.0' }, '0.2.0')).toBe('boot');
    expect(updater.decideLaunch({ version: '0.1.9' }, '0.2.0')).toBe('boot');
  });
  it('installs only a newer pending version', () => {
    expect(updater.decideLaunch({ version: '0.2.1' }, '0.2.0')).toBe('install');
    expect(updater.decideLaunch(null, '0.2.0')).toBe('boot');
  });
  it('allows one retry, then drops a marker whose install attempts ran out', () => {
    expect(updater.decideLaunch({ version: '0.2.1', attempts: 1 }, '0.2.0')).toBe('install');
    expect(updater.decideLaunch({ version: '0.2.1', attempts: 2 }, '0.2.0')).toBe('boot');
    expect(updater.decideLaunch({ version: '0.2.1', attempts: 2 }, '0.2.1')).toBe('boot');
  });
  it('never installs a skipped version; a strictly newer one installs; a garbage skip skips nothing', () => {
    expect(updater.decideLaunch({ version: '0.2.1' }, '0.2.0', { version: '0.2.1' })).toBe('boot');
    expect(updater.decideLaunch({ version: '0.2.2' }, '0.2.0', { version: '0.2.1' })).toBe('install');
    expect(updater.decideLaunch({ version: '0.2.1' }, '0.2.0', { version: 'garbage' })).toBe('install');
    expect(updater.decideLaunch({ version: '0.2.1' }, '0.2.0', null)).toBe('install');
  });
});

describe('updatesAllowed (the R8 gate)', () => {
  const base = { isPackaged: true, env: {}, hasUpdateConfig: true };
  it('runs only for a packaged NSIS install outside smoke with no opt-out', () => {
    expect(updater.updatesAllowed(base)).toBe(true);
    expect(updater.updatesAllowed({ ...base, isPackaged: false })).toBe(false);
    expect(updater.updatesAllowed({ ...base, env: { ASCENT_SMOKE: '1' } })).toBe(false);
    expect(updater.updatesAllowed({ ...base, env: { ASCENT_NO_UPDATE: '1' } })).toBe(false);
    // The hand-packaged zip exe has no resources/app-update.yml and must never self-update.
    expect(updater.updatesAllowed({ ...base, hasUpdateConfig: false })).toBe(false);
  });
});

// ── startUpdater with every side effect faked ─────────────────────────────────────────────────────────
const USER_DATA = path.join('/fake', 'userData');
const RESOURCES = path.join('/fake', 'resources');
const MARKER = path.join(USER_DATA, 'pending-update.json');
const SKIP = path.join(USER_DATA, 'skipped-update.json');

function harness(opts: { marker?: Marker; version?: string; env?: Record<string, string>; files?: Map<string, string> } = {}) {
  const files = opts.files ?? new Map<string, string>();
  files.set(path.join(RESOURCES, 'app-update.yml'), 'provider: generic\n');
  if (opts.marker) files.set(MARKER, JSON.stringify(opts.marker));
  const fs = {
    existsSync: (p: string) => files.has(p),
    readFileSync: (p: string) => { const v = files.get(p); if (v == null) throw new Error('ENOENT'); return v; },
    writeFileSync: (p: string, v: string) => void files.set(p, v),
    rmSync: (p: string) => void files.delete(p),
    appendFileSync: () => {},
  };
  const sent: Array<[string, unknown]> = [];
  const gameSent: Array<[string, unknown]> = [];
  const windows: FakeWindow[] = [];
  class FakeWindow {
    destroyed = false;
    url = '';
    webContents = { send: (ch: string, payload: unknown) => sent.push([ch, payload]), on: () => {} };
    constructor(public options: unknown) { windows.push(this); }
    loadFile(file: string, o?: { query?: Record<string, string> }) { this.url = `${file}?v=${o?.query?.v}`; return Promise.resolve(); }
    once() {}
    show() {}
    close() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
  }
  const gameWin = { webContents: { send: (ch: string, payload: unknown) => gameSent.push([ch, payload]) }, isDestroyed: () => false };
  const createGameWindow = vi.fn(() => gameWin);
  const au = Object.assign(new EventEmitter(), {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    logger: null as unknown,
    checkForUpdates: vi.fn(() => new Promise(() => {})), // never settles: offline-ish
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
  });
  const app = { isPackaged: true, getVersion: () => opts.version ?? '0.2.0', getPath: () => USER_DATA };
  const deps = {
    app, BrowserWindow: FakeWindow, createGameWindow, autoUpdater: au, fs,
    env: opts.env ?? {}, resourcesPath: RESOURCES, windowOptions: { show: false }, updatingHtml: '/build/updating.html',
  };
  return { deps, files, sent, gameSent, windows, createGameWindow, au };
}

describe('startUpdater', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('launchPlan_timesOutToBoot', async () => {
    const h = harness({ marker: { version: '0.2.1' } });
    await updater.startUpdater(h.deps);
    expect(h.createGameWindow).not.toHaveBeenCalled();
    expect(h.windows).toHaveLength(1);
    expect(h.windows[0].url).toBe('/build/updating.html?v=0.2.1');
    expect(h.au.checkForUpdates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(59_999);
    expect(h.createGameWindow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.createGameWindow).toHaveBeenCalledTimes(1);
    expect(h.files.has(MARKER)).toBe(false);
    expect(h.windows[0].isDestroyed()).toBe(true);
    // A late error after giving up changes nothing.
    h.au.emit('error', new Error('late'));
    expect(h.au.quitAndInstall).not.toHaveBeenCalled();
    expect(h.createGameWindow).toHaveBeenCalledTimes(1);
  });

  it('install: forwards progress and installs silently on download', async () => {
    const h = harness({ marker: { version: '0.2.1' } });
    await updater.startUpdater(h.deps);
    expect(h.au.autoDownload).toBe(true);
    expect(h.au.autoInstallOnAppQuit).toBe(false);
    h.au.emit('download-progress', { percent: 42.5 });
    expect(h.sent).toEqual([['ascent:update-progress', { percent: 42.5 }]]);
    h.au.emit('update-downloaded', { version: '0.2.1' });
    // The attempt is recorded BEFORE quitting, so a failure after the app is gone is visible next launch.
    expect(JSON.parse(h.files.get(MARKER)!)).toEqual({ version: '0.2.1', attempts: 1 });
    vi.advanceTimersByTime(1);
    expect(h.au.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(h.createGameWindow).not.toHaveBeenCalled();
  });

  // electron-updater 6.x's real failure modes: quitAndInstall never throws.
  it('install: quitAndInstall that emits error and returns (BaseUpdater.install) boots the game', async () => {
    const h = harness({ marker: { version: '0.2.1' } });
    h.au.quitAndInstall.mockImplementation(() => { h.au.emit('error', new Error("No update filepath provided, can't quit and install")); return false; });
    await updater.startUpdater(h.deps);
    h.au.emit('update-downloaded', { version: '0.2.1' });
    vi.advanceTimersByTime(1);
    expect(h.au.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(h.createGameWindow).toHaveBeenCalledTimes(1);
    expect(h.windows[0].isDestroyed()).toBe(true);
    expect(h.files.has(MARKER)).toBe(false);
    vi.advanceTimersByTime(120_000); // neither the watchdog nor the old timeout opens a second game
    expect(h.createGameWindow).toHaveBeenCalledTimes(1);
  });

  it('install: quitAndInstall that returns without quitting → the 15 s watchdog boots the game', async () => {
    const h = harness({ marker: { version: '0.2.1' } });
    h.au.quitAndInstall.mockImplementation(() => true); // "spawned", but the app never quits
    await updater.startUpdater(h.deps);
    h.au.emit('update-downloaded', { version: '0.2.1' });
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(14_998);
    expect(h.createGameWindow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(h.createGameWindow).toHaveBeenCalledTimes(1);
    expect(h.windows[0].isDestroyed()).toBe(true);
  });

  it('a launch that finds an already-attempted marker boots and clears it', async () => {
    const h = harness({ marker: { version: '0.2.1', attempts: 2 } });
    await updater.startUpdater(h.deps);
    expect(h.createGameWindow).toHaveBeenCalledTimes(1);
    expect(h.windows).toHaveLength(0);
    expect(h.files.has(MARKER)).toBe(false);
    expect(h.au.quitAndInstall).not.toHaveBeenCalled();
  });

  it('a second launch after an installer that failed post-quit retries once, then boots', async () => {
    const a = harness({ marker: { version: '0.2.1', attempts: 1 } });
    await updater.startUpdater(a.deps);
    expect(a.windows).toHaveLength(1); // the one retry
    a.au.emit('update-downloaded', { version: '0.2.1' });
    expect(JSON.parse(a.files.get(MARKER)!)).toEqual({ version: '0.2.1', attempts: 2 });
  });

  it('install: update-not-available boots the game at once', async () => {
    const h = harness({ marker: { version: '0.2.1' } });
    await updater.startUpdater(h.deps);
    h.au.emit('update-not-available', { version: '0.2.0' });
    expect(h.createGameWindow).toHaveBeenCalledTimes(1);
    expect(h.files.has(MARKER)).toBe(false);
    expect(h.windows[0].isDestroyed()).toBe(true);
  });

  it('install: a download that outlives the timeout is still recorded for next launch', async () => {
    const h = harness({ marker: { version: '0.2.1' } });
    await updater.startUpdater(h.deps);
    vi.advanceTimersByTime(60_000);
    expect(h.createGameWindow).toHaveBeenCalledTimes(1);
    h.au.emit('update-downloaded', { version: '0.2.1' });
    expect(h.au.quitAndInstall).not.toHaveBeenCalled();
    expect(JSON.parse(h.files.get(MARKER)!)).toEqual({ version: '0.2.1' });
    expect(h.gameSent).toEqual([['ascent:update-ready', { version: '0.2.1' }]]);
  });

  it('install: an error falls back to the game at once', async () => {
    const h = harness({ marker: { version: '0.2.1' } });
    await updater.startUpdater(h.deps);
    h.au.emit('error', new Error('offline'));
    expect(h.createGameWindow).toHaveBeenCalledTimes(1);
    expect(h.files.has(MARKER)).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(h.createGameWindow).toHaveBeenCalledTimes(1);
  });

  it('boot: clears a stale marker, opens the game, checks 10 s later, then marks + notifies', async () => {
    const h = harness({ marker: { version: '0.2.0' } });
    await updater.startUpdater(h.deps);
    expect(h.createGameWindow).toHaveBeenCalledTimes(1);
    expect(h.files.has(MARKER)).toBe(false);
    expect(h.au.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(h.au.checkForUpdates).toHaveBeenCalledTimes(1);
    h.au.emit('update-downloaded', { version: '0.2.1' });
    expect(JSON.parse(h.files.get(MARKER)!)).toEqual({ version: '0.2.1' });
    expect(h.gameSent).toEqual([['ascent:update-ready', { version: '0.2.1' }]]);
    expect(h.au.quitAndInstall).not.toHaveBeenCalled();
  });

  it('R11: the launch after two failed tries boots, skips that version, and stays booted', async () => {
    const files = new Map<string, string>();
    // Launch 3: the marker has used both attempts.
    const l3 = harness({ marker: { version: '0.2.1', attempts: 2 }, files });
    await updater.startUpdater(l3.deps);
    expect(l3.windows).toHaveLength(0);
    expect(l3.createGameWindow).toHaveBeenCalledTimes(1);
    expect(files.has(MARKER)).toBe(false);
    expect(JSON.parse(files.get(SKIP)!)).toEqual({ version: '0.2.1' });
    vi.advanceTimersByTime(10_000);
    l3.au.emit('update-downloaded', { version: '0.2.1' }); // the feed still serves 0.2.1
    expect(files.has(MARKER)).toBe(false);
    expect(l3.gameSent).toEqual([]);
    // Launches 4 and 5 against the same feed: plain boots, no installing screen, no marker.
    for (let i = 0; i < 2; i++) {
      const l = harness({ files });
      await updater.startUpdater(l.deps);
      expect(l.windows).toHaveLength(0);
      expect(l.createGameWindow).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(10_000);
      l.au.emit('update-downloaded', { version: '0.2.1' });
      expect(files.has(MARKER)).toBe(false);
      expect(l.gameSent).toEqual([]);
      expect(l.au.quitAndInstall).not.toHaveBeenCalled();
    }
  });

  it('R11: a strictly newer version clears the skip and is marked', async () => {
    const files = new Map<string, string>([[SKIP, JSON.stringify({ version: '0.2.1' })]]);
    const h = harness({ files });
    await updater.startUpdater(h.deps);
    vi.advanceTimersByTime(10_000);
    h.au.emit('update-downloaded', { version: '0.2.2' });
    expect(JSON.parse(files.get(MARKER)!)).toEqual({ version: '0.2.2' });
    expect(files.has(SKIP)).toBe(false);
    expect(h.gameSent).toEqual([['ascent:update-ready', { version: '0.2.2' }]]);
    // ...and the next launch installs it.
    const next = harness({ files });
    await updater.startUpdater(next.deps);
    expect(next.windows).toHaveLength(1);
  });

  it('R11: a garbage skip file skips nothing', async () => {
    const files = new Map<string, string>([[SKIP, '{not json']]);
    const h = harness({ files });
    await updater.startUpdater(h.deps);
    vi.advanceTimersByTime(10_000);
    h.au.emit('update-downloaded', { version: '0.2.1' });
    expect(JSON.parse(files.get(MARKER)!)).toEqual({ version: '0.2.1' });
  });

  it('ASCENT_UPDATE_URL overrides the feed with a generic provider', async () => {
    const h = harness({ env: { ASCENT_UPDATE_URL: 'https://example.com/dl' } });
    await updater.startUpdater(h.deps);
    expect(h.au.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'https://example.com/dl' });
  });

  it('off (no app-update.yml): just opens the game and never touches the updater', async () => {
    const h = harness({ marker: { version: '9.9.9' } });
    h.files.delete(path.join(RESOURCES, 'app-update.yml'));
    await updater.startUpdater(h.deps);
    expect(h.createGameWindow).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120_000);
    expect(h.au.checkForUpdates).not.toHaveBeenCalled();
    expect(h.windows).toHaveLength(0);
  });
});
