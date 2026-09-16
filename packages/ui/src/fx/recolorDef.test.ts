import { describe, expect, it } from 'vitest';
import type { FxDef, FxLayer } from './def';
import { recolorDef } from './recolorDef';

const PAL = [0x111111, 0x222222, 0x333333, 0x444444] as const;

function layer(params: Record<string, unknown>, primitive = 'burst'): FxLayer {
  return { primitive, anchor: 'source', at: 0, params };
}

function def(layers: FxLayer[]): FxDef {
  return { id: 'x', duration: 500, layers };
}

describe('recolorDef', () => {
  it('is an exact no-op (returns by identity) when no palette is given', () => {
    const d = def([layer({ palette: [1, 2, 3, 4] })]);
    expect(recolorDef(d, undefined)).toBe(d);
    expect(recolorDef(d, [])).toBe(d);
  });

  it('returns by identity when the def has no palette-bearing layer', () => {
    const d = def([layer({ alpha: 1 }, 'shockwave'), layer({ thickness: 3 })]);
    expect(recolorDef(d, PAL)).toBe(d);
  });

  it('swaps the palette on every palette-bearing layer', () => {
    const d = def([layer({ palette: [1, 2, 3, 4], size: 4 }), layer({ palette: [9, 9, 9, 9] }, 'shockwave')]);
    const out = recolorDef(d, PAL);
    expect(out).not.toBe(d);
    expect(out.layers[0].params.palette).toEqual([...PAL]);
    expect(out.layers[1].params.palette).toEqual([...PAL]);
    // other params ride along untouched
    expect(out.layers[0].params.size).toBe(4);
  });

  it('leaves a non-palette layer by identity while cloning the palette one', () => {
    const plain = layer({ alpha: 1 }, 'shockwave');
    const d = def([plain, layer({ palette: [1, 2, 3, 4] })]);
    const out = recolorDef(d, PAL);
    expect(out.layers[0]).toBe(plain); // untouched layer not copied
    expect(out.layers[1]).not.toBe(d.layers[1]); // recoloured layer cloned
  });

  it('does not mutate the input def or its layers', () => {
    const d = def([layer({ palette: [1, 2, 3, 4] })]);
    recolorDef(d, PAL);
    expect(d.layers[0].params.palette).toEqual([1, 2, 3, 4]);
  });

  it('gives each recoloured layer its OWN palette array (no shared reference)', () => {
    const d = def([layer({ palette: [1, 2, 3, 4] }), layer({ palette: [5, 6, 7, 8] })]);
    const out = recolorDef(d, PAL);
    expect(out.layers[0].params.palette).not.toBe(out.layers[1].params.palette);
  });

  it('preserves extra top-level fields of a richer def (StoredFxDef-shaped)', () => {
    const rich = { ...def([layer({ palette: [1, 2, 3, 4] })]), version: 1, seed: 42, label: 'x', tags: ['a'] };
    const out = recolorDef(rich, PAL);
    expect(out.version).toBe(1);
    expect(out.seed).toBe(42);
    expect(out.label).toBe('x');
    expect(out.tags).toEqual(['a']);
  });
});
