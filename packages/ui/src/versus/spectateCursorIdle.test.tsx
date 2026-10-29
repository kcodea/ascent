// @vitest-environment jsdom
/**
 * R-SPECTATE-CURSOR-IDLE-01 (owner 2026-10-29: "can we make it so the a spectated player's mouse doesnt go invisible
 * when it isnt moving?"). The stands (live spectate, Versus / Duos spectating, a replay's Cursor) keep drawing the
 * watched hand where it RESTS: the player's still hand sends nothing (no keep-alive), and the overlay's frame loop going
 * to sleep never hides it. Only a hide (their tab went to the background, or their mouse left the game window) or the
 * end of the stream takes it away. The sender side is pinned in `spectateLive.test.ts` / `streamParity.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sp = await import('./spectate');
const { SpectatorCursor, STALE_MS } = await import('./SpectatorCursor');

/** Animation frames run only when the test steps them (the overlay loops on its own otherwise). */
let rafQ: FrameRequestCallback[] = [];
const stepFrames = (n = 3): void => {
  for (let i = 0; i < n; i++) { const q = rafQ; rafQ = []; act(() => { for (const f of q) f(performance.now()); }); }
};
let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { rafQ.push(f); return rafQ.length; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  rafQ = [];
  sp.resetCursorFeed();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const hand = (): HTMLElement => host.querySelector<HTMLElement>('.vsspec-cursor .ghostmover:not(.vsspec-cardmover)')!;

describe('R-SPECTATE-CURSOR-IDLE-01: a resting hand stays drawn', () => {
  it('stays visible where it stopped long after the last message; a hide (tab / left the window) takes it away', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<SpectatorCursor />));

    const t0 = performance.now();
    act(() => sp.ingestCursor({ x: 0.5, y: 0.5, gx: 0.5, gy: 0.5, ts: t0 }, performance.now()));
    vi.advanceTimersByTime(300);
    stepFrames();
    expect(hand().style.opacity).toBe('1');
    const where = hand().style.transform;
    expect(where).toContain('translate3d');

    // The player's hand rests: nothing more arrives. Well past the loop's sleep, it is still drawn, in the same spot.
    vi.advanceTimersByTime(STALE_MS * 5);
    stepFrames();
    expect(rafQ).toHaveLength(0); // the loop sleeps (no per-frame cost while the hand rests)
    vi.advanceTimersByTime(30_000);
    stepFrames();
    expect(hand().style.opacity).toBe('1');
    expect(hand().style.transform).toBe(where);

    // The player's mouse leaves the game window (or their tab goes to the background): one hide, and it goes.
    act(() => sp.ingestCursor({ x: 0, y: 0, hide: true, ts: performance.now() }, performance.now()));
    vi.advanceTimersByTime(400);
    stepFrames(4);
    expect(hand().style.opacity).toBe('0');
  });

  it('the end of the stream takes the resting hand away', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<SpectatorCursor />));
    // A replay's recorded hand (the same feed), resting.
    act(() => sp.ingestCursor({ gx: 0.5, gy: 0.5, ts: performance.now() }, performance.now(), true));
    stepFrames();
    vi.advanceTimersByTime(STALE_MS * 3);
    stepFrames();
    expect(hand().style.opacity).toBe('1');
    act(() => sp.resetCursorFeed());
    expect(hand().style.opacity).toBe('0');
  });
});
