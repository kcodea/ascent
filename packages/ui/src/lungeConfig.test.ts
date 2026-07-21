import { describe, expect, it } from 'vitest';
import {
  EASE_KEYS, LUNGE_GROUPS, LUNGE_KEYS, LUNGE_RANGES, STRIKE_EASES, getLungeConfig, strikeBandFor,
  strikeEaseFor,
} from './lungeConfig';

describe('lungeConfig corner-clack dials', () => {
  it('exposes the contact + distance dials with defaults', () => {
    const c = getLungeConfig();
    expect(c.leadTilt).toBeGreaterThan(0);
    expect(c.defenderSpin).toBeGreaterThan(0);
    expect(c.attackerRebound).toBeGreaterThan(0);
    expect(c.targetSpeed).toBeGreaterThan(0);
    expect(c.minStrikeDur).toBeLessThan(c.maxStrikeDur);
  });
  it('every key has a slider range (the tuner renders one row per key)', () => {
    for (const k of LUNGE_KEYS) expect(LUNGE_RANGES[k], k).toHaveLength(3);
  });
  it('has retired strikeDist', () => {
    expect((getLungeConfig() as unknown as Record<string, number>).strikeDist).toBeUndefined();
  });
  // The tuner renders from LUNGE_GROUPS, so a key missing from every group would be silently unreachable —
  // exactly the kind of dial-you-can't-see this rebuild exists to prevent.
  it('every key appears in exactly one tuner group', () => {
    const grouped = LUNGE_GROUPS.flatMap((g) => g.keys);
    expect([...grouped].sort()).toEqual([...LUNGE_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});

// The strike curve was hardcoded `power3.in` until the strike-feel pass, and then a single global dial. It is
// now a FUNCTION OF TRAVEL DISTANCE (three bands), because the same curve reads as a snap over 180ms and as a
// drift-then-lurch over 440ms. These lock the shipped feel: all bands default to the original curve.
describe('strike ease is a function of travel', () => {
  // Owner feel pass 2026-07-21 moved every band from 'power3.in' to 'expo.in'. All three still agree, so
  // banding stays opt-in — this locks the shipped curve and catches an accidental single-band edit.
  it('every band ships the same curve, expo.in', () => {
    for (const px of [0, 100, 300, 700, 5000]) expect(strikeEaseFor(px), `${px}px`).toBe('expo.in');
  });
  it('bands split on the configured thresholds', () => {
    const c = getLungeConfig();
    expect(strikeBandFor(c.bandShortPx)).toBe('short');
    expect(strikeBandFor(c.bandShortPx + 1)).toBe('mid');
    expect(strikeBandFor(c.bandLongPx)).toBe('mid');
    expect(strikeBandFor(c.bandLongPx + 1)).toBe('long');
  });
  it('each band slider covers exactly the available curves', () => {
    for (const k of EASE_KEYS) {
      const [min, max] = LUNGE_RANGES[k];
      expect(min, k).toBe(0);
      expect(max, k).toBe(STRIKE_EASES.length - 1);
    }
  });
  it('every listed curve is a non-empty GSAP ease string', () => {
    for (const e of STRIKE_EASES) expect(typeof e === 'string' && e.length > 0, e).toBe(true);
  });
});
