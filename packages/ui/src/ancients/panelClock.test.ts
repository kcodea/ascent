import { describe, expect, it } from 'vitest';
import { ANCIENTS_DEFAULTS, gateStyleOf } from './ancientsConfig';
import { PANEL_LAND, panelFromTop, panelGeometry, panelTimeline, seamX, slideLeadY, stripPolygon } from './panelClock';

/**
 * THE AWAKENING'S SIX PANELS (owner 2026-11-18): "i want all 6 background colors to pop in from left to right, and
 * then the ancient itself to slide down into place from completely off the screen either top or bottom, and then
 * slide and slam to a stop", then "3 shake and their edges glow as the other three fade out and fall away, revealing
 * the ancient select screen". The clock and geometry every layer reads.
 */
describe('the awakening panels clock', () => {
  const tl = panelTimeline(ANCIENTS_DEFAULTS);

  it('is the default gate style, with the curtain still selectable', () => {
    expect(ANCIENTS_DEFAULTS.gateStyle).toBe('panels');
    expect(gateStyleOf('curtain')).toBe('curtain');
    expect(gateStyleOf('nonsense')).toBe('panels');
  });

  it('pops the six colours left to right, all before any Ancient sets off', () => {
    expect(tl.pop).toHaveLength(6);
    for (let i = 1; i < 6; i++) expect(tl.pop[i]!).toBeGreaterThan(tl.pop[i - 1]!);
    expect(tl.slide[0]!).toBeGreaterThan(tl.pop[5]! + ANCIENTS_DEFAULTS.panelPopMs * 0.5);
  });

  it('slides each Ancient in after the one to its left, and each slams before its slide ends', () => {
    for (let i = 0; i < 6; i++) {
      if (i > 0) expect(tl.slide[i]!).toBeGreaterThan(tl.slide[i - 1]!);
      expect(tl.land[i]!).toBeCloseTo(tl.slide[i]! + ANCIENTS_DEFAULTS.panelSlideMs * PANEL_LAND, 5);
      expect(tl.land[i]!).toBeLessThan(tl.allIn);
    }
  });

  it('holds the six, then picks three, then reveals: in that order', () => {
    expect(tl.titleAt).toBeLessThanOrEqual(tl.allIn);
    expect(tl.pickAt).toBe(tl.allIn + ANCIENTS_DEFAULTS.panelHoldMs);
    expect(tl.fallAt).toBeGreaterThan(tl.pickAt);
    expect(tl.revealAt).toBeGreaterThanOrEqual(tl.pickAt + ANCIENTS_DEFAULTS.panelRattleMs);
  });

  it('alternates top and bottom', () => {
    expect([0, 1, 2, 3, 4, 5].map(panelFromTop)).toEqual([true, false, true, false, true, false]);
  });
});

describe('the awakening panels geometry', () => {
  // A 16:9 stage and an ultrawide one: the panels span the layout viewport, whatever its shape.
  for (const [vw, vh] of [[1920, 1080], [2520, 1080]] as const) {
    const g = panelGeometry(vw, vh, ANCIENTS_DEFAULTS.panelSlant);

    it(`tiles ${vw}x${vh} edge to edge with no gap between neighbours`, () => {
      for (let i = 0; i < 5; i++) {
        // Panel i's right edge and panel i+1's left edge are the same slanted line (stage px, top and bottom).
        expect(g.left[i]! + g.boxW).toBeCloseTo(g.left[i + 1]! + 2 * g.slant, 5);
        expect(g.left[i]! + g.boxW - 2 * g.slant).toBeCloseTo(g.left[i + 1]!, 5);
        expect(seamX(g, i + 1, 0)).toBeCloseTo(g.left[i]! + g.boxW, 5);
        expect(seamX(g, i + 1, vh)).toBeCloseTo(g.left[i + 1]!, 5);
      }
      // The outer two run past the stage, so a slanted corner never shows the Shop.
      expect(stripPolygon(g, 0)).toContain(`${(-vw + 2 * g.slant).toFixed(1)}px 0px`);
      expect(stripPolygon(g, 5)).toContain(`${(g.boxW + vw).toFixed(1)}px 0px`);
    });

    it(`starts each Ancient completely off the ${vw}x${vh} screen`, () => {
      // The Ancient's square is centred on the stage; moved by `travel` it must clear the edge it came from.
      expect(g.travel).toBeGreaterThanOrEqual(vh / 2 + g.figS / 2);
    });

    it(`sweeps the grinding sparks across the whole ${vw}x${vh} height`, () => {
      expect(slideLeadY(g, true, 0)).toBeCloseTo(0, 5);
      expect(slideLeadY(g, true, 1)).toBeCloseTo(vh, 5);
      expect(slideLeadY(g, false, 0)).toBeCloseTo(vh, 5);
      expect(slideLeadY(g, false, 1)).toBeCloseTo(0, 5);
    });
  }
});
