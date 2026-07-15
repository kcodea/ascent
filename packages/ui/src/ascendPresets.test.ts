import { describe, it, expect } from 'vitest';
import { ASCEND_PRESETS, ascendPreset, type AscendPresetCfg } from './ascendPresets';
import type { Tribe } from '@game/core';

const FIELDS: (keyof AscendPresetCfg)[] = [
  'style', 'durationMs', 'flashSize', 'flashAlpha', 'flashMs', 'colorGlow', 'colorSpark', 'swapAt', 'overshoot',
];

describe('ascendPresets', () => {
  it('every preset has every AscendPresetCfg field', () => {
    for (const [name, cfg] of Object.entries(ASCEND_PRESETS)) {
      for (const f of FIELDS) expect(cfg[f], `${name}.${String(f)}`).not.toBeUndefined();
    }
  });

  it('always has a default preset (the owner-tuned flash morph)', () => {
    expect(ASCEND_PRESETS.default).toBeDefined();
    expect(ASCEND_PRESETS.default.style).toBe('flash');
  });

  it('ascendPreset falls through to default for an unmapped card + tribe', () => {
    expect(ascendPreset('no-such-card', 'neutral' as Tribe)).toBe('default');
  });

  it('ascendPreset returns default when a mapping points at a missing preset (stale mapping)', () => {
    expect(ascendPreset('anything', 'beast' as Tribe)).toBe('default');
  });
});
