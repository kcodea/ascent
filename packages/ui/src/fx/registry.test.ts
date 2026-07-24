import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPrimitives, getPrimitive, listPrimitives, registerPrimitive } from './registry';
import type { FxPrimitive } from './primitive';

const stub = (id: string): FxPrimitive => ({
  id,
  params: { size: { kind: 'slider', label: 'Size', min: 0, max: 10, step: 1, default: 5 } },
  spawn: () => ({ update: () => {}, setParams: () => {}, destroy: () => {} }),
});

describe('primitive registry', () => {
  beforeEach(() => clearPrimitives());

  it('returns a registered primitive by id', () => {
    const p = stub('ribbon');
    registerPrimitive(p);
    expect(getPrimitive('ribbon')).toBe(p);
  });

  it('returns undefined for an unknown id rather than throwing', () => {
    expect(getPrimitive('nope')).toBeUndefined();
  });

  it('throws on a duplicate id so a copy-pasted primitive is caught at load', () => {
    registerPrimitive(stub('ribbon'));
    expect(() => registerPrimitive(stub('ribbon'))).toThrow(/already registered/i);
  });

  it('lists primitives sorted by id for a stable palette order', () => {
    registerPrimitive(stub('shockwave'));
    registerPrimitive(stub('burst'));
    expect(listPrimitives().map((p) => p.id)).toEqual(['burst', 'shockwave']);
  });

  it('warns on a primitive with invalid param specs but still registers it', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const badPrimitive: FxPrimitive = {
      id: 'badslider',
      params: { size: { kind: 'slider', label: 'Size', min: 0, max: 10, step: 1, default: 15 } },
      spawn: () => ({ update: () => {}, setParams: () => {}, destroy: () => {} }),
    };
    registerPrimitive(badPrimitive);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/invalid param specs/i));
    expect(getPrimitive('badslider')).toBe(badPrimitive);
    warnSpy.mockRestore();
  });
});
