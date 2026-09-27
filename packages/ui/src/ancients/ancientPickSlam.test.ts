import { describe, expect, it } from 'vitest';
import { ANCIENTS_DEFAULTS } from './ancientsConfig';
import { pickTimeline } from './ancientPickSlam';

/** THE PICK → SLAM's clock (owner 2026-09-27): anticipation → contact → hit-stop → release, then the split's
 *  follow-through, all inside the ~0.9-1.4 s window the research note argues for. */
describe('the Ancient pick timeline', () => {
  it('lands contact after the lift + flight, releases after the hit-stop, and ends once the card is absorbed', () => {
    const t = pickTimeline(ANCIENTS_DEFAULTS, false);
    expect(t).toEqual({ fade: 380, contact: 480, release: 550, end: 640 });
    // The backdrop has cleared BEFORE contact, so the hero power is in view when it is hit.
    expect(t.fade).toBeLessThan(t.contact);
    // Click → the split settled (the crack starts drawing at the release; the half enters halfway through it).
    const settled = t.release + ANCIENTS_DEFAULTS.crackOpenMs * 0.5 + ANCIENTS_DEFAULTS.splitMs;
    expect(settled).toBeGreaterThanOrEqual(900);
    expect(settled).toBeLessThanOrEqual(1400);
  });
  it('reduced motion is a short fade with no hit-stop', () => {
    const t = pickTimeline(ANCIENTS_DEFAULTS, true);
    expect(t.contact).toBe(t.release);
    expect(t.end).toBeLessThanOrEqual(300);
  });
});
