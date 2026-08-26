# FX Timeline Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the FX workbench `Timeline` from a read-mostly bar chart into a drag-first editing surface: a **scrubbable playhead** (click/drag the track to seek), **vertical lane reorder** (mirroring the LayersPanel grip), and a **time ruler + readout** — reusing the existing pure `timelineModel`/`dragEdit` helpers and the Workbench's existing `scrub`/`reorderLayerTo` handlers.

**Architecture:** `Timeline.tsx` already renders per-layer bars with move/resize drag (via tested `timelineModel` helpers) and a decorative playhead; Phase 1 already made the timeline region collapsible. This phase ADDS two props (`onSeek`, `onReorder`) and their gestures, plus a ruler. All new arithmetic reuses tested pure helpers (`pointerToMs` for seek, `reorderTargetIndex`/`applyReorder` for reorder) or a small new tested `rulerTicks` helper. The Workbench wires `onSeek={scrub}` and `onReorder={reorderLayerTo}` — both handlers already exist (`Workbench.tsx:1410`, `:1236`). No player/engine/def change.

**Tech Stack:** React 18 + TypeScript, `fx/ui/timelineModel.ts` (`pointerToMs`, `resolveTimingDrag`, `spanOf`, `spanToTrack`), `fx/ui/dragEdit.ts` (`reorderTargetIndex`, `applyReorder`), Vitest, ESLint, Vite build.

## Global Constraints

- **Presentation only.** No change to `player.ts`, `FxDef`, timing semantics, or the Workbench's rebuild/live-push routing. `onSeek` and `onReorder` are wired to EXISTING Workbench handlers (`scrub`, `reorderLayerTo`) — do not create parallel logic.
- **Gesture separation is load-bearing.** The existing bar move/resize gestures (`beginDrag` on the bar body / `.fxwb-timeline-grip`) call `e.stopPropagation()`. New gestures must not collide: track-background scrub only fires when the pointer is NOT on a bar/grip/ruler; the vertical-reorder grip is a SEPARATE element that stops propagation so it triggers neither a bar move nor a track seek.
- **Performance:** measure the track rect / row tops ONCE per gesture at pointerdown (never per pointermove) — the existing `dragRef` pattern. No looping paint-property animation.
- **Custom cursor rule:** no bare `cursor: pointer`/keyword cursor on new interactive elements — global gauntlet rule or `cursor: url('/cursors/gauntlet_open.svg') 6 2, pointer` (or the gauntlet-`grab` form for the reorder grip, mirroring `.fxwb-layer-grip`).
- **CSS** in `packages/ui/src/styles.css`, reusing the `.fxwb-timeline-*` family; add classes only for the ruler + reorder grip + interactive playhead affordance.
- **Gates before "done":** `npm run typecheck` (pkgs + web), `npm run lint` (0 new errors), `npm test`, `npm run build:web` — all green, reported.
- **Patch notes:** dev-tool UI → NO `patchNotes.ts` entry.

---

## File Structure

- **Modify `packages/ui/src/fx/ui/timelineModel.ts`** — add a pure `rulerTicks` helper.
- **Modify `packages/ui/src/fx/ui/timelineModel.test.ts`** (check it exists; if not create) — tests for `rulerTicks`.
- **Modify `packages/ui/src/fx/ui/Timeline.tsx`** — `onSeek`/`onReorder` props + gestures + ruler render.
- **Modify `packages/ui/src/fx/ui/Workbench.tsx`** — pass `onSeek={scrub}` and `onReorder={reorderLayerTo}` to `<Timeline/>`.
- **Modify `packages/ui/src/styles.css`** — ruler, reorder grip, scrub affordance.

---

## Task 1: `rulerTicks` pure helper + ruler render

**Files:**
- Modify: `packages/ui/src/fx/ui/timelineModel.ts`
- Test: `packages/ui/src/fx/ui/timelineModel.test.ts`
- Modify: `packages/ui/src/fx/ui/Timeline.tsx` (render the ruler + a time readout)
- Modify: `packages/ui/src/styles.css`

**Interfaces:**
- Produces:
  - `interface RulerTick { ms: number; pct: number; major: boolean; label: string }`
  - `function rulerTicks(durationMs: number, targetCount?: number): RulerTick[]` — returns evenly-spaced ticks across `[0, durationMs]`. Pick a "nice" step (from the set `[50,100,200,250,500,1000,2000,5000]` ms) so the count is close to `targetCount` (default 8) but never exceeds `durationMs`. Each tick: `ms` (0, step, 2·step, … ≤ durationMs), `pct = ms/durationMs*100`, `major` true every 5th tick (or at 0 and the last), `label` = `${ms}` for a sub-second step else `${ms/1000}s`. `durationMs <= 0` → `[]`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { rulerTicks } from './timelineModel'

