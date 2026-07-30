import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CUSTOM_SHAPE_PREFIX,
  FALLBACK_SHAPE,
  MAX_ART_ALIASES,
  MAX_IMPORTED_SHAPES,
  OPAQUE_TRACE_THRESHOLD,
  customShapeId,
  fitRect,
  isBuiltinShapeId,
  labelFromFilename,
  listCommittedArt,
  listImportedShapes,
  listShapeOptions,
  luminanceAlpha,
  opaqueRatio,
  parseStoredArtAliases,
  parseStoredShapes,
  pruneArtAliases,
  registerSavedArt,
  removeImportedShape,
  resetShapeLibrary,
  resolveShapeSource,
  shouldTraceLuminance,
  slugifyShapeName,
  type ImportedShape,
} from './shapeLibrary';
import { SHAPE_NAMES } from './shapeTextures';

/**
 * The DOM half of the shape library (canvas rasterization, `img.decode()`, `Texture.from`) can't run in the
 * headless node test environment, and mocking WebGL to reach it would only test the mock. So everything that
 * MATTERS is factored into exported pure helpers — the alpha-trace decision, the luminance bake, the
 * fitting maths, the id namespacing, the render-path fallback rule, the storage parse — and those are what
 * this file covers. The remaining glue (draw → getImageData → toDataURL) is verified by eye in the workbench.
 */

/** Minimal in-memory Storage stub — Node has no `localStorage`. Returns null if it can't be installed, so
 *  the persistence tests skip gracefully rather than failing on an environment detail. */
function installStorageStub(): Storage | null {
  const map = new Map<string, string>();
  const stub: Storage = {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, String(v)); },
  };
  try {
    Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true });
    return typeof localStorage === 'undefined' ? null : stub;
  } catch {
    return null;
  }
}

function uninstallStorageStub(): void {
  try {
    Reflect.deleteProperty(globalThis, 'localStorage');
  } catch {
    /* ignore */
  }
}

const STORAGE_KEY = 'ascent.fx.shapes.v1';
/** The overlay's own key — asserted here rather than exported, so a rename has to be a deliberate key bump
 *  (which is the documented migration story) and can't slip through as "the tests still pass". */
const ART_ALIAS_KEY = 'ascent.fx.art.v1';
const shape = (id: string, label = id): ImportedShape => ({ id, label, dataUrl: 'data:image/png;base64,AAAA' });

describe('listShapeOptions', () => {
  beforeEach(() => resetShapeLibrary());

  it('includes every built-in shape, flagged builtin', () => {
    const options = listShapeOptions();
    for (const name of SHAPE_NAMES) {
      const row = options.find((o) => o.id === name);
      expect(row, `missing built-in '${name}'`).toBeDefined();
      expect(row?.builtin).toBe(true);
      expect(row?.label).toBe(name);
    }
  });

  it('lists exactly the built-ins when nothing has been imported', () => {
    // Committed art (`fx/defs/art/*.png`, ids prefixed `art:`) is a THIRD category this assertion isn't
    // about: it comes from the repo, not from an import, so committing a PNG must not fail this test.
    const local = listShapeOptions().filter((o) => !o.id.startsWith('art:'));
    expect(local.map((o) => o.id)).toEqual([...SHAPE_NAMES]);
  });
});

describe('id namespacing', () => {
  it('prefixes every custom id so it can never collide with a built-in', () => {
    for (const name of SHAPE_NAMES) {
      expect(customShapeId(name)).toBe(`${CUSTOM_SHAPE_PREFIX}${name}`);
      expect(isBuiltinShapeId(customShapeId(name))).toBe(false);
    }
  });

  it('recognises the built-ins (and nothing else)', () => {
    expect(isBuiltinShapeId('circle')).toBe(true);
    expect(isBuiltinShapeId('shard')).toBe(true);
    expect(isBuiltinShapeId('custom:shard')).toBe(false);
    expect(isBuiltinShapeId('nope')).toBe(false);
  });

  describe('slugifyShapeName', () => {
    it('drops the extension and lowercases', () => {
      expect(slugifyShapeName('Ember.PNG')).toBe('ember');
      expect(slugifyShapeName('Star.svg')).toBe('star');
    });

    it('collapses runs of non-alphanumerics into single dashes and trims them', () => {
      expect(slugifyShapeName('My Cool  Spark!!.png')).toBe('my-cool-spark');
      expect(slugifyShapeName('__leading and trailing__.png')).toBe('leading-and-trailing');
    });

    it('keeps digits', () => {
      expect(slugifyShapeName('flare_02.png')).toBe('flare-02');
    });

    it('falls back to a usable slug when nothing survives', () => {
      expect(slugifyShapeName('!!!.png')).toBe('shape');
      expect(slugifyShapeName('.png')).toBe('shape');
    });
  });

  describe('labelFromFilename', () => {
    it('uses the filename stem as the display name', () => {
      expect(labelFromFilename('Ember Wisp.png')).toBe('Ember Wisp');
    });

    it('falls back when the stem is empty', () => {
      expect(labelFromFilename('.svg')).toBe('Imported shape');
    });
  });
});

