import { describe, expect, it } from 'vitest';
import {
  artSlugOf,
  canRedo,
  canUndo,
  clampDuration,
  coerceLayerName,
  collectCustomShapeRefs,
  editorLayersFromDef,
  initHistory,
  LAYER_NAME_MAX,
  normalizeSession,
  pruneUnknownPrimitives,
  pushHistory,
  redo,
  replaceHistoryPresent,
  shouldCoalesce,
  toEditorLayer,
  toStoredLayers,
  undo,
  type DurationBounds,
  type HistoryMark,
} from './sessionState';
import { setLayerParam, setLayerPrimitive, type EditorLayer } from './layerModel';
import type { FxParamSpec } from '../params';

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

  it('keeps `solo` on exactly the same terms as `muted`', () => {
    expect(toEditorLayer({ primitive: 'ribbon', solo: true })?.solo).toBe(true);
    for (const solo of [false, 'yes', 1, null, undefined]) {
      const out = toEditorLayer({ primitive: 'ribbon', solo });
      expect('solo' in out!, `solo: ${String(solo)}`).toBe(false);
    }
  });

  it('keeps a usable `name` and OMITS the field otherwise (absent stays absent)', () => {
    expect(toEditorLayer({ primitive: 'ribbon', name: '  impact flash  ' })?.name).toBe('impact flash');
    for (const name of ['', '   ', 7, null, undefined, ['x']]) {
      const out = toEditorLayer({ primitive: 'ribbon', name });
      expect('name' in out!, `name: ${JSON.stringify(name)}`).toBe(false);
    }
  });

  it('copies params rather than aliasing them', () => {
    const params = { a: 1 };
    const out = toEditorLayer({ primitive: 'ribbon', params });
    out!.params.a = 99;
    expect(params.a).toBe(1);
  });
});

