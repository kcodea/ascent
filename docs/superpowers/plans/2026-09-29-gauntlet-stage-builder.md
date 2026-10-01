# Gauntlet — PR 2 (Stage Builder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A DEV-only Stage Builder: pick a Gauntlet stage, click a round 1–10, see and edit that round's opponent board
(cards, stats, golden, added keywords, order, tier), set the stage's opponent name and round-6 / round-9 runes, test the
round in the Scene Builder's fight flow, and **Save all edits** into the stage's JSON file in the repo.

**Architecture:** The Stage Builder is the Scene Builder sandbox run plus a second floating dev panel. A small zustand
store (`stageBuilderStore`) holds the stage DRAFT (source of truth) and the selected round. The selected round is
PINNED as the sandbox's served opponent board (`servedBoards[wave]` + `sandboxFoeWave`), so the existing tavern enemy
row, `UnitEditor` and End Turn → fight flow all work unchanged; edits made either in the panel or in the tavern row
flow back into the draft through one pure converter pair. Save posts the draft to a dev-server endpoint that writes
`packages/content/src/gauntlet/stages/NN-<name>.json`.

**Tech Stack:** React 18 + Zustand (packages/ui), Vite dev plugin (apps/web), Vitest (+ jsdom docblock for components).

**Spec:** `docs/superpowers/specs/2026-09-29-gauntlet-design.md` §3 · Builds on PR 1 (`docs/superpowers/plans/2026-09-29-gauntlet-engine.md`).

## Global Constraints

- DEV build only: every entry point sits behind `import.meta.env.DEV`; the plugin is `apply: 'serve'`. Players never see it.
- Reuse, don't copy, the Scene Builder's editing: the sandbox run, `sandboxEdit.ts` helpers, `UnitEditor`, `StatBadgeField`, the `Sec` look.
- Per round: Tier (blank = `GAUNTLET_DEFAULT_TIERS[round-1]`, shown as the hint), minions ≤ 7 with Golden + added keywords.
- Per stage: opponent name; rune slots on rounds 6 and 9 only; runes with no combat effect for an opponent
  (`Object.keys(runeCombatModsFor([id])).length === 0`) shown greyed with a "no effect for opponents" badge.
