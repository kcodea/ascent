// packages/ui/src/buffPresets.test.ts
import { describe, expect, it } from 'vitest';
import { buffPreset, BUFF_PRESETS } from './buffPresets';

describe('buffPreset resolver — most-specific wins', () => {
  it('maps every Beast-tribe buffer to the beast-tribe preset (by tribe, regardless of card)', () => {
    expect(buffPreset('kennel', 'beast')).toBe('beast-tribe');
    expect(buffPreset('someUnmappedBeast', 'beast')).toBe('beast-tribe');
  });
  it('falls back to default when the tribe is not mapped', () => {
    expect(buffPreset('nope', 'dragon')).toBe('default');
    expect(buffPreset('anything', 'undead')).toBe('default');
  });
  it('every preset name the resolver can return exists in BUFF_PRESETS', () => {
    for (const name of ['default', 'beast-tribe']) expect(BUFF_PRESETS[name]).toBeDefined();
  });
  it('every preset is a complete tendril config (style + colors + numeric dials)', () => {
    for (const cfg of Object.values(BUFF_PRESETS)) {
      expect(cfg.style).toBe('tendril');
      expect(typeof cfg.colorCore).toBe('string');
      expect(typeof cfg.travelMs).toBe('number');
      expect(['add', 'normal', 'screen']).toContain(cfg.blend);
    }
  });
});
