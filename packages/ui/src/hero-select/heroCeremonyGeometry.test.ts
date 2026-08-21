/**
 * HERO SELECT CEREMONY — geometry tests.
 *
 * Pure math over plain numbers, so these pin the actual contract: the destination clamps (desktop vs
 * narrow), aspect preservation, and — load-bearing for the animation layer — NaN-safety. A degenerate
 * rect (zero-size, NaN from a display:none read) must produce a boring-but-usable result; a single NaN in
 * a transform string makes the WAAPI keyframe silently invalid and the clone never arrives.
 */
import { describe, expect, it } from 'vitest';
import type { RectSnapshot } from './heroCeremonyMachine';
import {
  destinationRect, exitVector, focusKeyframes, rectCenter, snapshotRect, transformTo, stageScale, CEREMONY_ASPECT } from './heroCeremonyGeometry';

const rect = (left: number, top: number, width: number, height: number): RectSnapshot =>
  ({ left, top, width, height });

/** A typical hero card read at click time. */
const CARD = rect(300, 220, 120, 168);
const ZERO = rect(0, 0, 0, 0);

/** Keyframe's transform comes through an index signature — stringify once for assertions. */
const tf = (k: Keyframe): string => String(k.transform);

/** Parse "translate(Xpx, Ypx) scale(S)" or fail loudly. */
function parseTransform(s: string): { x: number; y: number; scale: number } {
  const m = /^translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\((-?[\d.]+)\)$/.exec(s);
  expect(m, `"${s}" must be a parseable translate+scale`).not.toBeNull();
  return { x: Number(m![1]), y: Number(m![2]), scale: Number(m![3]) };
}

describe('snapshotRect sanitizes the DOMRect read', () => {
  it('passes a healthy rect through untouched', () => {
    expect(snapshotRect({ left: 10.5, top: -20, width: 120, height: 168 }))
      .toEqual({ left: 10.5, top: -20, width: 120, height: 168 });
  });

  it('replaces NaN/Infinity with safe values — a broken read must not poison the whole ceremony', () => {
    const s = snapshotRect({ left: NaN, top: Infinity, width: -Infinity, height: NaN });
    expect(s).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });

  it('clamps negative width/height to 0 (a rect can be mispositioned, never inside-out)', () => {
    const s = snapshotRect({ left: 5, top: 6, width: -40, height: -1 });
    expect(s.width).toBe(0);
    expect(s.height).toBe(0);
    expect(s.left).toBe(5);
    expect(s.top).toBe(6);
  });
});

describe('destinationRect — the centered portrait target', () => {
  it('desktop (1920x1080): width is reference px x the STAGE SCALE, centered at (vw/2, 0.46*vh)', () => {
    // Reworked 2026-08-21: the width used to be `clamp(0.28*vw, 360, 520)`, which clamped to a constant 520px
    // on any wide screen while the board around it scaled — so the composition only held at one resolution.
    // It is now 636 reference px x `stageScale`, like every other authored size in the UI.
    const d = destinationRect(1920, 1080, CARD);
    expect(d.width).toBeCloseTo(636 * stageScale(1920, 1080), 4);
    const c = rectCenter(d);
    expect(c.x).toBeCloseTo(960, 6);
    expect(c.y).toBeCloseTo(1080 * 0.46, 6);
  });

  it('a smaller desktop stage gets a proportionally smaller card, not a floored one', () => {
    const d = destinationRect(900, 700, CARD);
    expect(d.width).toBeCloseTo(636 * stageScale(900, 700), 4);
  });

  it('narrow (<720px, e.g. 390x844): width is min(vw*0.76, vh*0.42), center rides at 0.43*vh', () => {
    const d = destinationRect(390, 844, CARD);
    expect(d.width).toBeCloseTo(Math.min(390 * 0.76, 844 * 0.42), 6); // 296.4 — the vw side wins
    const c = rectCenter(d);
    expect(c.x).toBeCloseTo(195, 6);
    expect(c.y).toBeCloseTo(844 * 0.43, 6);
  });

  it('height uses the BIG CARD aspect, never the source aspect', () => {
    // The ceremony always presents a big card, so taking the aspect from the source broke Practice: its dense
    // roster card is ~2.7:1, which made the destination twice as tall and pushed it off the top of the screen.
    const d = destinationRect(1920, 1080, CARD);
    expect(d.height / d.width).toBeCloseTo(CEREMONY_ASPECT, 6);
    expect(d.height / d.width).not.toBeCloseTo(CARD.height / CARD.width, 2);
  });

  it('a zero-sized source rect still yields finite numbers', () => {
    const d = destinationRect(1920, 1080, ZERO);
    for (const v of [d.left, d.top, d.width, d.height]) expect(Number.isFinite(v)).toBe(true);
    expect(d.height / d.width).toBeCloseTo(CEREMONY_ASPECT, 6);
  });
});

