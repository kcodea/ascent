import { describe, expect, it } from 'vitest';
import {
  aimInto, glossBandInto, glossD, glossSpecAlpha, glossStripU, newGlossBand, newTilt, newTiltPose, setTiltPose, stepTilt,
  tiltEaseK, tiltInto, tiltTargetInto,
} from './packTilt';

const W = 300, PH = 547;
const DIVE = { tiltMax: 16, tiltEase: 0.4, perspective: 600 }; // the owner's drag dive (dragFeel.ts)

describe('the sealed tilt: pointer position to angles', () => {
  it('normalises the pointer about the pack centre and clamps it', () => {
    const a = { x: 0, y: 0 };
    expect(aimInto(a, W / 2, PH / 2, W, PH)).toEqual({ x: 0, y: 0 });
    expect(aimInto(a, W, PH, W, PH)).toEqual({ x: 1, y: 1 });
    expect(aimInto(a, -500, 9999, W, PH)).toEqual({ x: -1, y: 1 });
    expect(aimInto(a, W * 0.75, PH * 0.25, W, PH)).toEqual({ x: 0.5, y: -0.5 });
  });

  it('targets tiltMax x packTilt at the edge, clamped there, with the drag dive signs', () => {
    const t = { rx: 0, ry: 0 };
    tiltTargetInto(t, 1, 0, DIVE.tiltMax, 0.6, true);
    expect(t.ry).toBeCloseTo(9.6); // aim right: rotY > 0, the right edge recedes (the dive's east)
    expect(t.rx).toBeCloseTo(0);
    tiltTargetInto(t, 0, 1, DIVE.tiltMax, 0.6, true);
    expect(t.rx).toBeCloseTo(-9.6); // aim down: rotX < 0, the bottom edge recedes (the dive's south)
    tiltTargetInto(t, 5, -5, DIVE.tiltMax, 1.5, true); // an out-of-range aim still stops at the ceiling
    expect(t.ry).toBe(24);
    expect(t.rx).toBe(24);
    tiltTargetInto(t, 0.5, 0.5, DIVE.tiltMax, 0, true);
    expect([t.rx, t.ry]).toEqual([0, 0]);
  });

  it('is flat outside the sealed phase', () => {
    const t = { rx: 3, ry: 3 };
    tiltTargetInto(t, 1, 1, DIVE.tiltMax, 1.5, false);
    expect([t.rx, t.ry]).toEqual([0, 0]);
  });
});

describe('the sealed tilt: easing', () => {
  it('uses the drag dive ease (tiltEase per 60 Hz frame, frame-rate independent)', () => {
    expect(tiltEaseK(0.4, 16.667)).toBeCloseTo(0.4);
    expect(tiltEaseK(1, 5)).toBe(1);
    // two half frames = one full frame
    const half = tiltEaseK(0.4, 16.667 / 2);
    expect(1 - (1 - half) * (1 - half)).toBeCloseTo(0.4);
  });

  it('converges on the target and then reports settled', () => {
    const s = newTilt();
    const k = tiltEaseK(DIVE.tiltEase, 16.667);
    let frames = 0;
    while (stepTilt(s, 1, 0, 0, 9.6, k) && frames < 200) frames++;
    expect(frames).toBeLessThan(40);
    expect(s.ry).toBe(9.6);
    expect(s.ax).toBe(1);
    expect(stepTilt(s, 1, 0, 0, 9.6, k)).toBe(false);
  });

  it('eases flat within ~150 ms once the opening begins', () => {
    const s = newTilt();
    s.rx = -9.6; s.ry = 9.6;
    const k = tiltEaseK(DIVE.tiltEase, 16.667);
    for (let f = 0; f < 9; f++) stepTilt(s, 1, 1, 0, 0, k); // 9 frames = 150 ms at 60 Hz
    expect(Math.abs(s.ry)).toBeLessThan(0.15);
    expect(Math.abs(s.rx)).toBeLessThan(0.15);
    for (let f = 0; f < 30; f++) stepTilt(s, 1, 1, 0, 0, k);
    expect([s.rx, s.ry]).toEqual([0, 0]);
  });
});

