import { describe, expect, it } from 'vitest';
import { hexToNum } from './color';
import { getMilestoneFrameConfig } from '../milestoneFrameConfig';
import { milestoneTierPalette, rampFromColor } from './milestonePalette';

describe('rampFromColor', () => {
  it('returns four rim→core stops, colour in the middle, core the brightest', () => {
    const [rim, outer, inner, core] = rampFromColor(0xffd54a);
    expect([rim, outer, inner, core]).toEqual([0x2e260d, 0x806b25, 0xffd54a, 0xfff6d7]);
    // luminance climbs rim → core (the burst reads dark-edge → hot-centre)
    const lum = (n: number): number => ((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff);
    expect(lum(rim)).toBeLessThan(lum(outer));
    expect(lum(outer)).toBeLessThan(lum(inner));
    expect(lum(inner)).toBeLessThan(lum(core));
  });

  it('keeps the source colour verbatim as the inner stop', () => {
    expect(rampFromColor(0x4fd1ff)[2]).toBe(0x4fd1ff);
  });

  it('black → a neutral grey core, everything else black', () => {
    expect(rampFromColor(0x000000)).toEqual([0x000000, 0x000000, 0x000000, 0xc7c7c7]);
  });
});

describe('milestoneTierPalette', () => {
  it('maps tier N to glowN from the live config (tier 3 = glow3)', () => {
    const cfg = getMilestoneFrameConfig();
    expect(milestoneTierPalette(1)).toEqual(rampFromColor(hexToNum(cfg.glow1)));
    expect(milestoneTierPalette(3)).toEqual(rampFromColor(hexToNum(cfg.glow3)));
    expect(milestoneTierPalette(6)).toEqual(rampFromColor(hexToNum(cfg.glow6)));
  });

  it('gives different tiers different colours when their glows differ (T3 gold vs T6 crystal)', () => {
    expect(milestoneTierPalette(3)).not.toEqual(milestoneTierPalette(6));
  });

  it('is undefined for an out-of-range tier (no recolor → the def plays its own colours)', () => {
    expect(milestoneTierPalette(0)).toBeUndefined();
    expect(milestoneTierPalette(7)).toBeUndefined();
  });
});
