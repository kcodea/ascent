# FX Stage Setter (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the FX workbench a composable **Stage Setter** — a custom preview canvas the author arranges (draggable source/target/cursor points + lightweight mock-card actors in two rows, with roles), so effects anchor to *it* instead of the live game board. It plugs in as a new `FxScenario` and remembers a named stage per effect.

**Architecture:** The cleanest seam (confirmed by exploration): a Stage Setter is **a new `FxScenario` whose `anchorsAt(vp, cursor)` reads the placed actors'/points' DOM rects** — exactly how the existing `realBoard` scenario reads live board rects via `anchorsFromRects`. The `StageSetter` React component renders the stage DOM (role-tagged, `[data-uid]`-bearing) into the Stage region; the scenario reads that DOM per frame (throttled, like `realBoard`). This needs **zero** changes to the Workbench build effect / per-frame updater — the `SCENARIOS` array is the whole seam (picker, build resolver, and `scenario.anchorsAt` are all data-driven off it). Mock cards are a purpose-built lightweight `StageCard` that replicates ONLY the DOM the FX system queries (`[data-zone]`→`.row`→`[data-uid]`→`.badge.atk/.badge.hp`→`.plate/.value`), so `react`/reach/stat-roll target it without pulling in the heavy real `<Card>`.

**Tech Stack:** React 18 + TS, the pure `fx/anchors.ts`/`fx/boardAnchors.ts` (`anchorsFromRects`), `fx/scenarios.ts` (`SCENARIOS`, `stageAll` invariant), `fx/ui/dragEdit.ts` (drag math), `fx/ui/reactTargets.ts` (the DOM contract to satisfy), localStorage persistence mirroring `sessionState.ts`/`defStore.ts`, Vitest, ESLint, Vite build.

## Global Constraints

- **Presentation only.** No change to `player.ts`, `FxDef`, the Workbench build `useEffect`, its dep array, the ref-mirror set, or the `structureKey`/live-push routing. The new scenario is appended to `SCENARIOS`; the `StageSetter` is rendered in the Stage region; nothing in the rebuild contract changes.
- **The `stageAll` invariant is law:** the new scenario's `anchorsAt` MUST return a fully-staged `FxAnchors` (every non-`travel` id present) — reuse the synthetic floor + override pattern `realBoard` uses, so no anchor ever falls back to `(0,0)`.
- **Reuse, don't reinvent:** compute unit-centre / slot / camera from rects via the existing `anchorsFromRects` (`boardAnchors.ts`) — do NOT re-derive that math. Drag via the existing `dragEdit`. Persist mirroring `sessionState.ts` (a pure normalize module + thin `save/load` in `defStore.ts`).
- **The StageCard DOM MUST satisfy the FX query contract exactly** (from `reactTargets.ts`): an ancestor `[data-zone="warband"]` / `[data-zone="tavern"]` → a `.row` → an element with `data-uid="<uid>"` → `.badge.atk` and `.badge.hp`, each with direct children `.plate` and `.value`. Non-zero rects when sampled (laid out + visible). Otherwise react part-targeting silently no-ops.
- **The board-behind-the-overlay is sampled throttled (~200ms), assumed static during playback.** The Stage Setter's actors are arranged while paused; they are static during a fire/loop. Do not stream live rect changes per frame.
- **Custom cursor rule:** no bare keyword cursor on interactive elements — global gauntlet rule or `cursor: url('/cursors/gauntlet_open.svg') 6 2, pointer` (grab form for drag handles).
- **Performance:** measure rects once per drag gesture; no per-frame layout reads in React; no looping paint-property animation.
- **CSS** in `packages/ui/src/styles.css` under a `FX STAGE SETTER` header.
- **Gates before "done":** `npm run typecheck` (pkgs + web), `npm run lint` (0 new errors), `npm test`, `npm run build:web` — all green, reported.
- **Patch notes:** dev-tool UI → NO `patchNotes.ts` entry.

## Scope (v1) — explicit

IN: composable canvas; draggable `source`/`target`/`cursor` point handles; lightweight mock-card actors in two rows (`warband`/`tavern` zones) with per-actor **role** (`source`/`target`/`struck`/`self-buffed`/`buffed`/`none`); a new `stageSetter` scenario reading the stage DOM; **saved named stages + last-used-per-effect**; a camera/full-screen note (the `camera` anchor already = viewport centre). OUT (deferred to v2, noted in PR): gradient backdrops; scoped cue-preview scoping; head-motion presets beyond the existing scenario motions. `realBoard` stays available for the event-timing residue.

