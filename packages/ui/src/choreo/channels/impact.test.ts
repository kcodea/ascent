import { afterEach, describe, expect, it, vi } from 'vitest';
import gsap from 'gsap';
import { sfx } from '../../sfx';
import { pixiFx } from '../../pixiFx';
import { hitPower, playContactImpact } from './impact';

afterEach(() => vi.restoreAllMocks());

// Tests run in the node environment (no jsdom in this repo), so — like the sibling `float.test.ts` — we
// hand `playContactImpact` a fake Element whose getBoundingClientRect is stubbed rather than a real DOM
// node. A 0×0 rect at (0,0) keeps the impact-FX center at (0,0), so the pixiFx.impact assertion is exact.
const fakeDefender = (): Element => ({
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
} as unknown as Element);

describe('hitPower', () => {
  it('maps swing damage to a power scale clamped to [0.9, 2]', () => {
    expect(hitPower(0)).toBeCloseTo(0.9, 5);
    expect(hitPower(3)).toBeCloseTo(1.1, 5);
    expect(hitPower(40)).toBe(2);
  });
});

describe('playContactImpact', () => {
  it('always fires the hit sound, even with no defender', () => {
    const hit = vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    playContactImpact(null, 10, 0, 1, 1);
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('with a defender: fires the WebGL impact FX at its screen center and starts a knockback tween', () => {
    const hit = vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    const impact = vi.spyOn(pixiFx, 'impact').mockImplementation(() => {});
    const el = fakeDefender();
    playContactImpact(el, 10, 0, 1.5, 1);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(impact).toHaveBeenCalledWith(0, 0, 10, 0, 1.5); // stubbed 0×0 rect at (0,0)
    expect(gsap.getTweensOf(el).length).toBeGreaterThan(0);
  });

  it('fires the impact FX at the given contact point, not the defender center', () => {
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    const impact = vi.spyOn(pixiFx, 'impact').mockImplementation(() => {});
    playContactImpact(fakeDefender(), 0, -10, 1, 1, { x: 42, y: 99 });
    expect(impact).toHaveBeenCalledWith(42, 99, 0, -10, 1); // the passed contact point, not the rect center
  });

  it('applies the engine-computed defender counter-spin (spinDeg) to the recoil tween', () => {
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    vi.spyOn(pixiFx, 'impact').mockImplementation(() => {});
    const el = fakeDefender();
    playContactImpact(el, 0, -10, 1, 1, undefined, -6); // engine passes a negative spin (opposite the lead)
    const tween = gsap.getTweensOf(el)[0];
    expect(tween).toBeDefined();
    expect(tween.vars.rotation).toBe(-6);
  });
});
