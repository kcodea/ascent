// packages/ui/src/buffPresets.test.ts
import { describe, expect, it } from 'vitest';
import { buffPreset, BUFF_PRESETS } from './buffPresets';

describe('buffPreset resolver — per-tribe assignment', () => {
  it('maps each tribe to its own tendril preset (by tribe, regardless of card)', () => {
    expect(buffPreset('kennel', 'beast')).toBe('beast-tribe');
    expect(buffPreset('anyBeast', 'beast')).toBe('beast-tribe');
    expect(buffPreset('anyMech', 'mech')).toBe('mech-tribe');
    expect(buffPreset('anyDragon', 'dragon')).toBe('dragon-tribe');
    expect(buffPreset('anyDemon', 'demon')).toBe('imp-tribe');
    expect(buffPreset('anyUndead', 'undead')).toBe('undead-tribe');
  });
  it('falls back to default for neutral (no dedicated preset)', () => {
    expect(buffPreset('glue', 'neutral')).toBe('default');
  });
  it('every preset name the resolver can return exists in BUFF_PRESETS', () => {
    for (const name of ['default', 'beast-tribe', 'mech-tribe', 'dragon-tribe', 'imp-tribe', 'undead-tribe']) {
      expect(BUFF_PRESETS[name]).toBeDefined();
    }
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