describe('coerceLayerName', () => {
  it('trims, caps, and treats blank as absent', () => {
    expect(coerceLayerName('embers')).toBe('embers');
    expect(coerceLayerName('  embers \n')).toBe('embers');
    expect(coerceLayerName('')).toBeUndefined();
    expect(coerceLayerName('   ')).toBeUndefined();
    expect(coerceLayerName(42)).toBeUndefined();
    expect(coerceLayerName('x'.repeat(500))).toHaveLength(LAYER_NAME_MAX);
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
      // The canvas slot round-trips with everything else. Spelled out here rather than left to the default
      // so this stays an exact-equality round-trip.
      slot: 'over' as const,
    };
    expect(normalizeSession(JSON.parse(JSON.stringify(saved)), BOUNDS)).toEqual(saved);
  });

  // A snapshot from before the slot toggle existed must restore to the DEFAULT canvas, and only the literal
  // 'under' may select the other one — the same "explicit value or the historical behaviour" rule `seedLocked`
  // follows, and what keeps every composition already in storage playing exactly where it did.
  it('defaults the canvas slot, and takes only the literal "under"', () => {
    const base = { layers: [layer('ribbon')], selected: 0, durationMs: 1000 };
    expect(normalizeSession({ ...base }, BOUNDS)?.slot).toBe('over');
    expect(normalizeSession({ ...base, slot: 'over' }, BOUNDS)?.slot).toBe('over');
    expect(normalizeSession({ ...base, slot: 'under' }, BOUNDS)?.slot).toBe('under');
    expect(normalizeSession({ ...base, slot: 'UNDER' }, BOUNDS)?.slot).toBe('over');
    expect(normalizeSession({ ...base, slot: true }, BOUNDS)?.slot).toBe('over');
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

  // Naming and soloing are working state exactly like mute: a composition you left as "three named layers
  // with the middle one soloed" has to come back that way, or the labels you added are a per-session toy.
  it('round-trips a layer name and a solo, and leaves an untouched layer with NEITHER field', () => {
    const saved = {
      layers: [layer('burst', { name: 'impact flash', solo: true }), layer('ribbon')],
      selected: 0,
      durationMs: 900,
      seed: 7,
      seedLocked: false,
    };
    const out = normalizeSession(JSON.parse(JSON.stringify(saved)), BOUNDS);
    expect(out?.layers[0].name).toBe('impact flash');
    expect(out?.layers[0].solo).toBe(true);
    expect('name' in out!.layers[1]).toBe(false); // absent stays absent — the default is an exact no-op
    expect('solo' in out!.layers[1]).toBe(false);
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

  it('persists `name` and `solo`, and writes NEITHER key for a layer that has neither', () => {
    const out = toStoredLayers([layer('a', { name: 'impact flash', solo: true }), layer('b')], new Map());
    expect(out[0].name).toBe('impact flash');
    expect(out[0].solo).toBe(true);
    expect('name' in out[1]).toBe(false);
    expect('solo' in out[1]).toBe(false);
    // An untouched composition still serialises byte-for-byte as it did before any of this existed.
    expect(JSON.parse(JSON.stringify(out[1]))).toEqual({ primitive: 'b', anchor: 'travel', at: 0, params: {} });
  });

  it('survives a full stored round-trip: stored → JSON → editor layer', () => {
    const before = [layer('burst', { name: 'embers', muted: true, solo: true, at: 40, life: 200 }), layer('r')];
    const after = JSON.parse(JSON.stringify(toStoredLayers(before, new Map()))).map(toEditorLayer);
    expect(after).toEqual(before);
  });
});

// ─── undo / redo ──────────────────────────────────────────────────────────────────────────────────────

/** A stand-in for the workbench's `EditorSnapshot` — the stack is generic, so the tests only need something
 *  distinguishable. */
type Snap = { n: number };
const snap = (n: number): Snap => ({ n });
const mark = (kind: HistoryMark['kind'], key: string, atMs: number): HistoryMark => ({ kind, key, atMs });

describe('history stack', () => {
  it('push / undo / redo round-trips', () => {
    let h = initHistory(snap(0));
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);

    h = pushHistory(h, snap(1));
    h = pushHistory(h, snap(2));
    expect(h.present).toEqual(snap(2));
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);

    h = undo(h);
    expect(h.present).toEqual(snap(1));
    expect(canRedo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toEqual(snap(0));

    h = redo(h);
    expect(h.present).toEqual(snap(1));
    h = redo(h);
    expect(h.present).toEqual(snap(2));
    expect(canRedo(h)).toBe(false);
  });

  it('never mutates the stack it is handed', () => {
    const h = pushHistory(initHistory(snap(0)), snap(1));
    const before = JSON.parse(JSON.stringify(h));
    pushHistory(h, snap(2));
    undo(h);
    redo(undo(h));
    expect(h).toEqual(before);
  });

  it('a new push after an undo CLEARS the redo branch', () => {
    let h = pushHistory(pushHistory(initHistory(snap(0)), snap(1)), snap(2));
    h = undo(h); // present = 1, future = [2]
    expect(canRedo(h)).toBe(true);
    h = pushHistory(h, snap(9)); // fork
    expect(canRedo(h)).toBe(false);
    expect(h.future).toEqual([]);
    expect(undo(h).present).toEqual(snap(1)); // …and the branch we forked from is still behind us
  });

  it('caps the stack, dropping the OLDEST entry', () => {
    let h = initHistory(snap(0));
    for (let i = 1; i <= 6; i++) h = pushHistory(h, snap(i), 3);
    expect(h.past).toHaveLength(3);
    expect(h.past.map((s) => s.n)).toEqual([3, 4, 5]); // 0,1,2 fell off the bottom
    // …and undoing all the way lands on the oldest SURVIVING state rather than throwing.
    while (canUndo(h)) h = undo(h);
    expect(h.present).toEqual(snap(3));
  });

  it('undo at the bottom and redo at the top are no-ops (the same object back)', () => {
    const empty = initHistory(snap(0));
    expect(undo(empty)).toBe(empty);
    expect(redo(empty)).toBe(empty);
    const pushed = pushHistory(empty, snap(1));
    expect(redo(pushed)).toBe(pushed);
    const bottom = undo(pushed);
    expect(undo(bottom)).toBe(bottom); // already at the bottom — stepping back again changes nothing
  });

  it('replaceHistoryPresent swaps the present WITHOUT making the outgoing one undoable', () => {
    const h = pushHistory(initHistory(snap(0)), snap(1));
    const replaced = replaceHistoryPresent(h, snap(99));
    expect(replaced.present).toEqual(snap(99));
    expect(replaced.past).toBe(h.past); // the pre-gesture entry is untouched
    expect(undo(replaced).present).toEqual(snap(0));
  });
});

describe('shouldCoalesce', () => {
  it('collapses two rapid edits of the SAME control', () => {
    expect(shouldCoalesce(mark('param', '0:size', 1000), mark('param', '0:size', 1016))).toBe(true);
    expect(shouldCoalesce(mark('param', '0:size', 1000), mark('param', '0:size', 1400))).toBe(true);
  });

  it('does NOT collapse a different key, or the same key on a different layer', () => {
    expect(shouldCoalesce(mark('param', '0:size', 1000), mark('param', '0:angle', 1016))).toBe(false);
    expect(shouldCoalesce(mark('param', '0:size', 1000), mark('param', '1:size', 1016))).toBe(false);
  });

  it('does NOT collapse across kinds', () => {
    expect(shouldCoalesce(mark('param', '0:at', 1000), mark('timing', '0:at', 1016))).toBe(false);
    expect(shouldCoalesce(mark('duration', '', 1000), mark('seed', '', 1016))).toBe(false);
  });

  // The motivating rule: a structural action must never be swallowed by the drag it lands next to, in
  // EITHER direction — a primitive swap is exactly the thing you need one Ctrl+Z to reverse.
  it('NEVER collapses a structural action', () => {
    expect(shouldCoalesce(mark('structural', '', 1000), mark('structural', '', 1001))).toBe(false);
    expect(shouldCoalesce(mark('param', '0:size', 1000), mark('structural', '', 1001))).toBe(false);
    expect(shouldCoalesce(mark('structural', '', 1000), mark('param', '0:size', 1001))).toBe(false);
  });

  it('does NOT collapse across a pause longer than the window', () => {
    expect(shouldCoalesce(mark('param', '0:size', 1000), mark('param', '0:size', 1401))).toBe(false);
    expect(shouldCoalesce(mark('param', '0:size', 1000), mark('param', '0:size', 5000))).toBe(false);
    // The window is measured from the PREVIOUS edit, so a long continuous drag keeps extending it.
    expect(shouldCoalesce(mark('param', '0:size', 5000), mark('param', '0:size', 5300), 400)).toBe(true);
  });

  it('has nothing to coalesce with on the first edit', () => {
    expect(shouldCoalesce(null, mark('param', '0:size', 1000))).toBe(false);
  });
});

describe('history over real editor layers', () => {
  /** The workbench's recipe, condensed: record the state that is about to change, then change it. */
  const edit = (
    h: ReturnType<typeof initHistory<EditorLayer[]>>,
    last: HistoryMark | null,
    next: EditorLayer[],
    m: HistoryMark,
  ): [ReturnType<typeof initHistory<EditorLayer[]>>, HistoryMark] => {
    const refreshed = { ...h, present: h.present };
    const pushed = shouldCoalesce(last, m)
      ? replaceHistoryPresent(refreshed, next)
      : pushHistory(refreshed, next);
    return [pushed, m];
  };

  // THE motivating bug: swapping a layer's primitive loses every param the new primitive doesn't share, so a
  // mis-click can still throw away tuning (carrying over shared names softens this but can't undo it). One
  // Ctrl+Z has to bring the tuning back, intact.
  it('a primitive swap is undoable — the tuned params come BACK', () => {
    // A one-param spec for the primitive being swapped TO. None of the ribbon's tuned names appear in it, so
    // nothing carries over and the swap is the full wipe this test is about.
    const COUNT_SPEC = { kind: 'slider', label: 'count', min: 0, max: 20, step: 1, default: 8 } as FxParamSpec;
    const tuned = [layer('ribbon', { params: { width: 12, wobble: 0.4, palette: [1, 2, 3, 4] } })];
    let h = initHistory(tuned);
    let last: HistoryMark | null = null;

    // …tune a slider (two rapid steps of one drag)…
    [h, last] = edit(h, last, setLayerParam(h.present, 0, 'width', 13), mark('param', '0:width', 1000));
    [h, last] = edit(h, last, setLayerParam(h.present, 0, 'width', 14), mark('param', '0:width', 1020));
    expect(h.past).toHaveLength(1); // ONE entry for the whole drag

    // …then mis-click a different primitive, which wipes the params.
    [h, last] = edit(h, last, setLayerPrimitive(h.present, 0, 'burst', { count: COUNT_SPEC }), mark('structural', '', 1030));
    expect(h.present[0].primitive).toBe('burst');
    expect(h.present[0].params).toEqual({ count: 8 }); // the tuning is gone…

    h = undo(h);
    expect(h.present[0].primitive).toBe('ribbon');
    expect(h.present[0].params).toEqual({ width: 14, wobble: 0.4, palette: [1, 2, 3, 4] }); // …and back
    expect(h.present[0].params.palette).toBe(tuned[0].params.palette); // by reference: nothing was cloned

    // …and redo puts the swap back, so the undo itself is reversible.
    h = redo(h);
    expect(h.present[0].primitive).toBe('burst');
    expect(last).not.toBeNull();
  });

  it('a whole slider drag is ONE undo step, and a pause between drags is two', () => {
    let h = initHistory([layer('ribbon', { params: { size: 1 } })]);
    let last: HistoryMark | null = null;
    for (let i = 2; i <= 40; i++) {
      [h, last] = edit(h, last, setLayerParam(h.present, 0, 'size', i), mark('param', '0:size', 1000 + i * 8));
    }
    expect(h.past).toHaveLength(1);
    expect(h.present[0].params.size).toBe(40);

    // …a pause, then a second drag: a second entry, and the first drag's result is what undo lands on.
    [h, last] = edit(h, last, setLayerParam(h.present, 0, 'size', 41), mark('param', '0:size', 9000));
    expect(h.past).toHaveLength(2);
    expect(undo(h).present[0].params.size).toBe(40);
    expect(undo(undo(h)).present[0].params.size).toBe(1);
  });
});
