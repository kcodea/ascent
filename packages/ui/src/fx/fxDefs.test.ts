import { describe, expect, it } from 'vitest';
import { getDef, listDefs, refreshDefs, registerSavedDef } from './fxDefs';

/**
 * The registry's CONTENT is whatever is committed under `fx/defs/`, which churns as defs are authored — so
 * this file asserts nothing about which defs exist. What it covers is that the module is TOTAL and
 * importable: the `import.meta.glob` call doesn't explode under Vitest, a miss returns `undefined` rather
 * than throwing, the listing stays sorted and self-consistent, and `refreshDefs` is safe at any time. The
 * parse/coerce behaviour itself is covered exhaustively in `defStore.test.ts` — deliberately not duplicated
 * here, because both paths run the SAME `coerceDef`.
 *
 * That the glob is NOT DEV-gated — i.e. that these defs reach players at all — is pinned separately, in
 * `prodPlayback.test.ts`, alongside the other two halves of the same contract.
 */
describe('fxDefs registry', () => {
  it('loads without throwing (the import.meta.glob call survives the test env)', () => {
    expect(() => listDefs()).not.toThrow();
    expect(Array.isArray(listDefs())).toBe(true);
  });

  it('returns undefined for an id that is not committed', () => {
    expect(getDef('no-such-def')).toBeUndefined();
    expect(getDef('')).toBeUndefined();
  });

  it('is sorted by id and internally consistent (id ↔ lookup)', () => {
    const defs = listDefs();
    const ids = defs.map((d) => d.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
    for (const def of defs) {
      expect(getDef(def.id)).toBe(def);
      expect(def.version).toBe(1);
      expect(Number.isFinite(def.duration)).toBe(true);
      expect(Array.isArray(def.layers)).toBe(true);
    }
  });

  it('refreshDefs re-reads without throwing and stays consistent', () => {
    const before = listDefs().map((d) => d.id);
    refreshDefs();
    expect(listDefs().map((d) => d.id)).toEqual(before);
  });

  // Regression: the eager glob is expanded at TRANSFORM time, so a def written seconds ago is invisible to it
  // and the write does not invalidate this module. Verified in a browser: after saving, the library stayed
  // empty until a full dev-server restart. `registerSavedDef` is what closes the save → library loop, so a
  // designer sees the def they just saved.
  it('registerSavedDef surfaces a just-written def immediately, without a reload', () => {
    const id = 'test-just-saved';
    expect(getDef(id)).toBeUndefined();

    registerSavedDef({ version: 1, id, duration: 750, layers: [] });

    expect(getDef(id)?.duration).toBe(750);
    expect(listDefs().map((d) => d.id)).toContain(id);
    // Survives a cache drop — the overlay is not the cache.
    refreshDefs();
    expect(getDef(id)?.duration).toBe(750);
    // And stays sorted alongside the globbed set.
    const ids = listDefs().map((d) => d.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it('registerSavedDef overwrites a previous save of the same id (re-saving is idempotent)', () => {
    const id = 'test-resave';
    registerSavedDef({ version: 1, id, duration: 100, layers: [] });
    registerSavedDef({ version: 1, id, duration: 2000, layers: [] });
    expect(getDef(id)?.duration).toBe(2000);
    expect(listDefs().filter((d) => d.id === id)).toHaveLength(1);
  });
});
