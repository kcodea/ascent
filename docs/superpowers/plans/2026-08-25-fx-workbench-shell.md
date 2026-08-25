# FX Workbench Shell + ⌘K Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the FX workbench (`packages/ui/src/fx/ui/Workbench.tsx`) into a calm four-region design-app layout — Layers | Stage | Properties | Timeline — with a top bar and a ⌘K command palette, extracting a props-driven `LayersPanel` and a `CommandBar`, and introducing a shared `dragEdit` utility used first for grip-drag layer reorder.

**Architecture:** `FxWorkbench` KEEPS all its state, refs, the build `useEffect`, the per-frame updater, undo/redo, autosave, and the structural-vs-live-push routing exactly as they are. This phase changes only (a) the outer JSX tree + CSS so the panels sit in a real CSS-grid four-region frame instead of one scrolling rail, (b) two new clean leaf components (`LayersPanel`, `CommandBar`) that take props and callbacks, and (c) one new pure util module (`dragEdit`). No player/engine/def change; no touching the build effect's dependency array or the `structureKey` rebuild contract. A full decomposition of `FxWorkbench` into a stateful `WorkbenchShell` is explicitly OUT of scope (highest regression risk; not needed for the layout).

**Tech Stack:** React 18 + TypeScript, Zustand (read-only here), the existing `fx/ui/*` module set, Vitest (+ the repo's headless UI-module-dump pattern for component logic), ESLint, Vite `build:web`.

## Global Constraints

- **Never edit `packages/ui/src/fx/ui/Workbench.tsx`'s build `useEffect` (the ~627-810 player-construction effect), its dependency array, the ref-mirror set, or the `structureKey`/live-push routing.** Layout work reparents JSX and moves existing controls between regions only.
- **Presentation only.** No change to `FxDef`/`FxLayer`/`player.ts`/`params.ts` runtime behaviour. `dragEdit` is pure UI math. No new param KINDS.
- **Custom cursor rule (CLAUDE.md):** never put a bare `cursor: pointer` (or any plain keyword cursor) on an interactive element — a class selector out-specifies the global `button` gauntlet rule. Let the global rule paint it, or use the gauntlet URL form `cursor: url('/cursors/gauntlet_open.svg') 6 2, pointer`. Check every new interactive element.
- **Performance (CLAUDE.md north star):** no paint-property looping animations; read layout rects once per drag (cache at pointerdown), never per frame; keep new list rows referentially stable. Confirm "slow" only against the prod build.
- **All CSS lives in `packages/ui/src/styles.css`** under a clearly-headed `FX WORKBENCH SHELL` block. Reuse existing `.fxwb-*` class names where the element is unchanged; add new ones only for the grid regions and new components.
- **Gates before any task is "done":** `npm run typecheck` (pkgs + web), `npm run lint` (0 new errors), `npm test`, `npm run build:web` — all green, reported.
- **Patch notes:** this is a dev-tool/workbench UI change → NO `patchNotes.ts` entry (owner rule: only player-facing gameplay changes).
- **Keyboard coexistence:** the workbench already owns three `window` keydown effects (undo/redo, an Escape-claim in capture phase, transport Space/F/L) with an `isTextEntry` exemption. A new ⌘K/Ctrl+K listener MUST respect the same `isTextEntry` exemption and MUST NOT break the Escape-capture claim; Escape closes the command bar first when it is open.

---

## File Structure

- **Create `packages/ui/src/fx/ui/dragEdit.ts`** — pure drag math: list reorder + value scrub. Foundation reused by later phases (curve drag, span drag, actor drag). One responsibility: convert pointer deltas + a start snapshot into a resolved result.
- **Create `packages/ui/src/fx/ui/dragEdit.test.ts`** — unit tests (node, no DOM).
- **Create `packages/ui/src/fx/ui/commandIndex.ts`** — pure builder: `(sources, query) => ranked CommandItem[]`. No React. Reuses `matchesParamQuery` from `params.ts`.
- **Create `packages/ui/src/fx/ui/commandIndex.test.ts`** — unit tests (node).
- **Create `packages/ui/src/fx/ui/CommandBar.tsx`** — the ⌘K overlay component (input + results list + keyboard nav). Props-driven; owns no workbench state.
- **Create `packages/ui/src/fx/ui/LayersPanel.tsx`** — extract the existing layers list + add-layer control into a props-driven component; grip-drag reorder via `dragEdit`.
- **Modify `packages/ui/src/fx/ui/Workbench.tsx`** — reparent the JSX into the four-region grid + top bar; render `<LayersPanel/>`, `<CommandBar/>`; wire the ⌘K listener. NO state/effect logic changes beyond adding `cmdOpen` state + the reorder callback already present (`reorderLayer`).
- **Modify `packages/ui/src/styles.css`** — the `.fxwb` grid + region + `LayersPanel`/`CommandBar` styles.

---

## Task 1: `dragEdit` pure drag utility

**Files:**
- Create: `packages/ui/src/fx/ui/dragEdit.ts`
- Test: `packages/ui/src/fx/ui/dragEdit.test.ts`

**Interfaces:**
- Produces:
  - `interface ReorderDrag { fromIndex: number; count: number }`
  - `function reorderTargetIndex(drag: ReorderDrag, pointerY: number, rowTops: readonly number[]): number` — given the dragged row's origin index, the total row count, the pointer Y (px, relative to the list top), and the cached Y-offset of each row's top edge (length = count), returns the index the dragged row should land at (0..count-1), clamped. Uses each row's vertical midpoint as the crossover threshold. Pure; no DOM.
  - `function applyReorder<T>(items: readonly T[], from: number, to: number): T[]` — immutable move; returns a new array with `items[from]` spliced to `to`. If `from === to` or either is out of range, returns a shallow copy unchanged.
  - `interface ScrubDrag { startValue: number; min: number; max: number; step: number; pxPerStep: number }`
  - `function scrubValue(drag: ScrubDrag, dx: number, fine: boolean): number` — converts a horizontal pixel delta `dx` into a new value: `startValue + round((dx / pxPerStep) * (fine ? 0.25 : 1)) * step`, clamped to `[min, max]`, then snapped to the nearest `step` grid anchored at `min`. Pure.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { reorderTargetIndex, applyReorder, scrubValue } from './dragEdit'

describe('applyReorder', () => {
  it('moves an item forward', () => {
    expect(applyReorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })
  it('moves an item backward', () => {
    expect(applyReorder(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })
  it('returns an unchanged copy when from === to', () => {
    const src = ['a', 'b', 'c']
    const out = applyReorder(src, 1, 1)
    expect(out).toEqual(src)
    expect(out).not.toBe(src)
  })
  it('returns an unchanged copy for out-of-range indices', () => {
    expect(applyReorder(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
  })
})

describe('reorderTargetIndex', () => {
  // three rows, each 40px tall, tops at 0, 40, 80
  const tops = [0, 40, 80]
  it('keeps the row in place when the pointer stays over its own band', () => {
    expect(reorderTargetIndex({ fromIndex: 0, count: 3 }, 10, tops)).toBe(0)
  })
  it('moves down when the pointer passes the next row midpoint', () => {
    // row 1 midpoint = 60; pointer at 65 is past it
    expect(reorderTargetIndex({ fromIndex: 0, count: 3 }, 65, tops)).toBe(1)
  })
  it('clamps to the last index', () => {
    expect(reorderTargetIndex({ fromIndex: 0, count: 3 }, 999, tops)).toBe(2)
  })
  it('clamps to zero above the list', () => {
    expect(reorderTargetIndex({ fromIndex: 2, count: 3 }, -50, tops)).toBe(0)
  })
})

describe('scrubValue', () => {
  const drag = { startValue: 10, min: 0, max: 100, step: 1, pxPerStep: 4 }
  it('increments one step per pxPerStep of drag', () => {
    expect(scrubValue(drag, 8, false)).toBe(12)
  })
  it('applies a quarter rate when fine', () => {
    expect(scrubValue(drag, 8, true)).toBe(10) // round(2 * 0.25) = round(0.5) = 1? -> see impl note
  })
  it('clamps to max', () => {
    expect(scrubValue(drag, 10000, false)).toBe(100)
  })
  it('clamps to min', () => {
    expect(scrubValue(drag, -10000, false)).toBe(0)
  })
})
```

> Implementation note for the fine-rate test: use `Math.round`. `round((8/4) * 0.25) = round(0.5) = 1` in JS (round half up) → `10 + 1*1 = 11`. Adjust the expected value to `11` if your rounding yields that; the test asserts the documented formula, so make the assertion match the formula's exact output you compute, and keep the formula in the signature doc. Do NOT change the formula to hit a number.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/ui && npx vitest run src/fx/ui/dragEdit.test.ts`
Expected: FAIL — module not found / exports undefined.

- [ ] **Step 3: Implement `dragEdit.ts`**

Implement the three pure functions exactly per the Interfaces block. No React, no DOM, no `Math.random`. `reorderTargetIndex`: walk `rowTops`, find the band whose midpoint (`top + (nextTop - top)/2`, last row uses `top + (top - prevTop)`) the pointer has crossed; clamp `[0, count-1]`. `applyReorder`: guard ranges, splice on a copy. `scrubValue`: apply the documented formula, clamp, then snap to `min + round((v-min)/step)*step`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && npx vitest run src/fx/ui/dragEdit.test.ts`
Expected: PASS (adjust the one fine-rate expectation to the formula's actual output as noted).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/dragEdit.ts packages/ui/src/fx/ui/dragEdit.test.ts
git commit -m "feat(fx): shared dragEdit utility — reorder + value scrub math"
```

---

## Task 2: `commandIndex` — the ⌘K search model

**Files:**
- Create: `packages/ui/src/fx/ui/commandIndex.ts`
- Test: `packages/ui/src/fx/ui/commandIndex.test.ts`

**Interfaces:**
- Consumes: `matchesParamQuery(spec, key, query)` and `FxParamSpecs` from `../params`; `EditorLayer` from `./layerModel`.
- Produces:
  - `type CommandKind = 'layer' | 'param' | 'action'`
  - `interface CommandItem { id: string; kind: CommandKind; label: string; hint?: string; layerIndex?: number; paramKey?: string; actionId?: string }`
  - `interface CommandSources { layers: readonly EditorLayer[]; specsByPrimitive: Record<string, FxParamSpecs>; actions: readonly { id: string; label: string; hint?: string }[] }`
  - `function buildCommands(sources: CommandSources, query: string): CommandItem[]` — returns, for a non-empty trimmed query, the union of: (1) layer jumps whose name or primitive matches the query substring (case-insensitive), (2) param jumps for the SELECTED-agnostic set — every param of every layer's primitive spec where `matchesParamQuery(spec, key, query)` is true, labelled `"<param label> · <layer name>"` with `layerIndex` + `paramKey`, (3) actions whose label matches. For an empty/whitespace query, returns actions first, then one jump per layer (no params). Deterministic order: layers, then params (grouped by layerIndex ascending, then param key), then actions. `id` is stable (`"layer:<i>"`, `"param:<i>:<key>"`, `"action:<id>"`).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { buildCommands, type CommandSources } from './commandIndex'
import type { FxParamSpecs } from '../params'

const burstSpecs: FxParamSpecs = {
  count: { kind: 'slider', label: 'Shard count', min: 1, max: 50, step: 1, default: 12 },
  blendMode: { kind: 'enum', label: 'Blend mode', options: ['normal', 'add'], default: 'add' },
} as unknown as FxParamSpecs

const sources: CommandSources = {
  layers: [
    { primitive: 'burst', name: 'Sparks', anchor: 'source', at: 0, life: null, params: {} } as any,
    { primitive: 'burst', name: 'Trail', anchor: 'travel', at: 0, life: null, params: {} } as any,
  ],
  specsByPrimitive: { burst: burstSpecs },
  actions: [
    { id: 'fire', label: 'Fire once' },
    { id: 'addLayer', label: 'Add layer' },
  ],
}

describe('buildCommands', () => {
  it('matches params by label across all layers', () => {
    const out = buildCommands(sources, 'blend')
    const params = out.filter((c) => c.kind === 'param')
    expect(params).toHaveLength(2) // one per layer
    expect(params[0]).toMatchObject({ layerIndex: 0, paramKey: 'blendMode' })
  })
  it('matches a layer by name', () => {
    const out = buildCommands(sources, 'trail')
    expect(out.some((c) => c.kind === 'layer' && c.layerIndex === 1)).toBe(true)
  })
  it('matches actions by label', () => {
    const out = buildCommands(sources, 'fire')
    expect(out.some((c) => c.kind === 'action' && c.actionId === 'fire')).toBe(true)
  })
  it('empty query lists actions then a jump per layer, no params', () => {
    const out = buildCommands(sources, '  ')
    expect(out.filter((c) => c.kind === 'param')).toHaveLength(0)
    expect(out.filter((c) => c.kind === 'action')).toHaveLength(2)
    expect(out.filter((c) => c.kind === 'layer')).toHaveLength(2)
  })
  it('ids are stable and unique', () => {
    const out = buildCommands(sources, 'a')
    const ids = out.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/ui && npx vitest run src/fx/ui/commandIndex.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `commandIndex.ts`** per the Interfaces block. Pure; reuse `matchesParamQuery`. No React.

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/ui && npx vitest run src/fx/ui/commandIndex.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/commandIndex.ts packages/ui/src/fx/ui/commandIndex.test.ts
git commit -m "feat(fx): command index model for the workbench ⌘K palette"
```

---

## Task 3: `CommandBar` component

**Files:**
- Create: `packages/ui/src/fx/ui/CommandBar.tsx`
- Modify: `packages/ui/src/styles.css` (the `.fxwb-cmd*` block)

**Interfaces:**
- Consumes: `buildCommands`, `CommandItem`, `CommandSources` from `./commandIndex`.
- Produces:
  - `interface CommandBarProps { open: boolean; sources: CommandSources; onClose: () => void; onRun: (item: CommandItem) => void }`
  - `export function CommandBar(props: CommandBarProps): React.ReactElement | null` — renders null when `!open`. When open: a centered overlay (`.fxwb-cmd`) with a `.fxwb-cmd-input` search box (autofocused), a `.fxwb-cmd-list` of results from `buildCommands(sources, query)`, arrow-key navigation (Up/Down move a highlighted index, wrapping), Enter runs the highlighted item then calls `onClose`, Escape calls `onClose`. Clicking a row runs it. The highlighted index resets to 0 on every query change. Mouse hover sets the highlight.

**Notes:** The overlay is `position: fixed`, high z-index, backdrop click closes. Do NOT trap the global keydown here — the input's own `onKeyDown` handles nav/Enter/Escape while focused. Reset `query` to `''` whenever `open` transitions false→true (via `useEffect` on `open`).

- [ ] **Step 1: Write a headless logic test** (repo pattern: no jsdom — test the pure selection helper, not the DOM). Extract the highlight-movement math into an exported pure helper so it is testable:

Add to `commandIndex.ts` (co-located, already imported by CommandBar):
```ts
export function nextHighlight(current: number, count: number, delta: number): number {
  if (count <= 0) return 0
  return ((current + delta) % count + count) % count
}
```
Test in `commandIndex.test.ts`:
```ts
import { nextHighlight } from './commandIndex'
describe('nextHighlight', () => {
  it('wraps forward past the end', () => { expect(nextHighlight(2, 3, 1)).toBe(0) })
  it('wraps backward past the start', () => { expect(nextHighlight(0, 3, -1)).toBe(2) })
  it('is 0 for an empty list', () => { expect(nextHighlight(0, 0, 1)).toBe(0) })
})
```

- [ ] **Step 2: Run to verify the new test fails**

Run: `cd packages/ui && npx vitest run src/fx/ui/commandIndex.test.ts`
Expected: FAIL — `nextHighlight` undefined.

- [ ] **Step 3: Implement `nextHighlight`, then build `CommandBar.tsx`** using `buildCommands` + `nextHighlight`. Wire input `onKeyDown`: ArrowDown/Up → `setHi(nextHighlight(hi, items.length, ±1))`; Enter → run `items[hi]`; Escape → `onClose`.

- [ ] **Step 4: Run tests + typecheck**

Run: `cd packages/ui && npx vitest run src/fx/ui/commandIndex.test.ts` → PASS.
Run (from repo root): `npm run typecheck` → clean.

- [ ] **Step 5: Add `.fxwb-cmd*` CSS** in `styles.css` (overlay, input, list, `.fxwb-cmd-row`, `.fxwb-cmd-row.hi`). Interactive rows must NOT set a bare `cursor: pointer` — rely on the global gauntlet rule or use the gauntlet URL form.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/fx/ui/CommandBar.tsx packages/ui/src/fx/ui/commandIndex.ts packages/ui/src/fx/ui/commandIndex.test.ts packages/ui/src/styles.css
git commit -m "feat(fx): CommandBar (⌘K) overlay with keyboard nav"
```

---

## Task 4: `LayersPanel` — extract + grip-drag reorder

**Files:**
- Create: `packages/ui/src/fx/ui/LayersPanel.tsx`
- Modify: `packages/ui/src/fx/ui/Workbench.tsx` (replace the inline `.fxwb-layers` block with `<LayersPanel .../>`)
- Modify: `packages/ui/src/styles.css` (grip-drag affordance; the drag ghost)

**Interfaces:**
- Consumes: `EditorLayer` from `./layerModel`; `applyReorder`, `reorderTargetIndex`, `ReorderDrag` from `./dragEdit`; existing `primitiveLabel`/`anchor` copy helpers from `./copy`; `effectiveMutes` from `./layerModel`.
- Produces:
  - `interface LayersPanelProps { layers: readonly EditorLayer[]; selected: number; onSelect: (i: number) => void; onReorder: (from: number, to: number) => void; onAdd: (primitive: string) => void; onDuplicate: (i: number) => void; onRemove: (i: number) => void; onToggleMute: (i: number) => void; onToggleSolo: (i: number) => void; onRename: (i: number, name: string) => void; primitives: readonly string[]; }`
  - `export function LayersPanel(props: LayersPanelProps): React.ReactElement`

**Behaviour:** Render the SAME rows the current `.fxwb-layers` block renders (name, `.fxwb-layer-meta` anchor·@at·life, the mute/solo/rename/dup/remove buttons) — reuse the existing class names so styling carries over. ADD a grip handle (`.fxwb-layer-grip`) at the row's left; pointerdown on the grip starts a reorder drag: capture the list's row-top offsets ONCE (`getBoundingClientRect` per row at drag start — never per move), track pointer Y on `pointermove`, compute `reorderTargetIndex`, show a drop indicator; on `pointerup` call `onReorder(from, to)`. Keep the existing ↑/↓ buttons too (accessibility + no-drag fallback). The add-layer control (`<select>` + `＋`) calls `onAdd`.

> The Workbench already has `reorderLayer(from, to)` (live-pushes + coalesces undo). Pass it as `onReorder`. Do NOT reimplement reorder inside the panel — it only computes the target index and calls back.

- [ ] **Step 1: Write a headless logic test** for the panel's only non-trivial pure decision — the drop-target resolution is already covered by `dragEdit.test.ts`, so assert the panel wires it correctly via a thin exported helper. Export from `LayersPanel.tsx`:
```ts
export function resolveDrop(from: number, pointerY: number, rowTops: number[]): number {
  return reorderTargetIndex({ fromIndex: from, count: rowTops.length }, pointerY, rowTops)
}
```
Test `packages/ui/src/fx/ui/LayersPanel.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { resolveDrop } from './LayersPanel'
describe('LayersPanel.resolveDrop', () => {
  it('delegates to reorderTargetIndex', () => {
    expect(resolveDrop(0, 65, [0, 40, 80])).toBe(1)
    expect(resolveDrop(2, -50, [0, 40, 80])).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/ui && npx vitest run src/fx/ui/LayersPanel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `LayersPanel.tsx`** per Interfaces + Behaviour. Reuse existing class names for unchanged elements.

- [ ] **Step 4: Wire into `Workbench.tsx`** — replace the inline `.fxwb-layers` JSX (the `layers.map(...)` block + `.fxwb-layer-add`) with `<LayersPanel layers={layers} selected={selected} onSelect={selectLayer} onReorder={reorderLayer} onAdd={addNewLayer} onDuplicate={duplicateLayerAt} onRemove={deleteLayer} onToggleMute={toggleMute} onToggleSolo={toggleSolo} onRename={commitRename} primitives={listPrimitives()} />`. Match the existing handler names in the file; if a 1:1 handler doesn't exist (e.g. rename is currently inline state), pass the smallest wrapper that preserves current behaviour. Do NOT change any handler's body.

- [ ] **Step 5: Run tests + typecheck + build**

Run: `cd packages/ui && npx vitest run src/fx/ui/LayersPanel.test.ts` → PASS.
Run (root): `npm run typecheck` → clean.
Run (root): `npm run build:web` → ✓.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/fx/ui/LayersPanel.tsx packages/ui/src/fx/ui/LayersPanel.test.ts packages/ui/src/fx/ui/Workbench.tsx packages/ui/src/styles.css
git commit -m "feat(fx): LayersPanel with grip-drag reorder (extract from Workbench)"
```

---

## Task 5: Four-region layout + top bar + ⌘K wiring

**Files:**
- Modify: `packages/ui/src/fx/ui/Workbench.tsx` (reparent JSX into the grid; add `cmdOpen` state + the ⌘K listener + `onRun`)
- Modify: `packages/ui/src/styles.css` (the `.fxwb` grid + regions)

**Interfaces:**
- Consumes: `CommandBar` + `CommandItem`/`CommandSources` from `./commandIndex`; `LayersPanel`.

**Layout target** — replace the current single-rail structure with a CSS grid:
```
.fxwb (grid)
├── .fxwb-top       (row 1, full width) — title · transport-core (play/fire/scrub/time) · ⌘K button · slot over/under · fps · ✕
├── .fxwb-layers-region  (row 2, col 1)  — <LayersPanel/> + the DefLibrary/New/Browse buttons + the selected layer's timing block
├── .fxwb-stage     (row 2, col 2)  — the centre "window" (transparent; the existing full-screen Pixi overlay shows through here); a `.fxwb-stage-hint` shows the active scenario hint. In this phase the stage region is a framed transparent pane — the Stage Setter (Phase 4) fills it.
├── .fxwb-props-region   (row 2, col 3)  — the `<Inspector/>` + Copy def + the Save box
└── .fxwb-timeline-region (row 3, full width, collapsible) — `<Timeline/>` + the loop/duration/ease/seed/playback controls
```

- The **top bar** absorbs the transport core (play/fire/scrub/time) so there is ONE transport, killing the rail-mode duplication where possible. If fully unifying rail-mode is too large, leave `railMode` behaving as today but ensure the new grid is the non-rail layout.
- **Selecting a layer** from `LayersPanel`, the `Timeline`, or a `CommandBar` param/layer jump all call the existing `setSelected`/`selectLayer`. A param jump additionally sets the Inspector search/opens the group — implement `onRun` to (a) `selectLayer(item.layerIndex)`, and (b) for a `param` item, set a new `inspectorFocusKey` state passed to `<Inspector/>` as an optional `focusKey?: string` prop that scrolls/opens that param (add the minimal `focusKey` handling to Inspector: when set, ensure its group is open and `scrollIntoView`; clear after). For an `action` item, call the matching existing handler via a small `runAction(id)` switch.
- **⌘K listener:** add one `window` keydown effect: on `(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'`, if not `isTextEntry(e.target)` (reuse the file's existing helper), `e.preventDefault()` + `setCmdOpen(true)`. Render `<CommandBar open={cmdOpen} sources={cmdSources} onClose={() => setCmdOpen(false)} onRun={onRun} />`. `cmdSources` is a `useMemo` over `{ layers, specsByPrimitive: specsFor each layer's primitive, actions: WB_ACTIONS }`.

- [ ] **Step 1: Add `cmdOpen` state + `WB_ACTIONS` + `cmdSources` memo + `onRun` + the ⌘K keydown effect** in `Workbench.tsx`. `WB_ACTIONS` is a module const: `[{id:'fire',label:'Fire once'},{id:'togglePlay',label:'Play / pause'},{id:'toggleLoop',label:'Toggle loop'},{id:'addLayer',label:'Add layer'},{id:'newEffect',label:'New effect…'},{id:'browse',label:'Browse all…'}]`. `runAction` maps each to the existing handler.

- [ ] **Step 2: Reparent the JSX** into the grid regions above. Move existing blocks wholesale — do not rewrite their internals. The `<Inspector/>`, `<Timeline/>`, `<LayersPanel/>`, timing block, save box, transport controls all keep their current props and handlers; only their DOM parent changes.

- [ ] **Step 3: Add the `focusKey` prop to `Inspector.tsx`** — optional `focusKey?: string | null`; a `useEffect` on it opens the containing group and `scrollIntoView({block:'nearest'})` the matching `.fxwb-row`, then the parent clears it. Keep it additive: when `focusKey` is undefined the Inspector behaves exactly as today.

- [ ] **Step 4: Write the `.fxwb` grid CSS** in `styles.css` — `display:grid`, `grid-template-columns: <layers> 1fr <props>`, `grid-template-rows: auto 1fr auto`, named regions. Rails scroll internally (`overflow:auto`), the page body never scrolls horizontally. `.fxwb-timeline-region` collapses to a header via an existing/added toggle. Respect the cursor rule on any new buttons.

- [ ] **Step 5: Gates**

Run (root): `npm run typecheck` → clean.
Run (root): `npm run lint` → 0 new errors.
Run (root): `npm test` → all green.
Run (root): `npm run build:web` → ✓.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/fx/ui/Workbench.tsx packages/ui/src/fx/ui/Inspector.tsx packages/ui/src/styles.css
git commit -m "feat(fx): four-region workbench layout + ⌘K command palette"
```

---

## Task 6: Verification pass + rough edges

**Files:** as needed (`styles.css`, `Workbench.tsx`) — bug-fix only, no new surface.

- [ ] **Step 1:** Serve the workbench (dev) and confirm: the four regions lay out without horizontal body scroll; the layers rail, properties rail, and timeline scroll independently; grip-drag reorders a layer; ⌘K opens, filters, arrow+Enter jumps to a param and it scrolls into view; Escape closes the command bar without triggering the workbench's Escape-claim/close. (This is the owner-verifiable acceptance; capture a screenshot for the report.)
- [ ] **Step 2:** Confirm the effect still plays in the stage window (the build effect is untouched, so it must). Fire/loop/scrub still work from the top bar.
- [ ] **Step 3:** Full gate suite (typecheck + lint + test + build:web) green; report results.
- [ ] **Step 4: Commit** any fixes.

```bash
git add -A packages/ui/src
git commit -m "fix(fx): workbench shell layout polish"
```

---

## Self-Review notes (author)

- **Spec coverage:** §3 layout (Tasks 5–6), ⌘K command bar (Tasks 2–3, 5), Layers drag reorder (Tasks 1, 4), drag-first foundation `dragEdit` (Task 1, reused later). Stage Setter, Inspector declutter, colour kit are OTHER phases — the stage region here is a framed placeholder (called out in Task 5).
- **Deferred (documented):** full `FxWorkbench`→`WorkbenchShell` stateful decomposition (highest risk; not needed for the layout); full rail-mode transport unification (attempted in Task 5, may partly remain); value-scrub drag on knobs (util built in Task 1, wired in the drag-first work of later phases); timeline-span/curve/actor drags (later phases reuse `dragEdit`).
- **Type consistency:** `CommandSources`/`CommandItem` defined in Task 2, consumed unchanged in Tasks 3+5. `ReorderDrag` defined Task 1, consumed Task 4. `LayersPanelProps` handler names must be reconciled against the real handler names in `Workbench.tsx` at Task 4 Step 4 (the implementer verifies against the file).
- **Test honesty:** the layout itself is owner-verified (Task 6), not unit-tested — the unit tests cover the pure decision cores (`dragEdit`, `commandIndex`, `nextHighlight`, `resolveDrop`), which is where the logic that can silently break lives.
