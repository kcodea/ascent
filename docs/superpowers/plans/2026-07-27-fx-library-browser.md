# FX Library Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workbench's flat list of def ids with a browsable library — one derived catalog, surfaced through three lenses (by look, by event, by card) in a full-screen overlay with hover-to-play preview.

**Architecture:** One pure module (`fx/ui/catalog.ts`) turns the def registry plus the choreo binding tables into a single `FxCatalogEntry[]`, deriving shape / colour / motion / bindings and carrying two optional authored fields. A second pure module (`fx/ui/catalogView.ts`) does all filtering and grouping over that array. The React overlay is a thin renderer over both, so every fact is computed exactly once and no lens can disagree with another. Read-only: nothing in this plan can change what plays in combat.

**Tech Stack:** TypeScript, React 18, Vitest, Vite. Repo: ASCENT monorepo. Worktree `.claude/worktrees/fx-workbench-p1`, branch `feat/fx-workbench-p1`. Spec: `docs/superpowers/specs/2026-07-27-fx-library-browser-design.md`.

---

## Working agreements for every task

- Run all commands from the worktree root: `C:\Users\micha\Desktop\ascent\.claude\worktrees\fx-workbench-p1`.
- Run a single test file with `npx vitest run <path>`.
- The full gate before any "done" claim: `npm run typecheck && npm run lint && npm test && npm run build:web`.
- `npm run lint` reports **1 pre-existing warning** (`CARD_INDEX` unused in `SceneBuilder.tsx`). That warning is expected; **0 errors** is the pass condition.
- Commit after every task. Never `git add -A` — always list paths explicitly (other sessions share this checkout).
- Per `CLAUDE.md`, the final commit of the feature updates `docs/devlog.md`, `docs/roadmap.md` and the README summary. That is Task 9; earlier tasks do not touch those files.

---

## File structure

**Created:**

| File | Responsibility |
|---|---|
| `packages/ui/src/fx/ui/catalog.ts` | Pure. Builds `FxCatalogEntry[]` and the inverse `MomentKind → def` index. Owns every derivation (shape, colour, motion, bindings). |
| `packages/ui/src/fx/ui/catalog.test.ts` | Tests for the above, including the two coverage guards. |
| `packages/ui/src/fx/ui/catalogView.ts` | Pure. Filtering and grouping — everything the overlay needs to decide what rows to render. |
| `packages/ui/src/fx/ui/catalogView.test.ts` | Tests for filtering/grouping. |
| `packages/ui/src/fx/ui/LibraryBrowser.tsx` | The full-screen overlay. Thin: renders what the two modules return, owns hover/selection state only. |

**Modified:**

| File | Change |
|---|---|
| `packages/ui/src/fx/defStore.ts` | `StoredFxDef` gains optional `label` + `tags`; `coerceDef` carries them through. |
| `packages/ui/src/fx/defs.test.ts` | Accept `label`/`tags` on committed defs. |
| `packages/ui/src/fx/ui/Workbench.tsx` | A "Browse all" button that opens the overlay; loading from it reuses the existing load path. |
| `packages/ui/src/styles.css` | Overlay styles. |

**Why `fx/ui/` and not `fx/`:** the catalog is the only module that must see both the defs and the choreo bindings. `choreo` imports `fx/playDef`, and `fx/playDef` never imports `fx/ui`, so there is no cycle.

---

### Task 1: `label` and `tags` on the def format

**Files:**
- Modify: `packages/ui/src/fx/defStore.ts` (interface `StoredFxDef` at :52, `coerceDef` at :162)
- Test: `packages/ui/src/fx/defStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/ui/src/fx/defStore.test.ts`:

```ts
describe('coerceDef — label and tags', () => {
  const base = { version: 1, id: 'x', duration: 500, layers: [] };

  it('carries a string label and string tags through', () => {
    const def = coerceDef({ ...base, label: 'Ember Lance', tags: ['impact', 'spell'] });
    expect(def?.label).toBe('Ember Lance');
    expect(def?.tags).toEqual(['impact', 'spell']);
  });

  // Absent is the norm — 20 committed defs have neither — so an untouched def must serialise exactly as it
  // did before these fields existed.
  it('OMITS both when absent, rather than storing empty values', () => {
    const def = coerceDef(base);
    expect('label' in (def ?? {})).toBe(false);
    expect('tags' in (def ?? {})).toBe(false);
  });

  it('drops a non-string label and trims a blank one to an omission', () => {
    expect('label' in (coerceDef({ ...base, label: 42 }) ?? {})).toBe(false);
    expect('label' in (coerceDef({ ...base, label: '   ' }) ?? {})).toBe(false);
  });

  it('drops non-string tags individually, keeping the usable ones', () => {
    expect(coerceDef({ ...base, tags: ['ok', 7, null, 'fine'] })?.tags).toEqual(['ok', 'fine']);
  });

  it('drops a tags field that is not an array, and an array that empties out', () => {
    expect('tags' in (coerceDef({ ...base, tags: 'impact' }) ?? {})).toBe(false);
    expect('tags' in (coerceDef({ ...base, tags: [1, 2] }) ?? {})).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/ui/src/fx/defStore.test.ts`
Expected: FAIL — `Property 'label' does not exist on type 'StoredFxDef'`.

- [ ] **Step 3: Add the fields**

In `packages/ui/src/fx/defStore.ts`, inside `interface StoredFxDef`, directly after the `seed?: number;` field:

```ts
  /**
   * Authoring-only display name and free-text tags, for the library browser's search and grouping.
   * BOTH OPTIONAL and omitted when unset, on the same terms as `seed` above: every def written before these
   * existed stays byte-identical, and an untagged def is still fully browsable — it just can't be found by a
   * word that isn't derivable from its data (see `fx/ui/catalog.ts`).
   */
  label?: string;
  tags?: string[];
```

In `coerceDef`, directly after the `if (seed !== null) def.seed = seed;` line:

