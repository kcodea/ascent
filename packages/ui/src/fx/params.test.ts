import { describe, expect, it, expectTypeOf } from 'vitest';
import {
  coerceParams,
  defaultOpenGroups,
  defaultsOf,
  DEFAULT_PARAM_GROUP,
  groupParamKeys,
  isParamEnabled,
  matchesParamQuery,
  mergeOpenGroups,
  paramDisabledReason,
  validateSpecs,
  visibleParamKeys,
  type FxParamSpec,
  type FxParamSpecs,
  type ParamsOf,
} from './params';
import { burstPrimitive } from './primitives/burst';
import { emitterPrimitive } from './primitives/emitter';
import { ribbonPrimitive } from './primitives/ribbon';
import { shockwavePrimitive } from './primitives/shockwave';
import { smokePrimitive } from './primitives/smoke';

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

    describe('vMax (raised value ceiling)', () => {
      const raisedSpecs = {
        c: { kind: 'curve' as const, label: 'Curve', vMax: 2, default: [[0, 1], [1, 0]] as const },
      } satisfies FxParamSpecs;

      // The backward-compatibility guarantee: a spec that omits vMax must behave EXACTLY as it did before
      // the option existed — v still clamps at 1.
      it('omitting vMax still clamps v to 1 (unchanged behaviour)', () => {
        expect(coerceParams(curveSpecs, { c: [[0, 1.8], [1, 5]] }).c).toEqual([[0, 1], [1, 1]]);
      });

      it('keeps a value above 1 when vMax allows it', () => {
        expect(coerceParams(raisedSpecs, { c: [[0, 1.8], [1, 0.5]] }).c).toEqual([[0, 1.8], [1, 0.5]]);
      });

      it('clamps a value above vMax down to vMax', () => {
        expect(coerceParams(raisedSpecs, { c: [[0, 2.5], [1, 0]] }).c).toEqual([[0, 2], [1, 0]]);
      });

      it('still clamps v below 0 regardless of vMax', () => {
        expect(coerceParams(raisedSpecs, { c: [[0, -3], [1, 1.2]] }).c).toEqual([[0, 0], [1, 1.2]]);
      });

      it('still clamps t to [0,1] regardless of vMax (the horizontal axis is always normalized)', () => {
        expect(coerceParams(raisedSpecs, { c: [[-1, 1.5], [4, 2]] }).c).toEqual([[0, 1.5], [1, 2]]);
      });
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

  it('accepts a curve default above 1 when vMax raises the ceiling', () => {
    const okCurve = {
      c: { kind: 'curve' as const, label: 'Curve', vMax: 2, default: [[0, 0.5], [0.5, 1.5], [1, 0]] as const },
    } satisfies FxParamSpecs;
    expect(validateSpecs(okCurve)).toEqual([]);
  });

  it('rejects that same default when vMax is omitted (the [0,1] default is unchanged)', () => {
    const badCurve = {
      c: { kind: 'curve' as const, label: 'Curve', default: [[0, 0.5], [0.5, 1.5], [1, 0]] as const },
    } satisfies FxParamSpecs;
    const problems = validateSpecs(badCurve);
    expect(problems.some((p) => p.includes('outside [0, 1]'))).toBe(true);
  });

  it('catches a curve default above its own raised vMax', () => {
    const badCurve = {
      c: { kind: 'curve' as const, label: 'Curve', vMax: 2, default: [[0, 1], [1, 2.5]] as const },
    } satisfies FxParamSpecs;
    const problems = validateSpecs(badCurve);
    expect(problems.some((p) => p.includes('outside [0, 2]'))).toBe(true);
  });

  it('flags a degenerate vMax (0, negative, or NaN)', () => {
    for (const vMax of [0, -1, Number.NaN]) {
      const badCurve = {
        c: { kind: 'curve' as const, label: 'Curve', vMax, default: [[0, 1], [1, 0]] as const },
      } satisfies FxParamSpecs;
      const problems = validateSpecs(badCurve);
      expect(problems.some((p) => p.includes('vMax must be a finite number greater than 0'))).toBe(true);
    }
  });
});

