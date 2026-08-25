import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The DEV/production SPLIT for authored FX, pinned.
 *
 * Authored defs used to be DEV-only: three separate `import.meta.env.DEV` gates kept them out of the shipped
 * game (the `import.meta.glob` in `fxDefs.ts`, the dynamic `import('./primitives')` in `playDef.ts`, and the
 * `ensureDefsReady()` call in `Game.tsx`). The owner removed all three on 2026-07-29 — players see the
 * authored effects now. AUTHORING stayed fenced: saving a def, the imported-art glob, `window.__fx`, and the
 * workbench UI under `DevMenu`.
 *
 * That split had nothing holding it: the whole fx suite passed with the gates removed, which is precisely how
 * a boundary like this drifts. These tests exist to fail if it drifts in EITHER direction — a re-added
 * playback gate silently empties the registry for players (bytes shipped, nothing plays, no error), and a
 * removed authoring gate points the save path at a dev endpoint that isn't there.
 *
 * How the DEV half is faked: `vi.stubEnv('DEV', false)` mutates the live `import.meta.env` object, which is
 * what Vite's transform makes source modules read at RUNTIME in dev/test (a production `vite build` folds the
 * constant instead — that path is covered by inspecting the built bundle, not from here). Each case therefore
 * pairs the stub with `vi.resetModules()` + a dynamic import, so the module under test evaluates its
 * top-level and gate code fresh while `DEV` is false. Asserting the stub took effect (`import.meta.env.DEV`
 * is `false`) is part of every case — without that assertion these would silently degrade into tests that
 * pass whatever the gates say.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the def registry ships (gate 1 of 3: the fxDefs glob)', () => {
  it('is populated with the committed defs even when DEV is false', async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    expect(import.meta.env.DEV).toBe(false); // the stub really is in effect for the import below

    const { listDefs, getDef } = await import('./fxDefs');
    const ids = listDefs().map((d) => d.id);

    // The registry is NOT force-empty. `readModules()` used to `return {}` outside DEV; if that comes back,
    // this is zero and every binding in the Score goes inert for players.
    expect(ids.length).toBeGreaterThan(0);
    // A named def, not just a count — one bindings.json actually points at, so a failure reads as the real
    // problem (players can't resolve a bound def) rather than an incidental number moving.
    expect(ids).toContain('ward-gained');
    expect(getDef('ward-gained')?.duration).toBeGreaterThan(0);
  });

  it('a def keeps its LAYERS outside DEV, once the primitives are registered', async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    expect(import.meta.env.DEV).toBe(false);

    // ORDER IS LOAD-BEARING, which is why this is its own case. `coerceDef` resolves each layer's primitive
    // through the registry and DROPS layers whose primitive is unknown, and `index()` caches its result on
    // first read — so a `getDef()` that happened before the primitives registered would cache every def with
    // zero layers, permanently, and `playDef` declines a def with no playable layers. In the real game this
    // can't happen (the only prod caller is `playDef`, behind `canPlayDefs()`, which requires the primitives),
    // and this pins that: with the primitives in place, the layers survive the trip.
    await (await import('./playDef')).ensureDefsReady();
    const { getDef } = await import('./fxDefs');

    expect(getDef('ward-gained')?.layers).toHaveLength(2);
    expect(getDef('ruby-lance')?.layers).toHaveLength(6);
  });

  it('every def the shipped binding table names resolves with DEV false', async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    expect(import.meta.env.DEV).toBe(false);

    const { effectiveTables } = await import('../choreo/bindings');
    const { getDef } = await import('./fxDefs');
    const tables = effectiveTables();
    const bound = [
      ...Object.values(tables.kinds).map((b) => b?.def),
      ...Object.values(tables.cards).flatMap((k) => Object.values(k).map((b) => b?.def)),
    ].filter((d): d is string => typeof d === 'string');

    // `bindings.test.ts` already asserts this holds in DEV. The point here is that it holds with DEV false —
    // i.e. what a player's build resolves, not what the author's does.
    expect(bound.length).toBeGreaterThan(0);
    for (const id of bound) expect(getDef(id), `bound def '${id}' must resolve for players`).toBeDefined();
  });
});