describe('the sealed tilt: projection', () => {
  it('a flat pose is the identity', () => {
    const p = setTiltPose(newTiltPose(), 0, 0, W / 2, PH / 2, 470);
    expect(p.flat).toBe(true);
    const o = { x: 0, y: 0 };
    expect(tiltInto(o, 12, 34, 0, p)).toEqual({ x: 12, y: 34 });
  });

  it('the edge nearest the cursor recedes (shrinks toward the pivot), the far edge comes forward', () => {
    const p = setTiltPose(newTiltPose(), 0, 9.6, W / 2, PH / 2, DIVE.perspective / 1.3);
    const r = tiltInto({ x: 0, y: 0 }, W, 0, 0, p), l = tiltInto({ x: 0, y: 0 }, 0, 0, 0, p);
    expect(r.x).toBeGreaterThan(W / 2); // still right of centre
    expect(r.x - W / 2).toBeLessThan(W / 2); // the right edge moved in
    expect(W / 2 - l.x).toBeGreaterThan(W / 2); // the left edge moved out
    expect(Math.abs(r.y - PH / 2)).toBeLessThan(Math.abs(l.y - PH / 2)); // and the right edge is shorter (farther)
    const down = setTiltPose(newTiltPose(), -9.6, 0, W / 2, PH / 2, 470);
    const b = tiltInto({ x: 0, y: 0 }, W / 2, PH, 0, down);
    expect(b.y - PH / 2).toBeLessThan(PH / 2); // the bottom edge recedes
  });
});

describe('the gloss band', () => {
  it('the strip lookup is exactly the old one with no gloss', () => {
    for (const th of [0, 0.3, 1, 2.5, Math.PI]) expect(glossStripU(th, 0, 0)).toBe(Math.min(0.999, th / Math.PI));
  });

  it('peaks on the spec glint at the band centre and fades to the plain lookup at its edges', () => {
    expect(glossStripU(0, 0, 0.25)).toBeCloseTo(0.25);
    expect(glossStripU(0, 1, 0.25)).toBe(0);
    expect(glossStripU(0, -1.4, 0.25)).toBe(0);
  });

  it('slides with the aim and the tilt; sharpness narrows it; no gloss puts nothing on the strip', () => {
    const b = newGlossBand();
    glossBandInto(b, 0.6, 0.5, 0, 0, 0, 0, 16, W, PH);
    expect(b.centre).toBeCloseTo(W / 2);
    expect(glossD(b, W / 2, PH / 2)).toBeCloseTo(0); // through the pack's centre at rest
    const rest = b.centre, satin = newGlossBand(), glassy = newGlossBand();
    glossBandInto(b, 0.6, 0.5, 1, 0, 0, 0, 16, W, PH);
    expect(b.centre).toBeLessThan(rest); // a reflection moves against the hand
    const aimOnly = b.centre;
    glossBandInto(b, 0.6, 0.5, 1, 0, 0, 9.6, 16, W, PH);
    expect(b.centre).toBeLessThan(aimOnly); // and further with the tilt
    glossBandInto(satin, 0.6, 0, 0, 0, 0, 0, 16, W, PH);
    glossBandInto(glassy, 0.6, 1, 0, 0, 0, 0, 16, W, PH);
    expect(glassy.halfWidth).toBeLessThan(satin.halfWidth);
    expect(glassy.alpha).toBeGreaterThan(satin.alpha);
    glossBandInto(b, 0, 1, 0, 0, 0, 0, 16, W, PH);
    expect(b.stripAmp).toBe(0);
    expect(b.alpha).toBe(0);
  });

  it('the strip spec brightens with the gloss and is the Highlight knob without it', () => {
    expect(glossSpecAlpha(0.65, 0)).toBe(0.65);
    expect(glossSpecAlpha(0.65, 0.6)).toBeGreaterThan(0.65);
    expect(glossSpecAlpha(1, 1.5)).toBe(1);
  });
});
