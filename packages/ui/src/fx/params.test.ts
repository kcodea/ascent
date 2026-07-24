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
});