```ts
  // Same omit-unless-usable discipline as `seed`. A blank label and a tag list that contains nothing usable
  // both mean "not set" rather than "set to empty" — storing the empty form would make an untouched def stop
  // round-tripping unchanged.
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (label !== '') def.label = label;
  if (Array.isArray(raw.tags)) {
    const tags = raw.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim());
    if (tags.length > 0) def.tags = tags;
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/ui/src/fx/defStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Let the committed-def guard accept them**

Open `packages/ui/src/fx/defs.test.ts` and read the test named `every def declares version 1, a positive duration, and at least one layer`. If it asserts an exact key set on the def object, add `label` and `tags` to the permitted keys. If it only checks the fields it names (the likely case), **change nothing** — record in the commit message that no change was needed.

- [ ] **Step 6: Run the def guard**

Run: `npx vitest run packages/ui/src/fx/defs.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/fx/defStore.ts packages/ui/src/fx/defStore.test.ts packages/ui/src/fx/defs.test.ts
git commit -m "feat(fx): optional label + tags on a def, for the library browser"
```

---

### Task 2: Hue bucketing

**Files:**
- Create: `packages/ui/src/fx/ui/catalog.ts`
- Test: `packages/ui/src/fx/ui/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/fx/ui/catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hueBucketOf, FX_HUES } from './catalog';

