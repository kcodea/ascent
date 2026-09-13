import { describe, expect, it } from 'vitest';
import { HeadTrail, smoothAngle, type TrailPoint } from './trail';

describe('smoothAngle', () => {
  it('takes the shortest arc across ±π and snaps at alpha 1', () => {
    expect(smoothAngle(3.0, -3.0, 1)).toBeCloseTo(3.0 + (2 * Math.PI - 6.0), 6); // goes the short way (through π)
    expect(smoothAngle(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smoothAngle(0, 1, 0)).toBe(0);
  });
});

describe('HeadTrail', () => {
  it('ignores sub-pixel jitter and reports the heading of the last real move', () => {
    const t = new HeadTrail();
    expect(t.headingRad()).toBeNull();
    t.push(0, 0); t.push(0.1, 0.1); // jitter: skipped
    expect(t.count).toBe(1);
    t.push(10, 0);
    expect(t.headingRad()).toBeCloseTo(0);
    t.push(10, 10);
    expect(t.headingRad()).toBeCloseTo(Math.PI / 2);
  });

  it('samples a straight path evenly, tail → head, relative to the head', () => {
    const t = new HeadTrail();
    for (let x = 0; x <= 100; x += 10) t.push(x, 0);
    const out: TrailPoint[] = [];
    t.sample(5, 40, out);
    expect(out.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[-40, 0], [-30, 0], [-20, 0], [-10, 0], [0, 0]]);
  });

  it('extends straight back when the recorded path is shorter than the requested length', () => {
    const t = new HeadTrail();
    t.push(0, 0); t.push(10, 0); // only 10 px recorded, heading +x
    const out: TrailPoint[] = [];
    t.sample(3, 100, out);
    expect(out[2]).toEqual({ x: 0, y: 0 });         // head
    expect(out[0].x).toBeCloseTo(-100);             // tail extended along -x
    expect(out[0].y).toBeCloseTo(0);
  });

  it('bends along a corner: samples on an L are not collinear', () => {
    const t = new HeadTrail();
    for (let x = 0; x <= 50; x += 10) t.push(x, 0);   // right 50
    for (let y = 10; y <= 50; y += 10) t.push(50, y); // then down 50
    const out: TrailPoint[] = [];
    t.sample(5, 80, out);
    // head at (0,0); the sample 40 px back sits at the corner region: x<0 and y<0 both present in the set
    expect(out[4]).toEqual({ x: 0, y: 0 });
    expect(out.some((p) => p.x < -1 && Math.abs(p.y) > 1)).toBe(true);
    expect(out[0].y).toBeCloseTo(-50); // tail 80 px back = 30 px along the first leg, i.e. y = -50 relative to head
  });

  it('reuses the point objects in `out`', () => {
    const t = new HeadTrail();
    t.push(0, 0); t.push(5, 0);
    const out: TrailPoint[] = [];
    t.sample(3, 10, out);
    const first = out[0];
    t.push(10, 0);
    t.sample(3, 10, out);
    expect(out[0]).toBe(first);
  });

  it('trims old points beyond keepLength', () => {
    const t = new HeadTrail(30, 0.5);
    for (let x = 0; x <= 100; x += 10) t.push(x, 0);
    expect(t.length).toBeLessThanOrEqual(40);
    expect(t.count).toBeLessThan(11);
  });
});
