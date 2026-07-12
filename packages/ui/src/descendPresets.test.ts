import { describe, it, expect } from 'vitest';
import { DESCEND_PRESETS, descendPreset, type DescendPresetCfg } from './descendPresets';
import type { PulsePresetCfg } from './pulsePresets';
import type { Tribe } from '@game/core';

const DROP_FIELDS: (keyof DescendPresetCfg)[] = [
  'blend', 'startHeight', 'dropMs', 'curve', 'wobbleAmp', 'wobbleFreq', 'retractMs',
  'baseWidth', 'tipWidth', 'coreAlpha', 'glowWidth', 'glowAlpha', 'colorCore', 'colorGlow', 'pulse',
];
const PULSE_FIELDS: (keyof PulsePresetCfg)[] = [
  'style', 'blend', 'ringCount', 'ringSize', 'ringWidth', 'ringSpeed', 'ringMs', 'ringStaggerMs',
  'coreFlashSize', 'coreFlashMs', 'sparkCount', 'sparkSpeed', 'sparkLife', 'sparkSize', 'holdMs',
  'colorRing', 'colorCore', 'colorSpark',
];

describe('descendPresets', () => {
  it('every preset has every DescendPresetCfg field, incl. a complete embedded pulse', () => {
    for (const [name, cfg] of Object.entries(DESCEND_PRESETS)) {
      for (const f of DROP_FIELDS) expect(cfg[f], `${name}.${String(f)}`).not.toBeUndefined();
      for (const f of PULSE_FIELDS) expect(cfg.pulse[f], `${name}.pulse.${String(f)}`).not.toBeUndefined();
    }
  });
  it('always has a default preset', () => {
    expect(DESCEND_PRESETS.default).toBeDefined();
  });
  it('descendPreset falls through to default for unmapped card + tribe', () => {
    expect(descendPreset('no-such-card', 'neutral' as Tribe)).toBe('default');
  });
  it('descendPreset returns default for a stale mapping', () => {
    expect(descendPreset('anything', 'beast' as Tribe)).toBe('default');
  });
});
