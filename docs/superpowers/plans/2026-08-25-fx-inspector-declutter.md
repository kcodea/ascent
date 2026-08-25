# FX Inspector Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the FX workbench Properties panel from a wall of ~35 groups to a calm, scannable list — a **Changed** view chip, **collapse-by-default with count badges**, all ~31 filters folded under **one "Filters" master group**, a **modified dot + double-click-to-reset** affordance — all as a pure presentation reorganisation of the existing `FxParamSpec` data.

**Architecture:** The Inspector already has Essentials/All tiers, a search box, collapsible groups (persisted per-primitive), and renders each param via `ParamRow`. This phase ADDS to that: pure helpers in `params.ts` (changed-set, filter-group partition), then Inspector rendering that consumes them. No `FxParamSpec` data changes; no runtime/engine change. The filter params already exist in every primitive's specs (each primitive spreads `...filterLabSpecs(FILTERS)`, grouping each filter's params under `group: <filter label>`); "Filters master group" is a rendering reorganisation of those existing groups.

**Tech Stack:** React 18 + TypeScript, the existing `fx/params.ts` derivation helpers (`defaultsOf`, `coerceParams`, `visibleParamKeys`, `groupParamKeys`, `matchesParamQuery`, `isParamEnabled`), the `FILTERS` registry in `fx/filterRegistry.ts`, Vitest, ESLint, Vite build.

## Global Constraints

- **Presentation only.** No change to `FxParamSpec` shape, param KINDS, `player.ts`, or any primitive's spec data. The Inspector still calls the SAME `onChange(key, value)` it does today; a reset is just `onChange(key, defaultValue)`.
- **Do NOT change the Inspector's public props contract** (`Inspector({ specs, values, onChange, primitiveId, layerKey, focusKey?, onFocusHandled? })`) except additively. Its consumers (`Workbench.tsx` and the def-ease `CurveEditor` reuse) must keep working unchanged.
- **Filter identity comes from the `FILTERS` registry** (`fx/filterRegistry.ts`) — the set of filter group labels is `FILTERS.map(f => f.label)`. Do NOT hardcode a filter list or a count; derive both. The filter param keys follow `<id>On` / `<id>Amt` / `<id>Curve` / `<id>_<knob>` (helpers `onKey`/`amtKey`/`curveKey`/`knobKey` in `filterStack.ts`) — but you identify a filter GROUP by its label matching a registry label, which is simpler and already what `filterLabSpecs` sets as `group`.
- **Custom cursor rule (CLAUDE.md):** no bare `cursor: pointer`/keyword cursor on interactive elements — use the global gauntlet `button` rule or `cursor: url('/cursors/gauntlet_open.svg') 6 2, pointer`.
- **Performance:** no looping paint-property animations; a one-shot pop (like the existing `cardbuff`) is fine for a reset flash. Keep `ParamRow` render cost flat — no per-render deep clones of large param arrays beyond the change check.
- **CSS** in `packages/ui/src/styles.css`, reusing the existing `.fxwb-grp*` / `.fxwb-row*` families; add new classes only for the master group + badges + modified dot.
- **Gates before "done":** `npm run typecheck` (pkgs + web), `npm run lint` (0 new errors), `npm test`, `npm run build:web` — all green, reported.
- **Patch notes:** dev-tool UI → NO `patchNotes.ts` entry.

---

## File Structure

- **Modify `packages/ui/src/fx/params.ts`** — add pure helpers: `paramIsChanged`, `changedParamKeys`, and extend `visibleParamKeys`'s options with `changedOnly`.
- **Modify `packages/ui/src/fx/params.test.ts`** (or create if absent — check first) — unit tests for the new helpers.
- **Create `packages/ui/src/fx/ui/filterGroups.ts`** — pure helper partitioning param keys into plain groups vs a filter list (id/label/on/param-keys), driven by the `FILTERS` registry.
- **Create `packages/ui/src/fx/ui/filterGroups.test.ts`** — unit tests.
- **Modify `packages/ui/src/fx/ui/Inspector.tsx`** — the Changed chip, default-collapse + count badges, the Filters master group, the modified dot + double-click reset.
- **Modify `packages/ui/src/styles.css`** — badges, master group, modified dot, reset flash.

