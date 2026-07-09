import { describe, expect, it } from 'vitest';
import { getLungeConfig, LUNGE_KEYS, LUNGE_RANGES } from './lungeConfig';

describe('lungeConfig corner-clack dials', () => {
  it('exposes the new contact + distance dials with defaults', () => {
    const c = getLungeConfig();
    expect(c.bite).toBeGreaterThan(0);
    expect(c.leadTilt).toBeGreaterThan(0);
    expect(c.defenderSpin).toBeGreaterThan(0);
    expect(c.attackerRebound).toBeGreaterThan(0);
    expect(c.targetSpeed).toBeGreaterThan(0);
    expect(c.minStrikeDur).toBeLessThan(c.maxStrikeDur);
  });
  it('gives every key a slider range', () => {
    for (const k of LUNGE_KEYS) expect(LUNGE_RANGES[k]).toHaveLength(3);
  });
  it('has retired strikeDist', () => {
    expect((getLungeConfig() as unknown as Record<string, number>).strikeDist).toBeUndefined();
  });
});
