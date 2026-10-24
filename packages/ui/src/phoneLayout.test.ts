import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { DESIGN_H, DESIGN_W, DESK_BOX_ASPECT, PHONE_BOX_ASPECT, PHONE_DESIGN_W, fitStage, gameBoxOf, phoneLayoutApplies } from './stage';
import { classifyPhone } from './deviceClass';
import { PHONE_DIAG_FLAGS, parseDiagQuery } from './phoneDiag';

/**
 * THE PHONE LAYOUT (owner 2026-10-23, R-PHONE-LAYOUT-01): a phone in landscape lays the game out in a 2:1 box and
 * phoneLayout.css re-composes the same components in it. Desktop must stay pixel-identical, so the gate and the
 * stylesheet's keying are what this file pins.
 */
describe('the phone layout gate', () => {
  it('applies to a phone in landscape only', () => {
    expect(phoneLayoutApplies(true, 852, 393)).toBe(true);
    expect(phoneLayoutApplies(true, 915, 412)).toBe(true);
    expect(phoneLayoutApplies(true, 393, 852)).toBe(false); // portrait: the rotate prompt, never this layout
    expect(phoneLayoutApplies(false, 852, 393)).toBe(false); // a mouse device at a phone-sized window
    expect(phoneLayoutApplies(false, 1920, 1080)).toBe(false);
    expect(phoneLayoutApplies(true, 852, 393, true)).toBe(false); // the `deskui` diagnostics switch
  });
  it('a desktop, a laptop with a touchscreen-sized window and a tablet are never phones', () => {
    expect(classifyPhone(false, 1920, 1080)).toBe(false);
    expect(classifyPhone(false, 852, 393)).toBe(false);
    expect(classifyPhone(true, 1180, 820)).toBe(false); // iPad landscape
    expect(classifyPhone(true, 852, 393)).toBe(true);
  });
  it('the `deskui` switch exists in Phone diagnostics', () => {
    expect(PHONE_DIAG_FLAGS.some((f) => f.id === 'deskui')).toBe(true);
    expect(parseDiagQuery('deskui')).toEqual({ deskui: 1 });
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
    expect(src).toMatch(/const phoneLayout = phoneLayoutApplies\(isPhone\(\), w, h, !!PHONE_DIAG\.deskui\)/);
    expect(src).toMatch(/toggleAttribute\('data-phone-layout', phoneLayout\)/);
    expect(src).toMatch(/fitStage\(w, h, readSafeInsets\(\), phoneLayout \? PHONE_DESIGN_W : DESIGN_W\)/);
  });
  it('Discover shows full cards on a phone only', () => {
    expect(readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8')).toMatch(/full=\{phoneLayoutOn\(\)\}/);
  });
  it('the desktop design width is still 1920', () => {
    expect(DESIGN_W).toBe(1920);
  });
});
