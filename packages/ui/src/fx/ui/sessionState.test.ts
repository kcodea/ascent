import { describe, expect, it } from 'vitest';
import {
  artSlugOf,
  clampDuration,
  collectCustomShapeRefs,
  editorLayersFromDef,
  normalizeSession,
  pruneUnknownPrimitives,
  toEditorLayer,
  toStoredLayers,
  type DurationBounds,
} from './sessionState';
import type { EditorLayer } from './layerModel';

const BOUNDS: DurationBounds = { min: 200, max: 4000, fallback: 1000 };

const layer = (primitive: string, over: Partial<EditorLayer> = {}): EditorLayer => ({
  primitive,
  anchor: 'travel',
  at: 0,
  life: null,
  params: {},
  ...over,
});

describe('toEditorLayer', () => {
  it('coerces a well-formed layer through unchanged', () => {
    expect(toEditorLayer({ primitive: 'burst', anchor: 'target', at: 120, life: 400, params: { a: 1 } })).toEqual({
      primitive: 'burst',
      anchor: 'target',
      at: 120,
      life: 400,
      params: { a: 1 },
    });
  });

  it('rejects anything without a usable primitive id', () => {
    expect(toEditorLayer(null)).toBeNull();
    expect(toEditorLayer('ribbon')).toBeNull();
    expect(toEditorLayer({ anchor: 'target' })).toBeNull();
    expect(toEditorLayer({ primitive: '' })).toBeNull();
    expect(toEditorLayer({ primitive: 7 })).toBeNull();
  });

  it('falls back field-by-field instead of rejecting the layer', () => {
    expect(toEditorLayer({ primitive: 'ribbon', anchor: 'nowhere', at: -5, life: 0, params: [1, 2] })).toEqual({
      primitive: 'ribbon',
      anchor: 'travel',
      at: 0,
      life: null,
      params: {},
    });
    expect(toEditorLayer({ primitive: 'ribbon', at: Number.NaN, life: 'long' })).toEqual({
      primitive: 'ribbon',
      anchor: 'travel',
      at: 0,
      life: null,
      params: {},
    });
  });

  it('keeps `muted` only when it is literally true', () => {
    expect(toEditorLayer({ primitive: 'ribbon', muted: true })?.muted).toBe(true);
    for (const muted of [false, 'yes', 1, null, undefined]) {
      const out = toEditorLayer({ primitive: 'ribbon', muted });
      expect('muted' in out!, `muted: ${String(muted)}`).toBe(false);
    }
  });

  it('copies params rather than aliasing them', () => {
    const params = { a: 1 };
    const out = toEditorLayer({ primitive: 'ribbon', params });
    out!.params.a = 99;
    expect(params.a).toBe(1);
  });
});

describe('editorLayersFromDef', () => {
  it('maps omitted life to null and keeps anchor/at/params', () => {
    expect(
      editorLayersFromDef([
        { primitive: 'ribbon', anchor: 'travel', at: 0, params: { w: 3 } },
        { primitive: 'burst', anchor: 'target', at: 200, life: 350, params: {} },
      ]),
    ).toEqual([
      { primitive: 'ribbon', anchor: 'travel', at: 0, life: null, params: { w: 3 } },
      { primitive: 'burst', anchor: 'target', at: 200, life: 350, params: {} },
    ]);
  });
});

describe('clampDuration', () => {
  it('clamps into the slider band and falls back for a non-number', () => {
    expect(clampDuration(800, BOUNDS)).toBe(800);
    expect(clampDuration(10, BOUNDS)).toBe(200);
    expect(clampDuration(99999, BOUNDS)).toBe(4000);
    expect(clampDuration('900', BOUNDS)).toBe(1000);
    expect(clampDuration(Number.NaN, BOUNDS)).toBe(1000);
  });
});