/* ── Progressive disclosure: the two spec fields the editor's Essentials tier and its disabled-with-a-reason
   rows are derived from, plus the pure helpers the inspector renders through. ──────────────────────────── */

const DEP_SPECS = {
  turbulence: { kind: 'slider', label: 'Turbulence', group: 'Physics', min: 0, max: 400, step: 5, default: 0 },
  turbScale: {
    kind: 'slider', label: 'Turb scale', group: 'Physics', min: 0.005, max: 0.1, step: 0.001, default: 0.02,
    enabledWhen: { param: 'turbulence', above: 0 },
  },
  emitShape: { kind: 'enum', label: 'Emit shape', group: 'Physics', options: ['point', 'disc'], default: 'point' },
  emitRadius: {
    kind: 'slider', label: 'Emit radius', group: 'Physics', min: 0, max: 120, step: 1, default: 0,
    enabledWhen: { param: 'emitShape', not: 'point' },
  },
  orient: { kind: 'toggle', label: 'Orient to velocity', group: 'Motion', default: false },
  spin: {
    kind: 'slider', label: 'Spin', group: 'Motion', min: 0, max: 180, step: 1, default: 25, essential: true,
    enabledWhen: { param: 'orient', is: false },
  },
  size: { kind: 'slider', label: 'Size', group: 'Shape', min: 1, max: 40, step: 1, default: 9, essential: true },
} satisfies FxParamSpecs;

describe('isParamEnabled', () => {
  it('is always true for a spec that declares no dependency', () => {
    expect(isParamEnabled(DEP_SPECS.size, defaultsOf(DEP_SPECS))).toBe(true);
    expect(isParamEnabled(DEP_SPECS.turbulence, { turbulence: 0 })).toBe(true);
  });

  it('above: enabled strictly above the threshold, disabled at or below it', () => {
    expect(isParamEnabled(DEP_SPECS.turbScale, { turbulence: 0 })).toBe(false);
    expect(isParamEnabled(DEP_SPECS.turbScale, { turbulence: -5 })).toBe(false);
    expect(isParamEnabled(DEP_SPECS.turbScale, { turbulence: 0.0001 })).toBe(true);
    expect(isParamEnabled(DEP_SPECS.turbScale, { turbulence: 40 })).toBe(true);
  });

  it('above: a non-numeric dependency value disables rather than coercing', () => {
    expect(isParamEnabled(DEP_SPECS.turbScale, { turbulence: '40' })).toBe(false);
    expect(isParamEnabled(DEP_SPECS.turbScale, { turbulence: Number.NaN })).toBe(false);
  });

  it('not: enabled for every value except the excluded one', () => {
    expect(isParamEnabled(DEP_SPECS.emitRadius, { emitShape: 'point' })).toBe(false);
    expect(isParamEnabled(DEP_SPECS.emitRadius, { emitShape: 'disc' })).toBe(true);
    expect(isParamEnabled(DEP_SPECS.emitRadius, { emitShape: 'ring' })).toBe(true);
  });

  it('is: strict equality, so a boolean false dependency is a real match (not a falsy miss)', () => {
    expect(isParamEnabled(DEP_SPECS.spin, { orient: false })).toBe(true);
    expect(isParamEnabled(DEP_SPECS.spin, { orient: true })).toBe(false);
    expect(isParamEnabled(DEP_SPECS.spin, { orient: 0 })).toBe(false);
  });

  it('ANDs multiple clauses', () => {
    const spec: FxParamSpec = {
      kind: 'slider', label: 'Both', min: 0, max: 10, step: 0.1, default: 0,
      enabledWhen: { param: 'mode', not: 'off', above: 2 },
    };
    expect(isParamEnabled(spec, { mode: 5 })).toBe(true);
    expect(isParamEnabled(spec, { mode: 1 })).toBe(false); // fails `above`
    expect(isParamEnabled(spec, { mode: 'off' })).toBe(false); // fails both
  });

  it('fails OPEN when it cannot evaluate — a control wrongly locked out is worse than one left live', () => {
    const orphan: FxParamSpec = {
      kind: 'slider', label: 'Orphan', min: 0, max: 1, step: 0.1, default: 0,
      enabledWhen: { param: 'missing', above: 0 },
    };
    expect(isParamEnabled(orphan, { present: 1 })).toBe(true);
    const empty: FxParamSpec = {
      kind: 'slider', label: 'Empty', min: 0, max: 1, step: 0.1, default: 0, enabledWhen: { param: 'orient' },
    };
    expect(isParamEnabled(empty, { orient: true })).toBe(true);
  });
});

