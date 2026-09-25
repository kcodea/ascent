import { describe, expect, it } from 'vitest';
import {
  WIPE_FRONT_RING_FRAC, WIPE_FRONT_TEXTURE_PX, wipeCoverRadius, wipeFrontScale, wipeOriginFor,
} from './wipeGeometry';

// Owner bug 2026-09-24: "the screen wipes between combat/shop seem not built for 21:9 and stop/pause here …
// can you make sure the animation fully covers the ultrawide display as well?"
const VIEWPORTS: Array<[string, number, number]> = [
  ['16:9 1080p', 1920, 1080],
  ['16:9 1440p', 2560, 1440],
  ['16:10', 1680, 1050],
  ['21:9 2560x1080', 2560, 1080],
  ['21:9 3440x1440', 3440, 1440],
  ['32:9 5120x1440', 5120, 1440],
  ['portrait-ish', 900, 1400],
];
// Anchors as viewport fractions: where the gem sits on 16:9, the centre, every corner, and off-screen.
const ANCHORS: Array<[number, number]> = [[0.84, 0.62], [0.733, 0.43], [0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1], [1.1, -0.1]];

describe('wipe cover geometry', () => {
  for (const [name, vw, vh] of VIEWPORTS) {
    it(`covers every corner at ${name}`, () => {
      for (const [fx, fy] of ANCHORS) {
        const cx = vw * fx, cy = vh * fy;
        const r = wipeCoverRadius(cx, cy, vw, vh);
        for (const [x, y] of [[0, 0], [vw, 0], [0, vh], [vw, vh]] as const) {
          expect(Math.hypot(x - cx, y - cy)).toBeLessThan(r);
        }
      }
    });

    it(`puts the ring on the seam and past the farthest corner at ${name}`, () => {
      const o = wipeOriginFor(vw, vh, { left: vw * 0.8, top: vh * 0.6, width: 80, height: 80 });
      const ringLine = (WIPE_FRONT_TEXTURE_PX / 2) * WIPE_FRONT_RING_FRAC * o.frontScale;
      expect(ringLine).toBeCloseTo(o.r, 6);
      // The glow's outer fringe (the texture's full radius) ends beyond the cover radius.
      expect((WIPE_FRONT_TEXTURE_PX / 2) * o.frontScale).toBeGreaterThan(o.r);
    });
  }

  it('grows with the viewport width (the old fixed ring did not)', () => {
    const wide = wipeOriginFor(5120, 1440, null);
    const std = wipeOriginFor(1920, 1080, null);
    expect(wide.r).toBeGreaterThan(std.r * 2);
    expect(wide.frontScale).toBeGreaterThan(4.4); // the old hard-coded scale fell short on ultrawide
  });

  it('falls back to the stage gem position when the gem is not mounted', () => {
    const o = wipeOriginFor(1000, 500, null);
    expect(o.cx).toBeCloseTo(840);
    expect(o.cy).toBeCloseTo(310);
    expect(o.frontScale).toBeCloseTo(wipeFrontScale(o.r));
  });
});
