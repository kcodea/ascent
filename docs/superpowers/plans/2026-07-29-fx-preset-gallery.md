# Preset Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the FX workbench an on-ramp — a `＋ New effect` gallery of archetype presets that lands a
tuned, working composition in the editor instead of a blank page.

**Architecture:** A hand-edited `presets.json` names ~10 archetypes, each pointing at an ordinary def (the
"base") plus a list of shared variant axes. A variant is a **param-name → multiplier** table applied to
slider params only, clamped to each param's spec and snapped to its step. All decision logic lives in two
pure modules (`presetTable.ts`, `applyVariant.ts`); the React overlay renders their output and hands the
result to the editor's existing `loadDef` seam.

**Tech Stack:** TypeScript, React, Vitest. No new dependencies — validation is hand-rolled in the style of
`choreo/bindings.ts`'s `parseTable`, not zod (the `ui` package does not use zod).

**Spec:** `docs/superpowers/specs/2026-07-29-fx-preset-gallery-design.md`

**Scope note:** This plan delivers the shell plus **two** bases (`preset-bolt`, `preset-blast`). The other
eight bases are content and land afterwards, one PR at a time. That split is deliberate — see the spec's
"Delivery order" section.

---

## Context an implementer needs

Read these before starting; they are the seams this feature attaches to.

- **`packages/ui/src/fx/def.ts`** — `FxDef { id, duration, layers }`, `FxLayer { primitive, anchor, at, life?,
  travelMs?, bow?, params }`. `params` is `Record<string, unknown>`.
- **`packages/ui/src/fx/params.ts`** — `FxParamSpec` is a union by `kind`. **Only `kind: 'slider'` has
  `min`/`max`/`step`.** Every other kind (`toggle`, `color`, `enum`, `palette`, `curve`, `shape`) has no
  numeric range and cannot be multiplied.
- **`packages/ui/src/fx/registry.ts`** — `getPrimitive(id)` returns `FxPrimitive | undefined`;
  `primitive.params` is the `FxParamSpecs` record for that primitive.
- **`packages/ui/src/fx/fxDefs.ts`** — `listDefs()`, `getDef(id)`, `registerSavedDef(def)`. Defs come from
  `import.meta.glob('./defs/*.json')`, so a new `defs/preset-bolt.json` is picked up automatically.
- **`packages/ui/src/fx/ui/Workbench.tsx`** — `loadDef(def, newId)` is how the ⧉ duplicate button already
  loads a def into the editor under a new name. The gallery reuses it verbatim.
- **`packages/ui/src/fx/ui/catalog.ts`** — `buildCatalog()` maps over `listDefs()`. This is where preset ids
  get excluded from **Browse all**.
- **`packages/ui/src/fx/playDef.ts`** — `playDef(id, anchors)` resolves the def **by id** via `getDef`. A
  computed variant is not on disk, so previewing one requires registering it first (Task 7).

**Prototype-pollution note.** A transform is a `Record<string, number>` whose keys are used to index into a
`params` object. `params['__proto__'] = 5` invokes the inherited setter. This bit us in `choreo/bindings.ts`
and is guarded there with an explicit `UNSAFE_KEYS` refusal. Do the same here (Task 2).

---

### Task 1: The preset table — types, parsing, validation