describe('transformTo — the clone-landing transform', () => {
  it('produces a parseable translate+scale whose scale is target.width / source.width', () => {
    const dest = destinationRect(1920, 1080, CARD);
    const t = parseTransform(transformTo(CARD, dest));
    expect(t.scale).toBeCloseTo(dest.width / CARD.width, 3);
    expect(t.x).toBeCloseTo(dest.left - CARD.left, 1);
    expect(t.y).toBeCloseTo(dest.top - CARD.top, 1);
  });

  it('a degenerate zero-size source still yields a parseable, NaN-free transform (scale falls back to 1)', () => {
    const s = transformTo(ZERO, destinationRect(1920, 1080, ZERO));
    expect(/NaN/.test(s)).toBe(false);
    expect(parseTransform(s).scale).toBe(1);
  });
});

describe('focusKeyframes — identity, overshoot, settle', () => {
  const dest = destinationRect(1920, 1080, CARD);
  const kf = focusKeyframes(CARD, dest);

  it('is exactly 3 keyframes and the first is the identity (the clone starts pinned on the source)', () => {
    expect(kf).toHaveLength(3);
    expect(parseTransform(tf(kf[0]!))).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('the middle keyframe sits at offset 0.82 with a scale ~3% larger than the settle', () => {
    expect(kf[1]!.offset).toBe(0.82);
    const over = parseTransform(tf(kf[1]!)).scale;
    const settle = parseTransform(tf(kf[2]!)).scale;
    expect(over / settle).toBeCloseTo(1.03, 3);
  });

  it('the last keyframe lands exactly on the destination translation — same string transformTo produces', () => {
    expect(tf(kf[2]!)).toBe(transformTo(CARD, dest));
  });

  it('no NaN in any transform string, even for a degenerate zero-size source', () => {
    for (const k of kf) expect(!/NaN/.test(tf(k))).toBe(true);
    for (const k of focusKeyframes(ZERO, destinationRect(1920, 1080, ZERO))) {
      expect(!/NaN/.test(tf(k))).toBe(true);
    }
  });
});

describe('exitVector — unselected cards yield away from the pick', () => {
  const selected = rect(800, 300, 120, 168); // centered at x = 860
  const stagger = 35; // the shipped optionStaggerMs default

  it('a card left of the selected exits left (negative x); a card right exits right (positive x)', () => {
    expect(exitVector(rect(200, 300, 120, 168), selected, 0, 0, stagger).x).toBeLessThan(0);
    expect(exitVector(rect(1400, 300, 120, 168), selected, 1, 0, stagger).x).toBeGreaterThan(0);
  });

  it('a card exactly on the selected center breaks the tie by index: even goes left, odd goes right', () => {
    // Same column, another row — delta is exactly 0, so Math.sign gives no direction.
    const centered = rect(800, 500, 120, 168);
    expect(exitVector(centered, selected, 4, 1, stagger).x).toBeLessThan(0);   // even index -> -1
    expect(exitVector(centered, selected, 5, 1, stagger).x).toBeGreaterThan(0); // odd index -> +1
  });

  it('|x| clamps to [90, 180]: a near neighbor still clears the frame, a far card does not fly off', () => {
    const near = exitVector(rect(810, 300, 120, 168), selected, 0, 0, stagger); // delta 10px
    const far = exitVector(rect(4800, 300, 120, 168), selected, 0, 0, stagger); // delta ~4000px
    expect(Math.abs(near.x)).toBe(90);
    expect(Math.abs(far.x)).toBe(180);
  });

  it('rotation magnitude never exceeds 3 degrees, even for the farthest card', () => {
    const far = exitVector(rect(4800, 300, 120, 168), selected, 0, 0, stagger);
    expect(Math.abs(far.rotateDeg)).toBeLessThanOrEqual(3);
    expect(Math.abs(far.rotateDeg)).toBe(3); // and the clamp actually engaged
  });

  it('delayMs caps at 180 even for a far card with a big stagger — the dense Practice roster rule', () => {
    // 23 cards deep: distance rank ~33 card-widths x 60ms stagger would be ~2s uncapped.
    const far = exitVector(rect(4800, 300, 120, 168), selected, 22, 2, 60);
    expect(far.delayMs).toBe(180);
    // …while a direct neighbor still starts near immediately.
    const near = exitVector(rect(930, 300, 120, 168), selected, 1, 0, 60);
    expect(near.delayMs).toBeLessThan(180);
  });

  it('row 0 drifts up (y = -10); lower rows drift down within [10, 30]', () => {
    const card = rect(200, 300, 120, 168);
    expect(exitVector(card, selected, 0, 0, stagger).y).toBe(-10);
    for (const row of [1, 2, 3, 9]) {
      const y = exitVector(card, selected, 0, row, stagger).y;
      expect(y, `row ${row} drifts down`).toBeGreaterThanOrEqual(10);
      expect(y, `row ${row} stays within the drift band`).toBeLessThanOrEqual(30);
    }
  });

  it('degenerate rects (NaN position, zero width) still produce finite numbers everywhere', () => {
    const broken = exitVector(rect(NaN, NaN, 0, 0), rect(NaN, NaN, 0, 0), 3, 1, stagger);
    for (const [name, v] of Object.entries(broken)) {
      expect(Number.isFinite(v as number), `${name} must be finite`).toBe(true);
    }
    // NaN delta collapses to the alternating tie-break, still inside the x clamp.
    expect(Math.abs(broken.x)).toBe(90);
  });
});
