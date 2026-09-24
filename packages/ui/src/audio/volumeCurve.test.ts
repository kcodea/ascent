/**
 * THE DEFAULT MIX CURVE (owner ask 2026-09-24): "bake these audio values as the default volumes, but all at the 50
 * mark for volume." The owner's mix was Game sounds 50, Music 20, Announcer 70. Pins: every slider defaults to 50;
 * 50 plays that channel's reference gain; 100 plays exactly what 100 played before (full scale); 0 is silent; Game
 * sounds keeps its identity mapping; nothing ever exceeds the old maximum.
 */
import { describe, expect, it } from 'vitest';
import { CHANNEL_MAX_GAIN, CHANNEL_REF_GAIN, DEFAULT_SLIDER, sliderToGain, type AudioChannelId } from './volumeCurve';

const CHANNELS: AudioChannelId[] = ['sfx', 'music', 'announcer'];

describe('the default-mix volume curve', () => {
  it('defaults to the 50 mark', () => {
    expect(DEFAULT_SLIDER).toBe(0.5);
  });
  it('50 plays the owner mix: Game sounds 0.5, Music 0.2, Announcer 0.7', () => {
    expect(sliderToGain('sfx', 0.5)).toBeCloseTo(0.5, 10);
    expect(sliderToGain('music', 0.5)).toBeCloseTo(0.2, 10);
    expect(sliderToGain('announcer', 0.5)).toBeCloseTo(0.7, 10);
    for (const c of CHANNELS) expect(sliderToGain(c, DEFAULT_SLIDER)).toBeCloseTo(CHANNEL_REF_GAIN[c], 10);
  });
  it('100 is unchanged from before (full gain), and 0 is silent', () => {
    for (const c of CHANNELS) {
      expect(CHANNEL_MAX_GAIN[c]).toBe(1);
      expect(sliderToGain(c, 1)).toBe(1);
      expect(sliderToGain(c, 0)).toBe(0);
    }
  });
  it('Game sounds keeps its identity mapping', () => {
    for (let s = 0; s <= 100; s++) expect(sliderToGain('sfx', s / 100)).toBeCloseTo(s / 100, 10);
  });
  it('is monotonic, piecewise linear, and never passes the old maximum (clamped outside 0..1)', () => {
    for (const c of CHANNELS) {
      let prev = -1;
      for (let s = 0; s <= 100; s++) {
        const g = sliderToGain(c, s / 100);
        expect(g).toBeGreaterThanOrEqual(prev);
        expect(g).toBeLessThanOrEqual(CHANNEL_MAX_GAIN[c]);
        prev = g;
      }
      expect(sliderToGain(c, 0.25)).toBeCloseTo(CHANNEL_REF_GAIN[c] / 2, 10);
      expect(sliderToGain(c, 0.75)).toBeCloseTo((CHANNEL_REF_GAIN[c] + 1) / 2, 10);
      expect(sliderToGain(c, 7)).toBe(1);
      expect(sliderToGain(c, -3)).toBe(0);
    }
  });
});
