import { afterEach, describe, expect, it, vi } from 'vitest';
import gsap from 'gsap';
import { playLunge } from './lunge';

const fakeEl = (): Element => ({
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 100 }),
  classList: { contains: () => false },
  querySelector: () => null,
}) as unknown as Element;

const base = () => ({
  attacker: fakeEl(), dx: 0, dy: -300, speed: 1,
  strike: { x: 0, y: -206 }, strikeDur: 0.16, leadTilt: 7, attackerRebound: 5,
  onContact: () => {},
});

afterEach(() => vi.restoreAllMocks());

describe('playLunge', () => {
  it('fires onContact exactly once when the timeline is seeked to completion', () => {
    const onContact = vi.fn();
    const tl = playLunge({ ...base(), onContact });
    tl.progress(1);
    expect(onContact).toHaveBeenCalledTimes(1);
  });

  it('onContact fires BEFORE the timeline fully completes (at the smack-lead position)', () => {
    let at = -1;
    const tl = playLunge({ ...base(), onContact: () => { at = tl.progress(); } });
    tl.progress(0.99);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(1);
  });

  it('timeScales the whole timeline by the given speed', () => {
    const tl = playLunge({ ...base(), speed: 2 });
    expect(tl.timeScale()).toBe(2);
  });

  it('drives the attacker to the surface strike offset (not overshooting center) at contact', () => {
    const el = fakeEl();
    const tl = playLunge({ ...base(), attacker: el });
    // seek to the end of the strike (wind-up 0.37 + strike 0.16 = 0.53 of the timeline)
    tl.time(0.53);
    expect(Number(gsap.getProperty(el, 'y'))).toBeCloseTo(-206, 0);
    expect(Number(gsap.getProperty(el, 'rotation'))).toBeCloseTo(7, 0); // leads with the corner tilt
  });

  it('returns to rest (x/y/rotation ≈ 0) once fully settled', () => {
    const el = fakeEl();
    const tl = playLunge({ ...base(), attacker: el });
    tl.progress(1);
    expect(Number(gsap.getProperty(el, 'x'))).toBeCloseTo(0, 1);
    expect(Number(gsap.getProperty(el, 'y'))).toBeCloseTo(0, 1);
    expect(Number(gsap.getProperty(el, 'rotation'))).toBeCloseTo(0, 1);
  });
});