describe('paramDisabledReason', () => {
  it('is null while the param is live', () => {
    expect(paramDisabledReason(DEP_SPECS, 'turbScale', { ...defaultsOf(DEP_SPECS), turbulence: 40 })).toBeNull();
    expect(paramDisabledReason(DEP_SPECS, 'size', defaultsOf(DEP_SPECS))).toBeNull();
  });

  it('names the DEPENDENCY by its label, not its key — the knob you have to go and move', () => {
    expect(paramDisabledReason(DEP_SPECS, 'turbScale', defaultsOf(DEP_SPECS))).toBe('Needs Turbulence above 0');
    expect(paramDisabledReason(DEP_SPECS, 'emitRadius', defaultsOf(DEP_SPECS))).toBe('Needs Emit shape ≠ point');
    expect(paramDisabledReason(DEP_SPECS, 'spin', { ...defaultsOf(DEP_SPECS), orient: true }))
      .toBe('Needs Orient to velocity off');
  });

  it('is null for an unknown key rather than throwing', () => {
    expect(paramDisabledReason(DEP_SPECS, 'nope', defaultsOf(DEP_SPECS))).toBeNull();
  });
});

describe('validateSpecs — enabledWhen', () => {
  it('flags an enabledWhen naming a param that does not exist in the same record', () => {
    const typo = {
      erode: { kind: 'slider' as const, label: 'Erode', min: 0, max: 1, step: 0.01, default: 0.5 },
      gain: {
        kind: 'slider' as const, label: 'Gain', min: 0, max: 2, step: 0.01, default: 1,
        enabledWhen: { param: 'erosion', above: 0 },
      },
    } satisfies FxParamSpecs;
    const problems = validateSpecs(typo);
    expect(problems.some((p) => p.includes("'gain'") && p.includes('erosion'))).toBe(true);
  });

  it('flags a self-referential dependency', () => {
    const selfDep = {
      gain: {
        kind: 'slider' as const, label: 'Gain', min: 0, max: 2, step: 0.01, default: 1,
        enabledWhen: { param: 'gain', above: 0 },
      },
    } satisfies FxParamSpecs;
    expect(validateSpecs(selfDep).some((p) => p.includes('depends on itself'))).toBe(true);
  });

  it('flags a predicate with nothing to test', () => {
    const bare = {
      erode: { kind: 'slider' as const, label: 'Erode', min: 0, max: 1, step: 0.01, default: 0.5 },
      gain: {
        kind: 'slider' as const, label: 'Gain', min: 0, max: 2, step: 0.01, default: 1,
        enabledWhen: { param: 'erode' },
      },
    } satisfies FxParamSpecs;
    expect(validateSpecs(bare).some((p) => p.includes('at least one of is/not/above'))).toBe(true);
  });

  it('accepts a well-formed dependency', () => {
    expect(validateSpecs(DEP_SPECS)).toEqual([]);
  });
});

describe('matchesParamQuery', () => {
  it('matches on the label, case-insensitively', () => {
    expect(matchesParamQuery(DEP_SPECS.turbScale, 'turbScale', 'turb')).toBe(true);
    expect(matchesParamQuery(DEP_SPECS.turbScale, 'turbScale', 'SCALE')).toBe(true);
    expect(matchesParamQuery(DEP_SPECS.turbScale, 'turbScale', 'palette')).toBe(false);
  });

  it('also matches the key, for anyone who knows the saved JSON', () => {
    expect(matchesParamQuery(DEP_SPECS.emitRadius, 'emitRadius', 'emitradius')).toBe(true);
  });

  it('an empty or whitespace query matches everything', () => {
    expect(matchesParamQuery(DEP_SPECS.size, 'size', '')).toBe(true);
    expect(matchesParamQuery(DEP_SPECS.size, 'size', '   ')).toBe(true);
  });
});

