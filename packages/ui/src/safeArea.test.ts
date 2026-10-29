// @vitest-environment jsdom
/**
 * R-TOUCH-SAFEAREA-01 + R-TOUCH-FILL-01 (owner 2026-10-18, Home Screen app on an iPhone in landscape: "the camera line
 * also lines up with some ui elements and it's annoying", then "Make sure it fills the screen too").
 *
 * The 16:9 box fits inside the safe area at the exact design size, the stylesheet's safe-area insets are LAYOUT px
 * (never a raw env() inside the scaled stage, which the transform shrank to about a third), the corner HUD anchors on the
 * real screen edge inset by its own side's safe area, and a 16:9 desktop is unchanged.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyStage, DESIGN_H, DESIGN_W, fitStage, gameBoxOf, isTabletSize, NO_INSETS } from './stage';

const IPHONE = { w: 852, h: 393 };
const ISLAND = { top: 0, right: 59, bottom: 21, left: 59 }; // iOS landscape: both sides report the island inset

describe('fitStage with safe-area insets', () => {
  it('no insets: exactly the old fit (desktop and every non-notched device are unchanged)', () => {
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3440, 1440], [852, 393], [1366, 768]]) {
      const a = fitStage(w, h);
      const b = fitStage(w, h, NO_INSETS);
      expect(b.s).toBe(a.s);
      expect(b.lw).toBe(a.lw);
      expect(b.lh).toBe(a.lh);
      expect(b.safe).toEqual(NO_INSETS);
    }
  });

  it('the box is fitted INSIDE the safe area at the exact design size, in either landscape rotation', () => {
    for (const ins of [ISLAND, { ...ISLAND, right: 0 }, { ...ISLAND, left: 0 }]) {
      const f = fitStage(IPHONE.w, IPHONE.h, ins);
      expect(f.s).toBeCloseTo((IPHONE.h - 2 * 21) / DESIGN_H, 10); // height-bound, less the home indicator
      // The layout viewport still covers the WHOLE window (backdrops bleed to the physical edges).
      expect(f.lw * f.s).toBeCloseTo(IPHONE.w, 6);
      expect(f.lh * f.s).toBeCloseTo(IPHONE.h, 6);
      // Insets come back in LAYOUT px: on screen they are exactly the device's.
      expect(f.safe.left * f.s).toBeCloseTo(ins.left, 6);
      expect(f.safe.right * f.s).toBeCloseTo(ins.right, 6);
      const box = gameBoxOf(f);
      expect(box.h / f.s).toBeCloseTo(DESIGN_H, 6); // the tuned 1080p box, not a squashed one
      expect(box.left).toBeGreaterThanOrEqual(Math.max(ins.left, ins.right) - 1e-6);       // clear of the island
      expect(IPHONE.w - (box.left + box.w)).toBeGreaterThanOrEqual(Math.max(ins.left, ins.right) - 1e-6);
      expect(IPHONE.h - (box.top + box.h)).toBeGreaterThanOrEqual(21 - 1e-6);               // clear of the indicator
    }
  });

  it('a width-bound window (4:3 iPad) keeps the box clear of the top and bottom insets', () => {
    const f = fitStage(1024, 768, { top: 24, right: 0, bottom: 20, left: 0 });
    const box = gameBoxOf(f);
    expect(box.w / f.s).toBeCloseTo(DESIGN_W, 6);
    expect(box.top).toBeGreaterThanOrEqual(24 - 1e-6);
  });
});

describe('applyStage writes the safe area for the stylesheet', () => {
  it('sets --safe-t/r/b/l (layout px) on <html>', () => {
    applyStage();
    const st = document.documentElement.style;
    for (const v of ['--safe-t', '--safe-r', '--safe-b', '--safe-l']) expect(st.getPropertyValue(v)).toMatch(/^\d+(\.\d+)?px$/);
    expect(document.getElementById('safe-probe')?.parentElement).toBe(document.documentElement); // OUTSIDE the stage
  });
});

describe('the stylesheet', () => {
  const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');
  const rule = (sel: string): string => {
    const i = css.indexOf(`\n${sel} {`);
    expect(i, sel).toBeGreaterThan(-1);
    return css.slice(i, css.indexOf('}', i));
  };

  it('never adds a raw env(safe-area-inset-*) inside the stage: only the :root defaults and the off-stage rotate prompt', () => {
    const lines = css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => /env\(safe-area-inset-/.test(l));
    for (const l of lines) expect(l, l).toMatch(/--safe-[trbl]: env\(|rotate|padding: 40px calc\(40px \+ env/);
  });

  it('fits the 16:9 box inside the safe area', () => {
    expect(css).toMatch(/--avw: calc\(var\(--lvw, 100vw\) - 2 \* var\(--safe-x\)\)/);
    expect(css).toMatch(/--gw: min\(var\(--avw\), calc\(var\(--avh\) \* 16 \/ 9\), 2560px\)/);
  });

  it('anchors the corner HUD on the real screen edges (--edge-*), inset by the safe area', () => {
    expect(rule('.gearbtn')).toContain('right: calc(var(--edge-r) + 16px)');
    expect(rule('.gearbtn')).toContain('bottom: calc(var(--edge-b) + 16px)');
    expect(rule('.version')).toContain('var(--edge-r)');
    expect(rule('.titlefoot')).toContain('var(--safe-l) / var(--ui-zoom)');
    expect(rule('.hsback')).toContain('var(--safe-l)');
  });

  it('a 16:9 desktop is unchanged: the edge falls back to the box edge when there is no aspect surplus and no inset', () => {
    // edge = max(0, bar-x - surplus-x - safe-x) + safe-side. With surplus 0 and safe 0 that is bar-x exactly.
    expect(css).toMatch(/--edge-r: calc\(max\(0px, var\(--bar-x\) - var\(--surplus-x\) - var\(--safe-x\)\) \+ var\(--safe-r\)\)/);
    expect(css).toMatch(/--surplus-x: max\(0px, calc\(\(var\(--avw\) - var\(--avh\) \* 16 \/ 9\) \/ 2\)\)/);
  });

  it('lets a tablet play upright; a phone never gets a rotate prompt (R-PHONE-SIDEWAYS-01: it plays turned)', () => {
    expect(css).not.toContain('.rotate-prompt');
    expect(isTabletSize(820, 1180)).toBe(true);  // iPad Air portrait
    expect(isTabletSize(768, 1024)).toBe(true);
    expect(isTabletSize(393, 852)).toBe(false);  // iPhone portrait
    expect(isTabletSize(412, 915)).toBe(false);  // Android phone portrait
  });
});
