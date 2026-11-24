import { describe, expect, it } from 'vitest';
import { COSMETIC_RARITIES } from '@game/progression';
import { ANCIENT_SHAKE_MULT, BURST, bigPullShakePx, bigPullTier, burstPoseAt, type BurstPose } from './bigPull';

const pose = (): BurstPose => ({ alpha: 0, scale: 1, rotation: 0, live: false });

describe('bigPull: bigPullTier', () => {
  it('only Legendary and Ancient are big pulls; Ancient is its own (bigger) tier', () => {
    expect(COSMETIC_RARITIES.map((r) => [r, bigPullTier(r)])).toEqual([
      ['common', 'none'], ['rare', 'none'], ['epic', 'none'], ['legendary', 'legendary'], ['ancient', 'ancient'],
    ]);
  });

  it('Ancient bursts bigger, with more rays, for longer', () => {
    expect(BURST.ancient.bloomSize).toBeGreaterThan(BURST.legendary.bloomSize);
    expect(BURST.ancient.raySize).toBeGreaterThan(BURST.legendary.raySize);
    expect(BURST.ancient.rays).toBeGreaterThan(BURST.legendary.rays);
    expect(BURST.ancient.totalMs).toBeGreaterThan(BURST.legendary.totalMs);
    expect(BURST.legendary.inMs).toBe(120);
    expect(BURST.legendary.totalMs).toBe(900);
  });
});

describe('bigPull: bigPullShakePx', () => {
  it('Legendary is the knob, Ancient 1.5x, everything else and a 0 knob none', () => {
    expect(bigPullShakePx('legendary', 6)).toBe(6);
    expect(bigPullShakePx('ancient', 6)).toBe(6 * ANCIENT_SHAKE_MULT);
    expect(ANCIENT_SHAKE_MULT).toBe(1.5);
    expect(bigPullShakePx('none', 6)).toBe(0);
    expect(bigPullShakePx('ancient', 0)).toBe(0);
    expect(bigPullShakePx('legendary', Number.NaN)).toBe(0);
  });
});

describe('bigPull: burstPoseAt', () => {
  const spec = BURST.legendary;

  it('scales in fast to its peak, then fades to nothing by totalMs', () => {
    const p = pose();
    burstPoseAt(spec, 0, 1, p);
    expect(p.live).toBe(true);
    expect(p.alpha).toBe(0);
    expect(p.scale).toBeCloseTo(0.55);
    burstPoseAt(spec, spec.inMs, 1, p);
    expect(p.alpha).toBeCloseTo(spec.peak);
    expect(p.scale).toBeCloseTo(1);
    let prev = p.alpha;
    for (let ms = spec.inMs + 50; ms < spec.totalMs; ms += 50) {
      burstPoseAt(spec, ms, 1, p);
      expect(p.alpha).toBeLessThan(prev);
      prev = p.alpha;
    }
    burstPoseAt(spec, spec.totalMs, 1, p);
    expect(p.live).toBe(false);
    expect(p.alpha).toBe(0);
  });

  it('the rays turn with time; the knob scales the alpha (capped at 1); 0 is off', () => {
    const p = pose();
    burstPoseAt(spec, 500, 1, p);
    const r = p.rotation, a = p.alpha;
    expect(r).toBeCloseTo((spec.spin * 500) / 1000);
    burstPoseAt(spec, 500, 2, p);
    expect(p.alpha).toBeCloseTo(Math.min(1, a * 2));
    burstPoseAt(spec, spec.inMs, 2, p);
    expect(p.alpha).toBe(1);
    burstPoseAt(spec, 300, 0, p);
    expect(p.live).toBe(false);
    expect(p.alpha).toBe(0);
  });

  it('writes into the object it is given', () => {
    const p = pose();
    expect(burstPoseAt(spec, 200, 1, p)).toBe(p);
  });
});
