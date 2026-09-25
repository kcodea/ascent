import { describe, expect, it } from 'vitest';
import {
  WIPE_FRONT_TEXTURE_PX, cubicBezier, ellipseCovers, wipeAspect, wipeCoverEllipse, wipeCoverRadius, wipeFrontScale,
  wipeOriginFor,
} from './wipeGeometry';

// Owner bugs 2026-09-24: "the screen wipes between combat/shop seem not built for 21:9 and stop/pause here … can
// you make sure the animation fully covers the ultrawide display as well?", then "the screen wipe still isnt
// perfect, can you make it smoother/wider/cleaner so that there's no jank on an ultrawide?"
const VIEWPORTS: Array<[string, number, number]> = [
  ['16:9 1080p', 1920, 1080],
  ['16:9 1440p', 2560, 1440],
  ['16:10', 1680, 1050],
  ['21:9 2560x1080', 2560, 1080],
  ['21:9 3440x1440', 3440, 1440],
  ['32:9 5120x1440', 5120, 1440],
  ['portrait-ish', 900, 1400],
];
// Anchors as viewport fractions: where the gem sits, the centre, every corner, and off-screen.
const ANCHORS: Array<[number, number]> = [[0.84, 0.62], [0.733, 0.43], [0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1], [1.1, -0.1]];
const STRETCH = [0, 0.5, 1, 1.5];

describe('wipe cover geometry', () => {
  for (const [name, vw, vh] of VIEWPORTS) {
    it(`the circle covers every corner at ${name}`, () => {
      for (const [fx, fy] of ANCHORS) {
        const cx = vw * fx, cy = vh * fy;
        const r = wipeCoverRadius(cx, cy, vw, vh);
        for (const [x, y] of [[0, 0], [vw, 0], [0, vh], [vw, vh]] as const) expect(Math.hypot(x - cx, y - cy)).toBeLessThan(r);
      }
    });

    it(`the ellipse covers every corner at ${name}, for every stretch`, () => {
      for (const amount of STRETCH) {
        for (const [fx, fy] of ANCHORS) {
          const o = wipeOriginFor(vw, vh, { left: vw * fx - 40, top: vh * fy - 40, width: 80, height: 80 }, { ellipse: amount });
          for (const [x, y] of [[0, 0], [vw, 0], [0, vh], [vw, vh]] as const) expect(ellipseCovers(o, x, y)).toBe(true);
        }
      }
    });

    it(`puts the ring's bright line on the seam, on both axes, at ${name}`, () => {
      for (const ringLine of [0.97, 0.88, 0.7]) {
        const o = wipeOriginFor(vw, vh, { left: vw * 0.8, top: vh * 0.6, width: 80, height: 80 }, { ellipse: 1, ringLine });
        expect((WIPE_FRONT_TEXTURE_PX / 2) * ringLine * o.frontScaleX).toBeCloseTo(o.rx, 6);
        expect((WIPE_FRONT_TEXTURE_PX / 2) * ringLine * o.frontScaleY).toBeCloseTo(o.ry, 6);
      }
    });
  }

  it('is a circle on 16:9 (and narrower) whatever the stretch, and wider on ultrawide', () => {
    expect(wipeAspect(1920, 1080, 1)).toBe(1);
    expect(wipeAspect(900, 1400, 1)).toBe(1);
    expect(wipeAspect(3440, 1440, 0)).toBe(1);
    expect(wipeAspect(3440, 1440, 1)).toBeCloseTo((3440 / 1440) / (16 / 9), 6);
    expect(wipeAspect(5120, 1440, 1)).toBeCloseTo(2, 6);
    const o = wipeOriginFor(1920, 1080, null, { ellipse: 1 });
    expect(Math.abs(o.rx - o.ry)).toBeLessThanOrEqual(3); // the padding only
  });

  it('on ultrawide the ellipse reaches the SIDES earlier in the bloom than the circle did', () => {
    // The far (left) edge's share of the full radius is the progress at which the seam reaches it: lower = the
    // bloom stops spending its tail crawling across a thin side strip.
    const vw = 3440, vh = 1440, cx = vw * 0.733, cy = vh * 0.43;
    const circle = wipeCoverRadius(cx, cy, vw, vh);
    const ell = wipeCoverEllipse(cx, cy, vw, vh, wipeAspect(vw, vh, 1));
    const circleTop = Math.max(cy, vh - cy) / circle;
    const ellTop = Math.max(cy, vh - cy) / ell.ry;
    // Circle: top/bottom covered very early, the left side very late. Ellipse: the gap between them narrows.
    expect(cx / ell.rx - ellTop).toBeLessThan(cx / circle - circleTop);
  });

  it('falls back to the stage gem position when the gem is not mounted', () => {
    const o = wipeOriginFor(1000, 500, null);
    expect(o.cx).toBeCloseTo(840);
    expect(o.cy).toBeCloseTo(310);
    expect(o.frontScaleX).toBeCloseTo(wipeFrontScale(o.rx));
  });

  it('evaluates the CSS cubic-bezier the curtain runs', () => {
    const e = cubicBezier(0.45, 0, 0.7, 0.85);
    expect(e(0)).toBe(0);
    expect(e(1)).toBe(1);
    for (let t = 0.1; t < 1; t += 0.1) expect(e(t)).toBeGreaterThan(e(t - 0.1));
    // Linear is the identity.
    const lin = cubicBezier(0, 0, 1, 1);
    expect(lin(0.37)).toBeCloseTo(0.37, 3);
  });
});