describe('luminanceAlpha', () => {
  it('maps black to 0 and white to 255', () => {
    expect(luminanceAlpha(0, 0, 0)).toBe(0);
    expect(luminanceAlpha(255, 255, 255)).toBe(255);
  });

  it('maps mid grey to mid alpha', () => {
    expect(luminanceAlpha(128, 128, 128)).toBe(128);
  });

  it('weights the channels per Rec. 709 (green dominates)', () => {
    expect(luminanceAlpha(255, 0, 0)).toBe(Math.round(0.2126 * 255));
    expect(luminanceAlpha(0, 255, 0)).toBe(Math.round(0.7152 * 255));
    expect(luminanceAlpha(0, 0, 255)).toBe(Math.round(0.0722 * 255));
    expect(luminanceAlpha(0, 255, 0)).toBeGreaterThan(luminanceAlpha(255, 0, 0));
  });

  it('clamps out-of-range input', () => {
    expect(luminanceAlpha(-50, -50, -50)).toBe(0);
    expect(luminanceAlpha(400, 400, 400)).toBe(255);
  });
});

describe('shouldTraceLuminance', () => {
  it('traces fully-opaque art (the solid-rectangle failure mode)', () => {
    expect(shouldTraceLuminance(1)).toBe(true);
  });

  it('does not trace art with a real alpha channel', () => {
    expect(shouldTraceLuminance(0)).toBe(false);
    expect(shouldTraceLuminance(0.5)).toBe(false);
  });

  it('brackets the threshold on both sides', () => {
    expect(shouldTraceLuminance(OPAQUE_TRACE_THRESHOLD + 0.001)).toBe(true);
    expect(shouldTraceLuminance(OPAQUE_TRACE_THRESHOLD - 0.001)).toBe(false);
    // Exactly at the threshold is NOT traced — the predicate is strictly greater-than.
    expect(shouldTraceLuminance(OPAQUE_TRACE_THRESHOLD)).toBe(false);
  });
});

describe('opaqueRatio', () => {
  it('is 1 for a fully opaque buffer', () => {
    expect(opaqueRatio([0, 0, 0, 255, 10, 20, 30, 255])).toBe(1);
  });

  it('is 0 for a fully transparent buffer', () => {
    expect(opaqueRatio([0, 0, 0, 0, 10, 20, 30, 0])).toBe(0);
  });

  it('counts only alpha === 255 as opaque', () => {
    expect(opaqueRatio([0, 0, 0, 255, 0, 0, 0, 254, 0, 0, 0, 0, 0, 0, 0, 255])).toBe(0.5);
  });

  it('is 0 for an empty buffer rather than NaN', () => {
    expect(opaqueRatio([])).toBe(0);
  });

  it('feeds shouldTraceLuminance the right answer for shape-on-black art', () => {
    // 4 opaque pixels: a white blob on a black background — alpha says "solid rectangle", brightness says
    // "silhouette". This is exactly the case the auto-detection exists for.
    const onBlack = [255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255];
    expect(shouldTraceLuminance(opaqueRatio(onBlack))).toBe(true);
    // ...and the bake turns it into a real silhouette.
    expect(luminanceAlpha(onBlack[0], onBlack[1], onBlack[2])).toBe(255);
    expect(luminanceAlpha(onBlack[8], onBlack[9], onBlack[10])).toBe(0);
  });
});

describe('fitRect', () => {
  it('fills the square for a square image', () => {
    expect(fitRect(64, 64, 128)).toEqual({ x: 0, y: 0, w: 128, h: 128 });
  });

  it('letterboxes a wide image, centred, preserving aspect', () => {
    expect(fitRect(200, 100, 128)).toEqual({ x: 0, y: 32, w: 128, h: 64 });
  });

  it('pillarboxes a tall image, centred, preserving aspect', () => {
    expect(fitRect(100, 200, 128)).toEqual({ x: 32, y: 0, w: 64, h: 128 });
  });

  it('fills the square when the image has no intrinsic size (an SVG with no width/height)', () => {
    expect(fitRect(0, 0, 128)).toEqual({ x: 0, y: 0, w: 128, h: 128 });
    expect(fitRect(NaN, 40, 128)).toEqual({ x: 0, y: 0, w: 128, h: 128 });
  });
});

