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

/**
 * EXECUTE replaces the standard strike VFX (owner 2026-07-22: "i only see the original strike effect"). It is
 * checked FIRST, so it outranks both Flurry and crit — an Execute proc is a kill, the biggest beat available.
 */
describe('playContactImpact — Execute', () => {
  const spies = () => ({
    exec: vi.spyOn(pixiFx, 'executeStrike').mockImplementation(() => {}),
    wind: vi.spyOn(pixiFx, 'windSlash').mockImplementation(() => {}),
    crit: vi.spyOn(pixiFx, 'critImpact').mockImplementation(() => {}),
    impact: vi.spyOn(pixiFx, 'impact').mockImplementation(() => {}),
    dust: vi.spyOn(pixiFx, 'impactDust').mockImplementation(() => {}),
    pulse: vi.spyOn(pixiFx, 'impactPulse').mockImplementation(() => {}),
  });

  it('replaces the standard burst with the execution strike', () => {
    const s = spies();
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    playContactImpact(fakeDefender(), 10, 0, 1, 1, undefined, 0, false, false, false, true);
    expect(s.exec).toHaveBeenCalledTimes(1);
    expect(s.impact).not.toHaveBeenCalled();
    expect(s.pulse).not.toHaveBeenCalled();
    expect(s.dust).not.toHaveBeenCalled();
  });

  it('wins over a Flurry slash and over a crit', () => {
    const s = spies();
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    vi.spyOn(sfx, 'critHit').mockImplementation(() => {});
    vi.spyOn(sfx, 'flurryHit').mockImplementation(() => {});
    playContactImpact(fakeDefender(), 10, 0, 1, 1, undefined, 0, true, true, true, true);
    expect(s.exec).toHaveBeenCalledTimes(1);
    expect(s.wind).not.toHaveBeenCalled();
    expect(s.crit).not.toHaveBeenCalled();
  });

  it('still plays the crit SOUND on an Execute crit (it is still a crit)', () => {
    spies();
    const critHit = vi.spyOn(sfx, 'critHit').mockImplementation(() => {});
    playContactImpact(fakeDefender(), 10, 0, 1, 1, undefined, 0, true, false, false, true);
    expect(critHit).toHaveBeenCalledTimes(1);
  });

  it('leaves a normal hit untouched', () => {
    const s = spies();
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    playContactImpact(fakeDefender(), 10, 0, 1, 1);
    expect(s.exec).not.toHaveBeenCalled();
    expect(s.impact).toHaveBeenCalledTimes(1);
  });
});

// The strike launches ALONG the blow (owner 2026-07-22), so the impact channel must hand it the attack vector
// — without this it fell back to the default rightward cut regardless of which way the attacker came from.
describe('playContactImpact — Execute direction', () => {
  it('passes the attack vector through to the strike', () => {
    const exec = vi.spyOn(pixiFx, 'executeStrike').mockImplementation(() => {});
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    playContactImpact(fakeDefender(), 0, -40, 1, 1, { x: 5, y: 7 }, 0, false, false, false, true);
    expect(exec).toHaveBeenCalledWith(5, 7, 0, -40);
  });
});