**Files:**
- Create: `packages/ui/src/fx/presets/presetTable.ts`
- Create: `packages/ui/src/fx/presets/presets.json`
- Test: `packages/ui/src/fx/presets/presetTable.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parsePresetTable, UNSAFE_KEYS } from './presetTable';

describe('parsePresetTable', () => {
  const good = {
    version: 1,
    archetypes: [
      { id: 'bolt', label: 'Bolt', icon: '⚡', blurb: 'travels fast', base: 'preset-bolt',
        variants: ['thin', 'heavy'] },
    ],
    variantAxes: [
      { id: 'thin', label: 'Thin', transform: { size: 0.6 } },
      { id: 'heavy', label: 'Heavy', transform: { size: 1.6, speed: 0.7 } },
    ],
  };

  it('parses a well-formed table', () => {
    const t = parsePresetTable(good);
    expect(t.archetypes).toHaveLength(1);
    expect(t.archetypes[0].variants).toEqual(['thin', 'heavy']);
    expect(t.variantAxes[1].transform).toEqual({ size: 1.6, speed: 0.7 });
  });

  it('rejects an archetype naming an axis that is not declared', () => {
    const bad = { ...good, archetypes: [{ ...good.archetypes[0], variants: ['thin', 'nope'] }] };
    expect(() => parsePresetTable(bad)).toThrow(/nope/);
  });

  it('rejects a duplicate archetype id', () => {
    const bad = { ...good, archetypes: [good.archetypes[0], good.archetypes[0]] };
    expect(() => parsePresetTable(bad)).toThrow(/bolt/);
  });

  it('refuses a reserved key in a transform', () => {
    for (const key of UNSAFE_KEYS) {
      const bad = { ...good, variantAxes: [{ id: 'thin', label: 'Thin', transform: { [key]: 2 } },
                                            good.variantAxes[1]] };
      expect(() => parsePresetTable(bad)).toThrow(/reserved/i);
    }
  });

  it('rejects a non-finite multiplier', () => {
    const bad = { ...good, variantAxes: [{ id: 'thin', label: 'Thin', transform: { size: NaN } },
                                          good.variantAxes[1]] };
    expect(() => parsePresetTable(bad)).toThrow(/size/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/fx/presets/presetTable.test.ts`
Expected: FAIL — cannot resolve `./presetTable`.

- [ ] **Step 3: Implement `presetTable.ts`**

```ts
/**
 * The preset table: which archetypes exist, what each starts from, and the shared variant axes.
 *
 * Hand-rolled validation rather than a schema library — the `ui` package has no zod, and
 * `choreo/bindings.ts` set the precedent for parsing a small authored JSON file this way.
 */

/** Keys that must never be used to index into an object we then assign to: `out['__proto__'] = x` invokes
 *  the inherited prototype setter. Same guard, same reason, as `choreo/bindings.ts`. */
export const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** Slider param name → multiplier. Applied to every layer that has that slider param. */
export type VariantTransform = Record<string, number>;

/** Slider param name → ABSOLUTE value. Applied after the transform, and wins. */
export type VariantOverride = Record<string, number>;

export interface VariantAxis {
  id: string;
  label: string;
  transform: VariantTransform;
}

export interface PresetArchetype {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  /** The def id this archetype starts from. Must exist in `fxDefs`. */
  base: string;
  /** Axis ids offered for this archetype. An axis omitted here simply isn't offered. */
  variants: string[];
  /** Per-variant absolute pins, for where a shared rule reads badly on this base. */
  overrides?: Record<string, VariantOverride>;
}

export interface PresetTable {
  version: number;
  archetypes: PresetArchetype[];
  variantAxes: VariantAxis[];
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`preset table: ${what} must be a non-empty string`);
  return v;
}

function numberMap(raw: unknown, what: string): Record<string, number> {
  if (raw === null || typeof raw !== 'object') throw new Error(`preset table: ${what} must be an object`);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (UNSAFE_KEYS.includes(k)) throw new Error(`preset table: ${what} uses reserved key '${k}'`);
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`preset table: ${what}.${k} must be a finite number`);
    }
    out[k] = v;
  }
  return out;
}

export function parsePresetTable(raw: unknown): PresetTable {
  if (raw === null || typeof raw !== 'object') throw new Error('preset table: not an object');
  const t = raw as Record<string, unknown>;

  const axes: VariantAxis[] = (Array.isArray(t.variantAxes) ? t.variantAxes : []).map((a) => {
    const o = a as Record<string, unknown>;
    return {
      id: str(o.id, 'axis id'),
      label: str(o.label, `axis '${String(o.id)}' label`),
      transform: numberMap(o.transform, `axis '${String(o.id)}' transform`),
    };
  });
  const axisIds = new Set(axes.map((a) => a.id));
  if (axisIds.size !== axes.length) throw new Error('preset table: duplicate variant axis id');

  const seen = new Set<string>();
  const archetypes: PresetArchetype[] = (Array.isArray(t.archetypes) ? t.archetypes : []).map((a) => {
    const o = a as Record<string, unknown>;
    const id = str(o.id, 'archetype id');
    if (seen.has(id)) throw new Error(`preset table: duplicate archetype id '${id}'`);
    seen.add(id);

    const variants = (Array.isArray(o.variants) ? o.variants : []).map((v) => str(v, `archetype '${id}' variant`));
    for (const v of variants) {
      if (!axisIds.has(v)) throw new Error(`preset table: archetype '${id}' names undeclared axis '${v}'`);
    }

    const overrides: Record<string, VariantOverride> = {};
    if (o.overrides !== undefined) {
      for (const [k, v] of Object.entries(o.overrides as Record<string, unknown>)) {
        if (UNSAFE_KEYS.includes(k)) throw new Error(`preset table: archetype '${id}' override uses reserved key '${k}'`);
        if (!axisIds.has(k)) throw new Error(`preset table: archetype '${id}' overrides undeclared axis '${k}'`);
        overrides[k] = numberMap(v, `archetype '${id}' override '${k}'`);
      }
    }

    return { id, label: str(o.label, `archetype '${id}' label`), icon: str(o.icon, `archetype '${id}' icon`),
             blurb: str(o.blurb, `archetype '${id}' blurb`), base: str(o.base, `archetype '${id}' base`),
             variants, ...(Object.keys(overrides).length > 0 ? { overrides } : {}) };
  });

  return { version: typeof t.version === 'number' ? t.version : 1, archetypes, variantAxes: axes };
}
```

