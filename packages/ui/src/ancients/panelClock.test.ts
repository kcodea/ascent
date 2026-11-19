import { describe, expect, it } from 'vitest';
import { ANCIENTS_DEFAULTS, gateStyleOf } from './ancientsConfig';
import { PANEL_FIGURE_FIT, PANEL_FIGURE_REST, PANEL_LAND, PANEL_PULSE, panelFromTop, panelGeometry, panelRank, panelTimeline, seamX, slideLeadY, stripPolygon } from './panelClock';

/**
 * THE AWAKENING'S SIX PANELS (owner 2026-11-18): "the ancient itself to slide down into place from completely off
 * the screen either top or bottom, and then slide and slam to a stop", then "3 shake and their edges glow as the other three fade out and fall away, revealing
 * the ancient select screen". The clock and geometry every layer reads.
 */
describe('the awakening panels clock', () => {
  const tl = panelTimeline(ANCIENTS_DEFAULTS);

  it('is the default gate style, with the curtain still selectable', () => {
    expect(ANCIENTS_DEFAULTS.gateStyle).toBe('panels');
    expect(gateStyleOf('curtain')).toBe('curtain');
    expect(gateStyleOf('nonsense')).toBe('panels');
  });

  // Owner 2026-11-18: "i dont like how the rainbow of colors shows up and then the ancients slide in. i want each
  // background to slide in with the ancient quickly following. and we can try doing it outside to inside".
  it('sets the panels off outside to inside: the outer pair, the next pair, the middle pair', () => {
    expect(tl.bg).toHaveLength(6);
    expect([0, 1, 2, 3, 4, 5].map((i) => panelRank(i))).toEqual([0, 1, 2, 2, 1, 0]);
    for (const [outer, inner] of [[0, 1], [5, 4], [1, 2], [4, 3], [5, 1], [4, 2]] as const) expect(tl.bg[inner]!).toBeGreaterThan(tl.bg[outer]!);
    // A pair goes together, the left of the two a moment first.
    for (const [l, r] of [[0, 5], [1, 4], [2, 3]] as const) expect(tl.bg[r]! - tl.bg[l]!).toBe(ANCIENTS_DEFAULTS.panelPairGapMs);
  });

  it('sends each Ancient quickly after its OWN background, never after all six', () => {
    for (let i = 0; i < 6; i++) {
      expect(tl.slide[i]! - tl.bg[i]!).toBe(ANCIENTS_DEFAULTS.panelFollowMs);
      expect(ANCIENTS_DEFAULTS.panelFollowMs).toBeLessThan(ANCIENTS_DEFAULTS.panelBgMs);
    }
    // The outer Ancients are already moving before the middle backgrounds set off.
    expect(tl.slide[0]!).toBeLessThan(tl.bg[2]!);
  });

  it('slams each Ancient before its slide ends', () => {
    for (let i = 0; i < 6; i++) {
      expect(tl.land[i]!).toBeCloseTo(tl.slide[i]! + ANCIENTS_DEFAULTS.panelSlideMs * PANEL_LAND, 5);
      expect(tl.land[i]!).toBeLessThan(tl.allIn);
      expect(tl.slide[i]! + ANCIENTS_DEFAULTS.panelSlideMs).toBeLessThanOrEqual(tl.allIn);
    }
  });

  it('holds the six, then picks three, then reveals: in that order', () => {
    expect(tl.pickAt).toBe(tl.allIn + ANCIENTS_DEFAULTS.panelHoldMs);
    // Owner 2026-11-18: "their edges to pulse before the others fade away": the fall waits for the whole pulse.
    expect(tl.fallAt).toBeGreaterThanOrEqual(tl.pickAt + ANCIENTS_DEFAULTS.panelRattleMs);
    expect(PANEL_PULSE.filter(([, o]) => o === 1).length).toBeGreaterThanOrEqual(3); // lit, then two more pulses
    expect(PANEL_PULSE[PANEL_PULSE.length - 1]).toEqual([1, 1]); // ends lit
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

    // Owner 2026-11-19 (layered portraits): the tall cut-out stands whole in the strip, running off the bottom.
    it(`stands a layered figure top to bottom in the ${vw}x${vh} strip`, () => {
      const h = g.figS * (PANEL_FIGURE_FIT.width / 100) * 1.5 * PANEL_FIGURE_REST; // a 2:3 image, at its rest size
      const top = vh / 2 + (-g.figS / 2 + g.figS * PANEL_FIGURE_FIT.top / 100) * PANEL_FIGURE_REST;
      expect(top).toBeLessThanOrEqual(vh * 0.02); // its top is at the top of the screen
      expect(top + h).toBeGreaterThanOrEqual(vh); // and it runs off the bottom
    });

    it(`sweeps the grinding sparks across the whole ${vw}x${vh} height`, () => {
      expect(slideLeadY(g, true, 0)).toBeCloseTo(0, 5);
      expect(slideLeadY(g, true, 1)).toBeCloseTo(vh, 5);
      expect(slideLeadY(g, false, 0)).toBeCloseTo(vh, 5);
      expect(slideLeadY(g, false, 1)).toBeCloseTo(0, 5);
    });
  }
});