---

## File Structure

- **Create `packages/ui/src/fx/ui/stageModel.ts`** — pure: stage state types + ops + saved-stages normalize. Test alongside.
- **Create `packages/ui/src/fx/ui/stageStore.ts`** — thin localStorage save/load for the per-effect stages map (mirrors `defStore.ts`). Pure-ish (guarded storage). Test the normalize via stageModel.
- **Create `packages/ui/src/fx/ui/StageCard.tsx`** — the lightweight mock card (FX-query-faithful DOM), draggable, role-tagged.
- **Create `packages/ui/src/fx/ui/StageSetter.tsx`** — the canvas: two zone rows of StageCards + draggable point handles + role/stage controls.
- **Modify `packages/ui/src/fx/scenarios.ts`** — add the `stageSetter` `FxScenario` reading the stage DOM; append to `SCENARIOS`.
- **Modify `packages/ui/src/fx/ui/Workbench.tsx`** — render `<StageSetter/>` in the Stage region when the `stageSetter` scenario is active; persist last-used stage per def.
- **Modify `packages/ui/src/styles.css`** — stage canvas, cards, handles, controls.

---

## Task 1: `stageModel` — pure stage state + anchors

**Files:**
- Create: `packages/ui/src/fx/ui/stageModel.ts`
- Test: `packages/ui/src/fx/ui/stageModel.test.ts`

**Interfaces:**
- Produces:
  - `type StageRole = 'source' | 'target' | 'struck' | 'selfBuffed' | 'buffed' | 'none'`
  - `type StageZone = 'warband' | 'tavern'`
  - `interface StageActor { uid: string; zone: StageZone; slot: number; role: StageRole; atk: number; hp: number }` — `slot` = index within its row (order matters for reach). `uid` stable + unique.
  - `interface StagePoint { x: number; y: number }` — viewport FRACTIONS (0..1), like `bounceSpots`.
  - `interface StageState { source: StagePoint; target: StagePoint; cursor: StagePoint; actors: StageActor[] }`
  - `const DEFAULT_STAGE: StageState` — source `{x:0.32,y:0.6}`, target `{x:0.68,y:0.6}`, cursor `{x:0.5,y:0.4}`, `actors: []`.
  - Immutable ops: `addActor(s, zone)`, `removeActor(s, uid)`, `moveActor(s, uid, zone, slot)`, `setActorRole(s, uid, role)`, `setActorStats(s, uid, atk, hp)`, `setPoint(s, which: 'source'|'target'|'cursor', p: StagePoint)`. Each returns a new `StageState`; `addActor` assigns the next free `uid` (`stageUid(n)` → `"stage-<n>"`) and appends at the row's end.
  - `function roleActor(s: StageState, role: StageRole): StageActor | null` — the first actor with that role (source/target lookups).
  - `interface SavedStages { byDef: Record<string, StageState>; last: StageState }` — per-def map + a global last-used.
  - `function normalizeStages(raw: unknown): SavedStages` — total; coerce untrusted storage into valid `SavedStages` (clamp fractions to 0..1, drop malformed actors, roles to the union, `DEFAULT_STAGE` fallback). Mirror `normalizeSession`'s defensive style.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_STAGE, addActor, removeActor, setActorRole, setPoint, roleActor,
  normalizeStages, type StageState,
} from './stageModel'

describe('stage ops', () => {
  it('addActor appends with a unique uid in the given zone', () => {
    const s1 = addActor(DEFAULT_STAGE, 'warband')
    const s2 = addActor(s1, 'warband')
    expect(s2.actors).toHaveLength(2)
    expect(new Set(s2.actors.map((a) => a.uid)).size).toBe(2)
    expect(s2.actors.every((a) => a.zone === 'warband')).toBe(true)
  })
  it('setActorRole + roleActor round-trip', () => {
    const s = setActorRole(addActor(DEFAULT_STAGE, 'warband'), 'stage-0', 'source')
    expect(roleActor(s, 'source')?.uid).toBe('stage-0')
  })
  it('removeActor drops it', () => {
    const s = removeActor(addActor(DEFAULT_STAGE, 'tavern'), 'stage-0')
    expect(s.actors).toHaveLength(0)
  })
  it('setPoint clamps into 0..1', () => {
    const s = setPoint(DEFAULT_STAGE, 'source', { x: 2, y: -1 })
    expect(s.source).toEqual({ x: 1, y: 0 })
  })
  it('ops are immutable', () => {
    const s = addActor(DEFAULT_STAGE, 'warband')
    expect(s).not.toBe(DEFAULT_STAGE)
    expect(DEFAULT_STAGE.actors).toHaveLength(0)
  })
})