describe('resolveShapeSource (the sync-lookup fallback rule)', () => {
  it('resolves a built-in to itself', () => {
    expect(resolveShapeSource('shard', false)).toEqual({ kind: 'builtin', name: 'shard' });
  });

  it('resolves an unknown id to the built-in fallback, with no renderer work implied', () => {
    expect(resolveShapeSource('custom:never-imported', false)).toEqual({ kind: 'builtin', name: FALLBACK_SHAPE });
    expect(resolveShapeSource('', false)).toEqual({ kind: 'builtin', name: FALLBACK_SHAPE });
  });

  it('falls back while an import is still decoding, then switches once it is ready', () => {
    expect(resolveShapeSource('custom:ember', false)).toEqual({ kind: 'builtin', name: FALLBACK_SHAPE });
    expect(resolveShapeSource('custom:ember', true)).toEqual({ kind: 'imported' });
  });

  it('never lets a ready import shadow a built-in id', () => {
    expect(resolveShapeSource('circle', true)).toEqual({ kind: 'builtin', name: 'circle' });
  });
});

describe('parseStoredShapes', () => {
  it('round-trips a well-formed payload', () => {
    const stored = [shape('custom:ember', 'Ember'), shape('custom:rune', 'Rune')];
    expect(parseStoredShapes(JSON.stringify(stored))).toEqual(stored);
  });

  it('returns [] for an empty / missing payload', () => {
    expect(parseStoredShapes(null)).toEqual([]);
    expect(parseStoredShapes('')).toEqual([]);
  });

  it('ignores malformed JSON rather than throwing', () => {
    expect(() => parseStoredShapes('{not json')).not.toThrow();
    expect(parseStoredShapes('{not json')).toEqual([]);
  });

  it('ignores a payload that is not an array', () => {
    expect(parseStoredShapes('{"id":"custom:x"}')).toEqual([]);
    expect(parseStoredShapes('42')).toEqual([]);
  });

  it('drops malformed entries instead of failing the whole load', () => {
    const raw = JSON.stringify([
      shape('custom:ok', 'Ok'),
      null,
      { id: 'circle', label: 'Not namespaced', dataUrl: 'data:...' }, // missing the custom: prefix
      { id: 'custom:nodata', label: 'No data' }, // no dataUrl
      { id: 'custom:blank', label: 'Blank', dataUrl: '' }, // empty dataUrl
      'nonsense',
    ]);
    expect(parseStoredShapes(raw).map((s) => s.id)).toEqual(['custom:ok']);
  });

  it('caps a stored payload that somehow exceeds the import limit', () => {
    const many = Array.from({ length: MAX_IMPORTED_SHAPES + 10 }, (_, i) => shape(`custom:s${i}`));
    expect(parseStoredShapes(JSON.stringify(many))).toHaveLength(MAX_IMPORTED_SHAPES);
  });
});