---

## Task 1: `params.ts` — changed-set helpers

**Files:**
- Modify: `packages/ui/src/fx/params.ts`
- Test: `packages/ui/src/fx/params.test.ts` (check whether it exists; if not, create it)

**Interfaces:**
- Consumes: existing `defaultsOf(specs)`, `coerceParams(specs, raw)`, `visibleParamKeys(specs, opts)`, `FxParamSpecs`.
- Produces:
  - `function paramIsChanged(spec: FxParamSpec, value: unknown, dflt: unknown): boolean` — true when the (coerced) `value` differs from `dflt`. Scalars compare with `!==`; arrays (palette/curve/gradient/emitpoints/shape payloads) compare by deep structural equality (a small local deep-equal over JSON-serialisable numbers/strings/arrays — do NOT pull a library). `undefined` value → treat as unchanged (equals default by definition after coercion).
  - `function changedParamKeys(specs: FxParamSpecs, values: Record<string, unknown>): Set<string>` — coerce `values` once, take `defaultsOf(specs)` once, return the set of keys whose `paramIsChanged` is true.
  - Extend the existing `visibleParamKeys(specs, opts)` options object with an optional `changedOnly?: boolean` and a `changed?: Set<string>` the caller passes in (so the pure function stays pure — it does NOT recompute the changed set). When `changedOnly` is true, keep only keys in `changed`. This composes with the existing `essentialsOnly`/`query` filters (AND semantics: essentials/changed/query all narrow).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { paramIsChanged, changedParamKeys, visibleParamKeys, type FxParamSpecs } from './params'

const specs: FxParamSpecs = {
  count: { kind: 'slider', label: 'Count', min: 0, max: 10, step: 1, default: 5 },
  pal: { kind: 'palette', label: 'Palette', default: [1, 2, 3, 4] },
  on: { kind: 'toggle', label: 'On', default: false },
} as unknown as FxParamSpecs

describe('paramIsChanged', () => {
  it('scalar differs', () => {
    expect(paramIsChanged(specs.count, 7, 5)).toBe(true)
    expect(paramIsChanged(specs.count, 5, 5)).toBe(false)
  })
  it('array deep-equals', () => {
    expect(paramIsChanged(specs.pal, [1, 2, 3, 4], [1, 2, 3, 4])).toBe(false)
    expect(paramIsChanged(specs.pal, [1, 2, 3, 9], [1, 2, 3, 4])).toBe(true)
  })
  it('undefined is unchanged', () => {
    expect(paramIsChanged(specs.count, undefined, 5)).toBe(false)
  })
})

describe('changedParamKeys', () => {
  it('reports only differing keys', () => {
    const changed = changedParamKeys(specs, { count: 7, pal: [1, 2, 3, 4], on: true })
    expect(changed.has('count')).toBe(true)
    expect(changed.has('pal')).toBe(false)
    expect(changed.has('on')).toBe(true)
  })
})

