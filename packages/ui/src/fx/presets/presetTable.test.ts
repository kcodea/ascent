import { describe, it, expect } from 'vitest';
import { parsePresetTable, UNSAFE_KEYS } from './presetTable';

describe('parsePresetTable', () => {
  const good = {
    version: 1,
    archetypes: [
      { id: 'bolt', label: 'Bolt', icon: '⚡', blurb: 'travels fast', base: 'preset-bolt',
        variants: ['thin', 'heavy'] },
    ],
    variantAxes: [
      { id: 'thin', label: 'Thin', transform: { size: 0.6 } },
      { id: 'heavy', label: 'Heavy', transform: { size: 1.6, speed: 0.7 } },
    ],
  };

  it('parses a well-formed table', () => {
    const t = parsePresetTable(good);
    expect(t.archetypes).toHaveLength(1);
    expect(t.archetypes[0].variants).toEqual(['thin', 'heavy']);
    expect(t.variantAxes[1].transform).toEqual({ size: 1.6, speed: 0.7 });
  });

  it('rejects an archetype naming an axis that is not declared', () => {
    const bad = { ...good, archetypes: [{ ...good.archetypes[0], variants: ['thin', 'nope'] }] };
    expect(() => parsePresetTable(bad)).toThrow(/nope/);
  });

  it('rejects a duplicate archetype id', () => {
    const bad = { ...good, archetypes: [good.archetypes[0], good.archetypes[0]] };
    expect(() => parsePresetTable(bad)).toThrow(/bolt/);
  });

  it('refuses a reserved key in a transform', () => {
    for (const key of UNSAFE_KEYS) {
      const bad = { ...good, variantAxes: [{ id: 'thin', label: 'Thin', transform: { [key]: 2 } },
                                            good.variantAxes[1]] };
      expect(() => parsePresetTable(bad)).toThrow(/reserved/i);
    }
  });

  it('rejects a non-finite multiplier', () => {
    const bad = { ...good, variantAxes: [{ id: 'thin', label: 'Thin', transform: { size: NaN } },
                                          good.variantAxes[1]] };
    expect(() => parsePresetTable(bad)).toThrow(/size/);
  });
});
