// @vitest-environment jsdom
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from './renderedText.mount';
import { UpdatedPanel } from './UpdatedPanel';
import { PatchNotesBody } from './PatchNotesBody';
import type { PatchNote } from './patchNotes';
import { UpdateReadyNotice, updateNoticePlace } from './UpdateReadyNotice';
import { CHECK_HOLD_MS, STALL_MS, updateCheckLine, watchUpdateCheck } from './updateCheck';
import type { UpdateStatus } from './desktop';
import { readUpdateSeen, writeUpdateSeen } from './updateNotes';

let ui: Mounted | null = null;
type Status = { state: string; version: string | null; percent: number };
type Hooks = { isDesktop: true; quit(): void; toggleFullscreen(): void; onUpdateReady(cb: (v: string) => void): () => void; getUpdateReady?(): Promise<string | null>; getUpdateStatus?(): Promise<Status>; installUpdate?(): void };
let fire: ((v: string) => void) | null = null;
const setDesktop = (ready: string | null = null): void => {
  (globalThis as { ascentDesktop?: Hooks }).ascentDesktop = {
    isDesktop: true, quit() {}, toggleFullscreen() {},
    onUpdateReady(cb) { fire = cb; return () => { fire = null; }; },
    getUpdateReady: () => Promise.resolve(ready),
  };
};
/** The notes are a lazy chunk (~400 KB of changelog text): poll for `selector` instead of a fixed wait (up to 3 s). */
const flush = async (selector = '.pnlist > li'): Promise<void> => {
  for (let i = 0; i < 300 && !document.querySelector(selector); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
};
/** For "nothing appears" cases: a short fixed wait is enough (there is no chunk to wait for). */
const nothing = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); };

afterEach(() => {
  ui?.unmount(); ui = null; fire = null;
  (globalThis as { ascentDesktop?: unknown }).ascentDesktop = undefined;
  localStorage.clear(); document.getElementById('stage')?.remove();
});

describe('UpdatedPanel', () => {
  it('shows "Updated to v…" with the notes, and Continue records the current build', async () => {
    setDesktop();
    writeUpdateSeen({ version: '0.0.1', buildDate: '2026-01-01' });
    ui = mount(<UpdatedPanel />);
    await flush();
    const text = document.body.textContent ?? '';
    expect(text).toContain(`Updated to v${__APP_VERSION__}`);
    expect(document.querySelector('.pnlist > li')).not.toBeNull();
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Continue')!;
    act(() => { btn.click(); });
    expect(readUpdateSeen()).toEqual({ version: __APP_VERSION__, buildDate: __BUILD_DATE__.slice(0, 10) });
    expect(document.body.textContent).not.toContain('Updated to v');
  });

  it('first ever desktop launch shows nothing but records the version', async () => {
    setDesktop();
    ui = mount(<UpdatedPanel />);
    await nothing();
    expect(document.body.textContent).not.toContain('Updated to v');
    expect(readUpdateSeen()?.version).toBe(__APP_VERSION__);
  });

  it('never shows or records in the browser build', async () => {
    writeUpdateSeen({ version: '0.0.1', buildDate: '2026-01-01' });
    ui = mount(<UpdatedPanel />);
    await nothing();
    expect(document.body.textContent).not.toContain('Updated to v');
    expect(readUpdateSeen()?.version).toBe('0.0.1');
  });
});

describe('UpdatedPanel keys and tabs', () => {
  it('Escape closes the panel and never reaches a bubbling window listener (Game.tsx opens Settings on Escape)', async () => {
    setDesktop();
    writeUpdateSeen({ version: '0.0.1', buildDate: '2026-01-01' });
    ui = mount(<UpdatedPanel />);
    expect(document.body.textContent).toContain('Updated to v');
    let leaked = false;
    const bubbling = (): void => { leaked = true; };
    window.addEventListener('keydown', bubbling);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    window.removeEventListener('keydown', bubbling);
    expect(document.body.textContent).not.toContain('Updated to v');
    expect(leaked).toBe(false);
  });

  it('an update with only Systems entries opens on the Systems tab and shows an entry', async () => {
    const notes: PatchNote[] = [{ date: '2026-11-04', changes: [{ category: 'Systems', text: 'A systems change' }] }];
    ui = mount(<PatchNotesBody notes={notes} initialTab="Systems" />);
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim()).toBe('Systems');
    expect(document.querySelector('.pnlist > li')).not.toBeNull();
  });
});

