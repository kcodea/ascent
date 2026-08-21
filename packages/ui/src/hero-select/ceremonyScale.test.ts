/**
 * The ceremony must be RESOLUTION-INDEPENDENT and grid-independent.
 *
 * Two owner reports on 2026-08-21:
 *  - "practice mode ceremony is way out of position" — the destination took its aspect from the SOURCE card,
 *    and Practice's dense roster card is ~2.7:1 against the big card's ~1.31:1, so the portrait came out more
 *    than twice as tall and sat off the top of the screen.
 *  - "on 16:9 monitors the sizing is off … pin the sizing so it does not transform with window size" — the
 *    portrait width was `clamp(0.28 × viewport width, 360, 520)`, so it CLAMPED to a constant 520px on any
 *    wide screen while the board around it scaled, and every tuned offset stayed in raw pixels.
 */
import { describe, expect, it } from 'vitest';
import { CEREMONY_ASPECT, destinationRect, stageScale } from './heroCeremonyGeometry';

const DENSE = { left: 428, top: 300, width: 108, height: 293 }; // Practice: compact card, ~2.7:1
const BIG = { left: 700, top: 400, width: 330, height: 432 };   // Play: big card, ~1.31:1
const RESOLUTIONS: [number, number][] = [[1366, 768], [1600, 900], [1920, 1080], [2560, 1440], [3440, 1440], [2095, 1316]];

/** The 16:9 stage height the whole UI is scaled against (Game.tsx's `--gh`). */
const stageH = (w: number, h: number): number => Math.min(h, (w * 9) / 16, 1440);

describe('the destination is identical whichever grid the player picked from', () => {
  it.each(RESOLUTIONS)('%ix%i — Practice and Play agree', (w, h) => {
    const dense = destinationRect(w, h, DENSE);
    const big = destinationRect(w, h, BIG);
    expect(dense).toEqual(big);
  });

  it('uses the big card aspect, never the source card aspect', () => {
    const d = destinationRect(1920, 1080, DENSE);
    expect(d.height / d.width).toBeCloseTo(CEREMONY_ASPECT, 5);
    // …and NOT the dense card's own 2.7:1, which is what pushed it off-screen.
    expect(d.height / d.width).toBeLessThan(2);
  });
});

describe('the ceremony holds the same proportions at every resolution', () => {
  it('occupies a constant share of the stage', () => {
    const shares = RESOLUTIONS.map(([w, h]) => destinationRect(w, h, BIG).width / stageH(w, h));
    for (const s of shares) expect(s).toBeCloseTo(shares[0]!, 4);
  });

  it.each(RESOLUTIONS)('%ix%i — centred horizontally and fully on screen', (w, h) => {
    const d = destinationRect(w, h, BIG);
    expect(d.left + d.width / 2).toBeCloseTo(w / 2, 3);
    expect(d.top).toBeGreaterThanOrEqual(0);
    expect(d.top + d.height).toBeLessThanOrEqual(h);
  });

  it('scales linearly with the stage — half the stage, half the portrait', () => {
    const big = destinationRect(2560, 1440, BIG);
    const half = destinationRect(1280, 720, BIG);
    expect(half.width / big.width).toBeCloseTo(stageScale(1280, 720) / stageScale(2560, 1440), 4);
  });

  it('an ultrawide is sized by its HEIGHT, not its width', () => {
    // 3440x1440 and 2560x1440 share a 16:9 stage, so the portrait must be the same SIZE on both — only its
    // centre moves with the wider window. Sizing off the width is exactly what broke on non-16:9 monitors.
    const wide = destinationRect(3440, 1440, BIG);
    const std = destinationRect(2560, 1440, BIG);
    expect(wide.width).toBeCloseTo(std.width, 5);
    expect(wide.height).toBeCloseTo(std.height, 5);
    expect(wide.left + wide.width / 2).toBeCloseTo(3440 / 2, 3);
  });
});

describe('stageScale mirrors the games own --scale', () => {
  it('is 1.0 at the 2560x1440 design reference and clamps there', () => {
    expect(stageScale(2560, 1440)).toBe(1);
    expect(stageScale(5120, 2880)).toBe(1); // never grows past the tuned reference
  });

  it('never collapses to zero on a degenerate viewport', () => {
    expect(stageScale(0, 0)).toBeGreaterThan(0);
    expect(Number.isFinite(stageScale(NaN, NaN))).toBe(true);
  });
});
