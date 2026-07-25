import { describe, expect, it, expectTypeOf } from 'vitest';
import { coerceParams, defaultsOf, validateSpecs, type FxParamSpecs, type ParamsOf } from './params';

const SPECS = {
  width: { kind: 'slider', label: 'Width', min: 1, max: 100, step: 1, default: 40 },
  loop: { kind: 'toggle', label: 'Loop', default: true },
  palette: { kind: 'enum', label: 'Palette', options: ['violet', 'ember'], default: 'violet' },
} satisfies FxParamSpecs;

describe('defaultsOf', () => {
  it('lifts every default into a params object', () => {
    expect(defaultsOf(SPECS)).toEqual({ width: 40, loop: true, palette: 'violet' });
  });

  it('returns a fresh object each call so callers cannot share state', () => {
    expect(defaultsOf(SPECS)).not.toBe(defaultsOf(SPECS));
  });

  it('returns a copy of a palette default, not the shared spec reference', () => {
    const paletteSpecs = {
      pal: { kind: 'palette' as const, label: 'Palette', default: [1, 2, 3, 4] as const },
    } satisfies FxParamSpecs;
    const a = defaultsOf(paletteSpecs);
    const b = defaultsOf(paletteSpecs);
    expect(a.pal).toEqual([1, 2, 3, 4]);
    expect(a.pal).not.toBe(b.pal);
    expect(a.pal).not.toBe(paletteSpecs.pal.default);
  });

  it('returns a deep copy of a curve default (mutating the result never touches the spec)', () => {
    const curveSpecs = {
      c: { kind: 'curve' as const, label: 'Curve', default: [[0, 1], [1, 0]] as const },
    } satisfies FxParamSpecs;
    const a = defaultsOf(curveSpecs);
    const b = defaultsOf(curveSpecs);
    expect(a.c).toEqual([[0, 1], [1, 0]]);
    expect(a.c).not.toBe(b.c);
    // The inner point arrays are copies too — a shallow spread would leave these aliased to the spec.
    expect(a.c[0]).not.toBe(curveSpecs.c.default[0]);
    a.c[0][1] = 0.123;
    expect(curveSpecs.c.default[0][1]).toBe(1);
  });
});

