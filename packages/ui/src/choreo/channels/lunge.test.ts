import { afterEach, describe, expect, it, vi } from 'vitest';
import gsap from 'gsap';
import { playLunge } from './lunge';
import { getLungeConfig } from '../../lungeConfig';

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
    // seek to the end of the strike (the config wind-up + this call's strikeDur), robust to a retuned default
    tl.time(getLungeConfig().windupDur + 0.16);
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

  it('fires onWindupBuffs during the wind-up, BEFORE onContact (pulse → tendril → lunge)', () => {
    const calls: string[] = [];
    const tl = playLunge({
      ...base(), rallyPauseMs: 440,
      onRallyPulse: () => calls.push('pulse'),
      onWindupBuffs: () => calls.push('buffs'),
      onContact: () => calls.push('contact'),
    });
    tl.progress(1);
    expect(calls).toEqual(['pulse', 'buffs', 'contact']); // rally pulse, then tendrils, then the strike
  });

  it('fires onWindupBuffs even without a rally pulse (on-ally-attack watcher case)', () => {
    const buffs = vi.fn();
    const tl = playLunge({ ...base(), rallyPauseMs: 440, onWindupBuffs: buffs });
    tl.progress(1);
    expect(buffs).toHaveBeenCalledTimes(1);
  });

  it('inserts the wind-up hold when there are wind-up buffs (longer than a normal swing)', () => {
    const plain = playLunge({ ...base() });
    const withBuffs = playLunge({ ...base(), rallyPauseMs: 440, onWindupBuffs: () => {} });
    expect(withBuffs.duration()).toBeGreaterThan(plain.duration());
  });

  it('fires onImpactAuras exactly once by the end of the lunge', () => {
    const auras = vi.fn();
    const tl = playLunge({ ...base(), onImpactAuras: auras });
    tl.progress(1);
    expect(auras).toHaveBeenCalledTimes(1);
  });

  it('fires onImpactAuras AT contact — same position as onContact, not on the elastic settle tail', () => {
    // Reading tl.progress() inside a callback during a seek returns the SEEK target, not the callback's own
    // position — so instead scan a fresh timeline in small steps and record the first progress where each fired.
    const firstFire = (key: 'contact' | 'auras'): number => {
      const fn = vi.fn();
      const tl = playLunge({
        ...base(),
        onContact: key === 'contact' ? fn : () => {},
        onImpactAuras: key === 'auras' ? fn : () => {},
      });
      for (let p = 0; p <= 1.0001; p += 0.01) { tl.progress(Math.min(1, p)); if (fn.mock.calls.length) return p; }
      return 1;
    };
    const auras = firstFire('auras');
    const contact = firstFire('contact');
    expect(auras).toBeGreaterThan(0);       // not fired at the start (the old start+300ms bug)
    expect(auras).toBeLessThan(0.9);        // well before the long elastic settle tail
    expect(Math.abs(auras - contact)).toBeLessThanOrEqual(0.02); // welded to the clash (within one scan step)
  });
});
