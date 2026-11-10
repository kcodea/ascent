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
import { readUpdateSeen, writeUpdateSeen } from './updateNotes';

let ui: Mounted | null = null;
type Hooks = { isDesktop: true; quit(): void; toggleFullscreen(): void; onUpdateReady(cb: (v: string) => void): () => void; getUpdateReady?(): Promise<string | null> };
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

describe('UpdateReadyNotice', () => {
  it('appears when the shell reports a downloaded update, and has no button', async () => {
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
