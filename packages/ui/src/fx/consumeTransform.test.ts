import { describe, expect, it } from 'vitest';
import { consumeTransform } from './consumeTransform';
import { CONSUMEFX_DEFAULTS, getConsumeFxConfig, resetConsumeFxConfig, setConsumeFxValue } from '../consumeFxConfig';

const CFG = { durationMs: 800, shakePhase: 0.28, shakeAmp: 4, shakeFreq: 22, stretch: 0.8, thin: 0.35, pullDist: 1, lag: 0.35, collapseStart: 0.75, fadeStart: 0.85, showStats: true } as const;
const from = { x: 100, y: 100 };
const to = { x: 100, y: 300 }; // eater straight below → pull is downward, no sideways drift

describe('consumeTransform — pulled from the bottom', () => {
  it('is at rest at t=0 (no translate, no stretch, upright)', () => {
    const r = consumeTransform(from, to, 0, CFG);
    expect(r.tx).toBeCloseTo(0); expect(r.ty).toBeCloseTo(0);
    expect(r.scaleX).toBeCloseTo(1); expect(r.scaleY).toBeCloseTo(1);
    expect(r.rotDeg).toBeCloseTo(0); // no snap-tilt at spawn
  });
  it('the bottom leads: it stretches DOWN (scaleY>1) and thins across (scaleX<1) early', () => {
    const r = consumeTransform(from, to, 0.3, CFG);
    expect(r.scaleY).toBeGreaterThan(1);   // elongated downward — the bottom leads
    expect(r.scaleX).toBeLessThan(1);      // thinned across
  });
  it('the top lags: during the early stretch the card has NOT translated yet', () => {
    const r = consumeTransform(from, to, CFG.lag * 0.9, CFG); // just before the lag threshold
    expect(r.scaleY).toBeGreaterThan(1);   // already stretching (bottom leading)
    expect(r.ty).toBeCloseTo(0);           // ... but the top hasn't started to follow
  });
  it('tilts to aim its bottom at a diagonal eater (down-right eater → negative CSS rotation)', () => {
    const r = consumeTransform({ x: 0, y: 0 }, { x: 200, y: 200 }, 0.3, CFG);
    expect(r.scaleY).toBeGreaterThan(1);   // still a bottom-led stretch along the (now-aimed) axis
    expect(r.scaleX).toBeLessThan(1);
    // atan2(-dx, dy) with dx=dy=200 → -45°, eased to full by t=0.3; CSS -45° swings the bottom down-right.
    expect(r.rotDeg).toBeCloseTo(-45);
  });
  it('does not tilt when the eater is straight below', () => {
    const r = consumeTransform(from, to, 0.3, CFG); // to is straight below from
    expect(r.rotDeg).toBeCloseTo(0);
  });
  it('arrives at the eater and collapses by t=1', () => {
    const r = consumeTransform(from, to, 1, CFG);
    expect(r.ty).toBeCloseTo((to.y - from.y) * CFG.pullDist); // 200 — pulled fully in
    expect(r.tx).toBeCloseTo(0);
    expect(r.scaleX).toBeLessThan(0.2); expect(r.scaleY).toBeLessThan(0.2); // vanished
  });
  it('follows the eater diagonally (translate goes both ways) while still stretching straight down', () => {
    const r = consumeTransform({ x: 0, y: 0 }, { x: 200, y: 200 }, 0.9, CFG);
    expect(r.tx).toBeGreaterThan(0); expect(r.ty).toBeGreaterThan(0); // homing to the diagonal eater
  });
});

describe('consumeFxConfig', () => {
  it('ships with stats OFF and returns the documented keys', () => {
    expect(CONSUMEFX_DEFAULTS.showStats).toBe(false);
    const cfg = getConsumeFxConfig();
    expect(Object.keys(cfg).sort()).toEqual(
      ['collapseStart', 'durationMs', 'fadeStart', 'lag', 'pullDist', 'shakeAmp', 'shakeFreq', 'shakePhase', 'showStats', 'stretch', 'thin'].sort(),
    );
  });
  it('stores showStats as a real boolean even when the toggle writes a numeric 1/0', () => {
    setConsumeFxValue('showStats', 1);
    expect(getConsumeFxConfig().showStats).toBe(true);   // strict — not the number 1
    setConsumeFxValue('showStats', 0);
    expect(getConsumeFxConfig().showStats).toBe(false);
    resetConsumeFxConfig();
  });
});
