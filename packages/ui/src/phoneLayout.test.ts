import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { DESIGN_H, DESIGN_W, DESK_BOX_ASPECT, PHONE_BOX_ASPECT, PHONE_DESIGN_W, PHONE_ZOOM_VARIANTS, fitStage, gameBoxOf, phoneLayoutApplies, phoneZoomApplies, phoneZoomOf } from './stage';
import { classifyPhone } from './deviceClass';
import { PHONE_DIAG_FLAGS, parseDiagQuery } from './phoneDiag';

/**
 * THE PHONE LAYOUT (owner 2026-10-23, R-PHONE-LAYOUT-01): a phone in landscape lays the game out in a 2:1 box and
 * phoneLayout.css re-composes the same components in it. Desktop must stay pixel-identical, so the gate and the
 * stylesheet's keying are what this file pins.
 */
describe('R-PHONE-ZOOM-01: phones get the desktop game, slightly zoomed', () => {
  it('the zoom applies to a phone in landscape only', () => {
    expect(phoneZoomApplies(true, 852, 393)).toBe(true);
    expect(phoneZoomApplies(true, 915, 412)).toBe(true);
    expect(phoneZoomApplies(true, 393, 852)).toBe(false); // portrait
    expect(phoneZoomApplies(false, 852, 393)).toBe(false); // a mouse device at a phone-sized window
    expect(phoneZoomApplies(false, 2560, 1080)).toBe(false);
    expect(phoneZoomApplies(true, 852, 393, true)).toBe(false); // the `nophonezoom` switch
  });
  it('the retired phone composition is OFF unless switched on', () => {
    expect(phoneLayoutApplies(true, 852, 393)).toBe(false);
    expect(phoneLayoutApplies(true, 852, 393, true)).toBe(true);
    expect(phoneLayoutApplies(false, 852, 393, true)).toBe(false);
  });
  it('the zoom variants and the default (1.35x)', () => {
    expect(PHONE_ZOOM_VARIANTS).toEqual({ pz125: 1.25, pz135: 1.35, pz145: 1.45 });
    expect(phoneZoomOf({})).toBe(1.35);
    expect(phoneZoomOf({ pz145: 1 })).toBe(1.45);
  });
  it('iPhone 15 Pro and Pixel 8 at every variant: the stage is the plain fit times the zoom, the 16:9 box centred', () => {
    for (const [w, h, ins] of [[852, 393, { top: 0, right: 59, bottom: 21, left: 59 }], [915, 412, { top: 0, right: 0, bottom: 0, left: 24 }]] as const) {
      const plain = fitStage(w, h, ins);
      for (const z of Object.values(PHONE_ZOOM_VARIANTS)) {
        const f = fitStage(w, h, ins, DESIGN_W, z);
        expect(f.s).toBeCloseTo(plain.s * z, 10);
        const box = gameBoxOf(f);
        expect(box.w / box.h).toBeCloseTo(16 / 9, 6);
        expect(box.left + box.w / 2).toBeCloseTo(w / 2, 6);
        expect(box.top + box.h / 2).toBeCloseTo(h / 2, 6);
      }
    }
  });
  it("at 1.35x the baked HUD region (box x 125..1795, y 150..930) is inside both phones' safe areas", () => {
    for (const [w, h, ins] of [[852, 393, { top: 0, right: 59, bottom: 21, left: 59 }], [915, 412, { top: 0, right: 0, bottom: 0, left: 24 }]] as const) {
      const f = fitStage(w, h, ins, DESIGN_W, 1.35);
      const box = gameBoxOf(f);
      expect(box.left + 125 * f.s).toBeGreaterThanOrEqual(ins.left - 1e-6);
      expect(box.left + 1795 * f.s).toBeLessThanOrEqual(w - ins.right + 1e-6);
      expect(box.top + 150 * f.s).toBeGreaterThanOrEqual(ins.top - 1e-6);
      expect(box.top + 930 * f.s).toBeLessThanOrEqual(h - ins.bottom + 1e-6);
    }
  });
  it("a desktop window of a phone's aspect never zooms (the plain fit)", () => {
    expect(fitStage(2560, 1080).zoom).toBeUndefined();
    expect(fitStage(852, 393).zoom).toBeUndefined();
  });
  it('a desktop, a laptop with a touchscreen-sized window and a tablet are never phones', () => {
    expect(classifyPhone(false, 1920, 1080)).toBe(false);
    expect(classifyPhone(false, 852, 393)).toBe(false);
    expect(classifyPhone(true, 1180, 820)).toBe(false); // iPad landscape
    expect(classifyPhone(true, 852, 393)).toBe(true);
  });
  it('the `nophonezoom` and `phonelayout` switches exist in Phone diagnostics', () => {
    expect(PHONE_DIAG_FLAGS.some((f) => f.id === 'nophonezoom')).toBe(true);
    expect(parseDiagQuery('phonelayout,nophonezoom')).toEqual({ phonelayout: 1, nophonezoom: 1 });
  });
  it('the zoom CSS is keyed off the touch UI and the stage attribute', () => {
    const css = readFileSync(join(__dirname, 'touchUi.css'), 'utf8');
    expect(css).toMatch(/html\[data-touch-ui\]\[data-phone-zoom\] \{ --gw: 1920px; --gh: 1080px;/);
  });
});

describe('the phone box', () => {
  it('is 2:1 at the desktop design height, so --scale keeps its meaning', () => {
    expect(PHONE_DESIGN_W).toBe(2160);
    expect(PHONE_BOX_ASPECT).toBe(2);
    expect(DESIGN_H).toBe(1080);
  });
  it('the desktop fit is unchanged: no aspect, the 16:9 box', () => {
    for (const [w, h] of [[1920, 1080], [2560, 1440], [1366, 768], [844, 390]]) {
      const f = fitStage(w, h);
      expect(f.aspect).toBeUndefined();
      expect(f.s).toBeCloseTo(Math.min(1, w / DESIGN_W, h / DESIGN_H), 10);
    }
    const box = gameBoxOf({ s: 1, lw: 1920, lh: 1080, safe: { top: 0, right: 0, bottom: 0, left: 0 } });
    expect(box.w / box.h).toBeCloseTo(DESK_BOX_ASPECT, 6);
  });
  it('an iPhone 15 Pro in landscape (insets 59 / 59 / 21) fits the 2:1 box inside its safe area', () => {
    const f = fitStage(852, 393, { top: 0, right: 59, bottom: 21, left: 59 }, PHONE_DESIGN_W);
    expect(f.aspect).toBe(2);
    const box = gameBoxOf(f);
    expect(box.w / box.h).toBeCloseTo(2, 6);
    expect(box.left).toBeGreaterThanOrEqual(59 - 1e-6);
    expect(box.left + box.w).toBeLessThanOrEqual(852 - 59 + 1e-6);
    expect(box.top + box.h).toBeLessThanOrEqual(393 - 21 + 1e-6);
  });
  it('a Pixel 8 in landscape fits it too, and a 16:9 phone letterboxes it (same composition, smaller)', () => {
    for (const [w, h] of [[915, 412], [699, 393]]) {
      const box = gameBoxOf(fitStage(w, h, { top: 0, right: 0, bottom: 0, left: 24 }, PHONE_DESIGN_W));
      expect(box.w / box.h).toBeCloseTo(2, 6);
      expect(box.left).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(box.left + box.w).toBeLessThanOrEqual(w - 24 + 1e-6);
    }
  });
});

describe('phoneLayout.css can never reach a mouse device', () => {
  const css = readFileSync(join(__dirname, 'phoneLayout.css'), 'utf8');
  it('every rule sits inside the touch media query a mouse never matches', () => {
    const outside: string[] = [];
    postcss.parse(css).walkRules((r) => {
      const media = r.parent && r.parent.type === 'atrule' ? (r.parent as unknown as { name: string; params: string }) : null;
      if (!media || media.name !== 'media' || !/\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)/.test(media.params)) outside.push(r.selector);
    });
    expect(outside).toEqual([]);
  });
  it('every selector is keyed off html[data-phone-layout]', () => {
    const bad: string[] = [];
    postcss.parse(css).walkRules((r) => { for (const sel of r.selectors) if (!sel.trim().startsWith('html[data-phone-layout]')) bad.push(sel); });
    expect(bad).toEqual([]);
  });
  it('has no looping animation and no :has()', () => {
    expect(css).not.toMatch(/infinite/);
    expect(css).not.toMatch(/:has\(/);
  });
  it('never puts a bare keyword cursor on a control (the gauntlet cursor rule)', () => {
    expect(css).not.toMatch(/cursor:\s*(pointer|default)\s*;/);
  });
  it('is imported by the app shell after the touch UI', () => {
    const game = readFileSync(join(__dirname, 'Game.tsx'), 'utf8');
    expect(game.indexOf("import './phoneLayout.css'")).toBeGreaterThan(game.indexOf("import './touchUi.css'"));
  });
});

describe('the phone layout is written by stage.ts, never by a desktop', () => {
  const src = readFileSync(join(__dirname, 'stage.ts'), 'utf8');
  it('the attribute and the 2:1 design width come from the same gate', () => {
    expect(src).toMatch(/const phoneLayout = phoneLayoutApplies\(isPhone\(\), w, h, !!PHONE_DIAG\.phonelayout\)/);
    expect(src).toMatch(/toggleAttribute\('data-phone-layout', phoneLayout\)/);
    expect(src).toMatch(/const phoneZoom = !phoneLayout && phoneZoomApplies\(isPhone\(\), w, h, !!PHONE_DIAG\.nophonezoom, !menuZoom\)/);
    expect(src).toMatch(/fitStage\(w, h, readSafeInsets\(\), phoneLayout \? PHONE_DESIGN_W : DESIGN_W, phoneZoom \? phoneZoomOf\(PHONE_DIAG\) : 1\)/);
  });
  it('Discover shows full cards on a phone only', () => {
    expect(readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8')).toMatch(/full=\{phoneLayoutOn\(\)\}/);
  });
  it('the desktop design width is still 1920', () => {
    expect(DESIGN_W).toBe(1920);
  });
});
