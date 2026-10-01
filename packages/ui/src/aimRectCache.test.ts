// @vitest-environment jsdom
/**
 * The aim paths' hit-testing (perf report 2026-09-30): the owner's 33-minute capture counted 1,813
 * `layout:read-in-move`, from `elementFromPoint` on every hero-power / Battlecry aim move. The aims now hit-test
 * a rect cache measured off the input path (`aimRectCache.ts`). Pinned here: a hit reads NO layout, the measure
 * does, and the cache's timer + listener are released on dispose. Plus the source contract that the aim effects
 * in `Recruit.tsx` never call `elementAtPoint` again.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { perfMonitor } from './perfMonitor';
import { createAimRectCache, hitEntries } from './aimRectCache';

function rect(left: number, top: number, w = 100, h = 140): DOMRect {
  return { left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function card(uid: string, left: number, top: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card';
  el.setAttribute('data-uid', uid);
  el.getBoundingClientRect = () => rect(left, top);
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('aimRectCache', () => {
  it('a hit reads no layout; only the (off-input-path) measure does', () => {
    card('a', 0, 0);
    card('b', 120, 0);
    const reads = vi.spyOn(perfMonitor, 'noteLayoutRead');
    const cache = createAimRectCache('.card[data-uid]');
    const measured = reads.mock.calls.length;
    expect(measured).toBe(2);
    expect(cache.hit(50, 50)).toBe('a');
    expect(cache.hit(150, 10)).toBe('b');
    expect(cache.hit(110, 10)).toBeNull();
    for (let i = 0; i < 500; i++) cache.hit(i, 20); // a whole aim's worth of moves
    expect(reads.mock.calls.length, 'layout:read-in-move must stay 0 on the move path').toBe(measured);
    cache.dispose();
  });

  it('re-measures on its timer (a card that was still gliding lands) and stops after dispose', () => {
    vi.useFakeTimers();
    const el = card('a', 0, 0);
    const cache = createAimRectCache('.card[data-uid]');
    expect(cache.hit(250, 10)).toBeNull();
    el.getBoundingClientRect = () => rect(200, 0);
    vi.advanceTimersByTime(250);
    expect(cache.hit(250, 10)).toBe('a');
    cache.dispose();
    expect(cache.hit(250, 10)).toBeNull();
    const reads = vi.spyOn(perfMonitor, 'noteLayoutRead');
    vi.advanceTimersByTime(1000);
    expect(reads).not.toHaveBeenCalled();
  });

  it('hitEntries: later siblings win, edges are inclusive', () => {
    const e = [
      { uid: 'a', left: 0, top: 0, right: 10, bottom: 10 },
      { uid: 'b', left: 5, top: 0, right: 15, bottom: 10 },
    ];
    expect(hitEntries(e, 7, 5)).toBe('b');
    expect(hitEntries(e, 0, 0)).toBe('a');
    expect(hitEntries(e, 16, 5)).toBeNull();
  });

  it('source contract: the hero-power and target aims no longer hit-test with elementAtPoint', () => {
    const src = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');
    const bodies = src.split('const minionAt = ').slice(1).map((s) => s.slice(0, 400));
    expect(bodies.length).toBe(2);
    for (const body of bodies) expect(body).not.toContain('elementAtPoint');
  });
});