describe('visibleParamKeys changedOnly', () => {
  it('narrows to the changed set', () => {
    const changed = new Set(['count'])
    const keys = visibleParamKeys(specs, { changedOnly: true, changed })
    expect(keys).toContain('count')
    expect(keys).not.toContain('on')
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/ui && npx vitest run src/fx/params.test.ts`
Expected: FAIL — helpers undefined / option unsupported.

- [ ] **Step 3: Implement** the three additions in `params.ts`. Keep `visibleParamKeys`'s existing behaviour identical when `changedOnly` is absent.

- [ ] **Step 4: Run to verify pass.** Also `npm run typecheck` (root) — clean.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/params.ts packages/ui/src/fx/params.test.ts
git commit -m "feat(fx): changed-from-default param helpers + visibleParamKeys changedOnly"
```

---

## Task 2: `filterGroups` — partition filter params under one master group

**Files:**
- Create: `packages/ui/src/fx/ui/filterGroups.ts`
- Test: `packages/ui/src/fx/ui/filterGroups.test.ts`

**Interfaces:**
- Consumes: `FILTERS` from `../filterRegistry` (each entry has `{ id, label, ... }`); `FxParamSpecs` from `../params`; the on-key convention `${id}On` (import `onKey` if exported from `../filterStack`, else replicate the one-liner `` `${id}On` `` with a comment pointing at `filterStack.ts`).
- Produces:
  - `const FILTER_GROUP_LABELS: ReadonlySet<string>` — `new Set(FILTERS.map(f => f.label))`.
  - `interface FilterEntry { id: string; label: string; onKey: string; on: boolean; paramKeys: string[] }` — one per filter that actually has specs present in the given `specs`, `paramKeys` = every spec key whose `group === label` EXCEPT the `onKey` (the toggle is rendered as the filter's own header row), in the specs' declared order.
  - `function isFilterGroup(group: string | undefined): boolean` — `group != null && FILTER_GROUP_LABELS.has(group)`.
  - `function filterEntries(specs: FxParamSpecs, values: Record<string, unknown>): FilterEntry[]` — for each registry filter present in `specs`, build a `FilterEntry` with `on = values[onKey] === true`. Order: enabled filters first (stable by registry order), then disabled (stable by registry order) — so enabled float to the top.
  - `function filterOnCount(entries: readonly FilterEntry[]): number` — count of `on`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { isFilterGroup, filterEntries, filterOnCount, FILTER_GROUP_LABELS } from './filterGroups'
import type { FxParamSpecs } from '../params'
import { FILTERS } from '../filterRegistry'

// Build a specs object with two known filters' params by cloning what filterLabSpecs emits:
// pick the first two registry filters and synthesise their on/amt keys.
const [f0, f1] = FILTERS
const specs = {
  [`${f0.id}On`]: { kind: 'toggle', label: f0.label, group: f0.label, default: false },
  [`${f0.id}Amt`]: { kind: 'slider', label: 'Amount', group: f0.label, min: 0, max: 1, step: 0.01, default: 0 },
  [`${f1.id}On`]: { kind: 'toggle', label: f1.label, group: f1.label, default: false },
  plainThing: { kind: 'slider', label: 'Plain', group: 'General', min: 0, max: 1, step: 0.1, default: 0 },
} as unknown as FxParamSpecs

describe('isFilterGroup', () => {
  it('recognises a registry filter label', () => {
    expect(isFilterGroup(f0.label)).toBe(true)
    expect(isFilterGroup('General')).toBe(false)
    expect(isFilterGroup(undefined)).toBe(false)
  })
})

describe('filterEntries', () => {
  it('lists filters present in specs with their non-toggle param keys', () => {
    const entries = filterEntries(specs, {})
    const e0 = entries.find((e) => e.id === f0.id)!
    expect(e0.paramKeys).toContain(`${f0.id}Amt`)
    expect(e0.paramKeys).not.toContain(`${f0.id}On`)
  })
  it('floats enabled filters to the top', () => {
    const entries = filterEntries(specs, { [`${f1.id}On`]: true })
    expect(entries[0].id).toBe(f1.id)
    expect(entries[0].on).toBe(true)
  })
})

describe('filterOnCount', () => {
  it('counts enabled', () => {
    expect(filterOnCount(filterEntries(specs, { [`${f0.id}On`]: true }))).toBe(1)
  })
})

describe('FILTER_GROUP_LABELS', () => {
  it('has one label per registry filter', () => {
    expect(FILTER_GROUP_LABELS.size).toBe(new Set(FILTERS.map((f) => f.label)).size)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/ui && npx vitest run src/fx/ui/filterGroups.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `filterGroups.ts`** per the Interfaces block. Pure; no React.

- [ ] **Step 4: Run to verify pass.** `npm run typecheck` (root) — clean.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/filterGroups.ts packages/ui/src/fx/ui/filterGroups.test.ts
git commit -m "feat(fx): filter-group partition model for the Filters master group"
```

---

## Task 3: Inspector — Changed chip + default-collapse + count badges

**Files:**
- Modify: `packages/ui/src/fx/ui/Inspector.tsx`
- Modify: `packages/ui/src/styles.css`

**Interfaces:**
- Consumes: `changedParamKeys`, `visibleParamKeys` (with `changedOnly`/`changed`) from `../params`.

**Behaviour:**
- **Read the current Inspector first.** It has a two-tier switch (`Essentials | All`) via `.fxwb-tier`/`.fxwb-tierbtn`. Add a THIRD chip **`Changed`**. State becomes a 3-way `tier: 'essentials' | 'all' | 'changed'`.
- Compute `changed = changedParamKeys(specs, values)` once per render (memoise on `[specs, values]`).
- `keys = visibleParamKeys(specs, { essentialsOnly: tier === 'essentials', changedOnly: tier === 'changed', changed, query })`. The `changed` tier shows changed params grouped (like All) so the user sees what they've touched.
- **Count badges on group headers:** each `.fxwb-grphead` shows a badge with the number of CHANGED params in that group (`N changed`), and for the Filters case (Task 4) `N on`. Reuse the existing group-count element if present; otherwise add `.fxwb-grpbadge`.
- **Collapse-by-default:** groups start collapsed except the ones `defaultOpenGroups(specs)` already returns (keep that seed). A group with ≥1 changed param opens by default in the `changed` tier. Persisted open-state (localStorage per-primitive) still wins for user toggles. Do NOT regress the existing persistence.

- [ ] **Step 1:** Add the `Changed` tier to the tier switch + state; wire `changedParamKeys` memo + `visibleParamKeys` call. Keep Essentials/All behaving exactly as today.
- [ ] **Step 2:** Add the per-group changed-count badge to `.fxwb-grphead`.
- [ ] **Step 3:** Ensure collapse-by-default holds (seeded by `defaultOpenGroups`), search still force-opens matching groups, and the `changed` tier opens groups that contain changed params.
- [ ] **Step 4: CSS** for `.fxwb-grpbadge` + the third tier button. Cursor rule on the new chip.
- [ ] **Step 5: Gates** — `npm run typecheck`, `npm run lint`, `npm run build:web` green. (No unit test for the .tsx rendering; the logic it uses is unit-tested in Tasks 1–2.)
- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/fx/ui/Inspector.tsx packages/ui/src/styles.css
git commit -m "feat(fx): inspector Changed view + per-group changed-count badges"
```

---

## Task 4: Inspector — the "Filters" master group

**Files:**
- Modify: `packages/ui/src/fx/ui/Inspector.tsx`
- Modify: `packages/ui/src/styles.css`

**Interfaces:**
- Consumes: `filterEntries`, `filterOnCount`, `isFilterGroup` from `./filterGroups`.

**Behaviour:**
- When rendering the grouped view, EXCLUDE every group whose label `isFilterGroup(label)` from the normal group list, and instead render ONE synthetic master group titled **"Filters"** with a badge `"<N> on · <total>"` (`N = filterOnCount`, `total = entries.length`).
- The master group body renders `filterEntries(specs, values)` as a list of filter rows: each row is the filter's **toggle** (its `onKey`, rendered as the header control with the filter label) — enabled entries sorted to the top. When a filter is `on`, its `paramKeys` render inline beneath it (reuse `ParamRow` for Amount / curve / knobs), respecting `isParamEnabled` (they're gated on the toggle, which is on).
- Search: when a query matches a filter's param (via `matchesParamQuery`) or the filter label, that filter expands within the master group regardless of its toggle (so search still finds inside filters). Keep it simple: if `query` non-empty, show matching filter entries expanded.
- The master group participates in collapse-by-default (collapsed unless it has an `on` filter or a search match). Its open-state persists under a stable key (e.g. `"__filters__"`).

- [ ] **Step 1:** Partition: in the grouped-render path, split `groupParamKeys` output into filter groups (dropped) vs plain groups (rendered as today). Read the current grouping code carefully so essentials/all/changed + search all still work for plain groups.
- [ ] **Step 2:** Render the master group + its filter-row list (enabled floated, inline expand). Reuse `ParamRow` for the inner params.
- [ ] **Step 3:** Wire search-expands-matching-filter + collapse-by-default + persisted open-state for the master group.
- [ ] **Step 4: CSS** `.fxwb-filters*` (master group, filter row, inline expand). Cursor rule; no looping paint animation.
- [ ] **Step 5: Gates** green (typecheck/lint/build). 
- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/fx/ui/Inspector.tsx packages/ui/src/styles.css
git commit -m "feat(fx): fold all filters under one Filters master group in the inspector"
```

---

## Task 5: Modified affordance + double-click-reset

**Files:**
- Modify: `packages/ui/src/fx/ui/Inspector.tsx`
- Modify: `packages/ui/src/styles.css`

**Interfaces:**
- Consumes: `paramIsChanged` + `defaultsOf` from `../params`.

**Behaviour:**
- A `ParamRow` whose param is changed (in the `changed` set) shows a **modified dot + accent** on its label (`.fxwb-row.changed` / a `.fxwb-moddot`).
- **Double-click the label resets to default:** `onDoubleClick` on `.fxwb-lab` calls `onChange(key, defaultsOf(specs)[key])`. A brief one-shot flash (reuse a `cardbuff`-style pop, transform/opacity only — profile-safe) confirms the reset. Guard: only when the param is currently changed (no-op on an already-default param).
- Keep it additive — an unchanged row looks exactly as today.

- [ ] **Step 1:** Thread the `changed` set (already computed in Task 3) into `ParamRow`; add the modified dot + `.changed` class.
- [ ] **Step 2:** Add `onDoubleClick` reset on the label → `onChange(key, default)`; the reset flash.
- [ ] **Step 3: CSS** `.fxwb-moddot` + `.fxwb-row.changed` + the reset flash keyframe (one-shot, transform/opacity). Cursor rule.
- [ ] **Step 4: Gates** green.
- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/Inspector.tsx packages/ui/src/styles.css
git commit -m "feat(fx): modified-dot affordance + double-click-to-reset in the inspector"
```

---

## Task 6: Verification + polish

**Files:** as needed (bug-fix only).

- [ ] **Step 1:** Full gate suite green: `npm run typecheck && npm run lint && npm test && npm run build:web`. Report the test count.
- [ ] **Step 2:** Sanity: Essentials/All unchanged from before; Changed shows only touched params; the Filters master group shows "N on · total" and enabled filters float + expand; a group's badge counts changed params; double-click resets a knob and the dot clears. (Owner-verifiable — the coordinator/owner eyeballs; capture a note.)
- [ ] **Step 3: Commit** any fixes.

```bash
git add -A packages/ui/src
git commit -m "fix(fx): inspector declutter polish"
```

---

## Self-Review notes (author)

- **Spec coverage (§8):** search (already existed) + Changed chip (Task 3) + collapsed groups with count badges (Task 3) + Filters master group "N on · 30" with enabled-float + inline expand (Task 4) + modified dot + double-click reset (Task 5) + inline curve editors (already exist via `CurveEditor` in `ParamRow`). All covered.
- **Deferred/none:** the ⌘K "jump" already backs onto `visibleParamKeys` search from Phase 1 — no change needed here.
- **Type consistency:** `changedParamKeys`/`paramIsChanged`/`visibleParamKeys(changedOnly)` defined Task 1, consumed Tasks 3+5. `filterEntries`/`filterOnCount`/`isFilterGroup` defined Task 2, consumed Task 4. The Inspector props contract stays additive.
- **Test honesty:** pure helpers (Tasks 1–2) are unit-tested; the Inspector rendering is owner-verified + gated by typecheck/build (consistent with Phase 1, where the layout was owner-verified and the decision cores were unit-tested).
- **Risk:** Inspector.tsx is 784 lines and self-contained (lower risk than the god component). The one real hazard is regressing the existing group open-state persistence / search — each task explicitly says "keep existing behaviour identical," and the reviewer must verify Essentials/All + search are unchanged.