describe('coerceParams', () => {
  it('fills missing keys from defaults', () => {
    expect(coerceParams(SPECS, { width: 12 })).toEqual({ width: 12, loop: true, palette: 'violet' });
  });

  it('clamps a slider to its declared range', () => {
    expect(coerceParams(SPECS, { width: 1000 }).width).toBe(100);
    expect(coerceParams(SPECS, { width: -5 }).width).toBe(1);
  });

  it('falls back to the default when a value has the wrong type', () => {
    expect(coerceParams(SPECS, { width: 'wide' }).width).toBe(40);
    expect(coerceParams(SPECS, { loop: 'yes' }).loop).toBe(true);
  });

  it('rejects an enum value that is not in options', () => {
    expect(coerceParams(SPECS, { palette: 'chartreuse' }).palette).toBe('violet');
  });

  it('ignores unknown keys rather than passing them through', () => {
    expect(coerceParams(SPECS, { nope: 1 })).toEqual({ width: 40, loop: true, palette: 'violet' });
  });

  it('falls back to the default for NaN and Infinity', () => {
    expect(coerceParams(SPECS, { width: NaN }).width).toBe(40);
    expect(coerceParams(SPECS, { width: Infinity }).width).toBe(40);
  });

  it('handles a color param (number passed through unclamped)', () => {
    const colorSpecs = {
      glow: { kind: 'color' as const, label: 'Glow', default: 0xff00ff },
    } satisfies FxParamSpecs;
    expect(coerceParams(colorSpecs, { glow: 0x00ff00 }).glow).toBe(0x00ff00);
    expect(coerceParams(colorSpecs, { glow: 999999 }).glow).toBe(999999); // no clamping
  });

  it('rejects an array as the raw params object', () => {
    expect(coerceParams(SPECS, [1, 2, 3])).toEqual({ width: 40, loop: true, palette: 'violet' });
  });

  describe('palette kind', () => {
    const paletteSpecs = {
      pal: {
        kind: 'palette' as const,
        label: 'Palette',
        default: [0x111111, 0x222222, 0x333333, 0x444444] as const,
      },
    } satisfies FxParamSpecs;

    it('accepts a valid 4-number array', () => {
      expect(coerceParams(paletteSpecs, { pal: [1, 2, 3, 0xffffff] })).toEqual({ pal: [1, 2, 3, 0xffffff] });
    });

    it('rejects a 3-element array, falling back to the default', () => {
      expect(coerceParams(paletteSpecs, { pal: [1, 2, 3] })).toEqual({
        pal: [0x111111, 0x222222, 0x333333, 0x444444],
      });
    });

    it('rejects an array containing a non-number, falling back to the default', () => {
      expect(coerceParams(paletteSpecs, { pal: [1, 2, 'x', 4] })).toEqual({
        pal: [0x111111, 0x222222, 0x333333, 0x444444],
      });
    });

    it('rejects an array with an out-of-range stop, falling back to the default', () => {
      expect(coerceParams(paletteSpecs, { pal: [1, 2, 3, 0x1000000] })).toEqual({
        pal: [0x111111, 0x222222, 0x333333, 0x444444],
      });
      expect(coerceParams(paletteSpecs, { pal: [-1, 2, 3, 4] })).toEqual({
        pal: [0x111111, 0x222222, 0x333333, 0x444444],
      });
    });

    it('returns a fresh array rather than aliasing the input', () => {
      const input = [1, 2, 3, 4];
      const result = coerceParams(paletteSpecs, { pal: input });
      expect(result.pal).toEqual(input);
      expect(result.pal).not.toBe(input);
    });
  });

  describe('shape kind', () => {
    const shapeSpecs = {
      s: { kind: 'shape' as const, label: 'Shape', default: 'circle' },
    } satisfies FxParamSpecs;

    it('lifts the default through defaultsOf', () => {
      expect(defaultsOf(shapeSpecs)).toEqual({ s: 'circle' });
    });

    it('accepts a built-in id', () => {
      expect(coerceParams(shapeSpecs, { s: 'shard' }).s).toBe('shard');
    });

    it('accepts an ARBITRARY id — the valid set is a runtime registry, not a fixed option list', () => {
      // A def saved on another machine may name a custom shape this browser never imported. Rewriting it to
      // the default here would permanently lose the reference; the render path falls back instead.
      expect(coerceParams(shapeSpecs, { s: 'custom:ember-wisp' }).s).toBe('custom:ember-wisp');
    });

    it('drops a non-string back to the default', () => {
      expect(coerceParams(shapeSpecs, { s: 7 }).s).toBe('circle');
      expect(coerceParams(shapeSpecs, { s: null }).s).toBe('circle');
      expect(coerceParams(shapeSpecs, { s: ['circle'] }).s).toBe('circle');
    });

    it('drops an empty string back to the default', () => {
      expect(coerceParams(shapeSpecs, { s: '' }).s).toBe('circle');
    });
  });

  describe('curve kind', () => {
    const curveSpecs = {
      c: { kind: 'curve' as const, label: 'Curve', default: [[0, 1], [1, 0]] as const },
    } satisfies FxParamSpecs;

    it('accepts a valid curve', () => {
      expect(coerceParams(curveSpecs, { c: [[0, 0.2], [0.5, 1], [1, 0]] }).c).toEqual([
        [0, 0.2],
        [0.5, 1],
        [1, 0],
      ]);
    });

    it('clamps out-of-range t and v into [0,1]', () => {
      expect(coerceParams(curveSpecs, { c: [[-1, 2], [2, -3]] }).c).toEqual([[0, 1], [1, 0]]);
    });

    it('sorts unsorted input ascending by t', () => {
      expect(coerceParams(curveSpecs, { c: [[1, 0], [0.5, 0.4], [0, 1]] }).c).toEqual([
        [0, 1],
        [0.5, 0.4],
        [1, 0],
      ]);
    });

    it('drops a curve with fewer than 2 points back to the default', () => {
      expect(coerceParams(curveSpecs, { c: [[0.5, 0.5]] }).c).toEqual([[0, 1], [1, 0]]);
    });

    it('drops a malformed point (wrong tuple shape) back to the default', () => {
      expect(coerceParams(curveSpecs, { c: [[0, 1], [1]] }).c).toEqual([[0, 1], [1, 0]]);
      expect(coerceParams(curveSpecs, { c: [[0, 1], [1, 'x']] }).c).toEqual([[0, 1], [1, 0]]);
    });

    it('drops a non-array value back to the default', () => {
      expect(coerceParams(curveSpecs, { c: 'nope' }).c).toEqual([[0, 1], [1, 0]]);
      expect(coerceParams(curveSpecs, { c: 5 }).c).toEqual([[0, 1], [1, 0]]);
    });

    it('returns fresh nested arrays rather than aliasing the input', () => {
      const input = [[0, 1], [1, 0]];
      const result = coerceParams(curveSpecs, { c: input });
      expect(result.c).toEqual(input);
      expect(result.c).not.toBe(input);
      expect(result.c[0]).not.toBe(input[0]);
    });
  });
});

