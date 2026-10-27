import { describe, it, expect, afterEach } from 'vitest';
import { FUSE_DEFAULTS, FUSE_SEAMS, forceRamp, getFuseCfg, resetFuseCfg, setFuseValue } from './fuseTune';

describe('crystal fuse tuning', () => {
  afterEach(() => resetFuseCfg());

  it('forceRamp at charge 0 is the floor share × aggression', () => {
    expect(forceRamp(FUSE_DEFAULTS, 0)).toBeCloseTo(FUSE_DEFAULTS.rampFloor * FUSE_DEFAULTS.aggression, 10);
  });

  it('forceRamp at charge 1 is the full aggression', () => {
    expect(forceRamp(FUSE_DEFAULTS, 1)).toBeCloseTo(FUSE_DEFAULTS.aggression, 10);
  });

  it('forceRamp rises with charge', () => {
    const c = FUSE_DEFAULTS;
    expect(forceRamp(c, 0.3)).toBeLessThan(forceRamp(c, 0.6));
    expect(forceRamp(c, 0.6)).toBeLessThan(forceRamp(c, 0.9));
  });

  it('aggression scales the whole ramp', () => {
    expect(forceRamp({ ...FUSE_DEFAULTS, aggression: 2 }, 0.5)).toBeCloseTo(2 * forceRamp({ ...FUSE_DEFAULTS, aggression: 1 }, 0.5), 10);
  });

  it('setFuseValue overrides and resetFuseCfg restores', () => {
    setFuseValue('pull', 999);
    expect(getFuseCfg().pull).toBe(999);
    resetFuseCfg();
    expect(getFuseCfg().pull).toBe(FUSE_DEFAULTS.pull);
  });

  it('the early End Turn flash-and-fade is very quick (owner ask)', () => {
    expect(FUSE_DEFAULTS.flashOutMs).toBeLessThanOrEqual(200);
  });

  it('seam fractions are sorted and inside the art', () => {
    expect(FUSE_SEAMS.length).toBeGreaterThan(5);
    for (let i = 0; i < FUSE_SEAMS.length; i++) {
      expect(FUSE_SEAMS[i]).toBeGreaterThan(0);
      expect(FUSE_SEAMS[i]).toBeLessThan(1);
      if (i) expect(FUSE_SEAMS[i]).toBeGreaterThan(FUSE_SEAMS[i - 1]);
    }
  });
});