- Warnings: red for a missing card id (from `validateStage`); amber "changed since saved" (from `stageDrift`).
- Copy from previous round; Test this round (pin + normal End Turn fight, opponent runes active); Save all edits
  (validate with `validateStage` first, stamp every minion's `cardVersion = cardRevision(def)`, write via the plugin).
  Unsaved rounds show a dot; leaving with unsaved edits asks to confirm.
- UI conventions (CLAUDE.md): portal into `stageHost()`; no raw `vw`/`vh`; no bare `cursor: pointer`; never `title=`.
- v1 edits the stage files that exist (1–5). Slots 6–10 show as disabled "no file yet"; adding a stage = add its JSON +
  one import in `packages/content/src/gauntlet/index.ts` (a code change, by design).
- Not in v1: multi-step undo (beyond Discard), duplicating a whole stage.
- Branch `feat/gauntlet-stage-builder` off `feat/gauntlet-engine`. Gate: `npm run typecheck && npm run lint && npm test && npm run build:web`.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `packages/ui/src/stageBuilder/stageDraft.ts` | create | Pure: round ⇄ BoardSnapshot, added-keyword diff, copy/move, dirty compare, save stamping |
| `packages/ui/src/stageBuilder/stageDraft.test.ts` | create | Pure tests |
| `packages/ui/src/sandboxEdit.ts` | modify | `toggleEnemyGolden`, `moveEnemy` |
| `apps/web/gauntletStagePlugin.ts` (+ `.test.ts`) | create | DEV GET/POST `/__gauntlet/stage` |
| `apps/web/vite.config.ts` | modify | register plugin; ignore the stages dir in the watcher |
| `packages/ui/src/stageBuilder/stageBuilderApi.ts` | create | fetch wrappers for the endpoint |
| `packages/ui/src/stageBuilder/stageBuilderStore.ts` (+ `.test.ts`) | create | draft/round/dirty state + actions + pin sync |
| `packages/ui/src/stageBuilder/StageBuilder.tsx` (+ `.test.tsx`) | create | the panel |
| `packages/ui/src/stageBuilder/runeEffect.ts` | create | cached "does this rune act for an opponent" |
| `packages/ui/src/UnitEditor.tsx`, `packages/ui/src/Recruit.tsx` | modify | optional Golden toggle for the enemy editor |
| `packages/ui/src/Title.tsx`, `packages/ui/src/Game.tsx` | modify | DEV "Stage Builder" button + panel mount |
| `packages/ui/src/styles.css` | modify | panel styles (reuse `.sfxmix` / Scene Builder classes) |

---

### Task 1: Pure draft ⇄ board conversion (+ two sandboxEdit helpers)

**Files:** Create `packages/ui/src/stageBuilder/stageDraft.ts`, `stageDraft.test.ts`; modify `packages/ui/src/sandboxEdit.ts` (+ its test file if one exists — `grep -l sandboxEdit packages/ui/src/*.test.ts`).

**Interfaces — Produces:**
```ts
roundTier(stage: GauntletStage, round: number): number            // explicit tier or GAUNTLET_DEFAULT_TIERS[round-1]
activeRunes(stage: GauntletStage, round: number): string[]         // round6 from 6, round9 from 9
roundToSnapshot(stage: GauntletStage, round: number, wave: number): BoardSnapshot
snapshotToRound(snap: BoardSnapshot, prev: GauntletRound): GauntletRound
copyPreviousRound(stage: GauntletStage, round: number): GauntletStage
moveMinion(stage: GauntletStage, round: number, from: number, to: number): GauntletStage
roundsEqual(a: GauntletRound, b: GauntletRound): boolean
stampForSave(stage: GauntletStage): GauntletStage                  // every minion's cardVersion = cardRevision(def)
toggleEnemyGolden(snap: BoardSnapshot, index: number): BoardSnapshot     // sandboxEdit.ts
moveEnemy(snap: BoardSnapshot, from: number, to: number): BoardSnapshot  // sandboxEdit.ts
```

Rules the code must follow:
- `roundToSnapshot` = `stagedBoard(wave, minions, roundTier(stage, round))` where each minion is
  `{ cardId, attack, health, golden?, keywords? }`; `keywords` is set ONLY when `addedKeywords` is non-empty, to
  `[...new Set([...printed, ...added])]` (a BoardMinion's `keywords` overrides the printed set — same rule as
  `omenBoardMinions` in `packages/sim/src/lobby/tutorialSeats.ts`). When `activeRunes` is non-empty, also set
  `snapshot.runes = active` and `snapshot.questMods = runeCombatModsFor(active)` so a Test fight has the runes.
  (Check `stagedBoard`'s `tier` default and pass the round tier explicitly.)
- `snapshotToRound` maps each BoardMinion back: `addedKeywords` = its `keywords` minus the card's printed keywords
  (omit when empty; when `keywords` is undefined there are none added); `golden` only when true; `cardVersion` carried
  from the same-index-and-same-cardId minion in `prev` if there is one, else `cardRevision(def)`. The round keeps
  `prev.tier` (the pin's tier is presentation; the draft's tier field is the source of truth).
- `copyPreviousRound` on round 1 is a no-op; otherwise deep-copies round−1's board (and tier) into `round`.
- `moveMinion` / `moveEnemy` clamp indices and are no-ops when out of range.
- `toggleEnemyGolden` flips `golden` on one enemy (absent ⇄ true), recomputing nothing else.
- Pure: never mutate inputs; `Math.random` not used.

- [ ] **Step 1: Write failing tests** covering: round-trip identity (`snapshotToRound(roundToSnapshot(s, r, w), s.rounds[r-1])` deep-equals the round for a round with golden + added keywords + a card with printed keywords); added-keyword diff (printed keywords never appear in `addedKeywords`); `activeRunes` for rounds 5/6/9/10 with both runes set; `roundToSnapshot` carries `questMods.rallyExtraAlways === 1` at round 6 with `round6: 'rune_adventuring'` and no `runes` key at round 5; `roundTier` default vs explicit; `copyPreviousRound` (round 1 no-op, round 4 copies round 3 and does not alias); `moveMinion`; `roundsEqual`; `stampForSave` sets `cardVersion` to `cardRevision(CARD_INDEX[id])`; `toggleEnemyGolden` / `moveEnemy`.
  Build fixtures from real cards (`Object.values(CARD_INDEX).find(...)`) as `packages/sim/src/lobby/gauntlet.test.ts` does.
- [ ] **Step 2:** `npx vitest run packages/ui/src/stageBuilder/stageDraft.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement. Imports: `@game/content` (`CARD_INDEX`, `cardRevision`, `GauntletStage`, `GauntletRound`), `@game/sim` (`GAUNTLET_DEFAULT_TIERS`, `runeCombatModsFor`, `BoardSnapshot`), `../sandboxEdit` (`stagedBoard`). Public entrypoints only.
- [ ] **Step 4:** Run the test → PASS; run `npx vitest run packages/ui/src/sandboxEdit` (or its test file) → PASS.
- [ ] **Step 5:** Commit `feat(ui): Stage Builder draft ⇄ board conversion`.

---

### Task 2: DEV endpoint `/__gauntlet/stage` + client API

**Files:** Create `apps/web/gauntletStagePlugin.ts`, `apps/web/gauntletStagePlugin.test.ts`, `packages/ui/src/stageBuilder/stageBuilderApi.ts`; modify `apps/web/vite.config.ts`.

Model it on `apps/web/qaScenarioPlugin.ts` (read it fully): one pure validation function unit-tested without a server,
a thin middleware shell, `apply: 'serve'`, fixed destination directory, filename never from a client path.

**Interfaces — Produces:**
```ts
// plugin (pure)
planStageSave(body: unknown, existingFiles: readonly string[]): { error: string } | { fileName: string; text: string }
planStageRead(numberParam: string | null, existingFiles: readonly string[]): { error: string } | { fileName: string }
// client
loadStage(n: number): Promise<GauntletStage>          // GET  /__gauntlet/stage?number=N
saveStage(stage: GauntletStage): Promise<{ ok: true; path: string } | { ok: false; error: string }>  // POST /__gauntlet/stage
```
- Directory: `packages/content/src/gauntlet/stages/` resolved from the plugin file (as qaScenarioPlugin does).
- A stage number maps to the ONE existing file whose name starts with its two-digit prefix (`01-`…`10-`); no match →
  error "stage N has no file yet". `number` must be an integer 1–10.
- POST body `{ stage }`: object; `stage.number` integer 1–10; `stage.rounds` an array; serialized text
  (`JSON.stringify(stage, null, 2) + '\n'`) ≤ 256 KB. Deep validation is `validateStage`, run by the CLIENT before posting
  (and by CI on the committed file) — the plugin only guards the filesystem, exactly like qaScenarioPlugin.
- Register in `vite.config.ts`'s plugins array. Add the stages directory to `server.watch.ignored` (merge with any
  existing value) so a Save does not force a page reload that would throw away the sandbox; document in a comment that
  the running game keeps the bundled stage data until the dev server restarts, while the Stage Builder always reads
  from disk via GET.
- Tests (`gauntletStagePlugin.test.ts`): valid save → `01-demons.json` + pretty text with trailing newline; bad number
  (0, 11, 1.5, "1"), missing file for number 7, non-object body, oversize → errors; read maps `"3"` → `03-dragons.json`.

- [ ] Steps: failing tests → implement plugin + register + api → `npx vitest run apps/web/gauntletStagePlugin.test.ts` → commit `feat(web): DEV /__gauntlet/stage endpoint for the Stage Builder`.

---

### Task 3: Stage Builder store + launch + pin sync

**Files:** Create `packages/ui/src/stageBuilder/stageBuilderStore.ts`, `stageBuilderStore.test.ts`; modify `packages/ui/src/store.ts` (one action), `packages/ui/src/Title.tsx`, `packages/ui/src/Game.tsx`.

**Interfaces — Produces** (a separate zustand store so `store.ts` only gains a launch action):
```ts
interface StageBuilderState {
  open: boolean;
  stageNumber: number;                 // 1..10
  saved: GauntletStage | null;         // last loaded/saved copy (for dirty compare + Discard)
  draft: GauntletStage | null;
  round: number;                       // 1..10
  status: string | null;               // last save/load message
  openBuilder(n?: number): Promise<void>;       // loads via loadStage (falls back to gauntletStage(n) from @game/content if the fetch fails)
  selectStage(n: number): Promise<void>;        // refuses (sets status) when dirty unless force=true … see below
  selectRound(r: number): void;                 // re-pins
  editDraft(fn: (s: GauntletStage) => GauntletStage): void;  // then re-pins the selected round
  syncFromPin(): void;                           // reads foeSnapshotOf(run) → snapshotToRound → draft (if changed)
  discard(): void;                               // draft = saved
  save(): Promise<void>;                         // validateStage → stampForSave → saveStage → saved = draft
  close(): void;
  dirtyRounds(): number[];                       // rounds where !roundsEqual(draft, saved); stage-level fields count as round 0
}
```
- `pinRound()` (internal): `const run = useGame.getState().run`; write `servedBoards[run.wave] = roundToSnapshot(draft, round, run.wave)` and `sandboxFoeWave = run.wave` via `useGame.setState` (mirror SceneBuilder's `mutate` pattern and Recruit's `applyFoe`). An EMPTY round cannot be pinned (the rig refuses an empty board) — pin `null`-free: leave the previous pin cleared (`servedBoards[wave]` deleted, `sandboxFoeWave` undefined) and set `status` to "Round N is empty — add a minion".
- Pin sync: subscribe to `useGame` (in `openBuilder`, unsubscribe in `close`): when `run.wave` changes (after a Test fight), re-pin the selected round; when the pinned snapshot changes by an edit made in the tavern row (the pin object identity changes and it's not the one we just wrote), call `syncFromPin()`.
- Launch: add `startStageBuilder(stage?: number)` to `store.ts` = `startSceneBuilder()` then `useStageBuilder.getState().openBuilder(stage ?? 1)`. Title: a DEV-only `menubtn` "Stage Builder" next to the Scene Builder button (`Title.tsx` ~250, same markup). Game.tsx: `{import.meta.env.DEV && sandbox && stageBuilderOpen && <StageBuilder />}` next to the SceneBuilder mount (Task 4 creates the component; in this task mount a placeholder import only if Task 4's file exists — otherwise add the mount in Task 4).
- Leaving: `close()` when dirty returns without closing and sets `status` to require confirmation; the panel (Task 4) shows the confirm. Provide `close(force?: boolean)`.
- Tests (node env, store-only like `packages/ui/src/sceneBuilderLaunch.test.ts` — read it): `startStageBuilder` opens a sandbox with the stage pinned (mock `loadStage` via `vi.mock('./stageBuilderApi')` to return a fixture stage with a non-empty round 1); `selectRound(2)` re-pins; `editDraft` marks the round dirty and re-pins; a tavern-style edit (replace `servedBoards[wave]` with `setEnemyStats(...)`) followed by `syncFromPin()` updates the draft; `save()` refuses an invalid draft (status contains the validateStage issue) and on success calls `saveStage` with stamped versions and clears dirty; `close()` while dirty stays open, `close(true)` closes; `discard()` restores.

- [ ] Steps: failing tests → implement → `npx vitest run packages/ui/src/stageBuilder` → commit `feat(ui): Stage Builder store, launch and board pin sync`.

---

### Task 4: The Stage Builder panel

**Files:** Create `packages/ui/src/stageBuilder/StageBuilder.tsx`, `StageBuilder.test.tsx`, `runeEffect.ts`; modify `packages/ui/src/styles.css`, `packages/ui/src/Game.tsx` (mount, if not done in Task 3).

Build it like `SceneBuilder.tsx` (read it): a floating draggable dev panel using `useDraggablePanel('stagebuilder')`,
foldable sections in the same look (copy the tiny `Sec` pattern or export `Sec` from SceneBuilder.tsx and reuse it —
prefer exporting), hover previews via `SceneBuilderPreview` if convenient. Sections top to bottom:

1. **Stage** — a row of 10 stage buttons (`1 Demons` … from `GAUNTLET_STAGES`; 6–10 disabled "no file yet"); opponent-name text input (`editDraft`); a status line.
2. **Rounds** — buttons 1–10; the selected one highlighted; a dot on each dirty round (from `dirtyRounds()`); a red
   marker on a round with a `validateStage` issue mentioning it; an amber marker on a round with `stageDrift` entries.
   Buttons: **Copy from previous round**.
3. **Round N** — Tier: a number input 1–6 with an empty value meaning default, placeholder `default: <GAUNTLET_DEFAULT_TIERS[N-1]>`;
   the minion list (≤7): card name, `StatBadgeField` attack/health, Golden toggle, added-keyword toggles from
   `EDITABLE_KEYWORDS` (showing printed keywords as locked-on), ◀ ▶ move, ✕ remove, amber "changed since saved" tag
   per drifted minion; a card search box (same `hay`/`matches` approach as SceneBuilder's Library over
   `Object.values(CARD_INDEX)` minus spells) whose results have "+ add" (disabled at 7). All edits go through
   `editDraft` with `stageDraft.ts` helpers.
4. **Runes** — two selects, "From round 6" and "From round 9", options = `[...RUNES, ...EPIC_RUNES]` (+ "none").
   `runeEffect.ts` exports `runeActsForOpponent(id): boolean` = `Object.keys(runeCombatModsFor([id])).length > 0`,
   memoized in a module `Map`. Options without an effect render greyed with the suffix "— no effect for opponents".
   Measure the first full pass (all runes); if it exceeds ~150 ms, fill the cache in idle chunks
   (`setTimeout` batches of 20) and render unknown ones normally until computed. Report the measurement.
5. **Actions** — **Test this round** (re-pins and shows the hint "End Turn to fight it"), **Save all edits**
   (disabled when nothing is dirty; shows the status), **Discard**, **Close** (when dirty: an inline two-step
   "Unsaved edits — Close anyway?" confirm like Title's `confirmClear` arm-to-confirm pattern).

Every button uses the global cursor rule (no bare `cursor: pointer`); no `title=` (use `aria-label` / `.gtip[data-tip]`);
portal/popovers into `stageHost()`.

Test (`// @vitest-environment jsdom`, `mount` from `packages/ui/src/renderedText.mount.tsx`, pattern of
`packages/ui/src/sceneBuilderPanel.test.tsx` — read it; mock `./stageBuilderApi`): the panel renders the 10 stage
buttons with 6–10 disabled; clicking round 3 selects it; editing a stat marks round 3 dirty (dot rendered); Save is
disabled until dirty and calls the mocked `saveStage` when clicked; a no-effect rune option carries the badge text;
Close while dirty shows the confirm.

- [ ] Steps: failing test → implement → run the test + `npx vitest run packages/ui/src/stageBuilder packages/ui/src/stageTripwire.test.ts` → commit `feat(ui): Stage Builder panel`.

---

### Task 5: Golden toggle on the tavern enemy editor

**Files:** Modify `packages/ui/src/UnitEditor.tsx` (optional props `golden?: boolean; onToggleGolden?: () => void` → a
"Golden" toggle rendered only when `onToggleGolden` is given), `packages/ui/src/Recruit.tsx` (the enemy `<UnitEditor>`
around `:7626-7655`: pass `golden` from the pinned minion and `onToggleGolden` → `applyFoe(toggleEnemyGolden(snap, index))`).
Test: extend an existing UnitEditor/Recruit sandbox test if one exists (`grep -rl UnitEditor packages/ui/src/*.test.*`),
else add a jsdom test mounting `UnitEditor` asserting the toggle renders only with the handler and calls it.
Commit `feat(ui): golden toggle on the sandbox enemy editor`.

---

### Task 6: Docs, full gate, PR

- Devlog `docs/devlog/2026-09-29-gauntlet-stage-builder.md` (how to open it, the draft/pin model, that Save writes the
  stage JSON and needs a normal commit + PR, that the running game keeps bundled stage data until a dev-server restart,
  how to add stage 6–10 files).
- No `patchNotes.ts` entry (dev tool). No oracle rule (no player-facing behaviour, no bug fix).
- Full gate: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:web` — each separately, report summaries.
- `git diff --stat` review; push; PR (base `main` once PR 1 has merged, else base `feat/gauntlet-engine`).
