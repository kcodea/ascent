// @vitest-environment jsdom
/**
 * CONCURRENT CARD POPS GET THEIR OWN LAYER (R-PERF-HANDBUFF-01, perf 2026-10-22). The `react` layer writes a card
 * pop's playhead from JS every frame, which made Chrome re-raster every popping hand card every frame: the real cost
 * of the Cave Cutter pile-up. While two or more whole cards pop at once each gets `will-change: transform` for its
 * pop; a lone pop is untouched; the previous inline value comes back when the pop ends or is cut short.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { reactPrimitive, poppingCardCount, PROMOTE_AT } from './primitives/react';
import type { FxContext, FxInstance } from './primitive';
import type { ParamsOf } from './params';

type ReactParams = ParamsOf<typeof reactPrimitive.params>;
const PARAMS = {
  part: 'card', reach: 'self', order: 'ripple', gap: 60, carries: false, roll: 0, reel: 0, falloff: 0.4,
  hold: 640, peak: 0.35, scale: 1.1, squash: 0, lift: 0, nudge: 0, shakes: 0, spin: 0, dip: 0, ease: 'overshoot',
} as unknown as ReactParams;

function card(uid: string, willChange = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card';
  el.setAttribute('data-uid', uid);
  el.style.willChange = willChange;
  const writes: number[] = [];
  el.animate = (() => {
    const a = { currentTime: 0 as number | null, pause: () => {}, cancel: () => {} };
    return new Proxy(a, { set(t, k, v) { if (k === 'currentTime') writes.push(v as number); (t as Record<string | symbol, unknown>)[k] = v; return true; } });
  }) as unknown as HTMLElement['animate'];
  (el as unknown as { writes: number[] }).writes = writes;
  let zone = document.querySelector('[data-zone="hand"]');
  if (!zone) { zone = document.createElement('div'); zone.setAttribute('data-zone', 'hand'); document.body.appendChild(zone); }
  zone.appendChild(el);
  return el;
}

const pop = (uid: string): FxInstance => reactPrimitive.spawn({ uids: { source: uid, target: uid } } as unknown as FxContext, PARAMS) as FxInstance;

describe('react: concurrent whole-card pops are promoted to their own layer', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('a lone pop is left exactly as it was', () => {
    const a = card('a');
    const ia = pop('a');
    expect(poppingCardCount(), 'the pop really is live').toBe(1);
    expect(a.style.willChange).toBe('');
    ia.update(700);
    ia.destroy();
    expect(poppingCardCount()).toBe(0);
  });

  it(`from ${PROMOTE_AT} concurrent pops every popping card gets will-change, restored when its pop ends`, () => {
    const a = card('a', 'opacity');
    const b = card('b');
    const ia = pop('a');
    expect(a.style.willChange).toBe('opacity');
    const ib = pop('b');
    expect(a.style.willChange).toBe('transform');
    expect(b.style.willChange).toBe('transform');
    ia.update(700); // a's pop is over: its own value comes back
    expect(a.style.willChange).toBe('opacity');
    expect(b.style.willChange).toBe('transform');
    ib.destroy(); // cut short: restored too
    expect(b.style.willChange).toBe('');
    ia.destroy();
    expect(poppingCardCount()).toBe(0);
  });

  it('a finished pop stops writing its playhead (no per-frame style invalidation once it is done)', () => {
    const a = card('a');
    const ia = pop('a');
    const writes = (a as unknown as { writes: number[] }).writes;
    ia.update(700);
    const n = writes.length;
    expect(n).toBeGreaterThan(0);
    ia.update(16); ia.update(16);
    expect(writes.length).toBe(n);
    ia.destroy();
  });
});