- [ ] **Step 4: Create `presets.json` with the two shipped archetypes and four axes**

```json
{
  "version": 1,
  "archetypes": [
    {
      "id": "bolt",
      "label": "Bolt",
      "icon": "⚡",
      "blurb": "travels fast and lands hard",
      "base": "preset-bolt",
      "variants": ["thin", "heavy", "crackling", "beam"],
      "overrides": { "beam": { "turbulence": 0 } }
    },
    {
      "id": "blast",
      "label": "Blast",
      "icon": "💥",
      "blurb": "detonates in place",
      "base": "preset-blast",
      "variants": ["thin", "heavy", "crackling"]
    }
  ],
  "variantAxes": [
    { "id": "thin",      "label": "Thin",      "transform": { "size": 0.6, "speed": 1.3, "count": 0.7 } },
    { "id": "heavy",     "label": "Heavy",     "transform": { "size": 1.6, "speed": 0.7, "life": 1.25 } },
    { "id": "crackling", "label": "Crackling", "transform": { "turbulence": 2.5, "speedVar": 1.6, "count": 1.4 } },
    { "id": "beam",      "label": "Beam",      "transform": { "speed": 1.8, "life": 0.8, "sizeVar": 0.4 } }
  ]
}
```

> `blast` omits `beam` from its `variants` — a beam-shaped explosion is nonsense. That omission IS the
> disable mechanism; there is no separate flag.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/ui/src/fx/presets/presetTable.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/fx/presets/
git commit -m "feat(fx): the preset table — archetypes and shared variant axes"
```

---

### Task 2: `applyVariant` — the transform, the clamp, the diagnostics

**Files:**
- Create: `packages/ui/src/fx/presets/applyVariant.ts`
- Test: `packages/ui/src/fx/presets/applyVariant.test.ts`

This is the whole risk surface of the feature. Every rule here exists because its absence is a *silent*
failure — the class of defect that has dominated this subsystem.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyVariant } from './applyVariant';
import { registerPrimitive, clearPrimitives } from '../registry';
import type { FxDef } from '../def';

const SPECS = {
  size:  { kind: 'slider', label: 'Size',  min: 1, max: 20, step: 1,   default: 10 },
  speed: { kind: 'slider', label: 'Speed', min: 0, max: 500, step: 10, default: 100 },
  glow:  { kind: 'toggle', label: 'Glow',  default: true },
} as const;

function def(): FxDef {
  return { id: 'x', duration: 500,
           layers: [{ primitive: 'p', anchor: 'source', at: 0, params: { size: 10, speed: 100, glow: true } }] };
}

beforeEach(() => {
  clearPrimitives();
  registerPrimitive({ id: 'p', params: SPECS, spawn: () => ({ update: () => {}, destroy: () => {} }) } as never);
});

describe('applyVariant', () => {
  it('multiplies a slider param and reports it applied', () => {
    const r = applyVariant(def(), { id: 'a', label: 'A', transform: { size: 1.5 } });
    expect(r.def.layers[0].params.size).toBe(15);
    expect(r.applied).toEqual(['0.size']);
    expect(r.missed).toEqual([]);
  });

  it('clamps above max and below min', () => {
    expect(applyVariant(def(), { id: 'a', label: 'A', transform: { size: 100 } }).def.layers[0].params.size).toBe(20);
    expect(applyVariant(def(), { id: 'a', label: 'A', transform: { size: 0.001 } }).def.layers[0].params.size).toBe(1);
  });

  it('snaps to the param step', () => {
    // 100 * 1.07 = 107 → step 10 → 110
    expect(applyVariant(def(), { id: 'a', label: 'A', transform: { speed: 1.07 } }).def.layers[0].params.speed).toBe(110);
  });

  it('refuses a non-slider param and reports it missed', () => {
    const r = applyVariant(def(), { id: 'a', label: 'A', transform: { glow: 2 } });
    expect(r.def.layers[0].params.glow).toBe(true);
    expect(r.missed).toEqual(['glow']);
  });

  it('reports a transform key no layer has', () => {
    const r = applyVariant(def(), { id: 'a', label: 'A', transform: { nonexistent: 2 } });
    expect(r.missed).toEqual(['nonexistent']);
  });

  it('an override beats the transform for the same key', () => {
    const r = applyVariant(def(), { id: 'a', label: 'A', transform: { size: 1.5 } }, { size: 3 });
    expect(r.def.layers[0].params.size).toBe(3);
  });

  it('does not mutate the base def', () => {
    const base = def();
    applyVariant(base, { id: 'a', label: 'A', transform: { size: 1.5 } });
    expect(base.layers[0].params.size).toBe(10);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/fx/presets/applyVariant.test.ts`
