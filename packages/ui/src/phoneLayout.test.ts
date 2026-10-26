import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { DESIGN_H, DESIGN_W, DESK_BOX_ASPECT, PHONE_BOX_ASPECT, PHONE_DESIGN_W, PHONE_ART_BOTTOM, PHONE_GESTURE_FRAC, PHONE_HOUSED_SPAN, PHONE_ZOOM_VARIANTS, PHONE_FOOT_FRAC, PHONE_RAIL_FOOTPRINT, PHONE_RAIL_GAP, PHONE_REFRESH_RIGHT, fitStage, gameBoxOf, phoneBottomStrip, phoneLayoutApplies, phoneZoomApplies, phoneZoomOf } from './stage';
import { classifyPhone } from './deviceClass';
import { PHONE_DIAG_FLAGS, parseDiagQuery } from './phoneDiag';
import { POP_FOOT_GAP, POP_HEIGHT_FRAC, PRESS_CLASS, handCardOf, popGeometry, popSafe } from './touchInput';

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
  it('iPhone 15 Pro and Pixel 8: ONE framing for shop and combat, the housed span inside the safe area, top-pinned', () => {
    const e = PHONE_HOUSED_SPAN;
    for (const [w, h, ins] of [[852, 393, { top: 0, right: 59, bottom: 21, left: 59 }], [915, 412, { top: 0, right: 0, bottom: 0, left: 24 }]] as const) {
      const plain = fitStage(w, h, ins);
      {
        const top = e.top;
        const f = fitStage(w, h, ins, DESIGN_W, 1.45);
        expect(f.s).toBeGreaterThan(plain.s);
        const box = gameBoxOf(f);
        expect(box.w / box.h).toBeCloseTo(16 / 9, 6);
        expect(box.left + e.left * f.s).toBeGreaterThanOrEqual(ins.left - 1e-6);
        expect(box.left + e.right * f.s).toBeLessThanOrEqual(w - ins.right + 1e-6);
        expect(box.top + top * f.s).toBeCloseTo(ins.top, 6); // top-pinned
        expect(box.top + PHONE_ART_BOTTOM * f.s).toBeLessThanOrEqual(h - ins.bottom + 1e-6);
      }
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
    expect(css).toMatch(/html\[data-touch-ui\]\[data-phone-zoom\] \{\s*--gw: 1920px; --gh: 1080px; --bar-x: var\(--pz-bx\); --bar-y: var\(--pz-by\);/);
  });
  it('the hand rests low with its full plates and a finger pops a card (owner 2026-10-24)', () => {
    const css = readFileSync(join(__dirname, 'touchUi.css'), 'utf8');
    // the plates are never stripped on a zoomed phone any more
    expect(css).not.toMatch(/data-phone-zoom\][^{]*\.row\.hand \.card :is\(\.cardplate/);
    // the pop is keyed off the press class, transform only, and not during a drag
    const pop = css.match(/html\[data-touch-ui\]\[data-phone-zoom\] body:not\(\.dragging\) \.row\.hand \.card\.tt-press \{([^}]*)\}/);
    expect(pop?.[1]).toMatch(/transform:/);
    expect(pop?.[1]).not.toMatch(/box-shadow|filter|top:|bottom:|margin/);
  });
  it('the pop fills ~68% of the safe height, its foot just above the safe bottom, never past a safe edge', () => {
    const safe = { top: 0, right: 59, bottom: 21, left: 59 };
    const base = { width: 50, extentTop: -10, extentBottom: 110, k: 0.4, vw: 852, vh: 393, safe };
    for (const left of [60, 400, 780]) {
      const g = popGeometry({ ...base, left, top: 300 });
      const h = g.s * 120; const avail = 393 - 21;
      expect(h / avail).toBeCloseTo(POP_HEIGHT_FRAC, 6);
      // the popped extent's foot: top + k*ty + s*extentBottom, just above the safe bottom
      const foot = 300 + 0.4 * g.ty + g.s * 110;
      expect(foot).toBeCloseTo(393 - 21 - POP_FOOT_GAP, 6);
      // horizontally inside the safe area
      const l = left + 0.4 * g.tx; const r = l + g.s * 50;
      expect(l).toBeGreaterThanOrEqual(59 + 8 - 1e-6);
      expect(r).toBeLessThanOrEqual(852 - 59 - 8 + 1e-6);
    }
  });
  it('R-PHONE-MENUS-01: the phone menu rules are touch-phone only and zoom the modal panels', () => {
    const css = readFileSync(join(__dirname, 'touchUi.css'), 'utf8');
    const K = 'html[data-touch-ui][data-touch-small]:not([data-phone-layout])';
    for (const sel of ['.pnpanel { zoom: var(--pm-z)', '.bgrpanel { zoom: var(--pm-z)', '.book { zoom: var(--pm-book)', '.lvend .vspanel { zoom: var(--pm-z)']) expect(css).toContain(`${K} ${sel}`);
    // the menu page zoom on a phone
    expect(css).toContain(`${K} { --touch-p: 2.1 !important; }`);
    // board badges step in on a zoomed phone only
    expect(css).toMatch(/html\[data-touch-ui\]\[data-phone-zoom\] \.zone:is\(\[data-zone='tavern'\], \[data-zone='warband'\]\) \.card\.compact \.atk \{ left: var\(--pz-badge-in/);
  });
  it('a press marks only a hand card', () => {
    // a stand-in for the DOM (this suite runs in node): `closest` answers for the hand-card selector only
    const card = { id: 'hand card' } as unknown as Element;
    const inHand = { closest: (sel: string) => (sel === '.row.hand .card' ? card : null) } as unknown as Element;
    const inShop = { closest: () => null } as unknown as Element;
    expect(handCardOf(inHand)).toBe(card);
    expect(handCardOf(inShop)).toBeNull();
    expect(handCardOf(null)).toBeNull();
    expect(PRESS_CLASS).toBe('tt-press');
  });
});

/**
 * ONE PHONE, ONE GAME (owner 2026-10-24, R-PHONE-PARITY-01: "Pixel and iPhone should be 1:1 experience"). The same game at
 * the same share of the screen on every phone, whatever bottom inset its browser reports (iOS 21 pt for the home
 * indicator, Chrome on a Pixel 0 for the same gesture strip).
 */
describe('R-PHONE-PARITY-01: Pixel and iPhone are one experience', () => {
  const PHONES = [
    { name: 'iPhone 15 Pro', w: 852, h: 393, ins: { top: 0, right: 59, bottom: 21, left: 59 } },
    { name: 'Pixel 8', w: 915, h: 412, ins: { top: 0, right: 0, bottom: 0, left: 24 } },
    { name: 'iPhone 15 Pro Max', w: 932, h: 430, ins: { top: 0, right: 59, bottom: 21, left: 59 } },
    { name: 'iPhone 13 mini', w: 812, h: 375, ins: { top: 0, right: 50, bottom: 21, left: 50 } },
    { name: 'Galaxy S23', w: 780, h: 360, ins: { top: 0, right: 0, bottom: 0, left: 30 } },
  ] as const;
  it('a run shows the game at the same share of the screen height on every phone (was 101% vs 107% of the box)', () => {
    const shares = PHONES.filter((q) => q.h >= 393 || q.ins.bottom === 0).map((p) => { const f = fitStage(p.w, p.h, p.ins, DESIGN_W, 1.35, true); return (DESIGN_H * f.s) / p.h; });
    for (const v of shares) expect(v).toBeCloseTo(shares[0], 6);
  });
  it('every housed piece stays on screen and clear of the side cut-outs, top-pinned, one framing', () => {
    const e = PHONE_HOUSED_SPAN;
    for (const p of PHONES) {
      const f = fitStage(p.w, p.h, p.ins, DESIGN_W, 1.35, true);
      const box = gameBoxOf(f);
      expect(box.left + e.left * f.s).toBeGreaterThanOrEqual(p.ins.left - 1e-6);
      expect(box.left + e.right * f.s).toBeLessThanOrEqual(p.w - p.ins.right + 1e-6);
      expect(box.top + e.top * f.s).toBeCloseTo(p.ins.top, 6);
      // R-PHONE-ZOOM-02: the Health plate frames down to a thin foot above the bottom edge (not above the whole strip).
      expect(box.top + PHONE_ART_BOTTOM * f.s).toBeLessThanOrEqual(p.h - PHONE_FOOT_FRAC * p.h + 1e-6);
      // ...and the lobby rail (outside the box, at the right safe edge) stays clear of Refresh.
      const railLeft = p.w - p.ins.right - PHONE_RAIL_FOOTPRINT * f.s;
      expect(railLeft - (box.left + PHONE_REFRESH_RIGHT * f.s)).toBeGreaterThanOrEqual(PHONE_RAIL_GAP - 1e-6);
    }
  });
  it('R-PHONE-ZOOM-02: the run is ~4.6% larger on the reference phones than the 2026-10-24 framing, and the same share on both', () => {
    const iphone = fitStage(852, 393, { top: 0, right: 59, bottom: 21, left: 59 }, DESIGN_W, 1.35, true);
    const pixel = fitStage(915, 412, { top: 0, right: 0, bottom: 0, left: 24 }, DESIGN_W, 1.35, true);
    expect(iphone.s / 0.36832).toBeGreaterThan(1.04);
    expect(pixel.s / 0.38614).toBeGreaterThan(1.04);
    expect((DESIGN_H * iphone.s) / 393).toBeCloseTo((DESIGN_H * pixel.s) / 412, 6);
  });
  it('the menus and hero select (the plain fit) are the same share of the screen on every phone (was 12% apart)', () => {
    const shares = PHONES.map((p) => fitStage(p.w, p.h, p.ins, DESIGN_W, 1, true).s / p.h);
    for (const v of shares) expect(v).toBeCloseTo(shares[0], 9);
  });
  it('the bottom gesture strip is the same share of the screen on every phone, or the reported inset when larger', () => {
    for (const p of PHONES) expect(phoneBottomStrip(p.h, p.ins.bottom)).toBeCloseTo(Math.max(p.ins.bottom, PHONE_GESTURE_FRAC * p.h), 9);
    // the reference phones and every larger one: exactly the shared share (a smaller iPhone keeps its full 21 pt indicator)
    for (const p of PHONES.filter((q) => q.h >= 393)) expect(phoneBottomStrip(p.h, p.ins.bottom) / p.h).toBeCloseTo(PHONE_GESTURE_FRAC, 9);
    expect(phoneBottomStrip(393, 21)).toBeCloseTo(21, 9); // the iPhone keeps exactly its home indicator
    expect(phoneBottomStrip(400, 60)).toBe(60);
  });
  it('the hand pop is one proportion on every phone: the same share of the height, its foot on the strip', () => {
    const fracs = PHONES.filter((q) => q.h >= 393 || q.ins.bottom === 0).map((p) => {
      const g = popGeometry({ width: 50, extentTop: -10, extentBottom: 110, k: 0.4, left: p.w / 2, top: p.h * 0.8, vw: p.w, vh: p.h, safe: popSafe(p.h, p.ins) });
      const foot = p.h * 0.8 + 0.4 * g.ty + g.s * 110;
      expect(p.h - foot).toBeCloseTo(phoneBottomStrip(p.h, p.ins.bottom) + POP_FOOT_GAP, 6);
      return (g.s * 120) / p.h;
    });
    for (const v of fracs) expect(v).toBeCloseTo(fracs[0], 9);
  });
  it('the bottom-edge pieces ride the shared strip in layout px, never the raw inset or screen px', () => {
    const css = readFileSync(join(__dirname, 'touchUi.css'), 'utf8');
    expect(css).toMatch(/\[data-phone-zoom\] \.zone\[data-zone='hand'\] \{ --bar-y: calc\(var\(--pz-safe-b, var\(--safe-b\)\) - 115px \+ 49px\);/);
    expect(css).toMatch(/\[data-phone-zoom\] :is\(\.gearbtn, \.bookbtn, \.rulesbtn\) \{[^}]*bottom: calc\(var\(--pz-safe-b, var\(--safe-b\)\) \+ 15px\);/);
    expect(css).toContain('--edge-b: var(--pz-safe-b, var(--safe-b));');
    // the lobby rail: the same distance from the right safe edge on every phone (no clamp to the box edge)
    expect(css).toContain("html[data-touch-ui][data-phone-zoom] :is(.lobbyrail, .lobbyrailhead) { --lr-right: calc(56px + var(--edge-r) - var(--bar-x));");
    expect(css).not.toMatch(/data-phone-zoom\][^{]*lobbyrail[^{]*\{[^}]*max\(-110px/);
    const zoomRules = css.split('\n').filter((l) => l.includes('[data-phone-zoom]'));
    for (const l of zoomRules) expect(l).not.toMatch(/var\(--safe-b\)\s*[+-]/);
  });
  it('a desktop never takes the phone path: the same fit with or without the flag when there are no insets', () => {
    for (const [w, h] of [[1920, 1080], [2560, 1080], [1366, 768]]) expect(fitStage(w, h, undefined, DESIGN_W, 1, false)).toEqual(fitStage(w, h));
    const src = readFileSync(join(__dirname, 'stage.ts'), 'utf8');
    expect(src).toMatch(/if \(isPhone\(\) && w > h && !phoneLayout\) de\.setProperty\('--pz-safe-b'/);
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
    expect(src).toMatch(/const phoneZoom = !phoneLayout && phoneZoomApplies\(isPhone\(\), w, h, !!PHONE_DIAG\.nophonezoom, inRun\)/);
    expect(src).toMatch(/fitStage\(w, h, insets, phoneLayout \? PHONE_DESIGN_W : DESIGN_W, phoneZoom \? phoneZoomOf\(PHONE_DIAG\) : 1, isPhone\(\) && !phoneLayout\)/);
  });
  it('Discover shows full cards on a phone only', () => {
    expect(readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8')).toMatch(/full=\{phoneLayoutOn\(\)\}/);
  });
  it('the desktop design width is still 1920', () => {
    expect(DESIGN_W).toBe(1920);
  });
});
