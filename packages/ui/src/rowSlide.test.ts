// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { liveRowSlides, power2Out, POWER2_OUT_LINEAR, slideHome } from './rowSlide';

// R-PERF-ROW-SLIDE-01: the row's commit slide is a Web Animation of `translate` (a compositor animation), with the
// curve, duration and death hold the GSAP tween had. Script never writes a card's transform per frame.

type Listener = () => void;
interface FakeAnim { frames: Keyframe[]; opts: KeyframeAnimationOptions; cancelled: boolean; cancel: () => void; finish: () => void; addEventListener: (t: string, l: Listener) => void }
function fakeAnimate(log: FakeAnim[], rejectLinear = false) {
  return function animate(this: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): FakeAnim {
    if (rejectLinear && String(opts.easing).startsWith('linear(')) throw new TypeError('easing');
    const ls: Record<string, Listener[]> = {};
    const a: FakeAnim = {
      frames, opts, cancelled: false,
      cancel: () => { a.cancelled = true; for (const l of ls.cancel ?? []) l(); },
      finish: () => { for (const l of ls.finish ?? []) l(); },
      addEventListener: (t, l) => { (ls[t] ||= []).push(l); },
    };
    log.push(a);
    return a;
  };
}
const card = (log: FakeAnim[], rejectLinear = false): HTMLElement => {
  const el = document.createElement('div');
  (el as unknown as { animate: unknown }).animate = fakeAnimate(log, rejectLinear);
  return el;
};

describe('slideHome', () => {
  it('animates translate from the offset home, with the duration, the hold and a backwards fill', () => {
    const log: FakeAnim[] = [];
    const a = card(log), b = card(log);
    slideHome([a, b], [-152.5, 76], 200, 120);
    expect(log).toHaveLength(2);
    expect(log[0]!.frames).toEqual([{ translate: '-152.5px 0px' }, { translate: '0px 0px' }]);
    expect(log[1]!.frames[0]).toEqual({ translate: '76px 0px' });
    expect(log[0]!.opts).toMatchObject({ duration: 200, delay: 120, fill: 'backwards', easing: POWER2_OUT_LINEAR });
    // Never `transform`: the card's own transform (drag shift, hover, the buy slide) keeps composing underneath.
    expect(JSON.stringify(log.map((x) => x.frames))).not.toContain('transform');
    expect(liveRowSlides()).toBe(2);
    log[0]!.finish(); log[1]!.finish();
    expect(liveRowSlides()).toBe(0);
  });

  it('writes no inline style on the card', () => {
    const log: FakeAnim[] = [];
    const a = card(log);
    slideHome([a], [40], 200);
    expect(a.getAttribute('style')).toBeNull();
    log[0]!.finish();
  });

  it('a second slide on the same card cancels the first, and the count stays right', () => {
    const log: FakeAnim[] = [];
    const a = card(log);
    slideHome([a], [40], 200);
    slideHome([a], [-90], 200);
    expect(log[0]!.cancelled).toBe(true);
    expect(log[1]!.cancelled).toBe(false);
    expect(liveRowSlides()).toBe(1);
    log[1]!.finish();
    expect(liveRowSlides()).toBe(0);
  });

  it('falls back to the cubic-bezier form where linear() is not parsed', () => {
    const log: FakeAnim[] = [];
    const a = card(log, true);
    slideHome([a], [40], 200);
    expect(log).toHaveLength(1);
    expect(log[0]!.opts.easing).toBe('cubic-bezier(0.215, 0.61, 0.355, 1)');
    log[0]!.finish();
  });

  it('is a no-op without Web Animations (the cards stand at their slots)', () => {
    const el = document.createElement('div');
    expect(() => slideHome([el], [40], 200)).not.toThrow();
    expect(liveRowSlides()).toBe(0);
  });
});

describe('the easing is GSAP power2.out', () => {
  it('power2Out is 1 - (1 - t)^3', () => {
    expect(power2Out(0)).toBe(0);
    expect(power2Out(1)).toBe(1);
    expect(power2Out(0.5)).toBeCloseTo(0.875, 10);
  });
  it('the linear() form follows the curve to within a tenth of a pixel on a 300 px slide', () => {
    const pts = POWER2_OUT_LINEAR.slice('linear('.length, -1).split(',').map((x) => Number(x.trim()));
    expect(pts[0]).toBe(0);
    expect(pts[pts.length - 1]).toBe(1);
    const n = pts.length - 1;
    const at = (t: number): number => { const x = Math.min(n - 1e-9, t * n); const i = Math.floor(x); return pts[i]! + (pts[i + 1]! - pts[i]!) * (x - i); };
    let worst = 0;
    for (let k = 0; k <= 2000; k++) worst = Math.max(worst, Math.abs(at(k / 2000) - power2Out(k / 2000)));
    expect(worst * 300).toBeLessThan(0.1);
    for (let i = 1; i < pts.length; i++) expect(pts[i]!).toBeGreaterThanOrEqual(pts[i - 1]!);
  });
});
