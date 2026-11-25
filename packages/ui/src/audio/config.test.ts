import { describe, it, expect } from 'vitest';
import { DEFAULT_AUDIO_CONFIG, mergeConfig, effectiveGain, busOf, CATEGORY_GAINS, BUS_NAMES } from './config';

describe('DEFAULT_AUDIO_CONFIG', () => {
  it('keeps the master-limiter values + the owner-tuned master gain', () => {
    expect(DEFAULT_AUDIO_CONFIG.master).toEqual({ threshold: -6, knee: 0, ratio: 20, attack: 0.001, release: 0.25 });
    expect(DEFAULT_AUDIO_CONFIG.masterGain).toBe(0.5);
  });
  it('gives every current category a bus + its current gain', () => {
    for (const key of Object.keys(CATEGORY_GAINS)) {
      const c = DEFAULT_AUDIO_CONFIG.categories[key];
      expect(c, key).toBeDefined();
      expect(c.gain).toBe(CATEGORY_GAINS[key]);
      expect(BUS_NAMES).toContain(c.bus);
    }
  });
  it('routes the synth-only buff cue to the combat bus (its gain is inert but present)', () => {
    expect(DEFAULT_AUDIO_CONFIG.categories.buff.bus).toBe('combat');
  });
  it('buses default to unity gain, compressor bypassed', () => {
    for (const b of BUS_NAMES) {
      expect(DEFAULT_AUDIO_CONFIG.buses[b]).toEqual({ gain: 1, comp: null });
    }
  });
});

describe('mergeConfig', () => {
  it('overlays saved values and fills missing fields from defaults', () => {
    const merged = mergeConfig(DEFAULT_AUDIO_CONFIG, { masterGain: 0.5, categories: { buy: { bus: 'combat', gain: 0.9 } } });
    expect(merged.masterGain).toBe(0.5);
    expect(merged.categories.buy).toEqual({ bus: 'combat', gain: 0.9 });
    expect(merged.categories.cardVoice).toEqual(DEFAULT_AUDIO_CONFIG.categories.cardVoice);
    expect(merged.master).toEqual(DEFAULT_AUDIO_CONFIG.master);
  });
});

describe('effectiveGain + busOf', () => {
  it('multiplies category gain by a per-clip override', () => {
    const cfg = mergeConfig(DEFAULT_AUDIO_CONFIG, { categories: { cardVoice: { bus: 'voice', gain: 0.2 } }, clips: { 'cards/alley': 0.5 } });
    expect(effectiveGain(cfg, 'cardVoice', 'cards/alley')).toBeCloseTo(0.1);
    expect(effectiveGain(cfg, 'cardVoice', 'cards/none')).toBeCloseTo(0.2);
    expect(busOf(cfg, 'cardVoice')).toBe('voice');
  });
  it('falls an unmapped category back to ui / 0.6', () => {
    expect(busOf(DEFAULT_AUDIO_CONFIG, 'brand_new_cue')).toBe('ui');
    expect(effectiveGain(DEFAULT_AUDIO_CONFIG, 'brand_new_cue')).toBe(0.6);
  });
});

describe('hero select lines (R-LOCATION-12)', () => {
  it('have a fader of their own, level with the announcer, apart from the lines said during a game', () => {
    // -20.2 LUFS clips through heroLine and the master: about the -17 LUFS the announcer's lines come out at.
    const out = -20.2 + 20 * Math.log10(effectiveGain(DEFAULT_AUDIO_CONFIG, 'heroLine') * DEFAULT_AUDIO_CONFIG.masterGain);
    expect(Math.abs(out - -17)).toBeLessThan(0.3);
    expect(CATEGORY_GAINS.heroSelect).toBe(1.4);
    expect(DEFAULT_AUDIO_CONFIG.clips['heroes/gambler']).toBeLessThan(1);
  });
});