describe('normalizeStages', () => {
  it('returns a valid default for junk', () => {
    const out = normalizeStages(null)
    expect(out.last).toEqual(DEFAULT_STAGE)
    expect(out.byDef).toEqual({})
  })
  it('clamps fractions and drops malformed actors', () => {
    const raw = { last: { source: { x: 5, y: 0.5 }, target: { x: 0.7, y: 0.6 }, cursor: { x: 0.5, y: 0.5 }, actors: [{ uid: 'x', zone: 'warband', slot: 0, role: 'nope', atk: 3, hp: 4 }, 42] }, byDef: {} }
    const out = normalizeStages(raw)
    expect(out.last.source.x).toBe(1)          // clamped
    expect(out.last.actors[0].role).toBe('none') // invalid role coerced
    expect(out.last.actors).toHaveLength(1)      // the `42` dropped
  })
})
```

- [ ] **Step 2: Run to verify fail** — `cd packages/ui && npx vitest run src/fx/ui/stageModel.test.ts` (module missing).
- [ ] **Step 3: Implement `stageModel.ts`** per the Interfaces block. Pure; no `Math.random`; no DOM/React.
- [ ] **Step 4: Run to verify pass.** `npm run typecheck` (root) clean.
- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/stageModel.ts packages/ui/src/fx/ui/stageModel.test.ts
git commit -m "feat(fx): pure stage-setter model (actors, points, roles, normalize)"
```

---

## Task 2: `stageStore` — per-effect saved stages persistence

**Files:**
- Create: `packages/ui/src/fx/ui/stageStore.ts`
- Test: `packages/ui/src/fx/ui/stageStore.test.ts`

