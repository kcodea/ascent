import { describe, expect, it } from 'vitest';
import { coerceParams, defaultsOf, type FxParamSpecs } from './params';

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
});
