import { describe, expect, it } from 'vitest';
import { WARD_GROUPS, WARD_KEYS, WARD_RANGES, getWardConfig } from './wardConfig';

describe('wardConfig', () => {
  it('every key has a slider range (the tuner renders one row per key)', () => {
    for (const k of WARD_KEYS) expect(WARD_RANGES[k], k).toHaveLength(3);
  });

  // The tuner renders from WARD_GROUPS, so a key missing from every group would be a dial that exists but
  // can't be reached — same guard as the Lunge tuner.
  it('every key appears in exactly one tuner group', () => {
    const grouped = WARD_GROUPS.flatMap((g) => g.keys);
    expect([...grouped].sort()).toEqual([...WARD_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("each default sits inside its own slider's range", () => {
    const cfg = getWardConfig();
    for (const k of WARD_KEYS) {
      const [min, max] = WARD_RANGES[k];
      expect(cfg[k], k).toBeGreaterThanOrEqual(min);
      expect(cfg[k], k).toBeLessThanOrEqual(max);
    }
  });

  // The dome now covers the whole arched frame, so inset must be able to go NEGATIVE — that is what lets it
  // bleed out past the card edge, which was impossible while it lived inside the clipped `.art`.
  it('inset can reach past the frame in both directions', () => {
    const [min, max] = WARD_RANGES.inset;
    expect(min).toBeLessThan(0);
    expect(max).toBeGreaterThan(0);
  });
});