describe('persistence', () => {
  let stub: Storage | null = null;

  beforeEach(() => {
    stub = installStorageStub();
    resetShapeLibrary();
  });

  afterEach(() => {
    resetShapeLibrary();
    uninstallStorageStub();
    stub = null;
  });

  it('rehydrates persisted imports into the option list', () => {
    if (!stub) return; // environment can't host a storage stub — nothing to assert
    // Seeded AFTER the beforeEach reset (which clears storage as well as memory); the first read below
    // hydrates from it.
    stub.setItem(STORAGE_KEY, JSON.stringify([shape('custom:ember', 'Ember')]));
    // Committed art (`art:` ids) is appended after the imports and is not what this case is about.
    const options = listShapeOptions().filter((o) => !o.id.startsWith('art:'));
    expect(options.map((o) => o.id)).toEqual([...SHAPE_NAMES, 'custom:ember']);
    expect(options.at(-1)).toEqual({ id: 'custom:ember', label: 'Ember', builtin: false });
    expect(listImportedShapes()).toEqual([shape('custom:ember', 'Ember')]);
  });

  it('ignores a corrupted store rather than throwing', () => {
    if (!stub) return;
    stub.setItem(STORAGE_KEY, '{not json');
    expect(() => listShapeOptions()).not.toThrow();
    expect(listShapeOptions().map((o) => o.id)).toEqual([...SHAPE_NAMES]);
  });

  it('removes an import and persists the removal', () => {
    if (!stub) return;
    stub.setItem(STORAGE_KEY, JSON.stringify([shape('custom:a', 'A'), shape('custom:b', 'B')]));
    expect(listImportedShapes()).toHaveLength(2);
    removeImportedShape('custom:a');
    expect(listImportedShapes().map((s) => s.id)).toEqual(['custom:b']);
    expect(parseStoredShapes(stub.getItem(STORAGE_KEY)).map((s) => s.id)).toEqual(['custom:b']);
  });

  it('ignores removing a built-in or an unknown id', () => {
    if (!stub) return;
    stub.setItem(STORAGE_KEY, JSON.stringify([shape('custom:a', 'A')]));
    removeImportedShape('circle');
    removeImportedShape('custom:nope');
    expect(listImportedShapes().map((s) => s.id)).toEqual(['custom:a']);
  });

  it('resetShapeLibrary wipes memory and storage', () => {
    if (!stub) return;
    stub.setItem(STORAGE_KEY, JSON.stringify([shape('custom:a', 'A')]));
    expect(listImportedShapes()).toHaveLength(1);
    resetShapeLibrary();
    expect(stub.getItem(STORAGE_KEY)).toBeNull();
    expect(listImportedShapes()).toEqual([]);
  });
});

/**
 * The committed-art OVERLAY — the fix for "imported a PNG, saved, reloaded, the effect vanished".
 *
 * The decode half needs a DOM and a WebGL context, so what is covered here is what actually decides whether
 * the id resolves after a reload: the pointer survives storage, the picker offers it, and the list cannot
 * grow without bound. `pruneArtAliases` is pure, so the two ways an alias dies are checked directly.
 */