describe('the primitives ship (gates 2 and 3: ensureDefsReady + its caller)', () => {
  it('ensureDefsReady registers the primitives without DEV', async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    expect(import.meta.env.DEV).toBe(false);

    // A FRESH registry module instance, so this measures a real empty→loaded transition rather than
    // primitives some earlier suite happened to register.
    const { hasPrimitives, listPrimitives } = await import('./registry');
    const { ensureDefsReady } = await import('./playDef');
    expect(hasPrimitives()).toBe(false);

    await ensureDefsReady();

    // The gate used to read `if (import.meta.env.DEV && !hasPrimitives())`, so outside DEV the dynamic import
    // never ran and this stayed false forever — `canPlayDefs()` with it.
    expect(hasPrimitives()).toBe(true);
    expect(listPrimitives().map((p) => p.id).sort()).toEqual([
      'burst',
      'emitter',
      'react',
      'ribbon',
      'screen',
      'shockwave',
      'smoke',
    ]);
  });

  it('Game.tsx calls ensureDefsReady unconditionally — the gate the spike missed', async () => {
    // Read as SOURCE, deliberately: rendering `Game` headless needs a DOM, a store, a Pixi renderer and the
    // whole app tree, and a mount-effect assertion through all of that would be a test of the harness. What
    // actually matters is one syntactic fact — the call is not wrapped in a DEV check. Shipping the defs and
    // the primitives but never CALLING this is exactly the half-done state that would have shipped bytes and
    // played nothing, and it is invisible to every other test in this file.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../Game.tsx', import.meta.url), 'utf8');
    const call = /^(?<indent>\s*)(?<line>.*ensureDefsReady\(\).*)$/m.exec(src);

    expect(call?.groups?.line).toBeDefined();
    expect(call?.groups?.line).not.toMatch(/import\.meta\.env\.DEV/);
    // And nothing DEV-gated on the lines around it either (the effect body is short).
    const at = src.indexOf(call?.groups?.line ?? '');
    expect(src.slice(Math.max(0, at - 200), at)).not.toMatch(/if \(import\.meta\.env\.DEV\)[^\n]*$/);
  });
});

describe('committed FX art ships (gate 4: the shapeLibrary art glob)', () => {
  it('resolves committed art slugs even when DEV is false', async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    expect(import.meta.env.DEV).toBe(false);

    const { listCommittedArt } = await import('./shapeLibrary');
    const slugs = listCommittedArt();

    // `artModules()` used to `return {}` outside DEV, so committed PNGs never bundled and every def
    // referencing `art:<slug>` fell back to a procedural shape for players (the "coin-ale coins layer
    // absent in prod" report). These are committed AND referenced by shipped defs: `group-14035` drives
    // the coin FX, `gemshard` the ruby/shop-buff FX, `bubble` the ale-bubbles burst.
    expect(slugs).toContain('group-14035');
    expect(slugs).toContain('gemshard');
    expect(slugs).toContain('bubble');
  });
});

describe('authoring stays fenced (the half that must NOT ship)', () => {
  it('saveDef refuses outside DEV, with a readable reason instead of a network error', async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    expect(import.meta.env.DEV).toBe(false);

    const { saveDef } = await import('./defStore');
    const res = await saveDef({ version: 1, id: 'test-should-not-save', duration: 500, layers: [] });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/dev server/i);
  });

  it('saveBindings and saveArt are refused outside DEV too — every write path, not just saveDef', async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    expect(import.meta.env.DEV).toBe(false);

    const { saveBindings, saveArt, ART_DATA_URL_PREFIX } = await import('./defStore');
    await expect(saveBindings('{}')).resolves.toMatchObject({ ok: false });
    await expect(saveArt('test-art', `${ART_DATA_URL_PREFIX}AAAA`)).resolves.toMatchObject({ ok: false });
  });
});
