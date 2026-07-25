import { describe, expect, it } from 'vitest';
import {
  addLayer,
  createEditorLayer,
  duplicateLayer,
  moveLayer,
  removeLayer,
  setLayerMuted,
  setLayerParam,
  setLayerPrimitive,
  setLayerTiming,
  structureKey,
  toDef,
  type EditorLayer,
} from './layerModel';

const layer = (primitive: string, over: Partial<EditorLayer> = {}): EditorLayer => ({
  primitive,
  anchor: 'travel',
  at: 0,
  life: null,
  params: {},
  ...over,
});

describe('createEditorLayer', () => {
  it('builds a layer with travel/at=0/life=null defaults and a copy of the params', () => {
    const defaults = { a: 1, b: 'x' };
    const l = createEditorLayer('ribbon', defaults);
    expect(l).toEqual({ primitive: 'ribbon', anchor: 'travel', at: 0, life: null, params: { a: 1, b: 'x' } });
    // params are copied, not aliased
    expect(l.params).not.toBe(defaults);
    l.params.a = 99;
    expect(defaults.a).toBe(1);
  });
});

describe('addLayer', () => {
  it('appends immutably', () => {
    const input = [layer('ribbon')];
    const out = addLayer(input, layer('burst'));
    expect(out).toHaveLength(2);
    expect(out[1].primitive).toBe('burst');
    expect(input).toHaveLength(1); // input unchanged
    expect(out).not.toBe(input);
  });
});

describe('duplicateLayer', () => {
  it('inserts the copy directly AFTER the source, immutably', () => {
    const input = [layer('ribbon'), layer('burst'), layer('smoke')];
    const out = duplicateLayer(input, 1);
    expect(out.map((l) => l.primitive)).toEqual(['ribbon', 'burst', 'burst', 'smoke']);
    expect(input).toHaveLength(3); // input untouched
    expect(out).not.toBe(input);
  });

  it('carries the whole layer over — primitive, anchor, timing, muted', () => {
    const input = [layer('burst', { anchor: 'source', at: 120, life: 300, muted: true, params: { n: 4 } })];
    const copy = duplicateLayer(input, 0)[1];
    expect(copy).toEqual({
      primitive: 'burst',
      anchor: 'source',
      at: 120,
      life: 300,
      muted: true,
      params: { n: 4 },
    });
    expect(copy).not.toBe(input[0]);
  });

  // THE load-bearing property. A shallow `{ ...layer }` (or `{ ...params }`) leaves the copy's palette /
  // curve arrays ALIASING the original's, so dragging one control point on the duplicate would silently
  // edit the layer it was duplicated from — the exact bug duplication exists to avoid.
  it('DEEP-copies params: mutating a nested palette / curve array on the copy cannot touch the original', () => {
    const palette = [0x112233, 0x445566, 0x778899, 0xaabbcc];
    const curve = [
      [0, 0],
      [0.5, 1],
      [1, 0],
    ];
    const input = [layer('ribbon', { params: { palette, curve, size: 4 } })];
    const out = duplicateLayer(input, 0);
    const copyParams = out[1].params as { palette: number[]; curve: number[][] };

    expect(copyParams.palette).toEqual(palette);
    expect(copyParams.palette).not.toBe(palette);
    expect(copyParams.curve).not.toBe(curve);
    expect(copyParams.curve[1]).not.toBe(curve[1]); // the NESTED row too, not just the outer array

    copyParams.palette[0] = 0xff0000;
    copyParams.curve[1][1] = 0.25;
    copyParams.curve.push([2, 2]);

    expect(palette[0]).toBe(0x112233);
    expect(curve[1][1]).toBe(1);
    expect(curve).toHaveLength(3);
    expect(input[0].params.palette).toBe(palette); // and the source layer still points at the original
  });

  it('is a no-op for an out-of-range index, but still returns a fresh array', () => {
    const input = [layer('ribbon')];
    expect(duplicateLayer(input, 5)).toHaveLength(1);
    expect(duplicateLayer(input, -1)).toHaveLength(1);
    expect(duplicateLayer(input, 5)).not.toBe(input);
  });
});

