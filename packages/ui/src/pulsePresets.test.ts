import { describe, it, expect } from 'vitest';
import { PULSE_PRESETS, pulsePreset, type PulsePresetCfg } from './pulsePresets';
import type { Tribe } from '@game/core';

const FIELDS: (keyof PulsePresetCfg)[] = [
  'style', 'blend', 'ringCount', 'ringSize', 'ringWidth', 'ringSpeed', 'ringMs', 'ringStaggerMs',
  'coreFlashSize', 'coreFlashMs', 'sparkCount', 'sparkSpeed', 'sparkLife', 'sparkSize', 'holdMs',
  'colorRing', 'colorCore', 'colorSpark',
];

describe('pulsePresets', () => {
  it('every preset has every PulsePresetCfg field', () => {
    for (const [name, cfg] of Object.entries(PULSE_PRESETS)) {
      for (const f of FIELDS) expect(cfg[f], `${name}.${String(f)}`).not.toBeUndefined();
    }
  });

  it('always has a default preset', () => {
    expect(PULSE_PRESETS.default).toBeDefined();
  });

  it('pulsePreset falls through to default for an unmapped card + tribe', () => {
    expect(pulsePreset('no-such-card', 'neutral' as Tribe)).toBe('default');
  });

  it('pulsePreset returns default when a mapping points at a missing preset (stale mapping)', () => {
    expect(pulsePreset('anything', 'beast' as Tribe)).toBe('default');
  });
});