Expected: FAIL — cannot resolve `./applyVariant`.

- [ ] **Step 3: Implement `applyVariant.ts`**

```ts
import type { FxDef } from '../def';
import { getPrimitive } from '../registry';
import { UNSAFE_KEYS, type VariantAxis, type VariantOverride } from './presetTable';

export interface VariantResult {
  def: FxDef;
  /** Params actually changed, as `<layerIndex>.<param>`. */
  applied: string[];
  /** Transform/override keys that matched no SLIDER param on any layer. An authoring error, not a no-op. */
  missed: string[];
}

/** Clamp to the spec's range, then snap to its step, then round away float dust from the multiply. */
function settle(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  if (step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
}

/**
 * Produce a variant of `base`.
 *
 * Sliders only: every other param kind (`toggle`, `enum`, `color`, `palette`, `curve`, `shape`) has no
 * numeric range, so "multiply it" is undefined. Such a key is reported in `missed` and the param is left
 * exactly as authored — never partially applied.
 *
 * The base is never mutated; layers and their `params` are cloned.
 */
export function applyVariant(base: FxDef, axis: VariantAxis, override?: VariantOverride): VariantResult {
  const applied: string[] = [];
  const touched = new Set<string>();

  const layers = base.layers.map((layer, i) => {
    const specs = getPrimitive(layer.primitive)?.params;
    const params: Record<string, unknown> = { ...layer.params };

    const write = (key: string, next: number): void => {
      params[key] = next;
      applied.push(`${i}.${key}`);
      touched.add(key);
    };

    for (const [key, mult] of Object.entries(axis.transform)) {
      if (UNSAFE_KEYS.includes(key)) continue;
      const spec = specs?.[key];
      if (spec?.kind !== 'slider') continue;
      const current = params[key];
      if (typeof current !== 'number') continue;
      write(key, settle(current * mult, spec.min, spec.max, spec.step));
    }

    // Absolute pins, applied AFTER the multipliers so a base can override a rule that reads badly on it.
    for (const [key, value] of Object.entries(override ?? {})) {
      if (UNSAFE_KEYS.includes(key)) continue;
      const spec = specs?.[key];
      if (spec?.kind !== 'slider') continue;
      write(key, settle(value, spec.min, spec.max, spec.step));
    }

    return { ...layer, params };
  });

  const declared = [...Object.keys(axis.transform), ...Object.keys(override ?? {})];
  const missed = [...new Set(declared.filter((k) => !touched.has(k)))];

  return { def: { ...base, layers }, applied, missed };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/ui/src/fx/presets/applyVariant.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/presets/applyVariant.ts packages/ui/src/fx/presets/applyVariant.test.ts
git commit -m "feat(fx): applyVariant — sliders only, clamped, snapped, and loud about misses"
```