describe('setLayerMuted', () => {
  it('mutes one layer immutably and leaves the others alone', () => {
    const input = [layer('ribbon'), layer('burst')];
    const out = setLayerMuted(input, 1, true);
    expect(out[1].muted).toBe(true);
    expect(out[0].muted).toBeUndefined();
    expect(input[1].muted).toBeUndefined();
    expect(out).not.toBe(input);
  });

  it('unmuting OMITS the flag rather than storing `muted: false` (the default is an exact no-op)', () => {
    const muted = setLayerMuted([layer('ribbon')], 0, true);
    const out = setLayerMuted(muted, 0, false);
    expect('muted' in out[0]).toBe(false);
    expect(out[0]).toEqual(layer('ribbon'));
  });
});

describe('removeLayer', () => {
  it('removes the layer at index immutably', () => {
    const input = [layer('ribbon'), layer('burst'), layer('shockwave')];
    const out = removeLayer(input, 1);
    expect(out.map((l) => l.primitive)).toEqual(['ribbon', 'shockwave']);
    expect(input).toHaveLength(3);
    expect(out).not.toBe(input);
  });

  it('refuses to empty the list (min 1 layer) but still returns a new array', () => {
    const input = [layer('ribbon')];
    const out = removeLayer(input, 0);
    expect(out).toHaveLength(1);
    expect(out).not.toBe(input);
  });
});

describe('moveLayer', () => {
  it('moves down and up immutably', () => {
    const input = [layer('a'), layer('b'), layer('c')];
    expect(moveLayer(input, 0, 1).map((l) => l.primitive)).toEqual(['b', 'a', 'c']);
    expect(moveLayer(input, 2, -1).map((l) => l.primitive)).toEqual(['a', 'c', 'b']);
    expect(input.map((l) => l.primitive)).toEqual(['a', 'b', 'c']); // input unchanged
  });

  it('clamps at index 0 moving up and at the end moving down', () => {
    const input = [layer('a'), layer('b')];
    expect(moveLayer(input, 0, -1).map((l) => l.primitive)).toEqual(['a', 'b']);
    expect(moveLayer(input, 1, 1).map((l) => l.primitive)).toEqual(['a', 'b']);
    expect(moveLayer(input, 0, -1)).not.toBe(input); // still a fresh array
  });
});

describe('setLayerPrimitive', () => {
  it('replaces the primitive and resets its params to the injected defaults', () => {
    const input = [layer('ribbon', { params: { keep: 1 } })];
    const out = setLayerPrimitive(input, 0, 'burst', { fresh: 7 });
    expect(out[0].primitive).toBe('burst');
    expect(out[0].params).toEqual({ fresh: 7 });
    expect(input[0].params).toEqual({ keep: 1 }); // input unchanged
    expect(out).not.toBe(input);
  });

  it('preserves anchor and timing', () => {
    const input = [layer('ribbon', { anchor: 'target', at: 120, life: 300 })];
    const out = setLayerPrimitive(input, 0, 'burst', {});
    expect(out[0].anchor).toBe('target');
    expect(out[0].at).toBe(120);
    expect(out[0].life).toBe(300);
  });
});

describe('setLayerParam', () => {
  it('merges one key immutably, leaving the input untouched', () => {
    const input = [layer('ribbon', { params: { a: 1, b: 2 } })];
    const out = setLayerParam(input, 0, 'b', 9);
    expect(out[0].params).toEqual({ a: 1, b: 9 });
    expect(input[0].params).toEqual({ a: 1, b: 2 });
    expect(out).not.toBe(input);
    expect(out[0].params).not.toBe(input[0].params);
  });
});

