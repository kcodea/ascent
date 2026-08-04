import { describe, expect, it } from 'vitest';
import { EASES, EASE_IDS, amplitudeAt, keyframesFor, type ReactMotion } from './reactMotion';

const MOTION: ReactMotion = { peak: 0.35, scale: 1.4, squash: 0, lift: -10, nudge: 0, spin: 8, dip: 0.5, shakes: 0 };

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
    expect(first.transform).toBe('translate(0px, 0px) scale(1, 1) rotate(0deg)');
    expect(last.transform).toBe('translate(0px, 0px) scale(1, 1) rotate(0deg)');
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
    expect(half.transform).toBe('translate(0.00px, -5.00px) scale(1.200, 1.200) rotate(4.00deg)');
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
    expect(frames.at(-1)!.easing).toBeUndefined();
  });

  it('collapses to a no-op at amplitude 0 — a fully faded-out recipient does not move', () => {
    const frames = keyframesFor(MOTION, 0, EASES.out);
    expect(frames[1].transform).toBe('translate(0.00px, 0.00px) scale(1.000, 1.000) rotate(0.00deg)');
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

describe('squash, nudge and shakes', () => {
  it('squash makes X and Y move OPPOSITE ways — shape, not size', () => {
    const f = keyframesFor({ ...MOTION, scale: 1, squash: 0.3 }, 1, EASES.out)[1];
    // wider than 1, shorter than 1: the classic impact-absorbed shape.
    expect(f.transform).toBe('translate(0.00px, -10.00px) scale(1.300, 0.700) rotate(8.00deg)');
  });

  it('a negative squash stretches instead', () => {
    const f = keyframesFor({ ...MOTION, scale: 1, squash: -0.3 }, 1, EASES.out)[1];
    expect(f.transform).toBe('translate(0.00px, -10.00px) scale(0.700, 1.300) rotate(8.00deg)');
  });

  it('nudge shifts horizontally', () => {
    const f = keyframesFor({ ...MOTION, scale: 1, lift: 0, nudge: 12 }, 1, EASES.out)[1];
    expect(f.transform).toBe('translate(12.00px, 0.00px) scale(1.000, 1.000) rotate(8.00deg)');
  });

  it('shakes: 0 is a plain three-frame pop', () => {
    expect(keyframesFor(MOTION, 1, EASES.out)).toHaveLength(3);
  });

  it('each extra shake adds one extremum, and they ALTERNATE direction', () => {
    const frames = keyframesFor({ ...MOTION, shakes: 3 }, 1, EASES.out);
    expect(frames).toHaveLength(1 + 4 + 1); // identity + four extrema + identity
    // lift is negative, so a swing back is positive. Signs must alternate or it is not a shake.
    const ys = frames.slice(1, -1).map((f) => Number(/translate\((?:[^,]+), (-?[\d.]+)px/.exec(String(f.transform))![1]));
    for (let i = 1; i < ys.length; i++) expect(Math.sign(ys[i])).toBe(-Math.sign(ys[i - 1]));
  });

  it('shakes DECAY — each swing is weaker than the last, settling at nothing', () => {
    const frames = keyframesFor({ ...MOTION, shakes: 3 }, 1, EASES.out);
    const mags = frames.slice(1, -1).map((f) => Math.abs(Number(/translate\((?:[^,]+), (-?[\d.]+)px/.exec(String(f.transform))![1])));
    for (let i = 1; i < mags.length; i++) expect(mags[i]).toBeLessThan(mags[i - 1]);
  });

  it('never brightens on a swing back — opacity only ever dips', () => {
    for (const f of keyframesFor({ ...MOTION, shakes: 3 }, 1, EASES.out)) {
      expect(Number(f.opacity)).toBeLessThanOrEqual(0);
    }
  });

  it('still rests at identity on both ends with shakes on', () => {
    const frames = keyframesFor({ ...MOTION, shakes: 3 }, 1, EASES.out);
    expect(frames[0].transform).toBe('translate(0px, 0px) scale(1, 1) rotate(0deg)');
    expect(frames.at(-1)!.transform).toBe('translate(0px, 0px) scale(1, 1) rotate(0deg)');
  });
});