describe('rulerTicks', () => {
  it('returns [] for non-positive duration', () => {
    expect(rulerTicks(0)).toEqual([])
  })
  it('spans 0..duration with a nice step and no tick past the end', () => {
    const ticks = rulerTicks(1000, 8)
    expect(ticks[0].ms).toBe(0)
    expect(ticks[0].pct).toBe(0)
    expect(ticks.every((t) => t.ms <= 1000)).toBe(true)
    // monotonic increasing
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].ms).toBeGreaterThan(ticks[i - 1].ms)
  })
  it('labels sub-second in ms and >=1000 in seconds', () => {
    const ticks = rulerTicks(4000, 8)
    const t2000 = ticks.find((t) => t.ms === 2000)
    expect(t2000?.label).toBe('2s')
  })
  it('marks the first tick major', () => {
    expect(rulerTicks(1000, 8)[0].major).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/ui && npx vitest run src/fx/ui/timelineModel.test.ts`
Expected: FAIL — `rulerTicks` undefined.

- [ ] **Step 3: Implement `rulerTicks`** in `timelineModel.ts` per the Interfaces block. Pure, no `Math.random`.

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Render the ruler in `Timeline.tsx`.** Add a `.fxwb-timeline-ruler` strip above (or within) `.fxwb-timeline-track`: one `.fxwb-timeline-tick` per `rulerTicks(durationMs)` positioned at `left: pct%`, `major` ticks taller + labelled. Add a time readout to `.fxwb-timeline-head` showing `${Math.round(timeMs)} / ${durationMs}ms`. Ruler + labels are `pointer-events: none` so they never intercept a drag.

- [ ] **Step 6: CSS** for `.fxwb-timeline-ruler` / `-tick` / `-readout` (static paint; no cursor on non-interactive ticks).

- [ ] **Step 7: Gates** — typecheck + the new test pass; lint clean; build ✓.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/fx/ui/timelineModel.ts packages/ui/src/fx/ui/timelineModel.test.ts packages/ui/src/fx/ui/Timeline.tsx packages/ui/src/styles.css
git commit -m "feat(fx): timeline ruler + time readout"
```

---

## Task 2: Scrubbable playhead (click/drag the track to seek)

**Files:**
- Modify: `packages/ui/src/fx/ui/Timeline.tsx`
- Modify: `packages/ui/src/fx/ui/Workbench.tsx`
- Modify: `packages/ui/src/styles.css`

**Interfaces:**
- Timeline gains: `onSeek(ms: number): void` in `TimelineProps`.
- Consumes: `pointerToMs` (already imported).

**Behaviour:**
- Add a pointer handler on the **track background** (the `.fxwb-timeline-track` div itself): `onPointerDown` → if the event target IS the track (not a bar/grip/ruler tick — check `e.target === e.currentTarget` OR that no bar handled it, since bars call `stopPropagation`), measure the track rect once, `onSeek(pointerToMs(e.clientX, rect, durationMs))`, set pointer capture, and enter a scrub-drag; `onPointerMove` while scrubbing → `onSeek(pointerToMs(...))`; `onPointerUp/Cancel` → release. Use a separate ref from the bar `dragRef` (e.g. `seekRef`) so the two gestures never interleave.
- The playhead gains a visible **grab affordance** (a small handle at its top), but the SEEK gesture lives on the track (dragging anywhere on empty track scrubs) — you do NOT need the thin playhead line itself to be the hit target. Keep the playhead line `pointer-events: none`; the optional handle at its top may be interactive but is not required for the gesture to work.
- **Wire in Workbench:** pass `onSeek={scrub}` to `<Timeline/>` (the existing `scrub(ms)` at `Workbench.tsx:~1410` pauses + `player.scrub(ms)`).

- [ ] **Step 1:** Add `onSeek` to `TimelineProps`; implement the track-background scrub gesture with its own `seekRef` + rect-once-at-pointerdown. Ensure a pointerdown that originated on a bar/grip (which stops propagation) does NOT start a seek.
- [ ] **Step 2:** Pass `onSeek={scrub}` from `Workbench.tsx` to `<Timeline/>`.
- [ ] **Step 3: CSS** for the scrub affordance (cursor rule); the track shows a seek cursor via the gauntlet URL form.
- [ ] **Step 4: Gates** — typecheck/lint/build green. (No unit test for the .tsx gesture; `pointerToMs` is already tested.)
- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/Timeline.tsx packages/ui/src/fx/ui/Workbench.tsx packages/ui/src/styles.css
git commit -m "feat(fx): scrub the timeline by dragging the track (seek)"
```

---

## Task 3: Vertical lane reorder (mirror the LayersPanel grip)

**Files:**
- Modify: `packages/ui/src/fx/ui/Timeline.tsx`
- Modify: `packages/ui/src/fx/ui/Workbench.tsx`
- Modify: `packages/ui/src/styles.css`

**Interfaces:**
- Timeline gains: `onReorder(from: number, to: number): void` in `TimelineProps`.
- Consumes: `reorderTargetIndex`, `applyReorder` from `./dragEdit` (Phase 1). (You only need `reorderTargetIndex` to compute the target; the Workbench's `reorderLayerTo` does the actual move — same as LayersPanel.)

**Behaviour:**
- Add a **left grip** to each `.fxwb-timeline-row` (`.fxwb-timeline-reorder-grip`), mirroring `LayersPanel`'s grip. `onPointerDown` on the grip: `stopPropagation` (so it triggers neither a bar move nor a track seek), measure each row's top offset ONCE (cache the rects), track pointer Y on `pointermove`, compute `reorderTargetIndex({ fromIndex: i, count: layers.length }, pointerY, rowTops)`, show a drop indicator; on `pointerup` call `onReorder(from, to)`.
- **Bound `rowTops` to the live `layers` length** (learn from the Phase 1 grip-drag bug: measure `layers.map((_, idx) => rowRefs.current[idx]?.getBoundingClientRect().top ?? 0)`, never a raw over-long ref array).
- **Wire in Workbench:** pass `onReorder={reorderLayerTo}` (the existing `reorderLayerTo(from,to)` at `Workbench.tsx:~1236`, which live-pushes + coalesces undo + follows selection).

- [ ] **Step 1:** Add `onReorder` to `TimelineProps`; add the reorder grip + vertical-drag logic with row-tops measured once, bounded to `layers.length`. Add a drop-indicator class.
- [ ] **Step 2:** Pass `onReorder={reorderLayerTo}` from `Workbench.tsx`.
- [ ] **Step 3: CSS** `.fxwb-timeline-reorder-grip` (gauntlet-grab cursor form) + drop indicator.
- [ ] **Step 4: Gates** green.
- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/Timeline.tsx packages/ui/src/fx/ui/Workbench.tsx packages/ui/src/styles.css
git commit -m "feat(fx): reorder layers by dragging a timeline lane grip"
```

---

## Task 4: Verification + polish

**Files:** as needed (bug-fix only).

- [ ] **Step 1:** Full gate suite green: `npm run typecheck && npm run lint && npm test && npm run build:web`. Report the test count.
- [ ] **Step 2:** Sanity (owner-verifiable): dragging empty track scrubs the playhead + effect; the ruler shows ticks + a time readout; dragging a lane's left grip reorders layers (and the bars still move/resize as before, and clicking a bar still selects). Confirm the three gestures (bar move/resize · track seek · lane reorder) never trigger each other.
- [ ] **Step 3: Commit** any fixes.

```bash
git add -A packages/ui/src
git commit -m "fix(fx): timeline lane polish"
```

---

## Self-Review notes (author)

- **Spec coverage (§3/§7):** scrubbable playhead (Task 2) + timeline span drag (already existed) + reorder mirrored on the timeline (Task 3) + a real per-layer lane with playhead + ruler (Task 1) + collapse (done in Phase 1). Selecting a span selects the layer (already `onSelect`).
- **Reuse:** seek uses the tested `pointerToMs`; reorder uses the tested `reorderTargetIndex`/`applyReorder` + the existing `reorderLayerTo`; the only new pure helper is `rulerTicks` (Task 1, unit-tested). No duplicated timing logic.
- **Gesture-conflict is the main risk** — each task explicitly separates its gesture by target element + `stopPropagation`, and Task 4 verifies the three don't cross-fire. The Phase-1 grip-drag staleness lesson (bound `rowTops` to live layers) is baked into Task 3.
- **Type consistency:** `onSeek`/`onReorder` added to `TimelineProps` (Tasks 2/3), wired to existing Workbench handlers `scrub`/`reorderLayerTo`. `rulerTicks`/`RulerTick` defined Task 1, consumed in the same task's render.
- **Test honesty:** `rulerTicks` unit-tested; the gestures are owner-verified (like Phase 1's layout), reusing already-tested pointer math.
