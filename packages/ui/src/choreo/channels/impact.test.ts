import { afterEach, describe, expect, it, vi } from 'vitest';
import gsap from 'gsap';
import { sfx } from '../../sfx';
import { pixiFx } from '../../pixiFx';
import { playDef } from '../../fx/playDef';
import { dustIntensity, hitPower, playContactImpact, strikeIntensity, strikeScale } from './impact';

// Neither the tan billow nor the strike burst is a `pixiFx` method any more — they are the authored
// `impact-dust` and `strike-impact` defs, fired through `playDef`. Mocked at the MODULE, not spied on an
// object: `playDef` is a bare function export, and most assertions below only care WHICH def fired.
vi.mock('../../fx/playDef', () => ({ playDef: vi.fn(() => null) }));
const playDefMock = vi.mocked(playDef);
/** Every def id `playDef` was handed this test, in call order. */
const firedDefs = (): string[] => playDefMock.mock.calls.map((c) => c[0]);

afterEach(() => {
  vi.restoreAllMocks();
  playDefMock.mockClear(); // a module mock survives restoreAllMocks — clear its call log per test
});

// Tests run in the node environment (no jsdom in this repo), so — like the sibling `float.test.ts` — we
// hand `playContactImpact` a fake Element whose getBoundingClientRect is stubbed rather than a real DOM
// node. A 0×0 rect at (0,0) keeps the impact-FX center at (0,0), so the anchor assertions are exact.
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

  it('with a defender: fires the strike burst at its screen center and starts a knockback tween', () => {
    const hit = vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    vi.spyOn(pixiFx, 'impactPulse').mockImplementation(() => {});
    const el = fakeDefender();
    playContactImpact(el, 10, 0, 1.5, 1);
    expect(hit).toHaveBeenCalledTimes(1);
    // Stubbed 0×0 rect at (0,0): the strike's TARGET is the contact point and its SOURCE is that point
    // walked BACK along the blow — which is how the def's `sourceToTarget` cone learns which way to fan.
    expect(playDefMock).toHaveBeenCalledWith(
      'strike-impact',
      { source: { x: -10, y: 0 }, target: { x: 0, y: 0 } },
      { scale: strikeScale(1.5), intensity: strikeIntensity(1.5) },
    );
    expect(gsap.getTweensOf(el).length).toBeGreaterThan(0);
  });

  it('fires the strike burst at the given contact point, not the defender center', () => {
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    vi.spyOn(pixiFx, 'impactPulse').mockImplementation(() => {});
    playContactImpact(fakeDefender(), 0, -10, 1, 1, { x: 42, y: 99 });
    expect(playDefMock).toHaveBeenCalledWith(
      'strike-impact',
      { source: { x: 42, y: 109 }, target: { x: 42, y: 99 } }, // the passed contact point, not the rect centre
      { scale: 1, intensity: 1 },
    );
  });

  it('applies the engine-computed defender counter-spin (spinDeg) to the recoil tween', () => {
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    vi.spyOn(pixiFx, 'impactPulse').mockImplementation(() => {});
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
    pulse: vi.spyOn(pixiFx, 'impactPulse').mockImplementation(() => {}),
  });

  it('replaces the standard burst with the execution strike', () => {
    const s = spies();
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    playContactImpact(fakeDefender(), 10, 0, 1, 1, undefined, 0, false, false, false, true);
    expect(s.exec).toHaveBeenCalledTimes(1);
    expect(s.pulse).not.toHaveBeenCalled();
    expect(firedDefs()).toEqual([]); // neither the strike burst nor the dust
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
    expect(firedDefs()).toEqual(['strike-impact', 'impact-dust']);
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

/**
 * The tan billow's migration from `pixiFx.impactDust` to the authored `impact-dust` def. The old method took
 * `power` and folded it into a particle COUNT (`impDustCount * (0.8 + 0.2 * power)`); the def carries the base
 * count, so `power` now arrives as `playDef`'s per-call `intensity` and nothing else moves with it.
 */
describe('playContactImpact — the impact-dust def', () => {
  it('fires impact-dust at the contact point with power carried as intensity', () => {
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    vi.spyOn(pixiFx, 'impactPulse').mockImplementation(() => {});
    playContactImpact(fakeDefender(), 10, 0, 2, 1, { x: 12, y: 34 });
    expect(playDefMock).toHaveBeenCalledWith(
      'impact-dust',
      { source: { x: 12, y: 34 }, target: { x: 12, y: 34 } },
      { intensity: dustIntensity(2) },
    );
  });

  it('maps power the way the hand-written method did', () => {
    expect(dustIntensity(1)).toBeCloseTo(1, 9);   // a baseline hit is an exact no-op on the axis
    expect(dustIntensity(2)).toBeCloseTo(1.2, 9); // the hitPower cap
    expect(dustIntensity(0.9)).toBeCloseTo(0.98, 9);
  });
});

/**
 * The strike burst's migration from `pixiFx.impact` to the authored `strike-impact` def. The old method took
 * `dx/dy` and a `power`; the def takes neither directly. Direction becomes GEOMETRY — the source/target pair
 * this fire stages, which `burst`'s `sourceToTarget` aim reads — and `power` splits across the two per-call
 * magnitude axes: sizes on `scale`, counts on `intensity`.
 */
describe('playContactImpact — the strike-impact def', () => {
  const normalHit = (dx: number, dy: number, power = 1): void => {
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    vi.spyOn(pixiFx, 'impactPulse').mockImplementation(() => {});
    playContactImpact(fakeDefender(), dx, dy, power, 1, { x: 100, y: 100 });
  };
  interface Staged { source: { x: number; y: number }; target: { x: number; y: number } }
  /** The `{ source, target }` the strike fired with. */
  const strikeAnchors = (): Staged =>
    playDefMock.mock.calls.find((c) => c[0] === 'strike-impact')?.[1] as Staged;
  const aimOf = (a: Staged): number => Math.atan2(a.target.y - a.source.y, a.target.x - a.source.x);

  it('stages source BEHIND the contact point along the blow, so the cone points at the defender', () => {
    normalHit(0, -40); // an upward blow
    expect(strikeAnchors()).toEqual({ source: { x: 100, y: 140 }, target: { x: 100, y: 100 } });
    expect(aimOf(strikeAnchors())).toBeCloseTo(-Math.PI / 2, 12); // screen convention: UP is negative
  });

  it('encodes the blow DIRECTION, whatever the vector magnitude', () => {
    // A raw attacker→defender delta arrives at any length; only its direction is meant to survive, and the
    // primitive normalises it to an angle. Both of these must aim the same way.
    normalHit(30, 0);
    const shortBlow = aimOf(strikeAnchors());
    playDefMock.mockClear();
    normalHit(300, 0);
    expect(aimOf(strikeAnchors())).toBeCloseTo(shortBlow, 12);
    expect(shortBlow).toBeCloseTo(0, 12); // +x: struck from the left
  });

  it('splits power across the two magnitude axes', () => {
    normalHit(10, 0, 2);
    expect(playDefMock.mock.calls.find((c) => c[0] === 'strike-impact')?.[2])
      .toEqual({ scale: 2, intensity: strikeIntensity(2) });
  });

  it('maps power the way the hand-written method did', () => {
    // Sizes were literally `cfg × power` (the flash/shockwave `toScale`), and the spark COUNT was this ramp.
    expect(strikeScale(1)).toBe(1);
    expect(strikeScale(2)).toBe(2);
    expect(strikeIntensity(1)).toBeCloseTo(1, 9);   // a baseline hit is an exact no-op on the axis
    expect(strikeIntensity(2)).toBeCloseTo(1.3, 9); // the hitPower cap
    expect(strikeIntensity(0.9)).toBeCloseTo(0.97, 9);
  });

  it('fires BEFORE the dust, so the burst reads under the billow as it always did', () => {
    normalHit(10, 0);
    expect(firedDefs()).toEqual(['strike-impact', 'impact-dust']);
  });
});
