import { describe, expect, it } from 'vitest';
import { classifyPhone } from './deviceClass';
import { FXBUDGET_DEFAULTS, FXBUDGET_PHONE_DEFAULTS, fxBudgetDefaultsFor } from './fx/fxBudgetConfig';

describe('classifyPhone', () => {
  it('a touch screen with a short side of a phone is a phone, in either orientation', () => {
    expect(classifyPhone(true, 390, 844)).toBe(true);
    expect(classifyPhone(true, 844, 390)).toBe(true);
    expect(classifyPhone(true, 360, 800)).toBe(true);
  });
  it('desktop, a touchscreen laptop with a mouse, and tablets are not', () => {
    expect(classifyPhone(false, 1920, 1080)).toBe(false);
    expect(classifyPhone(false, 390, 844)).toBe(false); // a narrow desktop window is still a mouse device
    expect(classifyPhone(true, 820, 1180)).toBe(false); // iPad Air
    expect(classifyPhone(true, 744, 1133)).toBe(false); // iPad mini
    expect(classifyPhone(true, 0, 0)).toBe(false);
  });
});

describe('FX budgets per device', () => {
  it('desktop keeps the shipped desktop budgets exactly', () => {
    expect(fxBudgetDefaultsFor(false)).toEqual(FXBUDGET_DEFAULTS);
  });
  it('a phone gets lower particle and filter ceilings, never higher, and the same per-def cap', () => {
    const p = fxBudgetDefaultsFor(true);
    expect(p).toEqual(FXBUDGET_PHONE_DEFAULTS);
    expect(p.maxParticles).toBeLessThan(FXBUDGET_DEFAULTS.maxParticles);
    expect(p.maxParticlesShop).toBeLessThan(FXBUDGET_DEFAULTS.maxParticlesShop);
    expect(p.maxParticlesDiscover).toBeLessThan(FXBUDGET_DEFAULTS.maxParticlesDiscover);
    expect(p.maxFilters).toBeLessThan(FXBUDGET_DEFAULTS.maxFilters);
    expect(p.maxPerDef).toBe(FXBUDGET_DEFAULTS.maxPerDef);
  });
});
