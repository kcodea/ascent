import { describe, expect, it } from 'vitest';
import { flipAngle, flipPoseAt, projectTurnedRect, type FlipPose } from './cardFlip';

describe('cardFlip: the first half of a flip', () => {
  it('turns from flat to just short of edge-on, never backwards', () => {
    expect(flipAngle(0)).toBe(0);
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const a = flipAngle(p);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    expect(flipAngle(1)).toBeLessThan(Math.PI / 2);
    expect(flipAngle(1)).toBeGreaterThan(Math.PI / 2 - 0.01);
  });

  it('covers half the way to its target by 90 degrees, and lifts', () => {
    const out: FlipPose = { cx: 0, cy: 0, s: 0 };
    const path = { c0x: 100, c0y: 50, tx: 300, ty: 150, scale: 1.3, lift: 0.1 };
    expect(flipPoseAt(path, 0, out)).toEqual({ cx: 100, cy: 50, s: 1.3 });
    flipPoseAt(path, 1, out);
    expect(out.cx).toBeCloseTo(200);
    expect(out.cy).toBeCloseTo(100);
    expect(out.s).toBeCloseTo(1.43);
  });

  it('flat, the corners are the plain rect; turned, the left edge comes forward and the card narrows', () => {
    const c = new Float64Array(8);
    projectTurnedRect(c, 0, 0, 1, 0, 1000, -50, -70, 50, 70);
    expect(Array.from(c)).toEqual([-50, -70, 50, -70, 50, 70, -50, 70]);
    projectTurnedRect(c, 0, 0, 1, Math.PI / 3, 1000, -50, -70, 50, 70);
    const leftH = c[7] - c[1], rightH = c[5] - c[3];
    expect(leftH).toBeGreaterThan(140);
    expect(rightH).toBeLessThan(140);
    expect(c[2] - c[0]).toBeLessThan(100);
  });
});
