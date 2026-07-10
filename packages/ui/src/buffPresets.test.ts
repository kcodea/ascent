// packages/ui/src/buffPresets.test.ts
import { describe, expect, it } from 'vitest';
import { buffPreset, BUFF_PRESETS } from './buffPresets';

describe('buffPreset resolver — most-specific wins', () => {
  it('returns the per-card preset when the card is mapped', () => {
    expect(buffPreset('kennel', 'beast')).toBe('kennelmaster');
  });
  it('falls back to the per-tribe preset when only the tribe is mapped', () => {
    expect(buffPreset('someUnmappedCard', 'beast')).toBe('default');
  });
  it('falls back to default when neither card nor tribe is mapped', () => {
    expect(buffPreset('nope', 'dragon')).toBe('default');
  });
  it('every preset name the resolver can return exists in BUFF_PRESETS', () => {
    for (const name of ['default', 'kennelmaster']) expect(BUFF_PRESETS[name]).toBeDefined();
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