describe('setLayerTiming', () => {
  it('sets at and life immutably', () => {
    const input = [layer('ribbon', { at: 0, life: null })];
    const out = setLayerTiming(input, 0, 200, 400);
    expect(out[0].at).toBe(200);
    expect(out[0].life).toBe(400);
    expect(input[0].at).toBe(0);
    expect(input[0].life).toBeNull();
  });
});

describe('structureKey', () => {
  it('is STABLE across a param-only change', () => {
    const a = [layer('ribbon', { params: { x: 1 } })];
    const b = setLayerParam(a, 0, 'x', 2);
    expect(structureKey(b)).toBe(structureKey(a));
  });

  it('CHANGES on a primitive swap', () => {
    const a = [layer('ribbon')];
    const b = setLayerPrimitive(a, 0, 'burst', {});
    expect(structureKey(b)).not.toBe(structureKey(a));
  });

  // REGRESSION (defect 2): `at`/`life` used to be part of this key, so every step of the workbench's At /
  // Life sliders rebuilt the player and re-fired -- the effect restarted mid-drag (impossible to judge the
  // change) and a ribbon re-rolled its noise seed on each respawn (the LOOK changed while tuning TIMING).
  // Timing is now pushed live via FxPlayer.setLayerTiming and must NOT move this key.
  it('regression: is STABLE across an `at` / `life` change', () => {
    const a = [layer('ribbon')];
    expect(structureKey(setLayerTiming(a, 0, 100, null))).toBe(structureKey(a));
    expect(structureKey(setLayerTiming(a, 0, 0, 500))).toBe(structureKey(a));
    expect(structureKey(setLayerTiming(a, 0, 250, 120))).toBe(structureKey(a));
  });

  // Mute takes the same live path timing does (`FxPlayer.setLayerMuted`), for the same reason: muting one
  // layer to isolate another must not rebuild — and therefore re-roll — every layer in the composition.
  it('is STABLE across a mute toggle', () => {
    const a = [layer('ribbon'), layer('burst')];
    expect(structureKey(setLayerMuted(a, 1, true))).toBe(structureKey(a));
    expect(structureKey(setLayerMuted(setLayerMuted(a, 1, true), 1, false))).toBe(structureKey(a));
  });

  it('CHANGES on a duplicate (a new layer IS structural)', () => {
    const a = [layer('ribbon')];
    expect(structureKey(duplicateLayer(a, 0))).not.toBe(structureKey(a));
  });

  it('CHANGES on an anchor swap', () => {
    const a = [layer('ribbon', { anchor: 'travel' })];
    const b = [layer('ribbon', { anchor: 'target' })];
    expect(structureKey(b)).not.toBe(structureKey(a));
  });

  it('CHANGES on a reorder', () => {
    const a = [layer('ribbon'), layer('burst')];
    expect(structureKey(moveLayer(a, 0, 1))).not.toBe(structureKey(a));
  });

  it('CHANGES on add/remove', () => {
    const a = [layer('ribbon'), layer('burst')];
    expect(structureKey(addLayer(a, layer('shockwave')))).not.toBe(structureKey(a));
    expect(structureKey(removeLayer(a, 1))).not.toBe(structureKey(a));
  });
});

describe('toDef', () => {
  it('maps life=null to undefined and passes params through', () => {
    const params = { x: 1 };
    const layers = [
      layer('ribbon', { anchor: 'travel', at: 0, life: null, params }),
      layer('burst', { anchor: 'target', at: 120, life: 300, params: { y: 2 } }),
    ];
    const def = toDef('workbench', 1000, layers);
    expect(def).toEqual({
      id: 'workbench',
      duration: 1000,
      layers: [
        { primitive: 'ribbon', anchor: 'travel', at: 0, life: undefined, params: { x: 1 } },
        { primitive: 'burst', anchor: 'target', at: 120, life: 300, params: { y: 2 } },
      ],
    });
    // params pass through by reference (player treats the def as read-only)
    expect(def.layers[0].params).toBe(params);
  });
});
