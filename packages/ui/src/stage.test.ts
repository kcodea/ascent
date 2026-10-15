import { describe, expect, it } from 'vitest';
import { DESIGN_H, DESIGN_W, fitStage, gameBoxOf } from './stage';

// The scaled stage (owner ask 2026-09-26): the layout never goes below the 1920×1080 design size; a smaller window
// gets the design-size layout scaled down by ONE uniform factor. At or above the design size, nothing changes.
describe('fitStage', () => {
  it('is the identity at and above the design size (desktop + ultrawide keep their code path)', () => {
    for (const [w, h] of [[1920, 1080], [2560, 1440], [2560, 1080], [3440, 1440], [5120, 1440], [3840, 2160]]) {
      const f = fitStage(w, h);
      expect(f.s).toBe(1);
      expect(f.lw).toBe(w);
      expect(f.lh).toBe(h);
    }
  });

  it('scales uniformly below the design size and maps the window exactly (no bars at the window level)', () => {
    for (const [w, h] of [[844, 390], [932, 430], [667, 375], [1024, 640], [1280, 720], [1366, 768], [1920, 969]]) {
      const f = fitStage(w, h);
      expect(f.s).toBeLessThan(1);
      expect(f.s).toBeCloseTo(Math.min(w / DESIGN_W, h / DESIGN_H), 10);
      // The scaled layout viewport lands exactly on the window.
      expect(f.lw * f.s).toBeCloseTo(w, 6);
      expect(f.lh * f.s).toBeCloseTo(h, 6);
      // …and it is never smaller than the design size, so the 16:9 box inside is always the tuned 1080p one.
      expect(f.lw).toBeGreaterThanOrEqual(DESIGN_W - 1e-6);
      expect(f.lh).toBeGreaterThanOrEqual(DESIGN_H - 1e-6);
    }
  });

  it('fits the binding axis: a wide phone is height-bound, a squarish window width-bound', () => {
    expect(fitStage(844, 390).lh).toBeCloseTo(DESIGN_H, 6);       // 2.16:1 → height-bound, extra width = side margin
    expect(fitStage(1024, 640).lw).toBeCloseTo(DESIGN_W, 6);      // 1.6:1 → width-bound, extra height = top/bottom
  });

  it('never divides by zero on a zero-size window (a hidden iframe)', () => {
    const f = fitStage(0, 0);
    expect(f.s).toBe(1);
    expect(Number.isFinite(f.lw) && Number.isFinite(f.lh)).toBe(true);
  });
});

describe('gameBoxOf: the centred 16:9 game box in screen px (R-SPECTATE-CURSOR-01)', () => {
  it('a 16:9 window is all box; a taller or wider one letterboxes; a smaller one scales', () => {
    expect(gameBoxOf(fitStage(1920, 1080))).toEqual({ left: 0, top: 0, w: 1920, h: 1080 });
    const tall = gameBoxOf(fitStage(2000, 1170)); // 16:9.36: bars top and bottom
    expect(tall.w).toBeCloseTo(2000, 6);
    expect(tall.h).toBeCloseTo(1125, 6);
    expect(tall.top).toBeCloseTo(22.5, 6);
    const wide = gameBoxOf(fitStage(3440, 1440)); // 21:9: capped at 2560 x 1440, bars left and right
    expect(wide).toEqual({ left: 440, top: 0, w: 2560, h: 1440 });
    const small = gameBoxOf(fitStage(1440, 900)); // scaled 0.75, 16:10: bars top and bottom
    expect(small.w).toBeCloseTo(1440, 6);
    expect(small.h).toBeCloseTo(810, 6);
    expect(small.top).toBeCloseTo(45, 6);
  });
});
