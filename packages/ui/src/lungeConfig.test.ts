import { describe, expect, it } from 'vitest';
import { LUNGE_KEYS, LUNGE_RANGES, STRIKE_EASES, getLungeConfig, strikeEase } from './lungeConfig';

describe('lungeConfig corner-clack dials', () => {
  it('exposes the contact + distance dials with defaults', () => {
    const c = getLungeConfig();
    expect(c.bite).toBeGreaterThan(0);
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
});

// The strike curve was hardcoded `power3.in` until the strike-feel pass. It's now an INDEX into STRIKE_EASES
// so the tuner can dial it — these lock the default to the shipped curve and keep the index in bounds.
describe('strike ease', () => {
  it('defaults to the shipped power3.in', () => {
    expect(strikeEase()).toBe('power3.in');
    expect(STRIKE_EASES[getLungeConfig().strikeEaseIdx]).toBe('power3.in');
  });
  it('the slider range covers exactly the available curves', () => {
    const [min, max] = LUNGE_RANGES.strikeEaseIdx;
    expect(min).toBe(0);
    expect(max).toBe(STRIKE_EASES.length - 1);
  });
  it('every listed curve is a non-empty GSAP ease string', () => {
    for (const e of STRIKE_EASES) expect(typeof e === 'string' && e.length > 0, e).toBe(true);
  });
});