describe('committed-art overlay', () => {
  let stub: Storage | null = null;

  beforeEach(() => {
    stub = installStorageStub();
    resetShapeLibrary();
  });

  afterEach(() => {
    resetShapeLibrary();
    uninstallStorageStub();
    stub = null;
  });

  describe('parseStoredArtAliases', () => {
    it('reads a well-formed overlay', () => {
      expect(parseStoredArtAliases('[{"slug":"coin","sourceId":"custom:coin"}]')).toEqual([
        { slug: 'coin', sourceId: 'custom:coin' },
      ]);
    });

    it('returns [] for junk rather than throwing (a corrupted overlay costs the overlay, not the workbench)', () => {
      expect(parseStoredArtAliases(null)).toEqual([]);
      expect(parseStoredArtAliases('')).toEqual([]);
      expect(parseStoredArtAliases('{not json')).toEqual([]);
      expect(parseStoredArtAliases('{"slug":"coin"}')).toEqual([]); // not an array
    });

    it('drops entries that are not aliases, keeping the rest', () => {
      const raw = JSON.stringify([
        { slug: 'coin', sourceId: 'custom:coin' },
        { slug: '', sourceId: 'custom:x' }, // no slug
        { slug: 'y', sourceId: 'art:y' }, // a source must be a LOCAL import, never another committed id
        { slug: 'z' }, // no source at all
      ]);
      expect(parseStoredArtAliases(raw).map((a) => a.slug)).toEqual(['coin']);
    });

    it('caps a hostile store at MAX_ART_ALIASES', () => {
      const raw = JSON.stringify(
        Array.from({ length: MAX_ART_ALIASES + 30 }, (_, i) => ({ slug: `s${i}`, sourceId: `custom:s${i}` })),
      );
      expect(parseStoredArtAliases(raw)).toHaveLength(MAX_ART_ALIASES);
    });
  });

  describe('pruneArtAliases', () => {
    const alias = { slug: 'coin', sourceId: 'custom:coin' };

    it('keeps an alias whose art the glob still cannot see and whose import is still here', () => {
      expect(pruneArtAliases([alias], new Set(), new Set(['custom:coin']))).toEqual([alias]);
    });

    it('drops it once the glob has caught up — the committed file is the authority', () => {
      expect(pruneArtAliases([alias], new Set(['coin']), new Set(['custom:coin']))).toEqual([]);
    });

    it('drops it when the import it points at is gone (nothing left to serve)', () => {
      expect(pruneArtAliases([alias], new Set(), new Set())).toEqual([]);
    });

    it('collapses a re-committed slug to the newest entry rather than accumulating', () => {
      const older = { slug: 'coin', sourceId: 'custom:coin' };
      const newer = { slug: 'coin', sourceId: 'custom:coin-2' };
      expect(pruneArtAliases([older, newer], new Set(), new Set(['custom:coin', 'custom:coin-2']))).toEqual([newer]);
    });

    it('never returns more than MAX_ART_ALIASES', () => {
      const many = Array.from({ length: MAX_ART_ALIASES + 10 }, (_, i) => ({ slug: `s${i}`, sourceId: `custom:s${i}` }));
      const ids = new Set(many.map((a) => a.sourceId));
      expect(pruneArtAliases(many, new Set(), ids)).toHaveLength(MAX_ART_ALIASES);
    });
  });

  it('registerSavedArt persists a POINTER, not a second copy of the PNG', () => {
    if (!stub) return;
    stub.setItem(STORAGE_KEY, JSON.stringify([shape('custom:coin', 'coin')]));
    registerSavedArt('coin', 'custom:coin');
    const stored = stub.getItem(ART_ALIAS_KEY);
    expect(parseStoredArtAliases(stored)).toEqual([{ slug: 'coin', sourceId: 'custom:coin' }]);
    expect(stored).not.toContain('data:image'); // the bytes stay in ONE place
  });

  it('offers the committed slug in the picker straight away — the in-session half of the bug', () => {
    if (!stub) return;
    stub.setItem(STORAGE_KEY, JSON.stringify([shape('custom:coin', 'coin')]));
    expect(listCommittedArt()).not.toContain('coin');
    registerSavedArt('coin', 'custom:coin');
    expect(listCommittedArt()).toContain('coin');
    expect(listShapeOptions().map((o) => o.id)).toContain('art:coin');
  });

  // THE case: a fresh module (a reload) hydrates from storage alone, with a glob that still cannot see the
  // PNG, and `art:coin` is still a slug the library knows about.
  it('survives a reload — the overlay rehydrates without the dev server restarting', () => {
    if (!stub) return;
    stub.setItem(STORAGE_KEY, JSON.stringify([shape('custom:coin', 'coin')]));
    stub.setItem(ART_ALIAS_KEY, JSON.stringify([{ slug: 'coin', sourceId: 'custom:coin' }]));
    expect(listCommittedArt()).toContain('coin');
  });

  it('sweeps a dangling alias at hydration, and writes the sweep back', () => {
    if (!stub) return;
    // No import behind it — the source aged out of the 24-import cap, or was removed in a past session.
    stub.setItem(ART_ALIAS_KEY, JSON.stringify([{ slug: 'coin', sourceId: 'custom:coin' }]));
    expect(listCommittedArt()).not.toContain('coin');
    expect(parseStoredArtAliases(stub.getItem(ART_ALIAS_KEY))).toEqual([]);
  });

  it('drops the alias when its import is removed', () => {
    if (!stub) return;
    stub.setItem(STORAGE_KEY, JSON.stringify([shape('custom:coin', 'coin')]));
    registerSavedArt('coin', 'custom:coin');
    removeImportedShape('custom:coin');
    expect(parseStoredArtAliases(stub.getItem(ART_ALIAS_KEY))).toEqual([]);
    expect(listCommittedArt()).not.toContain('coin');
  });

  it('ignores a registration it cannot honour rather than storing a dead pointer', () => {
    if (!stub) return;
    registerSavedArt('coin', 'custom:never-imported'); // no such import
    registerSavedArt('', 'custom:coin'); // no slug
    registerSavedArt('coin', 'art:coin'); // a source must be a local import
    expect(parseStoredArtAliases(stub.getItem(ART_ALIAS_KEY))).toEqual([]);
  });

  it('resetShapeLibrary wipes the overlay too', () => {
    if (!stub) return;
    stub.setItem(STORAGE_KEY, JSON.stringify([shape('custom:coin', 'coin')]));
    registerSavedArt('coin', 'custom:coin');
    resetShapeLibrary();
    expect(stub.getItem(ART_ALIAS_KEY)).toBeNull();
  });
});

describe('no storage available', () => {
  beforeEach(() => {
    uninstallStorageStub();
    resetShapeLibrary();
  });

  it('degrades to the built-ins instead of throwing when localStorage is absent', () => {
    if (typeof localStorage !== 'undefined') return; // a runtime with real web storage — nothing to prove
    expect(() => listShapeOptions()).not.toThrow();
    expect(listShapeOptions().map((o) => o.id)).toEqual([...SHAPE_NAMES]);
    expect(() => removeImportedShape('custom:x')).not.toThrow();
    expect(() => resetShapeLibrary()).not.toThrow();
  });
});