describe('ParamsOf type derivation', () => {
  it('derives the correct type for enum params (union of options, not just default)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const specsWithEnum = {
      color: { kind: 'enum' as const, label: 'Color', options: ['violet', 'ember'] as const, default: 'violet' as const },
    } satisfies FxParamSpecs;
    type Params = ParamsOf<typeof specsWithEnum>;
    // Bidirectional assertion: the type must be exactly 'violet' | 'ember', not just a subtype of it.
    // This catches the old broken ParamsOf that resolved to literal 'violet'.
    expectTypeOf<Params['color']>().toEqualTypeOf<'violet' | 'ember'>();
  });

  it('derives a concrete 4-number tuple for palette params (not a readonly-widened array)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const specsWithPalette = {
      pal: { kind: 'palette' as const, label: 'Palette', default: [1, 2, 3, 4] as const },
    } satisfies FxParamSpecs;
    type Params = ParamsOf<typeof specsWithPalette>;
    expectTypeOf<Params['pal']>().toEqualTypeOf<[number, number, number, number]>();
  });

  it('derives a mutable [number, number][] for curve params (not the readonly spec default)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const specsWithCurve = {
      c: { kind: 'curve' as const, label: 'Curve', default: [[0, 1], [1, 0]] as const },
    } satisfies FxParamSpecs;
    type Params = ParamsOf<typeof specsWithCurve>;
    expectTypeOf<Params['c']>().toEqualTypeOf<[number, number][]>();
  });

  it('derives plain string for shape params (NOT narrowed to the default, unlike enum)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const specsWithShape = {
      s: { kind: 'shape' as const, label: 'Shape', default: 'circle' as const },
    } satisfies FxParamSpecs;
    type Params = ParamsOf<typeof specsWithShape>;
    // Bidirectional: exactly `string`. Narrowing to 'circle' would make every imported shape id a type
    // error at the primitives' call sites.
    expectTypeOf<Params['s']>().toEqualTypeOf<string>();
  });
});

