import { describe, expect, it } from 'vitest';
import { ANCIENTS_DEFAULTS } from './ancientsConfig';
import { pickTimeline } from './ancientPickSlam';

/** THE PICK's clock (owner 2026-09-27): collapse → the triple's trail (its own 420 ms flight × 0.75) → contact → hit-stop →
 *  release, then the split's follow-through, inside the ~0.9-1.4 s window the research note argues for. */
describe('the Ancient pick timeline', () => {
  it('launches the triple trail out of the collapse, lands it, holds, releases', () => {
    const t = pickTimeline(ANCIENTS_DEFAULTS, false);
    expect(t).toEqual({ fade: 380, launch: 140, contact: 455, release: 515, end: 575 });
    // The trail leaves before the collapse has finished (a hand-off, no dead frame between them).
    expect(t.launch).toBeLessThan(ANCIENTS_DEFAULTS.collapseMs);
    // The backdrop has cleared BEFORE contact, so the hero power is in view when it is hit.
    expect(t.fade).toBeLessThan(t.contact);
    // Click → the split settled (the crack starts drawing at the release; the half enters halfway through it).
    const settled = t.release + ANCIENTS_DEFAULTS.crackOpenMs * 0.5 + ANCIENTS_DEFAULTS.splitMs;
    expect(settled).toBeGreaterThanOrEqual(900);
    expect(settled).toBeLessThanOrEqual(1400);
  });
  it('the trail speed dial stretches only the flight', () => {
    const t = pickTimeline({ ...ANCIENTS_DEFAULTS, trailTime: 0.5 }, false);
    expect(t.contact - t.launch).toBe(210);
  });
  it('reduced motion is a short fade with no hit-stop', () => {
    const t = pickTimeline(ANCIENTS_DEFAULTS, true);
    expect(t.contact).toBe(t.release);
    expect(t.end).toBeLessThanOrEqual(300);
  });
});
