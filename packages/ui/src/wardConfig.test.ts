import { describe, expect, it } from 'vitest';
import { WARD_COLOR_GROUPS, WARD_COLOR_KEYS, WARD_GROUPS, WARD_KEYS, WARD_RANGES, getWardConfig } from './wardConfig';

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

  // This config owns the dome's LOOK only. Geometry (size + vertical seat) is per-frame CSS
  // (`--wardsize`/`--wardy`, Card Frames tuner) and those rules set their own inset/transform — a geometry
  // dial here would be silently overridden, i.e. a dial that lies. Keep them out.
  it('has no geometry dials — the per-frame rules own dome size/seat and would override them', () => {
    for (const k of ['inset', 'scale', 'radius'] as const) {
      expect(WARD_KEYS, k).not.toContain(k);
    }
  });
});

// Colours are STRING dials rendered as swatches, so they're excluded from the numeric slider ranges — but
// they still have to be reachable in the panel, same guard as the sliders.
describe('ward colours', () => {
  it('every colour key appears in exactly one colour group', () => {
    const grouped = WARD_COLOR_GROUPS.flatMap((g) => g.keys);
    expect([...grouped].sort()).toEqual([...WARD_COLOR_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
  it('colour keys are excluded from the numeric keys (they have no slider range)', () => {
    for (const k of WARD_COLOR_KEYS) expect(WARD_KEYS, k).not.toContain(k);
    expect(Object.keys(WARD_RANGES).sort()).toEqual([...WARD_KEYS].sort());
  });
  it('every colour default is a #rrggbb string', () => {
    const cfg = getWardConfig() as unknown as Record<string, string>;
    for (const k of WARD_COLOR_KEYS) expect(cfg[k], k).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
