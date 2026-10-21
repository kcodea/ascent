// @vitest-environment jsdom
/**
 * R-TOUCH-UISCALE-01 / R-TOUCH-BUYZONE-01 (owner 2026-10-18: "I want to make sure it's a AAA experience, seamless 1:1
 * from mobile to desktop", and the hard requirement that desktop stays pixel-identical).
 *
 * The touch UI turns on ONLY for a touch device (no hover, a coarse pointer) on a scaled stage; a mouse device never
 * gets the attribute or a single var, at any window size. Every rule in touchUi.css is keyed off that attribute, the
 * size is a stored local preference with a sensible per-device default, and the buy line only moves for a finger.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTouchUi, defaultTouchUiSize, parseTouchUiSize, setTouchUiSize, TOUCH_BUY_LIFT, TOUCH_PAGE_ZOOM, TOUCH_UI_FACTOR,
  TOUCH_UI_KEY, touchBuyLine, touchUiApplies, touchUiState,
} from './touchUi';

function mockPointer(touch: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: touch && q.includes('hover: none') && q.includes('pointer: coarse'),
    media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
  }));
  window.matchMedia = globalThis.matchMedia as typeof window.matchMedia;
}
const PHONE_FIT = { s: 0.36, lw: 844 / 0.36, lh: 390 / 0.36, safe: { top: 0, right: 0, bottom: 0, left: 0 } };
const DESK_FIT = { s: 1, lw: 1920, lh: 1080, safe: { top: 0, right: 0, bottom: 0, left: 0 } };
const SMALL_DESK_FIT = { s: 0.6, lw: 1920, lh: 1080, safe: { top: 0, right: 0, bottom: 0, left: 0 } };

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  const de = document.documentElement;
  de.removeAttribute('data-touch-ui'); de.removeAttribute('data-touch-small'); de.removeAttribute('style');
});

describe('detection gating', () => {
  it('a mouse device never gets the touch UI, at any scale (desktop stays pixel-identical)', () => {
    for (const s of [1, 0.75, 0.5, 0.36, 0.2]) expect(touchUiApplies(false, s)).toBe(false);
  });
  it('a touch device gets it only on a scaled stage', () => {
    expect(touchUiApplies(true, 0.36)).toBe(true);
    expect(touchUiApplies(true, 0.62)).toBe(true);
    expect(touchUiApplies(true, 1)).toBe(false); // a big touch screen at the design size: nothing to grow
  });
  it('applyTouchUi on a MOUSE device writes nothing, even on a small window', () => {
    mockPointer(false);
    for (const fit of [DESK_FIT, SMALL_DESK_FIT, PHONE_FIT]) {
      const st = applyTouchUi(fit);
      expect(st.on).toBe(false);
      expect(document.documentElement.hasAttribute('data-touch-ui')).toBe(false);
      expect(document.documentElement.hasAttribute('data-touch-small')).toBe(false);
      expect(document.documentElement.getAttribute('style') ?? '').not.toContain('--touch-');
    }
  });
  it('applyTouchUi on a phone writes the size, the small flag and the vars; leaving touch clears every trace', () => {
    mockPointer(true);
    const st = applyTouchUi(PHONE_FIT);
    const de = document.documentElement;
    expect(st.on).toBe(true);
    expect(de.getAttribute('data-touch-ui')).toBe(st.size);
    expect(de.hasAttribute('data-touch-small')).toBe(true);
    expect(Number(de.style.getPropertyValue('--touch-k'))).toBe(TOUCH_UI_FACTOR[st.size]);
    expect(Number(de.style.getPropertyValue('--touch-p'))).toBe(TOUCH_PAGE_ZOOM[st.size]);
    expect(Number(de.style.getPropertyValue('--touch-inv-s'))).toBeCloseTo(1 / 0.36, 6);
    mockPointer(false);
    applyTouchUi(PHONE_FIT);
    expect(de.hasAttribute('data-touch-ui')).toBe(false);
    expect(de.hasAttribute('data-touch-small')).toBe(false);
    expect(de.getAttribute('style') ?? '').not.toContain('--touch-');
  });
  it('a tablet scale is touch UI but not "small" (the card views keep their size)', () => {
    const st = touchUiState(true, { s: 0.62 }, null, 1180, 820);
    expect(st.on).toBe(true);
    expect(st.small).toBe(false);
  });
});

describe('the Touch UI size setting', () => {
  it('defaults by device: Larger on a phone, Large on a tablet', () => {
    expect(defaultTouchUiSize(844, 390)).toBe('larger');
    expect(defaultTouchUiSize(800, 360)).toBe('larger');
    expect(defaultTouchUiSize(1180, 820)).toBe('large');
  });
  it('parses only the three sizes', () => {
    expect(parseTouchUiSize('normal')).toBe('normal');
    expect(parseTouchUiSize('larger')).toBe('larger');
    expect(parseTouchUiSize('huge')).toBeNull();
    expect(parseTouchUiSize(null)).toBeNull();
  });
  it('a stored choice wins over the default, and Normal keeps desktop proportions', () => {
    const st = touchUiState(true, { s: 0.36 }, 'normal', 844, 390);
    expect(st.size).toBe('normal');
    expect(st.k).toBe(1);
    expect(st.p).toBe(1);
  });
  it('setTouchUiSize stores a LOCAL preference and applies it at once', () => {
    mockPointer(true);
    applyTouchUi(PHONE_FIT);
    setTouchUiSize('normal');
    expect(localStorage.getItem(TOUCH_UI_KEY)).toBe('normal');
    // (applyTouchUi re-reads the stage fit, which is the identity in jsdom: a touch device at s=1 has no touch UI)
    expect(touchUiState(true, PHONE_FIT, parseTouchUiSize(localStorage.getItem(TOUCH_UI_KEY)), 844, 390).size).toBe('normal');
  });
  it('sizes grow monotonically', () => {
    expect(TOUCH_UI_FACTOR.normal).toBeLessThan(TOUCH_UI_FACTOR.large);
    expect(TOUCH_UI_FACTOR.large).toBeLessThan(TOUCH_UI_FACTOR.larger);
    expect(TOUCH_PAGE_ZOOM.normal).toBe(1);
    expect(TOUCH_PAGE_ZOOM.large).toBeLessThan(TOUCH_PAGE_ZOOM.larger);
  });
});

describe('R-TOUCH-BUYZONE-01: the buy line', () => {
  it('a mouse keeps the board midline exactly', () => {
    expect(touchBuyLine(540, 1080, false)).toBe(540);
  });
  it('a finger on the touch UI buys from a raised line (a taller warband drop zone)', () => {
    expect(touchBuyLine(195, 390, true)).toBeCloseTo(195 - TOUCH_BUY_LIFT * 390, 6);
    expect(touchBuyLine(195, 390, true)).toBeLessThan(195);
  });
  it('Recruit.tsx feeds the buy line through touchBuyLine, gated on a touch drag AND the touch UI', () => {
    const src = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');
    expect(src).toMatch(/const midlineY = touchBuyLine\([\s\S]*?touch && touchUi\(\)\.on\)/);
  });
});

describe('touchUi.css can never reach a mouse device', () => {
  it('every selector is keyed off html[data-touch-ui]', () => {
    const css = readFileSync(join(__dirname, 'touchUi.css'), 'utf8');
    const bad: string[] = [];
    postcss.parse(css).walkRules((r) => {
      for (const sel of r.selectors) if (!sel.trim().startsWith('html[data-touch-ui]')) bad.push(sel);
    });
    expect(bad).toEqual([]);
  });
  it('it is imported by the app shell', () => {
    expect(readFileSync(join(__dirname, 'Game.tsx'), 'utf8')).toContain("import './touchUi.css'");
  });
});

describe('R-TOUCH-MENU-MEMORY-01: nothing hidden under an open menu holds a layer on a phone', () => {
  const css = readFileSync(join(__dirname, 'touchUi.css'), 'utf8');
  const rules: { sel: string; body: string }[] = [];
  postcss.parse(css).walkRules((r) => { for (const sel of r.selectors) rules.push({ sel: sel.trim(), body: r.nodes.map(String).join(';') }); });
  const find = (part: string) => rules.filter((r) => r.sel.includes(part));
  it('the three gameplay FX canvases leave the page while the title or a menu page is open', () => {
    for (const target of ['> #root > .pixifx', '> canvas.pixifx-above', '> div > canvas.pixi-screen']) {
      const hit = find(target);
      expect(hit.length, target).toBe(1);
      expect(hit[0].sel).toContain('#stage:has(> #root > :is(.titlescreen, .lbpage, .modepick))');
      // !important: Pixi writes an inline display:block on its canvases.
      expect(hit[0].body).toMatch(/display:\s*none\s*!important/);
    }
  });
  it('never hides the wipe or the ranked gate canvases', () => {
    for (const r of rules) expect(r.sel).not.toMatch(/wipefx|gatefx/);
  });
  it('the title art under a mode page and the mode screen under the tutorial nudge stop painting', () => {
    expect(find('.titlescreen:has(> .modepick)')[0]?.body).toMatch(/visibility:\s*hidden/);
    expect(find('.modepick.mp-shell:has(~ .modepick)')[0]?.body).toMatch(/visibility:\s*hidden/);
  });
  it('the touch sidebar never scrolls sideways', () => {
    expect(rules.some((r) => r.sel === 'html[data-touch-ui] .msb' && /overflow-x:\s*hidden/.test(r.body))).toBe(true);
  });
});