describe('visibleParamKeys', () => {
  it('essentials-only shows just the flagged params, in declaration order', () => {
    expect(visibleParamKeys(DEP_SPECS, { essentialsOnly: true })).toEqual(['spin', 'size']);
  });

  it('all shows every param, in declaration order', () => {
    expect(visibleParamKeys(DEP_SPECS, { essentialsOnly: false })).toEqual(Object.keys(DEP_SPECS));
  });

  it('a search reaches PAST the essentials tier — typing "turb" finds the turbulence knobs', () => {
    expect(visibleParamKeys(DEP_SPECS, { essentialsOnly: true, query: 'turb' }))
      .toEqual(['turbulence', 'turbScale']);
  });

  it('returns nothing when a search matches nothing', () => {
    expect(visibleParamKeys(DEP_SPECS, { essentialsOnly: false, query: 'zzz' })).toEqual([]);
  });
});

describe('groupParamKeys', () => {
  it('buckets by group, keeping both group and key order as declared', () => {
    expect(groupParamKeys(DEP_SPECS, visibleParamKeys(DEP_SPECS, { essentialsOnly: false }))).toEqual([
      { group: 'Physics', keys: ['turbulence', 'turbScale', 'emitShape', 'emitRadius'] },
      { group: 'Motion', keys: ['orient', 'spin'] },
      { group: 'Shape', keys: ['size'] },
    ]);
  });

  it('files a param with no group under General', () => {
    const ungrouped = {
      a: { kind: 'slider' as const, label: 'A', min: 0, max: 1, step: 1, default: 0 },
    } satisfies FxParamSpecs;
    expect(groupParamKeys(ungrouped, ['a'])).toEqual([{ group: DEFAULT_PARAM_GROUP, keys: ['a'] }]);
  });
});

describe('defaultOpenGroups', () => {
  it('opens a group holding an essential and leaves the rest closed', () => {
    expect(defaultOpenGroups(DEP_SPECS)).toEqual({ Physics: false, Motion: true, Shape: true });
  });

  it('keeps the advanced material tiers closed even when they hold an essential', () => {
    const noisy = {
      erode: {
        kind: 'slider' as const, label: 'Erode', group: 'Noise', min: 0, max: 1, step: 0.01, default: 0.5,
        essential: true,
      },
    } satisfies FxParamSpecs;
    expect(defaultOpenGroups(noisy)).toEqual({ Noise: false });
  });
});

describe('mergeOpenGroups', () => {
  const defaults = { Emit: true, Texture: false };

  it('lets a persisted value win over the default, in both directions', () => {
    expect(mergeOpenGroups(defaults, { Emit: false, Texture: true })).toEqual({ Emit: false, Texture: true });
  });

  it('ignores junk from storage rather than throwing (null, arrays, wrong types, unknown groups)', () => {
    expect(mergeOpenGroups(defaults, null)).toEqual(defaults);
    expect(mergeOpenGroups(defaults, [1, 2])).toEqual(defaults);
    expect(mergeOpenGroups(defaults, 'nope')).toEqual(defaults);
    expect(mergeOpenGroups(defaults, { Emit: 'yes', Ghost: true })).toEqual(defaults);
  });

  it('never mutates the defaults it was handed', () => {
    const d = { ...defaults };
    mergeOpenGroups(d, { Emit: false });
    expect(d).toEqual(defaults);
  });
});