---

### Task 3: The two base defs

**Files:**
- Create: `packages/ui/src/fx/defs/preset-bolt.json`
- Create: `packages/ui/src/fx/defs/preset-blast.json`

These are **content**, not code, and this task has a limit an implementer must understand up front.

**What you can do:** produce a *structurally correct first pass* — right primitives, right anchors, right
timing, params in sensible ranges — that passes `defs.test.ts` and Task 4's coverage test.

**What you cannot do:** judge whether it looks good. Nobody can, from a JSON file. These two defs are
explicitly a **first pass for the owner to tune in the workbench**, and the plan is structured so a rejected
base costs one file and nothing else. Do not spend effort trying to make them beautiful by hand; make them
*correct and complete*, and say in the commit message that they are unreviewed first passes.

Copy the param ranges from a shipped def of the same primitive (`ruby-lance` for a travelling
`burst`/`ribbon`, `blue-trail-detonate` for a detonation) rather than inventing values — those files are
already known-good, which is a far better starting point than defaults.

- [ ] **Step 1: Write `preset-bolt`**

A travelling bolt: a `ribbon` layer anchored `travel` with `bow: 0` (dead straight), plus a `burst` anchored
`target` whose `at` matches the ribbon's `travelMs` so it fires on arrival.

**Hard requirement:** the axes multiply `size`, `speed`, `count`, `life`, `turbulence`, `speedVar` and
`sizeVar`, so the composition must actually *use* those slider params — an axis key that reaches nothing is a
variant that silently does nothing. Task 4's coverage test enforces this; do not hand-wave it.

- [ ] **Step 2: Write `preset-blast`**

A stationary detonation: a `burst` anchored `source` plus a `shockwave` ring. Same hard requirement, minus
`beam` (which `preset-blast` does not offer).

- [ ] **Step 3: Verify both load and validate**

