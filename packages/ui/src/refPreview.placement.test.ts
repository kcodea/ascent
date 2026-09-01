import { describe, expect, it } from 'vitest';
import { refPopupLeft } from './refPreviewPlacement';

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