describe('the shipped primitives', () => {
  const PRIMITIVES = [burstPrimitive, emitterPrimitive, ribbonPrimitive, shockwavePrimitive, smokePrimitive];
  const cases = PRIMITIVES.map((p) => [p.id, p.params as FxParamSpecs] as const);

  it.each(cases)('%s declares at least 4 essential params, all present in its own spec', (_id, specs) => {
    const essentials = Object.keys(specs).filter((k) => specs[k].essential === true);
    expect(essentials.length).toBeGreaterThanOrEqual(4);
    for (const key of essentials) expect(specs[key]).toBeDefined();
  });

  it.each(cases)('%s has no enabledWhen naming a param it does not have', (_id, specs) => {
    expect(validateSpecs(specs)).toEqual([]);
  });

  it.each(cases)(
    '%s never gates a param on another gated param — a mutually-dead pair could never be re-enabled',
    (_id, specs) => {
      for (const key of Object.keys(specs)) {
        const dep = specs[key].enabledWhen;
        if (dep === undefined) continue;
        // The gateway (the knob you move to bring this control back) must itself always be reachable.
        expect(specs[dep.param].enabledWhen).toBeUndefined();
      }
    },
  );

  it('burst: the turbulence + emit-shape knobs are inert at their own defaults, and say so', () => {
    const specs = burstPrimitive.params as FxParamSpecs;
    const values = defaultsOf(specs) as Record<string, unknown>;
    expect(isParamEnabled(specs.turbScale, values)).toBe(false);
    expect(paramDisabledReason(specs, 'turbScale', values)).toBe('Needs Turbulence above 0');
    expect(isParamEnabled(specs.emitRadius, values)).toBe(false);
    expect(paramDisabledReason(specs, 'emitRadius', values)).toBe('Needs Emit shape ≠ point');
    // Emit shape stays live: one half of a mutually-dead pair has to be the way back in.
    expect(isParamEnabled(specs.emitShape, values)).toBe(true);
  });

  it('burst: the whole noise/texture group dies with Erode', () => {
    const specs = burstPrimitive.params as FxParamSpecs;
    const live = defaultsOf(specs) as Record<string, unknown>;
    const dead = { ...live, erode: 0 };
    for (const key of ['noiseScale', 'warp', 'scroll', 'gain']) {
      expect(isParamEnabled(specs[key], live)).toBe(true);
      expect(isParamEnabled(specs[key], dead)).toBe(false);
      expect(paramDisabledReason(specs, key, dead)).toBe('Needs Erode above 0');
    }
  });

  it('ribbon: the wave shaping knobs are inert while Wave amp is 0 (their own default)', () => {
    const specs = ribbonPrimitive.params as FxParamSpecs;
    const values = defaultsOf(specs) as Record<string, unknown>;
    for (const key of ['waveFreq', 'waveSpeed']) {
      expect(isParamEnabled(specs[key], values)).toBe(false);
      expect(paramDisabledReason(specs, key, values)).toBe('Needs Wave amp above 0');
      expect(isParamEnabled(specs[key], { ...values, waveAmp: 12 })).toBe(true);
    }
  });

  it('smoke: Orient to velocity takes the whole Spin pair with it', () => {
    const specs = smokePrimitive.params as FxParamSpecs;
    const values = defaultsOf(specs) as Record<string, unknown>;
    for (const key of ['spin', 'spinVar']) {
      expect(isParamEnabled(specs[key], values)).toBe(true);
      expect(isParamEnabled(specs[key], { ...values, orientToVelocity: true })).toBe(false);
      expect(paramDisabledReason(specs, key, { ...values, orientToVelocity: true }))
        .toBe('Needs Orient to velocity off');
    }
  });

  it('shockwave: Ring delay is a no-op with a single ring', () => {
    const specs = shockwavePrimitive.params as FxParamSpecs;
    const values = defaultsOf(specs) as Record<string, unknown>;
    expect(isParamEnabled(specs.ringDelay, values)).toBe(true); // ships with 2 rings
    expect(isParamEnabled(specs.ringDelay, { ...values, rings: 1 })).toBe(false);
    expect(paramDisabledReason(specs, 'ringDelay', { ...values, rings: 1 })).toBe('Needs Rings above 1');
  });

  it('emitter: Speed var has nothing to vary at Speed 0', () => {
    const specs = emitterPrimitive.params as FxParamSpecs;
    const values = defaultsOf(specs) as Record<string, unknown>;
    expect(isParamEnabled(specs.speedVar, values)).toBe(true);
    expect(isParamEnabled(specs.speedVar, { ...values, speed: 0 })).toBe(false);
    expect(paramDisabledReason(specs, 'speedVar', { ...values, speed: 0 })).toBe('Needs Speed above 0');
  });
});