Run: `npx vitest run packages/ui/src/fx/defs.test.ts`
Expected: PASS — this is the existing test that proves every param name and value range in every def file is
real against the primitives' own specs.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/fx/defs/preset-bolt.json packages/ui/src/fx/defs/preset-blast.json
git commit -m "content(fx): preset-bolt and preset-blast — unreviewed first-pass bases for owner tuning"
```

---

### Task 4: Integrity + coverage tests

**Files:**
- Create: `packages/ui/src/fx/presets/presets.integrity.test.ts`

These run against the **shipped** table and defs, so they fail the build when someone adds an archetype
naming a missing base, or an axis whose keys reach nothing.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { presetTable } from './index';
import { getDef } from '../fxDefs';
import { getPrimitive } from '../registry';
import '../primitives';   // register the real primitives so specs resolve

describe('the shipped preset table', () => {
  it('every archetype names a base def that exists', () => {
    for (const a of presetTable().archetypes) {
      expect(getDef(a.base), `archetype '${a.id}' base '${a.base}'`).toBeDefined();
    }
  });

  it('every archetype base id is preset-prefixed, so Browse all excludes it', () => {
    for (const a of presetTable().archetypes) expect(a.base.startsWith('preset-')).toBe(true);
  });

  // The one that matters: an axis key reaching nothing is a variant that silently does nothing.
  it('every axis key resolves to a slider param on at least one base', () => {
    const table = presetTable();
    const bases = table.archetypes.map((a) => getDef(a.base)).filter((d) => d !== undefined);
    for (const axis of table.variantAxes) {
      for (const key of Object.keys(axis.transform)) {
        const hit = bases.some((d) =>
          d!.layers.some((l) => getPrimitive(l.primitive)?.params[key]?.kind === 'slider'));
        expect(hit, `axis '${axis.id}' key '${key}' reaches no slider param on any base`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run packages/ui/src/fx/presets/presets.integrity.test.ts`
Expected: PASS. If the coverage test fails, the fix is in Task 3's defs (use the params), not here.

- [ ] **Step 3: Create the barrel `packages/ui/src/fx/presets/index.ts`**

```ts
import raw from './presets.json';
import { parsePresetTable, type PresetTable } from './presetTable';

let cached: PresetTable | null = null;

/** The shipped table, parsed once. Throws on a malformed file — loudly, at first use, not silently later. */
export function presetTable(): PresetTable {
  if (cached === null) cached = parsePresetTable(raw);
  return cached;
}

export { applyVariant, type VariantResult } from './applyVariant';
export type { PresetTable, PresetArchetype, VariantAxis, VariantOverride } from './presetTable';
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/fx/presets/
git commit -m "test(fx): pin preset table integrity and axis coverage"
```

---

### Task 5: Exclude preset bases from Browse all

**Files:**
- Modify: `packages/ui/src/fx/ui/catalog.ts` (`buildCatalog`)
- Test: `packages/ui/src/fx/ui/catalog.test.ts` (add a case)

- [ ] **Step 1: Add the failing test to the existing file**

```ts
it('excludes preset bases — they are start-points, not bound effects', () => {
  registerSavedDef({ version: 1, id: 'preset-bolt', duration: 100, layers: [] } as never);
  expect(buildCatalog().some((e) => e.def.id === 'preset-bolt')).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/fx/ui/catalog.test.ts`
Expected: FAIL — `preset-bolt` is present.

- [ ] **Step 3: Implement the exclusion**

In `catalog.ts`, above `buildCatalog`:

```ts
/**
 * Ids under this prefix are archetype BASES for the preset gallery. They are deliberately bound to nothing,
 * so leaving them in would pad the "nothing bound" column of the by-event lens — degrading the very coverage
 * map that lens exists to provide.
 */
export const PRESET_ID_PREFIX = 'preset-';
```

and in `buildCatalog`, filter before the map:

```ts
  return listDefs()
    .filter((def) => !def.id.startsWith(PRESET_ID_PREFIX))
    .map((def) => ({ def, facets: deriveFacets(def), bindings: bindings.get(def.id) ?? { ...NO_BINDINGS } }))
    .sort((a, b) => a.def.id.localeCompare(b.def.id));
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/ui/src/fx/ui/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/catalog.ts packages/ui/src/fx/ui/catalog.test.ts
git commit -m "feat(fx): keep preset bases out of Browse all"
```

---

### Task 6: The gallery overlay

**Files:**
- Create: `packages/ui/src/fx/ui/PresetGallery.tsx`
- Modify: `packages/ui/src/styles.css` (a `.fxgallery` block)

No test — this repo has no jsdom and no `@testing-library/react`, so React components cannot be tested here.
That is why every decision already lives in Tasks 1–2. Keep this file a renderer.

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { presetTable, type PresetArchetype } from '../presets';

