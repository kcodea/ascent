import { describe, expect, it } from 'vitest';
import { fitRefPopup, refPopupLeft } from './refPreviewPlacement';

/**
 * THE REFERENCED-CARD POPUP'S PLACEMENT (owner report 2026-08-31: *"please dont shove it off to the left
 * side of the screen"*).
 *
 * Drives the REAL `refPopupLeft` that `Card.tsx` calls — an earlier cut of this file re-implemented the
 * rule locally, which tests a copy and drifts the moment the real one changes.
 *
 * Three cases, and the third is the bug: a cluster too wide for EITHER side used to clamp to x=6, which laps
 * the hovered card and the left-hand UI both, and reads as the popup having escaped rather than been placed.
 */
describe('referenced-card popup placement', () => {
  it('sits to the RIGHT of the card when there is room', () => {
    expect(refPopupLeft({ cardLeft: 200, cardRight: 340, tipW: 300, viewportW: 1600 })).toBe(350);
  });

  it('flips LEFT when the right side would overflow', () => {
    expect(refPopupLeft({ cardLeft: 1200, cardRight: 1340, tipW: 300, viewportW: 1600 })).toBe(890);
  });

  it('CENTRES when it fits on neither side, instead of pinning to the left edge', () => {
    // The reported case: a wide cluster on a card near the left. Pinned, this returned 6.
    const left = refPopupLeft({ cardLeft: 240, cardRight: 380, tipW: 1400, viewportW: 1600 });
    expect(left, 'centred, not slammed against the edge').toBe(100);
    expect(left, 'and specifically NOT the old clamp').not.toBe(6);
  });

  it('still refuses to go off-screen when the cluster is wider than the viewport', () => {
    // Degenerate but reachable on a narrow window: centring would give a negative left, so the edge wins.
    expect(refPopupLeft({ cardLeft: 100, cardRight: 240, tipW: 2000, viewportW: 1200 })).toBe(6);
  });
});

/**
 * THE MEASURED PASS (player report 2026-10-08: *"I can't read the Lasso spell when the Rune of Lassoing is the
 * rightmost rune"*). The forge opened the Rope Wrangler + Lasso chain from an estimate (~300 px) that was far
 * short of the real plated pair (~480 px), so it never flipped and the Lasso ran off the right edge. Given the
 * MEASURED size, `fitRefPopup` must keep the whole chain on screen.
 */
describe('fitRefPopup (the measured second pass)', () => {
  const vp = { viewportW: 1440, viewportH: 900 };

  it('flips the chain LEFT of a right-hand rune once the real width is known', () => {
    // The 1440 repro: Lassoing at 905..1063, the real chain 481 px wide.
    const fit = fitRefPopup({ anchorLeft: 905, anchorRight: 1063, prefTop: 311, w: 481, h: 158, ...vp });
    expect(fit.origin).toBe('right');
    expect(fit.left + 481).toBeLessThanOrEqual(905 - 10);
    expect(fit.left).toBeGreaterThanOrEqual(6);
  });

  it('keeps a chain that fits on the right where it is', () => {
    expect(fitRefPopup({ anchorLeft: 200, anchorRight: 340, prefTop: 100, w: 400, h: 300, ...vp }))
      .toEqual({ left: 350, top: 100, origin: 'left' });
  });

  it('never leaves the chain hanging off ANY edge', () => {
    for (const anchorLeft of [0, 150, 500, 900, 1200, 1380]) {
      for (const w of [200, 480, 900, 1300]) {
        const fit = fitRefPopup({ anchorLeft, anchorRight: anchorLeft + 60, prefTop: 850, w, h: 400, ...vp });
        expect(fit.left).toBeGreaterThanOrEqual(6);
        expect(fit.left + w).toBeLessThanOrEqual(1440 - 6);
        expect(fit.top + 400).toBeLessThanOrEqual(900 - 6);
      }
    }
  });
});