**Interfaces:**
- Consumes: `normalizeStages`, `SavedStages`, `StageState`, `DEFAULT_STAGE` from `./stageModel`.
- Produces (mirror `defStore.ts`'s guarded-storage style; a module-level in-memory cache so tests can run without a real `localStorage`):
  - `const STAGES_KEY = 'ascent.fx.stages.v1'`
  - `function loadStages(): SavedStages` — read + `normalizeStages`; returns `{ byDef:{}, last: DEFAULT_STAGE }` when storage is absent.
  - `function saveStageFor(defId: string | null, stage: StageState): void` — writes `last = stage`, and if `defId` non-empty `byDef[defId] = stage`; persists.
  - `function stageFor(defId: string | null): StageState` — `byDef[defId] ?? last ?? DEFAULT_STAGE`.
  - All storage access guarded (`typeof localStorage === 'undefined'`), degrade to the in-memory cache.

- [ ] **Step 1: Write tests** injecting a fake storage (or exercise the in-memory path when `localStorage` is undefined). Cover: `stageFor` returns per-def when set, else last; `saveStageFor(null, s)` updates last but no byDef entry; round-trip through `loadStages` after a save; junk in storage → normalized default (delegate to `normalizeStages`, already tested — here assert the store returns a valid `SavedStages`).

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { loadStages, saveStageFor, stageFor, STAGES_KEY } from './stageStore'
import { DEFAULT_STAGE, setPoint } from './stageModel'

describe('stageStore', () => {
  beforeEach(() => { try { localStorage?.removeItem(STAGES_KEY) } catch { /* no storage */ } })
  it('stageFor falls back to last then default', () => {
    expect(stageFor('unknown')).toEqual(DEFAULT_STAGE)
  })
  it('saveStageFor(defId) round-trips per def', () => {
    const s = setPoint(DEFAULT_STAGE, 'source', { x: 0.1, y: 0.2 })
    saveStageFor('coin', s)
    expect(stageFor('coin').source).toEqual({ x: 0.1, y: 0.2 })
  })
  it('saveStageFor(null) sets last but not a def entry', () => {
    const s = setPoint(DEFAULT_STAGE, 'target', { x: 0.9, y: 0.5 })
    saveStageFor(null, s)
    expect(stageFor(null).target).toEqual({ x: 0.9, y: 0.5 })
    expect(stageFor('brand-new').target).toEqual({ x: 0.9, y: 0.5 }) // falls to last
  })
})
```

> If the test env has no `localStorage`, the store's in-memory cache still makes these pass — the point is the resolution logic, not the DOM storage. Implement so both paths behave identically.

- [ ] **Step 2: Run to verify fail.** **Step 3: Implement.** **Step 4: Run pass + typecheck.**
- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/stageStore.ts packages/ui/src/fx/ui/stageStore.test.ts
git commit -m "feat(fx): per-effect saved-stage persistence (last-used per def)"
```

---

## Task 3: `StageCard` — the FX-query-faithful mock card

**Files:**
- Create: `packages/ui/src/fx/ui/StageCard.tsx`
- Modify: `packages/ui/src/styles.css`

**Interfaces:**
- Consumes: `StageActor`, `StageRole` from `./stageModel`.
- Produces:
  - `interface StageCardProps { actor: StageActor; selected: boolean; onSelect: () => void; onPointerDownDrag: (e: React.PointerEvent) => void }`
  - `export function StageCard(props: StageCardProps): React.ReactElement`

**DOM contract (MUST match `reactTargets.ts` exactly):** the card root is `<div className="card ... " data-uid={actor.uid}>`; inside it a stat cluster with `<span className="badge atk"><span className="plate"/><span className="value">{atk}</span></span>` and `<span className="badge hp"><span className="plate"/><span className="value">{hp}</span></span>`. (These are the exact selectors `PART_SELECTOR` queries: `.badge.atk`, `.badge.atk > .plate`, `.badge.atk > .value`, etc.) A role badge shows the actor's role. The card is NOT the heavy real `<Card>` — it is a minimal structural mock with dummy stats; reuse the real card/badge CSS classes so it *looks* like a card and lays out with non-zero size.

- [ ] **Step 1:** Implement `StageCard.tsx` with the exact DOM above; `data-uid`, role badge, selected ring, drag hook. Reuse existing `.card`/`.badge`/`.plate`/`.value` styles; add only `.fxwb-stagecard*` extras.
- [ ] **Step 2: Verify the DOM contract** by a headless module test if practical (the repo's headless-DOM-dump pattern), OR assert via a tiny render check that `partElements` would find the parts — at minimum, a unit test that constructs the expected selectors against a jsdom-free structural string is overkill; instead rely on Task 7's owner-verify + a code review that the selectors match. (Do not fake a test.)
- [ ] **Step 3: CSS** for `.fxwb-stagecard` (draggable, role badge, selected). Cursor rule (grab form on the drag handle). No looping paint animation.
- [ ] **Step 4: Gates** — typecheck/lint/build green.
- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/StageCard.tsx packages/ui/src/styles.css
git commit -m "feat(fx): StageCard — lightweight FX-query-faithful mock card"
```

---

## Task 4: `StageSetter` — the canvas

**Files:**
- Create: `packages/ui/src/fx/ui/StageSetter.tsx`
- Modify: `packages/ui/src/styles.css`

**Interfaces:**
- Consumes: `StageState`, `StageActor`, ops (`addActor`/`removeActor`/`setActorRole`/`moveActor`/`setPoint`), `stageModel`; `StageCard`; `dragEdit` if useful for point drags.
- Produces:
  - `interface StageSetterProps { stage: StageState; onChange: (next: StageState) => void; selectedActor: string | null; onSelectActor: (uid: string | null) => void }`
  - `export function StageSetter(props: StageSetterProps): React.ReactElement`

**Behaviour:** Render a stage container with two zone rows: a **top** `<div data-zone="tavern"><div className="row">…tavern StageCards…</div></div>` and a **bottom** `<div data-zone="warband"><div className="row">…warband StageCards…</div></div>` (this ancestry is what makes `otherRowUids`/reach `board` work). Each row has an `＋ add card` control (`addActor(stage, zone)`). Dragging a card horizontally reorders its slot / drags between rows (call `moveActor`); selecting a card opens a small role picker (a segmented control → `setActorRole`) + a remove button. Render three **draggable point handles** — `source`, `target`, `cursor` — positioned by their fraction × the stage box; dragging a handle updates via `setPoint` (measure the stage rect once at pointerdown; convert pointer → fraction). All mutations go through `onChange(nextStage)`.

> The point handles are positioned relative to the **stage box**, but the scenario reads their rects in **viewport** coords (see Task 5) — keep the stage box full-bleed in the Stage region (or convert consistently). Simplest: the stage container fills the Stage region; the scenario reads `getBoundingClientRect()` of each handle/card (already viewport coords), so no manual fraction↔px conversion is needed at read time — the fractions are only for RENDERING the handle position and for persistence.

- [ ] **Step 1:** Implement the two-zone rows + add-card controls + card select/role/remove.
- [ ] **Step 2:** Implement the three draggable point handles (rect-once-at-pointerdown; pointer→fraction relative to the stage box; clamp 0..1; `setPoint`).
- [ ] **Step 3:** Card drag (horizontal reorder within a row + across rows) via `moveActor`.
- [ ] **Step 4: CSS** `.fxwb-stage-canvas`, `.fxwb-stage-zone`, `.fxwb-stage-handle` (source/target/cursor distinct colors), role picker. Cursor rule; no looping paint animation.
- [ ] **Step 5: Gates** green.
- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/fx/ui/StageSetter.tsx packages/ui/src/styles.css
git commit -m "feat(fx): StageSetter canvas — zone rows, point handles, roles"
```

---

## Task 5: The `stageSetter` scenario (reads the stage DOM)

**Files:**
- Modify: `packages/ui/src/fx/scenarios.ts`
- (Possibly) Modify: `packages/ui/src/fx/boardAnchors.ts` — only if a small shared reader helps; prefer reusing `anchorsFromRects`.

**Interfaces:**
- Produces: a new `FxScenario` with `id: 'stageSetter'`, `label: 'Stage setter'`, appended to `SCENARIOS` (BEFORE `realBoard` so both remain).
- `anchorsAt(viewport, cursor)`:
  1. Read the stage DOM (throttle like `readBoardAnchors`, ~200ms cache; `invalidate` on scenario switch is already called by the build effect via `invalidateBoardAnchors` — add a sibling `invalidateStageAnchors` OR share the throttle). Query the stage container by a stable attribute (e.g. `[data-fx-stage]`).
  2. **Source/target rects:** prefer the role-tagged actor (`[data-fx-stage] [data-role="source"]` / `[data-role="target"]`) rect; else fall back to the bare point handles (`[data-fx-stage] [data-handle="source"]` / `[data-handle="target"]`) rect; else the synthetic `bounceSpots` floor.
  3. Compute `{source, target, slot, camera}` via the existing `anchorsFromRects` (reuse it — do NOT re-derive); fold in `cursor` from the `[data-handle="cursor"]` rect (or the passed `cursor`). Return a FULLY-staged `FxAnchors` (synthetic floor + overrides) honoring `stageAll`.
- `hint`: a short string; optionally a getter reporting how many actors are staged.

> Because the scenario reads DOM by selectors (not React state), the Workbench build effect never rebuilds when the stage changes — matching how `realBoard` works. The `StageSetter` component only needs to be MOUNTED (Task 6) whenever this scenario is active.

- [ ] **Step 1:** Add a throttled stage-DOM reader (mirror `readBoardAnchors`/`anchorsFromRects` usage) — new small function in `boardAnchors.ts` or inline in `scenarios.ts`; reuse `anchorsFromRects` for the centre/slot/camera math.
- [ ] **Step 2:** Add the `stageSetter` `FxScenario` + append to `SCENARIOS`. Honor `stageAll` (synthetic floor).
- [ ] **Step 3:** Add a unit test for the pure reader helper if it's pure (e.g. given a rects object, produces the staged anchors) — reuse/extend `boardAnchors` tests. If it's DOM-bound, cover the pure `anchorsFromRects` path only (already tested) and rely on Task 7 owner-verify for the DOM read.
- [ ] **Step 4: Gates** green (incl. any new test).
- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/scenarios.ts packages/ui/src/fx/boardAnchors.ts
git commit -m "feat(fx): stageSetter scenario — anchors from placed actors/points"
```

---

## Task 6: Wire StageSetter into the Workbench + persist per-effect

**Files:**
- Modify: `packages/ui/src/fx/ui/Workbench.tsx`
- Modify: `packages/ui/src/styles.css`

**Behaviour:**
- Add `stage` state (`useState<StageState>`) seeded from `stageFor(currentDefId)` (last-used per effect). Render `<StageSetter stage={stage} onChange={setStage} selectedActor=… onSelectActor=… />` INSIDE the `.fxwb-stage` region **when `scenarioId === 'stageSetter'`** (else the region stays the transparent framed pane it is today). The StageSetter DOM must carry `data-fx-stage` on its container so the scenario's reader finds it.
- Persist: on `stage` change (debounced, like the session autosave) call `saveStageFor(currentDefId, stage)`. On load/def-switch, seed `stage` from `stageFor(newDefId)`.
- Do NOT change the build effect. The stage lives entirely in the Stage region DOM + the scenario reader. `invalidateStageAnchors()` on scenario/def switch if you added one.
- `currentDefId` = the effect's id/slug the workbench is editing (reuse whatever the save box uses as the def name/slug; if none, use `null` → the global `last`).

- [ ] **Step 1:** Add `stage`/`selectedActor` state seeded from `stageFor(...)`; render `<StageSetter/>` in `.fxwb-stage` gated on the active scenario. Add `data-fx-stage`.
- [ ] **Step 2:** Debounced `saveStageFor(defId, stage)` on change; re-seed on def switch.
- [ ] **Step 3: CSS** for the stage-in-region layout (fills `.fxwb-stage`, doesn't overflow, scrolls if needed). Cursor rule.
- [ ] **Step 4: Gates** — typecheck/lint/build green; full `npm test`.
- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/Workbench.tsx packages/ui/src/styles.css
git commit -m "feat(fx): mount StageSetter in the stage region + persist per effect"
```

---

## Task 7: Verification + polish

**Files:** as needed (bug-fix only).

- [ ] **Step 1:** Full gate suite green: `npm run typecheck && npm run lint && npm test && npm run build:web`. Report the test count.
- [ ] **Step 2:** Sanity (owner-verifiable): select the "Stage setter" scenario → the stage canvas appears in the centre region with two rows + source/target/cursor handles; drag a handle → a point-anchored effect (e.g. a bolt source→target) follows it; add two cards, tag one `source` one `target` → the effect anchors to the CARDS; a `react`-based effect targeting a staged card animates its badges (proving the mock DOM is FX-query-faithful); switch effects and back → the stage is remembered; `realBoard` still works. Capture a note/screenshot.
- [ ] **Step 3:** Confirm the three residue behaviours still use `realBoard` (unchanged) and that selecting `stageSetter` does not disturb the build effect / playback.
- [ ] **Step 4: Commit** any fixes.

```bash
git add -A packages/ui/src
git commit -m "fix(fx): stage setter polish"
```

---

## Self-Review notes (author)

- **Spec coverage (§4):** composable stage replacing `realBoard` as an authoring canvas (Tasks 4–6); two facing rows of real-DOM mock cards for reach/react (Tasks 3–4); roles per actor (Tasks 1,4); draggable source/target/cursor + per-layer travel already handled by the anchor system (Task 5); saved named stages + last-used per effect (Tasks 1,2,6); `realBoard` residue kept (Task 5 appends, doesn't replace). **Deferred (noted in PR):** gradient backdrops, scoped cue-preview, extra head-motion presets, a full library of pre-authored named stages (v1 persists the author's own stage per effect; a seed library of presets is v2).
- **Integration seam:** the whole feature is a new `FxScenario` + a component that renders the stage DOM it reads — zero build-effect change, mirroring `realBoard`. This is the lowest-risk way to add a stage.
- **The real-Card-DOM risk** is retired by the lightweight `StageCard` that replicates only the queried DOM (Task 3) — covering react/reach/stat-roll without the heavy `<Card>` or the static-board violation.
- **Type consistency:** `StageState`/`StageActor`/ops (Task 1) consumed by Tasks 2–6; `stageFor`/`saveStageFor` (Task 2) consumed by Task 6; the scenario (Task 5) reads DOM the StageSetter (Task 4) renders.
- **Test honesty:** the pure model + persistence + anchor math are unit-tested; the canvas + DOM read are owner-verified (like the other phases' UI), reusing the already-tested `anchorsFromRects`.
- **Risk:** the DOM read (Task 5) + the mount gating (Task 6) are the integration hinges — the reviewer must confirm `stageAll` is honored (no unstaged anchor) and that the build effect is untouched.
