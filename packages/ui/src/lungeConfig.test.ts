import { describe, expect, it } from 'vitest';
import { getLungeConfig, LUNGE_KEYS } from './lungeConfig';

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
  it('LUNGE_KEYS enumerates every field', () => {
    expect(LUNGE_KEYS).toContain('windupDur');
    expect(LUNGE_KEYS).toContain('attackGap');
  });
  it('has retired strikeDist', () => {
    expect((getLungeConfig() as unknown as Record<string, number>).strikeDist).toBeUndefined();
  });
});