describe('normalizeSession', () => {
  it('round-trips a saved composition', () => {
    const saved = {
      layers: [layer('ribbon'), layer('burst', { at: 100, life: 200 })],
      selected: 1,
      durationMs: 1500,
      seed: 4242,
      seedLocked: true,
    };
    expect(normalizeSession(JSON.parse(JSON.stringify(saved)), BOUNDS)).toEqual(saved);
  });

  // The seed + lock must survive a reload for the same reason the layers do: reopening the workbench on a
  // frozen look that silently re-rolled itself is exactly the authoring failure the seed control exists to
  // stop. A muted layer likewise comes back muted — the author's working state, not a rendering bug.
  it('round-trips the seed, its lock, and a muted layer', () => {
    const saved = {
      layers: [layer('ribbon', { muted: true }), layer('burst')],
      selected: 0,
      durationMs: 900,
      seed: 7,
      seedLocked: true,
    };
    const out = normalizeSession(JSON.parse(JSON.stringify(saved)), BOUNDS);
    expect(out?.seed).toBe(7);
    expect(out?.seedLocked).toBe(true);
    expect(out?.layers[0].muted).toBe(true);
    expect('muted' in out!.layers[1]).toBe(false); // the default stays an OMISSION
  });

  it('a snapshot with no seed restores UNLOCKED (today\'s fresh-roll behaviour), with no seed of its own', () => {
    const out = normalizeSession({ layers: [layer('ribbon')], selected: 0, durationMs: 900 }, BOUNDS);
    expect(out?.seed).toBeNull(); // the caller substitutes a fresh randomSeed()
    expect(out?.seedLocked).toBe(false);
  });

  it('drops an unusable seed / lock rather than restoring a broken one', () => {
    const bad = normalizeSession(
      { layers: [layer('ribbon')], seed: 'lots', seedLocked: 'yes' },
      BOUNDS,
    );
    expect(bad?.seed).toBeNull();
    expect(bad?.seedLocked).toBe(false);
    expect(normalizeSession({ layers: [layer('ribbon')], seed: Number.NaN }, BOUNDS)?.seed).toBeNull();
  });

  it('returns null when there is nothing usable to restore', () => {
    expect(normalizeSession(null, BOUNDS)).toBeNull();
    expect(normalizeSession({}, BOUNDS)).toBeNull();
    expect(normalizeSession({ layers: 'nope' }, BOUNDS)).toBeNull();
    expect(normalizeSession({ layers: [] }, BOUNDS)).toBeNull();
    expect(normalizeSession({ layers: [{ anchor: 'target' }] }, BOUNDS)).toBeNull();
  });

  it('drops unusable layers but keeps the rest', () => {
    const out = normalizeSession({ layers: [{ primitive: 'ribbon' }, null, { at: 5 }], selected: 2 }, BOUNDS);
    expect(out?.layers).toHaveLength(1);
    expect(out?.selected).toBe(0); // re-clamped against the surviving layers
    expect(out?.durationMs).toBe(1000);
  });

  it('clamps a selected index that points past the end', () => {
    expect(normalizeSession({ layers: [layer('a'), layer('b')], selected: 9 }, BOUNDS)?.selected).toBe(1);
    expect(normalizeSession({ layers: [layer('a')], selected: -3 }, BOUNDS)?.selected).toBe(0);
  });

  it('is registry-blind — an unknown primitive survives this pass', () => {
    // A cold boot restores BEFORE the primitives self-register; dropping them here would lose the session.
    expect(normalizeSession({ layers: [layer('not-a-real-primitive')] }, BOUNDS)?.layers).toHaveLength(1);
  });
});

describe('pruneUnknownPrimitives', () => {
  const isKnown = (id: string): boolean => id === 'ribbon' || id === 'burst';

  it('returns null when every primitive still exists (so the caller skips a rebuild)', () => {
    expect(pruneUnknownPrimitives([layer('ribbon'), layer('burst')], isKnown)).toBeNull();
  });

  it('drops a layer naming a primitive that no longer exists', () => {
    const out = pruneUnknownPrimitives([layer('ribbon'), layer('gone'), layer('burst')], isKnown);
    expect(out?.map((l) => l.primitive)).toEqual(['ribbon', 'burst']);
  });

  it('degrades to an empty list when NOTHING survives (caller substitutes a default layer)', () => {
    expect(pruneUnknownPrimitives([layer('gone'), layer('also-gone')], isKnown)).toEqual([]);
  });
});

describe('collectCustomShapeRefs', () => {
  it('finds every distinct custom: param value in first-seen order', () => {
    const layers = [
      layer('a', { params: { shape: 'custom:shard', tint: 0xff0000, mode: 'add' } }),
      layer('b', { params: { shape: 'custom:spark', other: 'custom:shard' } }),
      layer('c', { params: { shape: 'circle' } }),
    ];
    expect(collectCustomShapeRefs(layers)).toEqual(['custom:shard', 'custom:spark']);
  });

  it('is empty for a composition that only uses built-ins', () => {
    expect(collectCustomShapeRefs([layer('a', { params: { shape: 'circle', art: 'art:committed' } })])).toEqual([]);
  });
});

describe('artSlugOf', () => {
  it('strips the custom: namespace', () => {
    expect(artSlugOf('custom:my-shard')).toBe('my-shard');
  });
});

describe('toStoredLayers', () => {
  it('rewrites uploaded custom refs to art: refs and leaves the rest alone', () => {
    const layers = [layer('a', { params: { shape: 'custom:shard', miss: 'custom:nope', n: 4 } })];
    const out = toStoredLayers(layers, new Map([['custom:shard', 'art:shard']]));
    expect(out[0].params).toEqual({ shape: 'art:shard', miss: 'custom:nope', n: 4 });
  });

  it('NEVER mutates the live editor layers', () => {
    const params = { shape: 'custom:shard' };
    const layers = [layer('a', { params })];
    const out = toStoredLayers(layers, new Map([['custom:shard', 'art:shard']]));
    expect(params.shape).toBe('custom:shard');
    expect(layers[0].params).not.toBe(out[0].params);
    out[0].params.shape = 'mutated';
    expect(params.shape).toBe('custom:shard');
  });

  it('omits life entirely when the editor layer runs the full duration', () => {
    const out = toStoredLayers([layer('a'), layer('b', { life: 250 })], new Map());
    expect('life' in out[0]).toBe(false);
    expect(out[1].life).toBe(250);
  });

  it('PERSISTS a muted layer as muted (rather than dropping it or silently un-muting it)', () => {
    const out = toStoredLayers([layer('a', { muted: true }), layer('b')], new Map());
    expect(out).toHaveLength(2); // the layer is kept, tuning and all
    expect(out[0].muted).toBe(true);
    expect('muted' in out[1]).toBe(false); // and the default is still an omission
  });
});