describe('hueBucketOf', () => {
  it('buckets the saturated stop of each shipped palette', () => {
    expect(hueBucketOf(0xd41f1f)).toBe('red');
    expect(hueBucketOf(0xff9c1e)).toBe('orange');
    expect(hueBucketOf(0xffb81f)).toBe('gold');
    expect(hueBucketOf(0x7ade22)).toBe('green');
    expect(hueBucketOf(0x2ee0ac)).toBe('cyan');
    expect(hueBucketOf(0x2f8bff)).toBe('blue');
    expect(hueBucketOf(0xc936ef)).toBe('violet');
    expect(hueBucketOf(0xff33a8)).toBe('magenta');
  });

  // THE trap this function exists to avoid. Stop 4 is #ffffff in nearly every def and stop 1 is a near-black
  // rim; both have no usable hue, so bucketing either would make most defs look identical.
  it('calls a colourless value neutral rather than inventing a hue', () => {
    expect(hueBucketOf(0xffffff)).toBe('neutral');
    expect(hueBucketOf(0x000000)).toBe('neutral');
    expect(hueBucketOf(0x808080)).toBe('neutral');
  });

  it('is total for junk input', () => {
    expect(hueBucketOf(Number.NaN)).toBe('neutral');
    expect(hueBucketOf(-1)).toBe('neutral');
  });

  it('FX_HUES lists every bucket the function can return', () => {
    const samples = [0xd41f1f, 0xff9c1e, 0xffb81f, 0x7ade22, 0x2ee0ac, 0x2f8bff, 0xc936ef, 0xff33a8, 0xffffff];
    samples.forEach((n) => expect(FX_HUES).toContain(hueBucketOf(n)));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/ui/src/fx/ui/catalog.test.ts`
Expected: FAIL — cannot resolve `./catalog`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/fx/ui/catalog.ts`:

```ts
/** The colour buckets a def can be filed under. `neutral` is not a failure — it is the honest answer for a
 *  white, black or grey stop, which is what stops 1 and 4 of nearly every palette are. */
export const FX_HUES = ['red', 'orange', 'gold', 'green', 'cyan', 'blue', 'violet', 'magenta', 'neutral'] as const;
export type FxHue = (typeof FX_HUES)[number];

/** Below this saturation, or outside this lightness band, a colour has no hue worth filing under. */
const MIN_SATURATION = 0.18;
const MIN_LIGHTNESS = 0.08;
const MAX_LIGHTNESS = 0.94;

/** Hue ranges in degrees, in the order they are tested. Upper bound exclusive; the last entry wraps. */
const HUE_RANGES: [FxHue, number, number][] = [
  ['red', 345, 360],
  ['red', 0, 18],
  ['orange', 18, 38],
  ['gold', 38, 65],
  ['green', 65, 160],
  ['cyan', 160, 200],
  ['blue', 200, 255],
  ['violet', 255, 300],
  ['magenta', 300, 345],
];

/**
 * The colour bucket for one 0xRRGGBB stop.
 *
 * Total by construction: anything non-finite, out of range, or too grey/dark/bright to have a meaningful hue
 * returns `neutral` rather than throwing or guessing. That matters because it is fed raw palette numbers
 * straight out of def JSON, which is untrusted input.
 */
export function hueBucketOf(rgb: number): FxHue {
  if (!Number.isFinite(rgb) || rgb < 0 || rgb > 0xffffff) return 'neutral';
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) return 'neutral';
  const d = max - min;
  if (d === 0) return 'neutral';
  const s = d / (1 - Math.abs(2 * l - 1));
  if (s < MIN_SATURATION) return 'neutral';

  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;

  for (const [hue, lo, hi] of HUE_RANGES) if (h >= lo && h < hi) return hue;
  return 'neutral';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/ui/src/fx/ui/catalog.test.ts`
Expected: PASS, 4 tests. If a shipped-palette assertion fails, adjust the boundary in `HUE_RANGES` — the sample colours are the source of truth, not the ranges.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/catalog.ts packages/ui/src/fx/ui/catalog.test.ts
git commit -m "feat(fx): hue bucketing for the def catalog"
```

---

### Task 3: Derive shape, colour and motion for one def

**Files:**
- Modify: `packages/ui/src/fx/ui/catalog.ts`
- Test: `packages/ui/src/fx/ui/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/src/fx/ui/catalog.test.ts`:

```ts
import { deriveFacets } from './catalog';
import type { StoredFxDef } from '../defStore';

const def = (layers: StoredFxDef['layers']): StoredFxDef => ({ version: 1, id: 'd', duration: 900, layers });
const layer = (primitive: string, over: Partial<StoredFxDef['layers'][number]> = {}) =>
  ({ primitive, anchor: 'source' as const, at: 0, params: {}, ...over });

describe('deriveFacets', () => {
  it('labels the shape from the primitives, in layer order, using the human names', () => {
    const f = deriveFacets(def([layer('shockwave'), layer('burst'), layer('ribbon')]));
    expect(f.shape).toBe('Ring + Burst + Trail');
  });

  it('collapses repeated primitives so three bursts do not read as three things', () => {
    expect(deriveFacets(def([layer('burst'), layer('burst'), layer('burst')])).shape).toBe('Burst');
  });

  it('takes the SECOND palette stop, not the first or last', () => {
    // stop 1 near-black rim, stop 2 the identifying red, stop 4 white.
    const f = deriveFacets(def([layer('burst', { params: { palette: [0x0a0a0a, 0xd41f1f, 0xff8a5c, 0xffffff] } })]));
    expect(f.hue).toBe('red');
  });

  it('uses the most common bucket across layers, ties going to the first layer', () => {
    const f = deriveFacets(def([
      layer('burst', { params: { palette: [0, 0x2f8bff, 0, 0] } }),
      layer('burst', { params: { palette: [0, 0xd41f1f, 0, 0] } }),
      layer('burst', { params: { palette: [0, 0xd41f1f, 0, 0] } }),
    ]));
    expect(f.hue).toBe('red');

    const tied = deriveFacets(def([
      layer('burst', { params: { palette: [0, 0x2f8bff, 0, 0] } }),
      layer('burst', { params: { palette: [0, 0xd41f1f, 0, 0] } }),
    ]));
    expect(tied.hue).toBe('blue');
  });

  it('is neutral when no layer carries a palette at all', () => {
    expect(deriveFacets(def([layer('burst')])).hue).toBe('neutral');
  });

  it('reports motion from the travel anchor', () => {
    expect(deriveFacets(def([layer('burst', { anchor: 'target' })])).motion).toBe('in place');
    expect(deriveFacets(def([layer('burst'), layer('ribbon', { anchor: 'travel' })])).motion).toBe('travels');
  });

  it('survives an empty layer list', () => {
    const f = deriveFacets(def([]));
    expect(f.shape).toBe('');
    expect(f.hue).toBe('neutral');
    expect(f.motion).toBe('in place');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/ui/src/fx/ui/catalog.test.ts`
Expected: FAIL — `deriveFacets` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `packages/ui/src/fx/ui/catalog.ts`:

```ts
import type { StoredFxDef } from '../defStore';
import { primitiveLabel } from './copy';

export type FxMotion = 'travels' | 'in place';

export interface FxFacets {
  /** Human primitive names in layer order, de-duplicated: `Ring + Burst + Trail`. */
  shape: string;
  hue: FxHue;
  motion: FxMotion;
}

/** Which palette stop identifies a def's colour. Stop 1 is a near-black rim and stop 4 is `#ffffff` in
 *  nearly every shipped palette — only stop 2 carries a hue anyone would name. */
const IDENTIFYING_STOP = 1;

/**
 * Everything about a def that can be worked out from the def itself. No authoring, so it is always correct
 * and never needs back-filling for the defs that already exist.
 */
export function deriveFacets(def: StoredFxDef): FxFacets {
  const seen: string[] = [];
  for (const l of def.layers) if (!seen.includes(l.primitive)) seen.push(l.primitive);
  const shape = seen.map(primitiveLabel).join(' + ');

  // Count buckets in layer order so the FIRST layer wins a tie simply by being counted first.
  const counts = new Map<FxHue, number>();
  let best: FxHue | null = null;
  for (const l of def.layers) {
    const palette = l.params.palette;
    if (!Array.isArray(palette)) continue;
    const stop = palette[IDENTIFYING_STOP];
    if (typeof stop !== 'number') continue;
    const bucket = hueBucketOf(stop);
    if (bucket === 'neutral') continue;
    const n = (counts.get(bucket) ?? 0) + 1;
    counts.set(bucket, n);
    if (best === null || n > (counts.get(best) ?? 0)) best = bucket;
  }

  return {
    shape,
    hue: best ?? 'neutral',
    motion: def.layers.some((l) => l.anchor === 'travel') ? 'travels' : 'in place',
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/ui/src/fx/ui/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/catalog.ts packages/ui/src/fx/ui/catalog.test.ts
git commit -m "feat(fx): derive shape, colour and motion from a def"
```

---

### Task 4: Roll up the bindings

**Files:**
- Modify: `packages/ui/src/fx/ui/catalog.ts`
- Test: `packages/ui/src/fx/ui/catalog.test.ts`

Reads `getScore()` from `../../choreo/score` (returns `Record<MomentKind, Cue[]>`, live overrides applied) and `CARD_FX` from `../../choreo/cardFx`.

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/src/fx/ui/catalog.test.ts`:

```ts
import { bindingsByDef, kindCoverage } from './catalog';
import { getScore } from '../../choreo/score';
import { CARD_FX } from '../../choreo/cardFx';

describe('bindingsByDef', () => {
  const index = bindingsByDef();

  it('maps a def id to the moment kinds whose cue names it', () => {
    expect(index.get('ward-gained')?.kinds).toContain('shieldGain');
  });

  it('maps a def id to the cards that override to it, with their tribes', () => {
    const ruby = index.get('ruby-lance');
    expect(ruby?.cards.map((c) => c.cardId)).toContain('bloodbinder');
    expect(ruby?.cards.find((c) => c.cardId === 'bloodbinder')?.tribe).toBe('demon');
  });

  it('has no entry for a def nothing binds to', () => {
    expect(index.get('blue-glow-trail')).toBeUndefined();
  });
});

describe('kindCoverage', () => {
  const coverage = kindCoverage();

  it('lists EVERY moment kind, bound or not', () => {
    expect(coverage.length).toBe(Object.keys(getScore()).length);
  });

  it('names the def for a bound kind', () => {
    expect(coverage.find((c) => c.kind === 'shieldGain')?.def).toBe('ward-gained');
  });

  // Gaps are the entire point of the coverage lens.
  it('reports null for a kind with no authored def', () => {
    const gap = coverage.find((c) => c.kind === 'summon');
    expect(gap).toBeDefined();
    expect(gap?.def).toBeNull();
  });
});

/**
 * THE guard. A binding naming a def that does not exist is a silent no-op at runtime (`playDef` returns
 * null and nothing plays), indistinguishable from a binding that was never wired — which is exactly the
 * ambiguity that cost a long debugging session on Bloodbinder.
 */
describe('binding integrity', () => {
  it('every bound def id exists in the registry', async () => {
    await import('../primitives');
    const { listDefs } = await import('../fxDefs');
    const known = new Set(listDefs().map((d) => d.id));
    const missing: string[] = [];
    for (const cues of Object.values(getScore())) {
      for (const c of cues) if (c.ch === 'fxDef' && c.def && !known.has(c.def)) missing.push(c.def);
    }
    for (const [cardId, byKind] of Object.entries(CARD_FX)) {
      for (const b of Object.values(byKind)) if (b && !known.has(b.def)) missing.push(`${cardId}:${b.def}`);
    }
    expect(missing, `bindings naming defs that do not exist: ${missing.join(', ')}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/ui/src/fx/ui/catalog.test.ts`
Expected: FAIL — `bindingsByDef` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `packages/ui/src/fx/ui/catalog.ts`:

```ts
import { CARD_INDEX } from '@game/content';
import { CARD_FX } from '../../choreo/cardFx';
import { getScore } from '../../choreo/score';
import type { MomentKind } from '../../choreo/kinds';

export interface FxBindingCard {
  cardId: string;
  /** The card's display name, or the raw id when the card is unknown (see `missing` below). */
  name: string;
  tribe: string;
  /** True when `CARD_FX` names a card that is not in `CARD_INDEX` — surfaced rather than skipped. */
  missing: boolean;
}

export interface FxBindings {
  kinds: MomentKind[];
  cards: FxBindingCard[];
}

/**
 * def id → what binds to it. Reads `getScore()` (the LIVE score, with any choreo-panel overrides applied)
 * rather than `SCORE_DEFAULTS`, so the browser shows what would actually play right now.
 */
export function bindingsByDef(): Map<string, FxBindings> {
  const out = new Map<string, FxBindings>();
  const entry = (id: string): FxBindings => {
    const found = out.get(id) ?? { kinds: [], cards: [] };
    out.set(id, found);
    return found;
  };

  for (const [kind, cues] of Object.entries(getScore()) as [MomentKind, { ch: string; def?: string }[]][]) {
    for (const cue of cues) if (cue.ch === 'fxDef' && cue.def) entry(cue.def).kinds.push(kind);
  }
  for (const [cardId, byKind] of Object.entries(CARD_FX)) {
    const card = CARD_INDEX[cardId];
    for (const binding of Object.values(byKind)) {
      if (!binding) continue;
      entry(binding.def).cards.push({
        cardId,
        name: card?.name ?? cardId,
        tribe: card?.tribe ?? 'unknown',
        missing: card === undefined,
      });
    }
  }
  return out;
}

export interface FxKindCoverage {
  kind: MomentKind;
  /** The def bound to this kind, or null when nothing is — the gap the coverage lens exists to show. */
  def: string | null;
}

/** Every moment kind with its bound def or null, in the score's own order. */
export function kindCoverage(): FxKindCoverage[] {
  return (Object.entries(getScore()) as [MomentKind, { ch: string; def?: string }[]][]).map(([kind, cues]) => ({
    kind,
    def: cues.find((c) => c.ch === 'fxDef' && c.def)?.def ?? null,
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/ui/src/fx/ui/catalog.test.ts`
Expected: PASS. If the `summon` gap assertion fails, a def has since been bound to `summon` — pick another kind from `kindCoverage()` that is still `null` and update the test.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/catalog.ts packages/ui/src/fx/ui/catalog.test.ts
git commit -m "feat(fx): roll up bindings per def, plus a guard that every binding resolves"
```

---

### Task 5: Assemble the catalog

**Files:**
- Modify: `packages/ui/src/fx/ui/catalog.ts`
- Test: `packages/ui/src/fx/ui/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/src/fx/ui/catalog.test.ts`:

```ts
import { buildCatalog } from './catalog';

describe('buildCatalog', () => {
  it('returns one entry per registered def, exactly once', async () => {
    await import('../primitives');
    const { listDefs } = await import('../fxDefs');
    const catalog = buildCatalog();
    expect(catalog.length).toBe(listDefs().length);
    expect(new Set(catalog.map((e) => e.def.id)).size).toBe(catalog.length);
  });

  it('carries the derived facets and the bindings on each entry', async () => {
    await import('../primitives');
    const entry = buildCatalog().find((e) => e.def.id === 'ward-gained');
    expect(entry?.facets.shape).toBeTruthy();
    expect(entry?.bindings.kinds).toContain('shieldGain');
  });

  it('gives an unbound def empty bindings rather than undefined', async () => {
    await import('../primitives');
    const entry = buildCatalog().find((e) => e.def.id === 'blue-glow-trail');
    expect(entry?.bindings).toEqual({ kinds: [], cards: [] });
  });

  it('sorts by id so the list is stable between renders', async () => {
    await import('../primitives');
    const ids = buildCatalog().map((e) => e.def.id);
    expect(ids).toEqual([...ids].sort());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/ui/src/fx/ui/catalog.test.ts`
Expected: FAIL — `buildCatalog` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `packages/ui/src/fx/ui/catalog.ts`:

```ts
import { listDefs } from '../fxDefs';

export interface FxCatalogEntry {
  def: StoredFxDef;
  facets: FxFacets;
  bindings: FxBindings;
}

const NO_BINDINGS: FxBindings = { kinds: [], cards: [] };

/**
 * The whole library, as one array. Every view in the browser reads THIS and nothing else — which is the
 * point: "which def fires on Bloodbinder" is computed once here rather than separately per lens, so the
 * lenses cannot disagree with each other.
 *
 * Not memoised. `listDefs()` is already cached in `fxDefs.ts`, the derivations are a few dozen arithmetic
 * ops over ~20 defs, and the browser rebuilds only when it opens — caching here would mean owning an
 * invalidation story for a save, and that is exactly the bug class the def registry already had.
 */
export function buildCatalog(): FxCatalogEntry[] {
  const bindings = bindingsByDef();
  return listDefs()
    .map((def) => ({ def, facets: deriveFacets(def), bindings: bindings.get(def.id) ?? { ...NO_BINDINGS } }))
    .sort((a, b) => a.def.id.localeCompare(b.def.id));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/ui/src/fx/ui/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: typecheck clean; lint 0 errors (1 pre-existing warning); all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/fx/ui/catalog.ts packages/ui/src/fx/ui/catalog.test.ts
git commit -m "feat(fx): assemble the def catalog"
```

---

### Task 6: Filtering and grouping

**Files:**
- Create: `packages/ui/src/fx/ui/catalogView.ts`
- Test: `packages/ui/src/fx/ui/catalogView.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/fx/ui/catalogView.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, applyFilter, groupByLook, groupByCard, type FxCatalogEntry } from './catalogView';

const entry = (id: string, over: Partial<FxCatalogEntry> = {}): FxCatalogEntry => ({
  def: { version: 1, id, duration: 900, layers: [] },
  facets: { shape: 'Burst', hue: 'red', motion: 'in place' },
  bindings: { kinds: [], cards: [] },
  ...over,
});

describe('applyFilter', () => {
  const all = [
    entry('red-burst'),
    entry('blue-trail', { facets: { shape: 'Trail', hue: 'blue', motion: 'travels' } }),
    entry('bound-one', { bindings: { kinds: ['shieldGain'], cards: [] } }),
  ];

  it('returns everything for the empty filter', () => {
    expect(applyFilter(all, EMPTY_FILTER)).toHaveLength(3);
  });

  it('filters by hue', () => {
    expect(applyFilter(all, { ...EMPTY_FILTER, hues: ['blue'] }).map((e) => e.def.id)).toEqual(['blue-trail']);
  });

  it('filters by motion', () => {
    expect(applyFilter(all, { ...EMPTY_FILTER, motion: 'travels' }).map((e) => e.def.id)).toEqual(['blue-trail']);
  });

  it('filters by bound / unbound', () => {
    expect(applyFilter(all, { ...EMPTY_FILTER, bound: 'bound' }).map((e) => e.def.id)).toEqual(['bound-one']);
    expect(applyFilter(all, { ...EMPTY_FILTER, bound: 'unbound' })).toHaveLength(2);
  });

  it('searches id, label, tags and card name', () => {
    const rich = [
      entry('x', { def: { version: 1, id: 'x', duration: 9, layers: [], label: 'Ember Lance' } }),
      entry('y', { def: { version: 1, id: 'y', duration: 9, layers: [], tags: ['impact'] } }),
      entry('z', { bindings: { kinds: [], cards: [{ cardId: 'bloodbinder', name: 'Bloodbinder', tribe: 'demon', missing: false }] } }),
    ];
    expect(applyFilter(rich, { ...EMPTY_FILTER, search: 'ember' }).map((e) => e.def.id)).toEqual(['x']);
    expect(applyFilter(rich, { ...EMPTY_FILTER, search: 'impact' }).map((e) => e.def.id)).toEqual(['y']);
    expect(applyFilter(rich, { ...EMPTY_FILTER, search: 'blood' }).map((e) => e.def.id)).toEqual(['z']);
  });

  it('search is case-insensitive and ignores surrounding whitespace', () => {
    const one = [entry('x', { def: { version: 1, id: 'x', duration: 9, layers: [], label: 'Ember Lance' } })];
    expect(applyFilter(one, { ...EMPTY_FILTER, search: '  EMBER ' })).toHaveLength(1);
  });

  it('combines filters as AND', () => {
    expect(applyFilter(all, { ...EMPTY_FILTER, hues: ['blue'], motion: 'in place' })).toEqual([]);
  });
});

describe('groupByLook', () => {
  it('groups on shape then colour, and keeps groups sorted', () => {
    const groups = groupByLook([
      entry('b', { facets: { shape: 'Trail', hue: 'blue', motion: 'travels' } }),
      entry('a'),
      entry('c'),
    ]);
    expect(groups.map((g) => g.title)).toEqual(['Burst', 'Trail']);
    expect(groups[0].entries.map((e) => e.def.id)).toEqual(['a', 'c']);
  });
});

describe('groupByCard', () => {
  const cards = [
    { cardId: 'bloodbinder', name: 'Bloodbinder', tribe: 'demon', defId: 'ruby-lance' },
    { cardId: 'imp', name: 'Imp', tribe: 'demon', defId: null },
    { cardId: 'wolf', name: 'Wolf', tribe: 'beast', defId: null },
  ];

  it('groups by tribe, sorted, with cards sorted inside', () => {
    const groups = groupByCard(cards);
    expect(groups.map((g) => g.title)).toEqual(['beast', 'demon']);
    expect(groups[1].cards.map((c) => c.name)).toEqual(['Bloodbinder', 'Imp']);
  });

  // A tribe with no bespoke effects anywhere is the signal this lens exists to give.
  it('keeps a tribe whose cards all use defaults', () => {
    expect(groupByCard(cards).find((g) => g.title === 'beast')?.cards).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/ui/src/fx/ui/catalogView.test.ts`
Expected: FAIL — cannot resolve `./catalogView`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/fx/ui/catalogView.ts`:

```ts
import type { FxCatalogEntry } from './catalog';
import type { FxHue, FxMotion } from './catalog';

export type { FxCatalogEntry };

export interface FxFilter {
  search: string;
  hues: FxHue[];
  shapes: string[];
  motion: FxMotion | null;
  bound: 'all' | 'bound' | 'unbound';
}

export const EMPTY_FILTER: FxFilter = { search: '', hues: [], shapes: [], motion: null, bound: 'all' };

/** Everything one entry can be matched against by the search box, lower-cased once per call. */
function searchableText(e: FxCatalogEntry): string {
  return [
    e.def.id,
    e.def.label ?? '',
    ...(e.def.tags ?? []),
    e.facets.shape,
    e.facets.hue,
    ...e.bindings.kinds,
    ...e.bindings.cards.map((c) => c.name),
  ]
    .join(' ')
    .toLowerCase();
}

const isBound = (e: FxCatalogEntry): boolean => e.bindings.kinds.length > 0 || e.bindings.cards.length > 0;

/** Filters combine as AND; an empty facet list means "no constraint", not "match nothing". */
export function applyFilter(entries: FxCatalogEntry[], filter: FxFilter): FxCatalogEntry[] {
  const needle = filter.search.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter.hues.length > 0 && !filter.hues.includes(e.facets.hue)) return false;
    if (filter.shapes.length > 0 && !filter.shapes.includes(e.facets.shape)) return false;
    if (filter.motion !== null && e.facets.motion !== filter.motion) return false;
    if (filter.bound === 'bound' && !isBound(e)) return false;
    if (filter.bound === 'unbound' && isBound(e)) return false;
    if (needle !== '' && !searchableText(e).includes(needle)) return false;
    return true;
  });
}

export interface FxLookGroup {
  title: string;
  entries: FxCatalogEntry[];
}

/** Grouped by shape, then colour within each shape. Both sorts are alphabetical so the list does not
 *  reorder itself between renders — a library that shuffles is unusable for finding things twice. */
export function groupByLook(entries: FxCatalogEntry[]): FxLookGroup[] {
  const byShape = new Map<string, FxCatalogEntry[]>();
  for (const e of entries) {
    const key = e.facets.shape === '' ? '(empty)' : e.facets.shape;
    byShape.set(key, [...(byShape.get(key) ?? []), e]);
  }
  return [...byShape.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, list]) => ({
      title,
      entries: [...list].sort((a, b) => a.facets.hue.localeCompare(b.facets.hue) || a.def.id.localeCompare(b.def.id)),
    }));
}

export interface FxCardRow {
  cardId: string;
  name: string;
  tribe: string;
  /** The def explicitly bound to this card, or null = "uses whatever its moment kinds give it". */
  defId: string | null;
}

export interface FxTribeGroup {
  title: string;
  cards: FxCardRow[];
}

/** Grouped by tribe, then card name. Cards with NO bespoke effect are kept: a tribe that is entirely bare
 *  is the most useful thing this lens can tell you, and hiding unbound cards would hide it. */
export function groupByCard(cards: FxCardRow[]): FxTribeGroup[] {
  const byTribe = new Map<string, FxCardRow[]>();
  for (const c of cards) byTribe.set(c.tribe, [...(byTribe.get(c.tribe) ?? []), c]);
  return [...byTribe.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, list]) => ({ title, cards: [...list].sort((a, b) => a.name.localeCompare(b.name)) }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/ui/src/fx/ui/catalogView.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/catalogView.ts packages/ui/src/fx/ui/catalogView.test.ts
git commit -m "feat(fx): filtering and grouping over the def catalog"
```

---

### Task 7: Build the card rows

**Files:**
- Modify: `packages/ui/src/fx/ui/catalog.ts`
- Test: `packages/ui/src/fx/ui/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/src/fx/ui/catalog.test.ts`:

```ts
import { buildCardRows } from './catalog';
import { CARD_INDEX } from '@game/content';

describe('buildCardRows', () => {
  const rows = buildCardRows();

  // EVERY card, not just the bound ones: seeing which tribes are bare is the point of the card lens, and
  // that is invisible if unbound cards are hidden.
  it('returns one row per card in CARD_INDEX', () => {
    expect(rows.length).toBe(Object.keys(CARD_INDEX).length);
  });

  it('names the explicit override for a card that has one', () => {
    expect(rows.find((r) => r.cardId === 'bloodbinder')?.defId).toBe('ruby-lance');
  });

  it('reports null for a card with no bespoke effect', () => {
    const plain = rows.find((r) => r.cardId !== 'bloodbinder' && r.defId === null);
    expect(plain).toBeDefined();
  });

  it('carries the tribe through for grouping', () => {
    expect(rows.find((r) => r.cardId === 'bloodbinder')?.tribe).toBe('demon');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/ui/src/fx/ui/catalog.test.ts`
Expected: FAIL — `buildCardRows` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `packages/ui/src/fx/ui/catalog.ts`:

```ts
import type { FxCardRow } from './catalogView';

/**
 * One row per card in the game, with its explicit per-card effect or null.
 *
 * DELIBERATELY not limited to cards that have an override. This lens answers "which cards have bespoke
 * effects, and which tribes are bare" — and the bare half of that is invisible if unbound cards are dropped.
 *
 * `defId` is only ever an EXPLICIT override. It does not attempt to work out which moment kinds a card can
 * produce: that is a static analysis of effect data which cannot be exact, because many moments only exist
 * at runtime. A null here means "uses whatever its moments give it", not "shows nothing".
 */
export function buildCardRows(): FxCardRow[] {
  return Object.values(CARD_INDEX).map((card) => {
    const byKind = CARD_FX[card.id];
    const first = byKind ? Object.values(byKind).find((b) => b !== undefined) : undefined;
    return { cardId: card.id, name: card.name, tribe: card.tribe, defId: first?.def ?? null };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/ui/src/fx/ui/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/catalog.ts packages/ui/src/fx/ui/catalog.test.ts
git commit -m "feat(fx): card rows for the library's by-card lens"
```

---

### Task 8: The browse overlay

**Files:**
- Create: `packages/ui/src/fx/ui/LibraryBrowser.tsx`
- Modify: `packages/ui/src/fx/ui/Workbench.tsx`
- Modify: `packages/ui/src/styles.css`

No test: the component is a thin renderer over Task 5–7's tested functions, matching how `Inspector.tsx` and `Timeline.tsx` are handled (neither has a component test).

- [ ] **Step 1: Create the overlay**

Create `packages/ui/src/fx/ui/LibraryBrowser.tsx`:

```tsx
import { useMemo, useState } from 'react';
import type { StoredFxDef } from '../defStore';
import { buildCatalog, buildCardRows, kindCoverage, FX_HUES, type FxHue } from './catalog';
import { EMPTY_FILTER, applyFilter, groupByLook, groupByCard, type FxFilter } from './catalogView';

export interface LibraryBrowserProps {
  onLoad: (def: StoredFxDef) => void;
  onDuplicate: (def: StoredFxDef) => void;
  /** Play `id` in the preview stage; called on hover after the caller's own debounce. */
  onPreview: (id: string | null) => void;
  onClose: () => void;
}

type Lens = 'look' | 'event' | 'card';

/** Hover settle before a preview fires. Without it, dragging down a 20-row list starts 20 effects. */
const PREVIEW_DELAY_MS = 120;

export function LibraryBrowser({ onLoad, onDuplicate, onPreview, onClose }: LibraryBrowserProps): React.ReactElement {
  const [lens, setLens] = useState<Lens>('look');
  const [filter, setFilter] = useState<FxFilter>(EMPTY_FILTER);
  // Built once per open: the catalog is derived from module-level registries that cannot change while the
  // overlay is up, and rebuilding per keystroke would re-derive every facet for every def on every filter edit.
  const catalog = useMemo(() => buildCatalog(), []);
  const coverage = useMemo(() => kindCoverage(), []);
  const cardRows = useMemo(() => buildCardRows(), []);
  const shown = useMemo(() => applyFilter(catalog, filter), [catalog, filter]);
  const knownIds = useMemo(() => new Set(catalog.map((e) => e.def.id)), [catalog]);

  const [hoverTimer, setHoverTimer] = useState<number | null>(null);
  const hover = (id: string | null): void => {
    if (hoverTimer !== null) window.clearTimeout(hoverTimer);
    if (id === null) { onPreview(null); setHoverTimer(null); return; }
    setHoverTimer(window.setTimeout(() => onPreview(id), PREVIEW_DELAY_MS));
  };

  const load = (def: StoredFxDef): void => { hover(null); onLoad(def); onClose(); };

  const set = <K extends keyof FxFilter>(key: K, value: FxFilter[K]): void =>
    setFilter((f) => ({ ...f, [key]: value }));

  const toggleHue = (h: FxHue): void =>
    set('hues', filter.hues.includes(h) ? filter.hues.filter((x) => x !== h) : [...filter.hues, h]);

  return (
    <div className="fxlib">
      <div className="fxlib-top">
        <span className="fxlib-title">FX Library</span>
        {(['look', 'event', 'card'] as Lens[]).map((l) => (
          <button key={l} className={`fxwb-btn${lens === l ? ' on' : ''}`} onClick={() => setLens(l)}>
            {l === 'look' ? 'By look' : l === 'event' ? 'By event' : 'By card'}
          </button>
        ))}
        <input
          className="fxlib-search"
          placeholder="Search name, tag, card…"
          value={filter.search}
          onChange={(e) => set('search', e.target.value)}
        />
        <button className="fxwb-btn" onClick={onClose}>Close</button>
      </div>

      <div className="fxlib-body">
        <div className="fxlib-facets">
          <div className="fxlib-facet-title">Colour</div>
          <div className="fxlib-hues">
            {FX_HUES.map((h) => (
              <button
                key={h}
                className={`fxlib-hue ${h}${filter.hues.includes(h) ? ' on' : ''}`}
                title={h}
                onClick={() => toggleHue(h)}
              />
            ))}
          </div>
          <div className="fxlib-facet-title">Motion</div>
          {(['travels', 'in place'] as const).map((m) => (
            <button
              key={m}
              className={`fxwb-btn${filter.motion === m ? ' on' : ''}`}
              onClick={() => set('motion', filter.motion === m ? null : m)}
            >
              {m}
            </button>
          ))}
          <div className="fxlib-facet-title">Wiring</div>
          {(['all', 'bound', 'unbound'] as const).map((b) => (
            <button key={b} className={`fxwb-btn${filter.bound === b ? ' on' : ''}`} onClick={() => set('bound', b)}>
              {b}
            </button>
          ))}
        </div>

        <div className="fxlib-results">
          {lens === 'look' && groupByLook(shown).map((g) => (
            <div className="fxlib-group" key={g.title}>
              <div className="fxlib-group-title">{g.title}</div>
              {g.entries.map((e) => (
                <div
                  className="fxlib-row"
                  key={e.def.id}
                  onPointerEnter={() => hover(e.def.id)}
                  onPointerLeave={() => hover(null)}
                >
                  <span className={`fxlib-swatch ${e.facets.hue}`} />
                  <button className="fxlib-row-load" onClick={() => load(e.def)}>
                    <span className="fxlib-row-name">{e.def.label ?? e.def.id}</span>
                    <span className="fxlib-row-meta">
                      {e.facets.shape} · {e.facets.motion} · {e.def.layers.length} layers · {e.def.duration}ms
                      {e.bindings.kinds.length + e.bindings.cards.length === 0 ? ' · unbound' : ''}
                    </span>
                  </button>
                  <button title="Duplicate as a fresh template" onClick={() => onDuplicate(e.def)}>⧉</button>
                </div>
              ))}
            </div>
          ))}

          {lens === 'event' && (
            <div className="fxlib-group">
              {coverage.map((c) => (
                <div className="fxlib-row" key={c.kind} onPointerEnter={() => hover(c.def)} onPointerLeave={() => hover(null)}>
                  <span className="fxlib-row-name">{c.kind}</span>
                  {c.def === null ? (
                    <span className="fxlib-gap">nothing bound</span>
                  ) : knownIds.has(c.def) ? (
                    <span className="fxlib-row-meta">{c.def}</span>
                  ) : (
                    // A binding naming a def that does not exist is a silent no-op at runtime. Saying so here
                    // is the whole reason this lens is worth building.
                    <span className="fxlib-missing">bound to {c.def} — missing</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {lens === 'card' && groupByCard(cardRows).map((g) => (
            <div className="fxlib-group" key={g.title}>
              <div className="fxlib-group-title">{g.title}</div>
              {g.cards.map((c) => (
                <div className="fxlib-row" key={c.cardId} onPointerEnter={() => hover(c.defId)} onPointerLeave={() => hover(null)}>
                  <span className="fxlib-row-name">{c.name}</span>
                  {c.defId === null ? (
                    <span className="fxlib-row-meta">uses defaults</span>
                  ) : knownIds.has(c.defId) ? (
                    <span className="fxlib-row-meta">{c.defId}</span>
                  ) : (
                    <span className="fxlib-missing">{c.defId} — missing</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the workbench**

In `packages/ui/src/fx/ui/Workbench.tsx`:

Add the import beside the other `./` imports:

```tsx
import { LibraryBrowser } from './LibraryBrowser';
```

Add state beside the other `useState` calls near `const [defs, setDefs] = useState<StoredFxDef[]>(() => listDefs());`:

```tsx
  const [browsing, setBrowsing] = useState(false);
```

Render the overlay as the LAST child of the root `<div className="fxwb">`, immediately before its closing tag:

```tsx
      {browsing && (
        <LibraryBrowser
          onLoad={loadDef}
          onDuplicate={duplicateDef}
          // Preview reuses the workbench's own player: the overlay names a def, the editor plays it on the
          // stage already running behind it. No second Pixi context, and the preview is the real thing.
          onPreview={(id) => {
            const found = id === null ? undefined : defs.find((d) => d.id === id);
            if (found) loadDef(found);
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
```

Add the open button inside the `Start from` header area, next to the existing library heading:

```tsx
          <button className="fxwb-btn" onClick={() => setBrowsing(true)}>Browse all</button>
```

**If `loadDef` / `duplicateDef` are named differently in this file**, use the handlers already passed to `<DefLibrary onLoad={…} onDuplicate={…} />` — find that JSX and reuse the exact same two functions.

- [ ] **Step 3: Add the styles**

Append to `packages/ui/src/styles.css`:

```css
/* FX LIBRARY BROWSER — a full-screen overlay above the workbench. Deliberately opaque: the workbench rail
   underneath is a competing wall of controls, and browsing wants a quiet surface. */
.fxlib {
  position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column;
  background: #17141f; color: #d9d3ea; font-family: var(--font-ui);
}
.fxlib-top {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  background: #211d2c; border-bottom: 2px solid #3d3752;
}
.fxlib-title { font-size: 13px; font-weight: 800; letter-spacing: 0.04em; margin-right: 6px; }
.fxlib-search {
  flex: 1; min-width: 0; height: 28px; padding: 0 10px; border-radius: 7px;
  border: 1px solid #3d3752; background: #17141f; color: #d9d3ea; font-size: 12px;
}
.fxlib-body { flex: 1; display: flex; min-height: 0; }
.fxlib-facets {
  width: 190px; flex: none; padding: 12px; border-right: 2px solid #3d3752;
  display: flex; flex-direction: column; gap: 6px; overflow-y: auto;
}
.fxlib-facet-title {
  font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em;
  color: #8a7fa8; margin-top: 8px;
}
.fxlib-hues { display: flex; flex-wrap: wrap; gap: 5px; }
.fxlib-hue { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.fxlib-hue.on { border-color: #fff; }
.fxlib-hue.red { background: #d41f1f; } .fxlib-hue.orange { background: #ff9c1e; }
.fxlib-hue.gold { background: #ffb81f; } .fxlib-hue.green { background: #7ade22; }
.fxlib-hue.cyan { background: #2ee0ac; } .fxlib-hue.blue { background: #2f8bff; }
.fxlib-hue.violet { background: #c936ef; } .fxlib-hue.magenta { background: #ff33a8; }
.fxlib-hue.neutral { background: #8a7fa8; }
.fxlib-results { flex: 1; overflow-y: auto; padding: 12px 16px; }
.fxlib-group { margin-bottom: 16px; }
.fxlib-group-title {
  font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em;
  color: #8a7fa8; border-bottom: 1px solid #3d3752; padding-bottom: 4px; margin-bottom: 6px;
}
.fxlib-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
.fxlib-row:hover { background: #211d2c; }
.fxlib-swatch { width: 12px; height: 12px; border-radius: 50%; flex: none; }
.fxlib-swatch.red { background: #d41f1f; } .fxlib-swatch.orange { background: #ff9c1e; }
.fxlib-swatch.gold { background: #ffb81f; } .fxlib-swatch.green { background: #7ade22; }
.fxlib-swatch.cyan { background: #2ee0ac; } .fxlib-swatch.blue { background: #2f8bff; }
.fxlib-swatch.violet { background: #c936ef; } .fxlib-swatch.magenta { background: #ff33a8; }
.fxlib-swatch.neutral { background: #8a7fa8; }
.fxlib-row-load {
  flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  background: none; border: none; color: inherit; text-align: left; cursor: pointer; padding: 2px 4px;
}
.fxlib-row-name { font-size: 12px; font-weight: 700; }
.fxlib-row-meta { font-size: 11px; color: #8a7fa8; }
.fxlib-gap { font-size: 11px; color: #6f6688; font-style: italic; }
/* A binding pointing at a def that does not exist plays NOTHING at runtime, silently. It must look wrong. */
.fxlib-missing { font-size: 11px; font-weight: 700; color: #ff6b6b; }
```

- [ ] **Step 4: Verify it compiles and builds**

Run: `npm run typecheck && npm run build:web`
Expected: both clean.

- [ ] **Step 5: Verify in the browser**

Ensure a dev server is serving THIS worktree on 5190 (check the process command line contains `fx-workbench-p1`, not just that the port answers):

```bash
cd apps/web && npx vite --port 5190 --strictPort
```

Open `http://localhost:5190/` → Dev Menu → 🎨 FX Workbench → **Browse all**. Confirm:
1. All three lenses render.
2. A colour swatch filters the list.
3. Hovering a row plays that effect on the stage.
4. Clicking a row loads it and closes the overlay.
5. **By event** shows at least one `nothing bound` gap.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/fx/ui/LibraryBrowser.tsx packages/ui/src/fx/ui/Workbench.tsx packages/ui/src/styles.css
git commit -m "feat(fx/ui): the FX library browse overlay, three lenses over one catalog"
```

---

### Task 9: Full gate and docs

**Files:**
- Modify: `docs/devlog.md`, `docs/roadmap.md`, `README.md`

- [ ] **Step 1: Run the authoritative gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: typecheck clean; lint **0 errors** (1 pre-existing `SceneBuilder` warning); all tests pass; build succeeds. Record the exact test count for the devlog entry.

- [ ] **Step 2: Write the devlog entry**

Prepend a dated entry to `docs/devlog.md` covering: the flat list replaced by a derived catalog; that facets are derived rather than authored so nothing needed back-filling; the two guards (every def appears once; **every binding resolves to a def that exists**) and why the second matters — a binding naming a missing def is a silent no-op at runtime, indistinguishable from one never wired; the By-card lens's known limitation (explicit overrides only); and the exact verification numbers from Step 1.

Use the `Edit` tool, not a shell heredoc — backticks in a devlog entry get command-substituted by bash and silently eat every code term.

- [ ] **Step 3: Update the roadmap**

In `docs/roadmap.md`, move the FX-library work out of the forward queue and add **phase C** under Next: bindings as JSON the dev plugin can write, enabling bind / unbind / "fork for this card" from the browser. Note that phase A's catalog is its input.

- [ ] **Step 4: Update the README**

Add one line to **Recent changes** naming the FX library browser.

- [ ] **Step 5: Commit**

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: FX library browser (phase A)"
git push origin HEAD
```

---

## Self-review

**Spec coverage:** catalog module → Tasks 2–5, 7. Derived shape/colour/motion → Tasks 2–3. Bindings roll-up + inverse index → Task 4. Authored `label`/`tags` incl. `coerceDef` and the `defs.test.ts` note → Task 1. Overlay, three lenses, facets, search, hover-to-play, click-loads-and-closes → Task 8. Missing-binding surfacing → Task 4 (guard) + Task 8 (`.fxlib-missing`). By-card completeness limitation → Task 7 docblock. Both testing guards → Tasks 4 and 5. Out-of-scope items appear in no task, as intended.

**Deviation from the spec, deliberate:** the spec described a preview stage *inside* the overlay with its own player. Task 8 instead has the overlay call back into the workbench's existing player (`onPreview` → `loadDef`). Same user-visible behaviour, no second Pixi context, and it reuses a load path that already works. Flagged here rather than silently changed.

**Placeholders:** none. Every code step carries complete code; every command carries its expected result. The two conditional steps (Task 1 Step 5, Task 8 Step 2) state exactly how to decide and what to do in each branch.

**Type consistency:** `FxHue`, `FxMotion`, `FxFacets`, `FxBindings`, `FxBindingCard`, `FxCatalogEntry`, `FxKindCoverage`, `FxCardRow`, `FxFilter` are each defined once and used with the same shape thereafter. `buildCatalog`, `buildCardRows`, `kindCoverage`, `bindingsByDef`, `deriveFacets`, `hueBucketOf`, `applyFilter`, `groupByLook`, `groupByCard`, `EMPTY_FILTER`, `FX_HUES` keep their names across tasks. `FxCardRow` is declared in `catalogView.ts` and imported by `catalog.ts` (Task 7) — the one cross-module type, deliberate so the view layer owns its own row shape.
