// @vitest-environment jsdom
/**
 * R-PHONE-PAGESCALE-01 (owner report 2026-10-25, a real iPhone: "Mobile looks like this", the Shop minions collapsed to
 * their badges in one spot, the lobby rail tiny, Tier / Freeze / the Refresh cost huge).
 *
 * Root cause: on a phone the stage was shrunk with CSS `zoom`, and WebKit lays a zoomed subtree out differently from
 * Chromium (every registered `@property` length declared inside it is zoomed twice, and its minimum font size lifts any
 * text the zoom takes under 9 screen px). Chromium's device emulation, where every phone capture was taken, does neither.
 * THE INVARIANT: a phone never shrinks the stage with CSS zoom (nor the transform, which WebKit pays ~9x the layer memory
 * for, R-TOUCH-RUN-MEMORY-01). The browser scales the PAGE: the meta viewport is the stage's layout width at the fit
 * scale, the stage itself is unscaled, every coordinate helper is the identity, and Pixi folds the page scale into its
 * resolution. Desktop keeps the transform path untouched.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const pixiScale = vi.fn();
vi.mock('./phoneDiag', () => ({ PHONE_GPU: true, PHONE_DIAG: {}, setPixiPageScale: (k: number) => pixiScale(k) }));
vi.mock('./deviceClass', () => ({ isPhone: () => true }));

const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8');

describe('the page scale (phone)', () => {
  beforeAll(() => {
    // An iPhone 15 Pro in landscape at page scale 1: 852 x 393 CSS px.
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: { width: 852, height: 393, scale: 1, offsetLeft: 0, offsetTop: 0, addEventListener: () => {} } });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 852 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 393 });
  });

  it('a phone takes the page scale by default, never CSS zoom; desktop keeps the transform', async () => {
    const { stageModeFor } = await import('./stage');
    expect(stageModeFor(true, false, {})).toBe('page');
    expect(stageModeFor(true, true, {})).toBe('page');
    expect(stageModeFor(false, false, {})).toBe('transform');
    expect(stageModeFor(false, true, {})).toBe('transform');
  });

  it('applyStage scales the page, not the stage: meta viewport, no zoom, no transform, identity coordinates', async () => {
    const st = await import('./stage');
    st.setStageInRun(true);
    const f = st.applyStage();
    const meta = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';
    const k = Number(/initial-scale=([\d.]+)/.exec(meta)?.[1]);
    const lw = Number(/width=(\d+)/.exec(meta)?.[1]);
    expect(k).toBeGreaterThan(0.3); expect(k).toBeLessThan(0.45);
    expect(meta).toContain(`minimum-scale=${k}`); expect(meta).toContain(`maximum-scale=${k}`);
    expect(lw * k).toBeCloseTo(852, 0); // the layout width fills the screen at the page scale
    const stage = st.stageHost();
    expect(stage.style.getPropertyValue('zoom')).toBe('');
    expect(stage.style.transform).toBe('');
    expect(f.s).toBe(1); // rects and pointers are already layout px
    expect(st.stageScale()).toBe(1);
    expect(st.toStage(100)).toBe(100);
    expect(st.screenScale()).toBeCloseTo(k, 4); // the touch UI sizes off the screen scale
    expect(st.pageScale()).toBeCloseTo(k, 4);
    expect(pixiScale).toHaveBeenLastCalledWith(st.pageScale()); // Pixi renders at its on-screen size
    expect(document.documentElement.getAttribute('data-page-scale')).toBe(String(Number(k.toFixed(4))));
    expect(document.documentElement.hasAttribute('data-phone-zoom')).toBe(true);
  });

  it('the layout the page scale lays out is the one the transform / zoom fit lays out (the same game, the same seats)', async () => {
    const st = await import('./stage');
    const f = st.stageFit();
    const ref = st.fitStage(852, 393, { top: 0, right: 0, bottom: 0, left: 0 }, st.DESIGN_W, st.phoneZoomOf({}), true);
    expect(f.lw).toBeCloseTo(ref.lw, -0.5); // within a px: the scale is snapped to a whole layout width
    expect(f.barX).toBeCloseTo(ref.barX!, 6);
    expect(f.barY).toBeCloseTo(ref.barY!, 6);
  });

  it('the page scale keeps the browser from inflating text or zooming on a pinch (touchUi.css)', () => {
    const css = src('touchUi.css');
    expect(css).toMatch(/html\[data-touch-ui\]\[data-page-scale\] \{ -webkit-text-size-adjust: 100%; text-size-adjust: 100%; \}/);
    expect(css).toMatch(/html\[data-touch-ui\]\[data-page-scale\], html\[data-touch-ui\]\[data-page-scale\] body \{ touch-action: pan-x pan-y; \}/);
  });

  it('touch thresholds stay SCREEN px on the page scale (tap slop, the 44 px hit slop, the keyboard lift, the hand pop)', () => {
    expect(src('touchInput.ts')).toMatch(/export function tapSlopPx\(\): number \{ return TAP_SLOP \/ pageScale\(\); \}/);
    expect(src('touchSlop.ts')).toMatch(/const min = TOUCH_TARGET_PX \/ pageScale\(\);/);
    expect(src('touchKeyboard.ts')).toMatch(/const k = pageScale\(\);/);
    expect(src('touchInput.ts')).toMatch(/u: 1 \/ pageScale\(\)/);
  });
});