describe('validateSpecs', () => {
  it('returns empty array for a well-formed spec record', () => {
    expect(validateSpecs(SPECS)).toEqual([]);
  });

  it('catches a slider default above its max', () => {
    const badSlider = {
      value: { kind: 'slider' as const, label: 'Value', min: 0, max: 10, step: 1, default: 15 },
    } satisfies FxParamSpecs;
    const problems = validateSpecs(badSlider);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('default 15 is outside [0, 10]');
  });

  it('catches a slider default below its min', () => {
    const badSlider = {
      value: { kind: 'slider' as const, label: 'Value', min: 5, max: 10, step: 1, default: 2 },
    } satisfies FxParamSpecs;
    const problems = validateSpecs(badSlider);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('default 2 is outside [5, 10]');
  });

  it('catches a slider min > max', () => {
    const badSlider = {
      value: { kind: 'slider' as const, label: 'Value', min: 100, max: 10, step: 1, default: 50 },
    } satisfies FxParamSpecs;
    const problems = validateSpecs(badSlider);
    expect(problems.some(p => p.includes('min 100 exceeds max 10'))).toBe(true);
  });

  it('catches an enum default not in options', () => {
    const badEnum = {
      color: { kind: 'enum' as const, label: 'Color', options: ['red', 'blue'], default: 'green' },
    } satisfies FxParamSpecs;
    const problems = validateSpecs(badEnum);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("default 'green' is not one of its options");
  });

  it('catches a palette default with the wrong number of stops', () => {
    const badPalette = {
      pal: {
        kind: 'palette' as const,
        label: 'Palette',
        default: [1, 2, 3] as unknown as readonly [number, number, number, number],
      },
    } satisfies FxParamSpecs;
    const problems = validateSpecs(badPalette);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('must have exactly 4 stops');
  });

  it('catches a palette default with an out-of-range stop', () => {
    const badPalette = {
      pal: { kind: 'palette' as const, label: 'Palette', default: [1, 2, 3, 0x1000000] as const },
    } satisfies FxParamSpecs;
    const problems = validateSpecs(badPalette);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('outside [0, 0xFFFFFF]');
  });

  it('accepts a well-formed palette spec', () => {
    const okPalette = {
      pal: { kind: 'palette' as const, label: 'Palette', default: [1, 2, 3, 4] as const },
    } satisfies FxParamSpecs;
    expect(validateSpecs(okPalette)).toEqual([]);
  });

  it('catches an empty shape default', () => {
    const badShape = {
      s: { kind: 'shape' as const, label: 'Shape', default: '' },
    } satisfies FxParamSpecs;
    const problems = validateSpecs(badShape);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('non-empty shape id');
  });

  it('accepts a well-formed shape spec', () => {
    const okShape = {
      s: { kind: 'shape' as const, label: 'Shape', default: 'circle' },
    } satisfies FxParamSpecs;
    expect(validateSpecs(okShape)).toEqual([]);
  });

  it('catches a curve default with fewer than 2 points', () => {
    const badCurve = {
      c: {
        kind: 'curve' as const,
        label: 'Curve',
        default: [[0, 1]] as unknown as readonly (readonly [number, number])[],
      },
    } satisfies FxParamSpecs;
    const problems = validateSpecs(badCurve);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('at least 2 points');
  });

  it('catches a curve default with an out-of-range point', () => {
    const badCurve = {
      c: { kind: 'curve' as const, label: 'Curve', default: [[0, 1], [1, 2]] as const },
    } satisfies FxParamSpecs;
    const problems = validateSpecs(badCurve);
    expect(problems.some((p) => p.includes('outside [0, 1]'))).toBe(true);
  });

  it('catches a curve default that is not sorted by t', () => {
    const badCurve = {
      c: { kind: 'curve' as const, label: 'Curve', default: [[1, 0], [0, 1]] as const },
    } satisfies FxParamSpecs;
    const problems = validateSpecs(badCurve);
    expect(problems.some((p) => p.includes('sorted ascending by t'))).toBe(true);
  });

  it('accepts a well-formed curve spec', () => {
    const okCurve = {
      c: { kind: 'curve' as const, label: 'Curve', default: [[0, 1], [0.5, 0.5], [1, 0]] as const },
    } satisfies FxParamSpecs;
    expect(validateSpecs(okCurve)).toEqual([]);
  });
});
