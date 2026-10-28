// @vitest-environment jsdom
/**
 * COMING BACK TO THE GAME NEVER SHOWS AN ERROR CODE (R-PHONE-RESUME-01, owner 2026-10-27 on his iPhone: "seems to be an
 * issue with minimizing the game and coming back. it shows an error. is there a way to fix this or clean it up so you
 * just press continue without an error code there or something?").
 *
 *  - A passing render crash (one throw) is retried silently: the game comes back, nothing is shown.
 *  - A crash that comes straight back shows "Game paused" with one Continue and no error text outside "Details".
 *  - A code-split chunk whose first fetch fails (iOS waking the page) is fetched again before anything throws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
// A Home Screen app whose last session crashed, set before crashLog.ts starts (it folds the stored log at import).
vi.hoisted(() => {
  Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
  localStorage.setItem('ascent.crashlog.v1', JSON.stringify({ crashes: [{ id: 'x', at: 1, clean: false, crumbs: [{ s: 'resumed', t: 1 }] }] }));
});
// A phone (the crash log records, and the old readout rule auto-showed in a Home Screen app).
vi.mock('./phoneArt', async (orig) => ({ ...(await orig<typeof import('./phoneArt')>()), LITE_ART: true }));

import { continueAction, crashResponse, ErrorBoundary, RECRASH_MS } from './ErrorBoundary';
import { retryImport } from './retryImport';
import { crashedSessions, crashReadoutWanted } from './crashLog';
import { mount, type Mounted } from './renderedText.mount';
import { useGame } from './store';
import { turnClock } from './turnClock';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); });

const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };

describe('the error boundary on a crash', () => {
  it('decides: retry silently first, show only a crash that comes straight back', () => {
    expect(crashResponse(1_000_000, null)).toBe('retry');
    expect(crashResponse(1_000_000, 1_000_000 - 2000)).toBe('show');
    expect(crashResponse(1_000_000, 1_000_000 - RECRASH_MS - 1)).toBe('retry');
    expect(continueAction(1_000_000, 1_000_000 - 2000)).toBe('reload');
    expect(continueAction(1_000_000, null)).toBe('remount');
  });

  it('a passing crash comes back without any screen', async () => {
    let throwing = true; // until the boundary catches it (React re-renders a failed component once by itself)
    const spy = vi.spyOn(console, 'error').mockImplementation((m: unknown) => { if (String(m).startsWith('Game crashed')) throwing = false; });
    function Flaky(): JSX.Element {
      if (throwing) throw new Error('TypeError: Load failed');
      return <div className="board-ok">board</div>;
    }
    ui = mount(<ErrorBoundary><Flaky /></ErrorBoundary>);
    await flush();
    expect(document.querySelector('.board-ok')).not.toBeNull();
    expect(document.querySelector('.crashscreen')).toBeNull();
    spy.mockRestore();
  });

  it('a silent remount in the Shop keeps the seconds showing (never a fresh full clock)', async () => {
    let throwing = true;
    const spy = vi.spyOn(console, 'error').mockImplementation((m: unknown) => { if (String(m).startsWith('Game crashed')) throwing = false; });
    const later = Date.now() + 60_000; // well past the previous test's retry
    const now = vi.spyOn(Date, 'now').mockReturnValue(later);
    const run = useGame.getState().run;
    useGame.setState({ showTitle: false, run: { ...run, phase: 'recruit', mode: run.mode === 'versus' ? 'lobby' : run.mode } as typeof run, pendingResumeSeconds: null });
    turnClock.set(17);
    function Flaky(): JSX.Element { if (throwing) throw new Error('x'); return <div className="board-ok" />; }
    ui = mount(<ErrorBoundary><Flaky /></ErrorBoundary>);
    await flush();
    expect(document.querySelector('.board-ok')).not.toBeNull();
    expect(useGame.getState().pendingResumeSeconds).toBe(17);
    useGame.setState({ showTitle: true, pendingResumeSeconds: null });
    now.mockRestore();
    spy.mockRestore();
  });

  it('a crash that keeps coming shows "Game paused" with Continue and no error text in view', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Broken(): JSX.Element { throw new Error('Cannot read properties of undefined (reading x)'); }
    ui = mount(<ErrorBoundary><Broken /></ErrorBoundary>);
    await flush();
    const screen = document.querySelector('.crashscreen') as HTMLElement;
    expect(screen).not.toBeNull();
    expect(screen.querySelector('h1')!.textContent).toBe('Game paused');
    const buttons = [...screen.querySelectorAll('.crashbtns button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Continue']);
    // The error text lives only inside the collapsed Details.
    const outside = [...screen.children].filter((c) => c.tagName !== 'DETAILS').map((c) => c.textContent).join(' ');
    expect(outside).not.toMatch(/undefined|Error|reading/);
    expect((screen.querySelector('details') as HTMLDetailsElement).open).toBe(false);
    spy.mockRestore();
  });
});

describe('retryImport', () => {
  it('a chunk whose first fetches fail is fetched again', async () => {
    let n = 0;
    const load = (): Promise<string> => (++n < 3 ? Promise.reject(new TypeError('Load failed')) : Promise.resolve('chunk'));
    await expect(retryImport(load, 4, 1)).resolves.toBe('chunk');
    expect(n).toBe(3);
  });

  it('gives up after its tries with the real error', async () => {
    const load = (): Promise<string> => Promise.reject(new TypeError('Load failed'));
    await expect(retryImport(load, 2, 1)).rejects.toThrow('Load failed');
  });
});

describe('the crash readout after a crash', () => {
  it('never shows by itself, even in a Home Screen app with a crash on record (it still needs ?crashlog=1)', () => {
    expect(crashedSessions().length).toBeGreaterThan(0); // a crash is still on record (and uploads)
    expect(crashReadoutWanted()).toBe(false);
    window.history.replaceState(null, '', '/?crashlog=1');
    expect(crashReadoutWanted()).toBe(true);
    window.history.replaceState(null, '', '/?crashlog=0');
    expect(crashReadoutWanted()).toBe(false);
  });
});
