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

  const goodWithOverrides = {
    ...good,
    archetypes: [{ ...good.archetypes[0], overrides: { heavy: { size: 3 } } }],
  };

  it('parses a well-formed table', () => {
    const t = parsePresetTable(good);
    expect(t.archetypes).toHaveLength(1);
    expect(t.archetypes[0].variants).toEqual(['thin', 'heavy']);
    expect(t.variantAxes[1].transform).toEqual({ size: 1.6, speed: 0.7 });
  });

  it('parses overrides and carries them through to the output', () => {
    const t = parsePresetTable(goodWithOverrides);
    expect(t.archetypes[0].overrides).toEqual({ heavy: { size: 3 } });
  });

  it('rejects a non-array variantAxes', () => {
    const bad = { ...good, variantAxes: { thin: { id: 'thin', label: 'Thin', transform: {} } } };
    expect(() => parsePresetTable(bad)).toThrow(/variantAxes must be an array/);
  });

  it('rejects a non-array archetypes', () => {
    const bad = { ...good, archetypes: { bolt: good.archetypes[0] } };
    expect(() => parsePresetTable(bad)).toThrow(/archetypes must be an array/);
  });

  it('rejects a non-array variants on an archetype', () => {
    const bad = { ...good, archetypes: [{ ...good.archetypes[0], variants: 'thin' }] };
    expect(() => parsePresetTable(bad)).toThrow(/variants must be an array/);
  });

  it('rejects a null variantAxes member', () => {
    const bad = { ...good, variantAxes: [null, good.variantAxes[1]] };
    expect(() => parsePresetTable(bad)).toThrow(/variantAxes\[0\] must be an object/);
  });

  it('rejects a null archetypes member', () => {
    const bad = { ...good, archetypes: [null] };
    expect(() => parsePresetTable(bad)).toThrow(/archetypes\[0\] must be an object/);
  });

  it('rejects a null overrides', () => {
    const bad = { ...good, archetypes: [{ ...good.archetypes[0], overrides: null }] };
    expect(() => parsePresetTable(bad)).toThrow(/overrides must be an object/);
  });

  it('rejects an array overrides', () => {
    const bad = { ...good, archetypes: [{ ...good.archetypes[0], overrides: [] }] };
    expect(() => parsePresetTable(bad)).toThrow(/overrides must be an object/);
  });

  it('rejects a non-object transform (array)', () => {
    const bad = { ...good, variantAxes: [{ id: 'thin', label: 'Thin', transform: [1, 2] },
                                          good.variantAxes[1]] };
    expect(() => parsePresetTable(bad)).toThrow(/transform must be an object/);
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

  it('rejects a duplicate axis id, naming it', () => {
    const bad = { ...good, variantAxes: [good.variantAxes[0], good.variantAxes[0]] };
    expect(() => parsePresetTable(bad)).toThrow(/thin/);
  });

  it('rejects a reserved key inside an override', () => {
    for (const key of UNSAFE_KEYS) {
      const bad = { ...good, archetypes: [{ ...good.archetypes[0], overrides: { heavy: { [key]: 2 } } }] };
      expect(() => parsePresetTable(bad)).toThrow(/reserved/i);
    }
  });

  it('rejects an override naming an undeclared axis', () => {
    const bad = { ...good, archetypes: [{ ...good.archetypes[0], overrides: { nope: { size: 3 } } }] };
    expect(() => parsePresetTable(bad)).toThrow(/undeclared axis 'nope'/);
  });

  it('rejects a non-finite override value', () => {
    const bad = { ...good, archetypes: [{ ...good.archetypes[0], overrides: { heavy: { size: NaN } } }] };
    expect(() => parsePresetTable(bad)).toThrow(/size/);
  });
});
