import { describe, expect, it } from 'vitest';
import { EASES, EASE_IDS, amplitudeAt, keyframesFor, type ReactMotion } from './reactMotion';

const MOTION: ReactMotion = { peak: 0.35, scale: 1.4, lift: -10, spin: 8, dip: 0.5 };

describe('amplitudeAt', () => {
  it('is full strength at the subject', () => {
    expect(amplitudeAt(0, 5, 1)).toBe(1);
  });

  it('falls linearly to 1 - falloff at the furthest recipient', () => {
    expect(amplitudeAt(4, 5, 0.5)).toBeCloseTo(0.5);
    expect(amplitudeAt(2, 5, 0.5)).toBeCloseTo(0.75);
  });

  it('leaves everyone equal at falloff 0', () => {
    expect([0, 1, 2, 3].map((i) => amplitudeAt(i, 4, 0))).toEqual([1, 1, 1, 1]);
  });

  it('is full strength for a lone recipient — no divide by zero', () => {
    expect(amplitudeAt(0, 1, 1)).toBe(1);
  });
});

describe('keyframesFor', () => {
  it('rests at IDENTITY on both ends, so additive composition is a true no-op', () => {
    // Load-bearing: these animations composite with `add`, so a non-identity resting frame would
    // permanently offset every card the effect ever touched.
    const [first, , last] = keyframesFor(MOTION, 1, EASES.out);
    expect(first.transform).toBe('translateY(0px) scale(1) rotate(0deg)');
    expect(last.transform).toBe('translateY(0px) scale(1) rotate(0deg)');
    expect(first.opacity).toBe(0);
    expect(last.opacity).toBe(0);
  });

  it('puts the peak where `peak` says', () => {
    expect(keyframesFor(MOTION, 1, EASES.out)[1].offset).toBe(0.35);
  });

  it('expresses the dip as a NEGATIVE delta, not an absolute opacity', () => {
    expect(keyframesFor(MOTION, 1, EASES.out)[1].opacity).toBeCloseTo(-0.5);
  });

  it('scales every channel by amplitude', () => {
    const half = keyframesFor(MOTION, 0.5, EASES.out)[1];
    // scale interpolates toward 1 (its neutral), the rest toward 0.
    expect(half.transform).toBe('translateY(-5.00px) scale(1.200) rotate(4.00deg)');
    expect(half.opacity).toBeCloseTo(-0.25);
  });

  it('puts the ease on the KEYFRAMES, not on the effect timing', () => {
    // Measured in Chrome: a timing-level ease remaps the whole iteration, so an overshoot curve put the
    // playhead at progress 0.978 while the clock read 0.35 — the tail, ~3% of the intended peak. The
    // reaction was very nearly invisible. Per-keyframe easing keeps `peak` honest.
    const frames = keyframesFor(MOTION, 1, EASES.overshoot);
    expect(frames[0].easing).toBe(EASES.overshoot);
    expect(frames[1].easing).toBe(EASES.overshoot);
    // A keyframe's easing governs the interval that STARTS at it, so the last frame carries none.
    expect(frames[2].easing).toBeUndefined();
  });

  it('collapses to a no-op at amplitude 0 — a fully faded-out recipient does not move', () => {
    const frames = keyframesFor(MOTION, 0, EASES.out);
    expect(frames[1].transform).toBe('translateY(0.00px) scale(1.000) rotate(0.00deg)');
    expect(frames[1].opacity).toBe(-0);
  });
});

describe('the ease list', () => {
  it('every advertised id resolves to a real easing string', () => {
    // The picker offers EASE_IDS; a name without a value would silently fall back and make an author's
    // choice do nothing.
    for (const id of EASE_IDS) {
      expect(typeof EASES[id]).toBe('string');
      expect(EASES[id]).not.toBe('');
    }
  });
});