export interface PresetGalleryProps {
  /** Fired with (archetypeId, variantId) when the author picks a variant. */
  onPick: (archetypeId: string, variantId: string) => void;
  /**
   * Hover preview. Passes the IDS, never a constructed def id — the Workbench owns `--` id construction in
   * exactly one place (`materialiseVariant`). Building it here too would be two spellings of one rule.
   * `variantId === null` means "stop previewing".
   */
  onPreview: (archetypeId: string, variantId: string | null) => void;
  onClose: () => void;
}

export function PresetGallery({ onPick, onPreview, onClose }: PresetGalleryProps): React.ReactElement {
  const table = presetTable();
  const [open, setOpen] = useState<PresetArchetype | null>(null);

  return (
    <div className="fxgallery">
      <div className="fxgallery-h">
        <span>Start a new effect</span>
        <button className="fxwb-btn" onClick={onClose}>Close</button>
      </div>

      {table.archetypes.length === 0 && (
        <p className="fxgallery-empty">No archetypes in <code>presets.json</code> — nothing to start from.</p>
      )}

      <div className="fxgallery-grid">
        {table.archetypes.map((a) => (
          <button
            key={a.id}
            className={`fxgallery-card${open?.id === a.id ? ' on' : ''}`}
            onClick={() => setOpen(open?.id === a.id ? null : a)}
          >
            <span className="fxgallery-icon">{a.icon}</span>
            <span className="fxgallery-name">{a.label}</span>
            <span className="fxgallery-blurb">{a.blurb}</span>
          </button>
        ))}
      </div>

      {open !== null && (
        <div className="fxgallery-variants">
          {open.variants.map((v) => {
            const axis = table.variantAxes.find((x) => x.id === v);
            return (
              <button
                key={v}
                className="fxgallery-variant"
                onMouseEnter={() => onPreview(open.id, v)}
                onMouseLeave={() => onPreview(open.id, null)}
                onClick={() => { onPreview(open.id, null); onPick(open.id, v); }}
              >
                {axis?.label ?? v}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the CSS**

Add a `.fxgallery` block to `styles.css`. **It must set `pointer-events: auto`** — `.fxwb` is
`pointer-events: none` and every child surface has to opt back in. A panel that renders perfectly and is
completely inert is a defect this codebase has shipped before (the library browser, fixed in `88bb5592`).
Follow `.fxlib`'s existing block for placement and chrome.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/fx/ui/PresetGallery.tsx packages/ui/src/styles.css
git commit -m "feat(fx): the preset gallery overlay"
```

---

### Task 7: Wire it into the Workbench

**Files:**
- Modify: `packages/ui/src/fx/ui/Workbench.tsx`

- [ ] **Step 1: Add state and the computed-variant registration**

Near the other overlay state (`browsing`):

```tsx
  const [gallery, setGallery] = useState(false);
```

Add this helper inside the component. It computes a variant and registers it so `playDef` — which resolves
**by id** — can preview something that exists only in memory. The `preset-` prefix means Task 5's filter
already keeps these out of Browse all.

```tsx
  /** Compute `<base>--<variant>` and register it so hover-preview and load can both address it by id. */
  const materialiseVariant = useCallback((archetypeId: string, variantId: string): StoredFxDef | null => {
    const table = presetTable();
    const arch = table.archetypes.find((a) => a.id === archetypeId);
    const axis = table.variantAxes.find((x) => x.id === variantId);
    const base = arch ? getDef(arch.base) : undefined;
    if (!arch || !axis || !base) return null;

    const { def, missed } = applyVariant(base, axis, arch.overrides?.[variantId]);
    if (import.meta.env.DEV && missed.length > 0) {
      console.warn(`[fx] preset '${archetypeId}/${variantId}': ${missed.length} key(s) reached nothing —`, missed);
    }
    const stored = { ...base, ...def, id: `${arch.base}--${variantId}` } as StoredFxDef;
    registerSavedDef(stored);
    return stored;
  }, []);
```

- [ ] **Step 2: Render the gallery beside the library browser**

Next to the existing `{browsing && <LibraryBrowser … />}` block:

```tsx
      {gallery && (
        <PresetGallery
          onPreview={(archetypeId, variantId) => {
            const anchors = lastAnchorsRef.current;
            if (variantId === null || anchors === null) return;
            // Materialise FIRST: `playDef` resolves by id, and a computed variant does not exist until
            // `registerSavedDef` has seen it. Previewing before registering is a silent no-op.
            const stored = materialiseVariant(archetypeId, variantId);
            if (stored === null) return;
            playDef(stored.id, anchors);
          }}
          onPick={(archetypeId, variantId) => {
            const stored = materialiseVariant(archetypeId, variantId);
            if (stored === null) return;
            // Same seam the ⧉ duplicate button uses. Pre-named so Save never opens on a blank name.
            loadDef(stored, `${archetypeId}-${variantId}`);
            setGallery(false);
          }}
          onClose={() => setGallery(false)}
        />
      )}
```

`materialiseVariant` is idempotent — re-registering the same id overwrites the same overlay entry — so
calling it from both `onPreview` and `onPick` is correct, not wasteful.

- [ ] **Step 3: Add the button**

Beside the existing `Browse all` button (Workbench.tsx ~line 1559):

```tsx
        <button className="fxwb-btn" onClick={() => setGallery(true)}>＋ New effect</button>
```

- [ ] **Step 4: Verify in the browser**

Run `npm run dev` **from this worktree** and read the port it prints. Then: open the workbench → `＋ New
effect` → hover a variant (it previews) → click it (it loads, named `bolt-heavy`) → Save → confirm
`packages/ui/src/fx/defs/bolt-heavy.json` exists. Then open **Browse all** and confirm `preset-bolt` and the
`--` variants are absent.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/Workbench.tsx
git commit -m "feat(fx): ＋ New effect — the gallery lands a tuned composition in the editor"
```

---

### Task 8: Gate, docs, PR

**Files:**
- Modify: `docs/fx-workbench-guide.md`, `docs/devlog.md`, `docs/roadmap.md`, `README.md`

- [ ] **Step 1: Run the full gate**

```bash
npm run typecheck && npm run lint && npm test && npm run build:web
```

All four must be green. Report the actual test count. **Note:** `#676` landed on 2026-07-29 and
`typecheck:web` is now part of CI — `npm run typecheck` covers packages *and* web, so a UI type error is a
real failure now, not a known-red backlog.

- [ ] **Step 2: Update the guide**

Rewrite `docs/fx-workbench-guide.md` §2 ("Pick a starting point"). Today it says *don't author from scratch,
duplicate something close* — that advice exists because there was no on-ramp. Lead with `＋ New effect`
instead, and keep **Browse all** as the second option, for starting from something already bound.

- [ ] **Step 3: Update devlog, roadmap, README**

Prepend a dated `docs/devlog.md` entry (what changed, why, how verified). Move the gallery out of
`docs/roadmap.md` **Now**. Add a README "Recent changes" bullet.

- [ ] **Step 4: Commit and open the PR**

```bash
git add -A && git commit -m "docs(fx): the preset gallery — guide, devlog, roadmap, README"
git push -u origin feat/fx-preset-gallery
```

Then open the PR with `gh` (full path: `/c/Program\ Files/GitHub\ CLI/gh.exe`).

---

## Follow-ups (do NOT do in this PR)

- The remaining **eight bases** — `wave`, `chain`, `cloud`, `swell`, `drip`, `vortex`, `slam`, `beam`. Content,
  one at a time, reviewed side by side at real card scale.
- The **friction batch** already queued with the owner: keep Fire/scrub alive in rail mode, persist a
  commit-success toast across the forced reload, relabel `fanOut` in plain language, auto-unlock the seed on
  Save.
- Absorbing the **~30 legacy `pixiFx` effects** into the workbench, and stripping the unrequested defs — the
  owner's third queued item.