/** R-UPDATE-CHECK-LOADING-01 (owner 2026-11-10): the loading screen reports the update check and offers the install. */
describe('the loading screen update line', () => {
  const st = (state: UpdateStatus['state'], version: string | null = null, percent = 0): UpdateStatus => ({ state, version, percent });
  const turn = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
  it('says the owner\'s lines for each state, and nothing when there is nothing to say', () => {
    expect(updateCheckLine(st('checking'))).toEqual({ text: 'Checking for updates…', click: false });
    expect(updateCheckLine(st('current'))).toEqual({ text: 'Your version of Ascent is up to date.', click: false });
    expect(updateCheckLine(st('downloading', '0.9.9', 42.6))).toEqual({ text: 'New version found. Downloading version 0.9.9… 43%', click: false });
    expect(updateCheckLine(st('ready', '0.9.9', 100))).toEqual({ text: 'New version found. Click here to restart and install version 0.9.9.', click: true });
    expect(updateCheckLine(st('off')).text).toBe('');
    expect(updateCheckLine(st('error')).text).toBe('');
  });
  it('follows the shell from checking to ready, and the click restarts to install exactly once', async () => {
    let status: Status = { state: 'checking', version: null, percent: 0 };
    const install = vi.fn();
    (globalThis as { ascentDesktop?: Hooks }).ascentDesktop = {
      isDesktop: true, quit() {}, toggleFullscreen() {}, onUpdateReady: () => () => {},
      getUpdateStatus: () => Promise.resolve(status), installUpdate: install,
    };
    const el = document.createElement('div');
    document.body.appendChild(el);
    vi.useFakeTimers();
    const stop = watchUpdateCheck(el);
    try {
      await turn();
      expect(el.textContent).toBe('Checking for updates…');
      el.click();
      expect(install).not.toHaveBeenCalled(); // not clickable until the download is in
      status = { state: 'ready', version: '0.9.9', percent: 100 };
      await act(async () => { vi.advanceTimersByTime(400); });
      await turn();
      expect(el.textContent).toBe('New version found. Click here to restart and install version 0.9.9.');
      expect(el.classList.contains('is-click')).toBe(true);
      expect(el.getAttribute('role')).toBe('button');
      el.click(); el.click();
      expect(install).toHaveBeenCalledTimes(1);
      expect(el.textContent).toBe('Restarting…');
    } finally { stop(); vi.useRealTimers(); el.remove(); }
  });
  it('stays empty in the browser and on a shell too old to answer', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const stop = watchUpdateCheck(el);
    await turn();
    expect(el.textContent).toBe('');
    setDesktop();
    const stop2 = watchUpdateCheck(el);
    await turn();
    expect(el.textContent).toBe('');
    stop(); stop2(); el.remove();
  });
  it('the splash has the line, Boot drives it, and the shell checks at launch', () => {
    const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
    expect(read('apps/web/index.html')).toContain('<div id="bootsplash-update" aria-live="polite"></div>');
    expect(read('packages/ui/src/Boot.tsx')).toMatch(/#bootsplash-update[\s\S]{0,200}watchUpdateCheck\(line, /);
  });

  // R-UPDATE-HOLD-LOADING-01 (owner 2026-11-10): the loading screen waits while a found update downloads.
  const hold = (first: Status): { set(s: Status): void; released: () => number; el: HTMLElement; skip: HTMLElement; stop(): void; step(ms: number): Promise<void> } => {
    let status = first;
    (globalThis as { ascentDesktop?: Hooks }).ascentDesktop = {
      isDesktop: true, quit() {}, toggleFullscreen() {}, onUpdateReady: () => () => {},
      getUpdateStatus: () => Promise.resolve(status), installUpdate() {},
    };
    const el = document.createElement('div');
    const skip = document.createElement('div');
    document.body.append(el, skip);
    let n = 0;
    vi.useFakeTimers();
    const stop = watchUpdateCheck(el, () => { n++; }, skip);
    return {
      set(s) { status = s; }, released: () => n, el, skip,
      stop() { stop(); vi.useRealTimers(); el.remove(); skip.remove(); },
      async step(ms) { await act(async () => { vi.advanceTimersByTime(ms); }); await turn(); },
    };
  };
  it('R-UPDATE-HOLD-LOADING-01: up to date, off and a failed check let the game open at once', async () => {
    for (const state of ['current', 'off', 'error']) {
      const h = hold({ state, version: null, percent: 0 });
      try { await turn(); expect(h.released()).toBe(1); } finally { h.stop(); }
    }
  });
  it('R-UPDATE-HOLD-LOADING-01: holds while downloading and on the downloaded line; "Not now" lets go', async () => {
    const h = hold({ state: 'checking', version: null, percent: 0 });
    try {
      await turn();
      expect(h.released()).toBe(0);
      h.set({ state: 'downloading', version: '0.9.9', percent: 10 });
      await h.step(400);
      h.set({ state: 'downloading', version: '0.9.9', percent: 60 });
      await h.step(30_000);
      expect(h.released()).toBe(0);
      expect(h.skip.classList.contains('is-on')).toBe(false);
      h.set({ state: 'ready', version: '0.9.9', percent: 100 });
      await h.step(400);
      expect(h.released()).toBe(0);
      expect(h.skip.classList.contains('is-on')).toBe(true);
      h.skip.click(); h.skip.click();
      expect(h.released()).toBe(1);
      expect(h.skip.classList.contains('is-on')).toBe(false);
    } finally { h.stop(); }
  });
  it('R-UPDATE-HOLD-LOADING-01: a check that never answers, or a download that stops moving, never traps the player', async () => {
    let h = hold({ state: 'checking', version: null, percent: 0 });
    try {
      await turn();
      await h.step(CHECK_HOLD_MS - 500);
      expect(h.released()).toBe(0);
      await h.step(1000);
      expect(h.released()).toBe(1);
    } finally { h.stop(); }
    h = hold({ state: 'downloading', version: '0.9.9', percent: 12 });
    try {
      await turn();
      await h.step(STALL_MS - 1000);
      expect(h.released()).toBe(0);
      await h.step(2000);
      expect(h.released()).toBe(1);
    } finally { h.stop(); }
  });
  it('R-UPDATE-CHECK-LOADING-01: the download has its own bar, shown only while downloading and filled to the percent', async () => {
    let status: Status = { state: 'checking', version: null, percent: 0 };
    (globalThis as { ascentDesktop?: Hooks }).ascentDesktop = {
      isDesktop: true, quit() {}, toggleFullscreen() {}, onUpdateReady: () => () => {},
      getUpdateStatus: () => Promise.resolve(status), installUpdate() {},
    };
    const el = document.createElement('div');
    const bar = document.createElement('div');
    const fill = bar.appendChild(document.createElement('i'));
    document.body.append(el, bar);
    vi.useFakeTimers();
    const stop = watchUpdateCheck(el, () => {}, null, bar);
    try {
      await turn();
      expect(bar.classList.contains('is-on')).toBe(false);
      status = { state: 'downloading', version: '0.9.9', percent: 43 };
      await act(async () => { vi.advanceTimersByTime(400); });
      await turn();
      expect(bar.classList.contains('is-on')).toBe(true);
      expect(fill.style.transform).toBe('scaleX(0.4300)');
      status = { state: 'ready', version: '0.9.9', percent: 100 };
      await act(async () => { vi.advanceTimersByTime(400); });
      await turn();
      expect(bar.classList.contains('is-on')).toBe(false);
    } finally { stop(); vi.useRealTimers(); el.remove(); bar.remove(); }
    expect(readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8')).toContain('<div id="bootsplash-dl" aria-hidden="true"><i></i></div>');
  });
  it('R-UPDATE-HOLD-LOADING-01: Boot opens the game only when the art is loaded AND the update check has let go', () => {
    const boot = readFileSync(resolve(process.cwd(), 'packages/ui/src/Boot.tsx'), 'utf8');
    expect(boot).toContain('const ready = artReady && updateOk;');
    expect(boot).toMatch(/if \(!line\) \{ setUpdateOk\(true\); return undefined; \}/);
    expect(readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8')).toContain('<div id="bootsplash-skip" role="button" tabindex="0">Not now</div>');
  });
  it('the notice under START carries the same click when the shell can install', () => {
    setDesktop();
    const install = vi.fn();
    (globalThis as { ascentDesktop?: Hooks }).ascentDesktop!.installUpdate = install;
    ui = mount(<UpdateReadyNotice />);
    act(() => { fire!('0.9.9'); });
    const n = document.querySelector<HTMLElement>('.updnotice')!;
    expect(n.textContent).toBe('Update v0.9.9 downloaded. Click here to restart and install it.');
    expect(n.classList.contains('can-click')).toBe(true);
    act(() => { n.click(); });
    expect(install).toHaveBeenCalledTimes(1);
  });
});

describe('UpdateReadyNotice', () => {
  it('appears when the shell reports a downloaded update; on a shell that cannot install now it is information only', async () => {
    setDesktop();
    ui = mount(<UpdateReadyNotice />);
    expect(document.body.textContent).not.toContain('downloaded');
    act(() => { fire!('0.9.9'); });
    expect(document.body.textContent).toContain('Update v0.9.9 downloaded. It installs next time you start Ascent.');
    expect(document.querySelector('.updnotice button')).toBeNull();
  });
  it('renders nothing in the browser', () => {
    ui = mount(<UpdateReadyNotice />);
    expect(document.querySelector('.updnotice')).toBeNull();
  });
  // R-UPDATE-NOTICE-SEEN-01 (owner 2026-11-09: the notice never showed). The push fired during the loading screen, before
  // anything listened; the notice now asks the shell when it mounts, and never fades on its own.
  it('R-UPDATE-NOTICE-SEEN-01: shows an update downloaded before it mounted (the missed push)', async () => {
    setDesktop('0.9.8');
    ui = mount(<UpdateReadyNotice />);
    await act(async () => { await Promise.resolve(); });
    expect(document.body.textContent).toContain('Update v0.9.8 downloaded.');
  });
  it('R-UPDATE-NOTICE-SEEN-01: stays up instead of fading after a few seconds', async () => {
    setDesktop();
    ui = mount(<UpdateReadyNotice />);
    act(() => { fire!('0.9.9'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    vi.useFakeTimers();
    try { act(() => { vi.advanceTimersByTime(120_000); }); } finally { vi.useRealTimers(); }
    expect(document.querySelector('.updnotice')).not.toBeNull();
  });
  it('R-UPDATE-NOTICE-SEEN-01: lives on the main screen beside START, not app-wide', () => {
    const ph = readFileSync(resolve(process.cwd(), 'packages/ui/src/partyHome/PartyHome.tsx'), 'utf8');
    const game = readFileSync(resolve(process.cwd(), 'packages/ui/src/Game.tsx'), 'utf8');
    expect(ph).toMatch(/className="ph-start"[\s\S]{0,900}<UpdateReadyNotice \/>/);
    expect(game).not.toContain('<UpdateReadyNotice');
  });
});

/** R-UPDATE-NOTICE-PLACE-01 (owner 2026-11-08): under START, centred on it, kept on screen; top centre without START. */
describe('UpdateReadyNotice placement', () => {
  it('centres on START and sits just under it', () => {
    expect(updateNoticePlace({ left: 200, width: 384, bottom: 900 }, { height: 52 }, 1080)).toEqual({ left: 392, top: 914 });
  });
  it('stays on screen when START is near the bottom', () => {
    expect(updateNoticePlace({ left: 200, width: 384, bottom: 1050 }, { height: 52 }, 1080)).toEqual({ left: 392, top: 1016 });
  });
  it('keeps the top-centre default when there is no START', () => {
    expect(updateNoticePlace(null, { height: 52 }, 1080)).toBeNull();
  });
  it('hangs under START on the main screen, top centre elsewhere', () => {
    setDesktop();
    ui = mount(<UpdateReadyNotice />);
    act(() => { fire!('0.9.9'); });
    expect(document.querySelector('.updnotice')?.classList.contains('under-start')).toBe(false);
    ui.unmount(); ui = null;
    const start = document.createElement('button');
    start.className = 'ph-start';
    document.body.appendChild(start);
    try {
      setDesktop();
      ui = mount(<UpdateReadyNotice />);
      act(() => { fire!('0.9.9'); });
      expect(document.querySelector('.updnotice')?.classList.contains('under-start')).toBe(true);
    } finally { start.remove(); }
  });
});
