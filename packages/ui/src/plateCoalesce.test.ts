// @vitest-environment jsdom
/**
 * R-PERF-COALESCE-DUST-01 (owner 2026-10-27: "draw dust at 120 and cap it to 3 concurrent. the remaining should still
 * get the coalesce effect"). A late-game Ale engine generates many cards at once; at most three coalesces draw their
 * dust motes, any more still play the wireframe and resolve into the card, and the dust draws at most 120 times a
 * second, with the trail smear per elapsed time so the look holds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DUST_FPS, MAX_CONCURRENT_DUST, playPlateCoalesce, plateCoalesceDustLive } from './plateCoalesce';

const RECT = { left: 100, top: 100, width: 120, height: 170 };
let frames: FrameRequestCallback[] = [];
let drawCalls = 0;

beforeEach(() => {
  frames = [];
  drawCalls = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  // jsdom has no 2D canvas: a stub context that counts the per-frame clears (one per dust draw).
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return {
      globalCompositeOperation: '', globalAlpha: 1, fillStyle: '',
      fillRect: () => { drawCalls++; }, drawImage: () => {},
      // the mote sprites (plateFx `sprite`), built once on first use
      createRadialGradient: () => ({ addColorStop: () => {} }), beginPath: () => {}, arc: () => {}, fill: () => {},
    } as unknown as CanvasRenderingContext2D;
  } as never);
});
afterEach(() => {
  // Run every effect to its end so the dust count is back to 0 for the next test.
  for (let t = 0; t < 4000 && frames.length; t += 4) runFrame(performance.now() + 10_000);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function runFrame(now: number): void {
  const pending = frames; frames = [];
  for (const cb of pending) cb(now);
}

const card = (): HTMLElement => { const el = document.createElement('div'); el.className = 'card'; document.body.appendChild(el); return el; };

describe('plate coalesce dust budget (R-PERF-COALESCE-DUST-01)', () => {
  it('draws dust for at most three coalesces at once; the rest still play the wireframe and hide the card', () => {
    const targets = Array.from({ length: 5 }, card);
    for (const t of targets) playPlateCoalesce(RECT, t);
    expect(plateCoalesceDustLive()).toBe(MAX_CONCURRENT_DUST);
    expect(document.querySelectorAll('canvas')).toHaveLength(3);
    // Every one of the five still runs the rest of the effect: a wireframe overlay each, and its card held hidden.
    const overlays = [...document.querySelectorAll<HTMLElement>('#stage > div')].filter((d) => d.style.position === 'fixed');
    expect(overlays).toHaveLength(5);
    for (const t of targets) expect(t.style.getPropertyValue('opacity')).toBe('0');
  });

  it('frees a dust slot when a coalesce finishes', () => {
    for (let i = 0; i < 3; i++) playPlateCoalesce(RECT, card());
    expect(plateCoalesceDustLive()).toBe(3);
    runFrame(performance.now() + 10_000); // past the whole effect: every one finishes
    expect(plateCoalesceDustLive()).toBe(0);
    playPlateCoalesce(RECT, card());
    expect(plateCoalesceDustLive()).toBe(1);
  });

  it('draws the dust at most DUST_FPS times a second however fast the display runs', () => {
    playPlateCoalesce(RECT, card());
    const t0 = performance.now();
    const frameMs = 1000 / 360; // the owner's 360 Hz panel
    for (let i = 0; i < 90; i++) runFrame(t0 + i * frameMs); // a quarter of a second
    expect(DUST_FPS).toBe(120);
    expect(drawCalls).toBeGreaterThanOrEqual(28); // ~30 draws in 250 ms at 120 a second
    expect(drawCalls).toBeLessThanOrEqual(32); // never once per 360 Hz frame (90)
  });
});
