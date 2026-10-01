# Gauntlet — PR 3 (Player screens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players can pick **Gauntlet** in the Play menu, choose an unlocked stage, pick any hero, play the 10 rounds
with Gauntlet HUD/timer/caps, and land on a Gauntlet win or loss screen (Retry / Next stage / Home). Stage unlocks are
tracked on the device in this PR (account storage + crates are PR 4). "vs bots" leaves Practice.

**Architecture:** A `startGauntlet(stage)` store action sets `pendingMode: 'gauntlet'` + `pendingGauntletStage` and opens
the normal hero picker; `pickHero` gains a gauntlet branch calling `createGauntletRun`. A small `gauntletProgress` module
owns local unlock state. UI surfaces branch on `run.mode === 'gauntlet'`. Every run-end side effect meant for ladder /
practice runs is gated off for gauntlet.

**Tech Stack:** React 18 + Zustand (packages/ui), Vitest (+ `// @vitest-environment jsdom` for components, `mount` from `packages/ui/src/renderedText.mount.tsx`).

**Spec:** `docs/superpowers/specs/2026-09-29-gauntlet-design.md` §1, §4, §5 · Builds on PR 1 (`@game/sim`: `createGauntletRun`, `gauntletOutcome`, `runLossCap`, `roundLossCap`, `GAUNTLET_LOSS_CAPS`; `@game/content`: `GAUNTLET_STAGES`, `gauntletStage`).

## Global Constraints

- Rules (spec §1): 10 rounds; caps 5 (1–3) / 10 (4–6) / 15 (7–8) / none (9–10); clear = still standing after round 10's
  combat; normal shop/economy/tribes; any hero; no scouting of the opponent's next board; opponent runes visible in combat only.
- Timer: NO clock until the player has spent 30 Gold in the round (`run.goldSpentThisTurn >= 30`), then a 60-second
  countdown; at 0 it behaves exactly like the normal game's timeout (reorder + freeze still allowed; no buy/sell/roll/play).
- Stage select: 10 slots. Stage 1 unlocked; clearing N unlocks N+1. A stage whose data is `status: 'draft'` (or has no
  file: 6–10) shows "Coming soon" to players. In a DEV build, a draft stage with at least one non-empty round is playable
  and marked "Draft" so the author can test it. Locked / available / cleared states.
- Loss screen: "Defeated — Stage S, Round R" with **Retry** (→ hero select for the same stage) and **Home**. No replay button.
- Win screen: "Stage cleared!", "Stage N+1 unlocked" (when N < 10 and N+1 exists), **Next stage** (→ hero select for N+1,
  only if N+1 is playable) and **Home**. (Crate reveal is PR 4.)
- Mid-run quit resumes like a normal game (autosave already covers it — do not break it).
- A Gauntlet run must never rate, upload boards / run history / telemetry / practice rows, or record a replay draft.
- UI conventions (CLAUDE.md): `stageHost()` portals; no raw vw/vh or viewport @media; no bare `cursor: pointer`; never
  `title=`; performance — no looping paint animations.
- Player-facing text goes in `packages/ui/src/patchNotes.ts` (one entry for the Gauntlet launch).
- Branch `feat/gauntlet-screens` off `feat/gauntlet-stage-builder`. Gate: `npm run typecheck && npm run lint && npm test && npm run build:web`.

---

### Task 1: Start flow, local progress, run-end gates

**Files:** Create `packages/ui/src/gauntlet/gauntletProgress.ts` (+ `.test.ts`); modify `packages/ui/src/store.ts`,
`packages/ui/src/boardLibrary.ts` (~79), `packages/ui/src/replay/replayDraft.ts` (~94); test in a new
`packages/ui/src/gauntlet/gauntletStart.test.ts` (jsdom docblock like `packages/ui/src/sceneBuilderLaunch.test.ts`).

**Produces:**
```ts
// gauntletProgress.ts — device-local progress (PR 4 layers account storage on top of this module's API)
export const GAUNTLET_LOCAL_KEY = 'ascent.gauntlet.local';
export function clearedStages(): number[];                    // sorted, unique; [] when storage is empty/unreadable
export function recordClear(stage: number): { firstClear: boolean };
export function isStageUnlocked(stage: number, cleared?: readonly number[]): boolean;  // 1 always; else stage-1 cleared
export type StageSlotState = 'locked' | 'available' | 'cleared' | 'soon' | 'draft';
export function stageSlotState(stage: number, opts: { dev: boolean; cleared: readonly number[] }): StageSlotState;
export function isStagePlayable(stage: number, dev: boolean): boolean;   // exists + (ready, or dev && draft with a non-empty round)
// store.ts
startGauntlet: (stage: number) => void;      // refuses (no-op) unless isStagePlayable(stage, import.meta.env.DEV)
pendingGauntletStage?: number;
```
- `stageSlotState`: no playable data → `'soon'` (or `'draft'` in DEV when a draft has a non-empty round and is unlocked);
  else locked unless `isStageUnlocked`; else `'cleared'` if cleared, else `'available'`.
- Every localStorage access in try/catch (private mode / blocked storage), mirroring other `ascent.*` keys in store.ts.
- `startGauntlet(n)`: like `startLobby` — `{ showTitle: false, pendingMode: 'gauntlet', pendingGauntletStage: n, pendingSeed: seed, heroChoices: <ALL playable heroes>, avatarPickerOpen: false }`. "Any hero": use the same full-roster choice list Practice uses for `heroes: 'all'` (find `practiceHeroChoiceIds`), not the 3-hero roll.
- `pickHero`: add a branch before the existing ternary: `pendingMode === 'gauntlet'` → `createGauntletRun(seed, heroId, gauntletStage(pendingGauntletStage)!)` (guard: if the stage is missing, fall back to the title and do nothing). Clear `pendingGauntletStage` in the reset slice. Keep everything else in `pickHero` identical for other modes.
- Run end (store.ts ~1460-1470 big block): add `next.mode !== 'gauntlet'` to the gate so boards, run history, replay upload, rank and telemetry never fire. Then, in a separate small branch for `next.mode === 'gauntlet'` reaching gameover, call `recordClear(next.gauntletStage!)` when `gauntletOutcome(next) === 'cleared'` and store `{ gauntletResult: { stage, outcome, round, firstClear } }` in the store for the end screen (add that field; reset it in `RANK_SLICE_RESET`'s neighbour reset slice or wherever run-scoped end fields reset — find how `lastMatch` is reset).
- `boardLibrary.ts:79` and `replayDraft.ts:94`: exclude `'gauntlet'` alongside the existing exclusions.
- Tests: progress module (empty storage, record, first vs repeat clear, unlock chain, slot states incl. dev draft); store: `startGauntlet(1)` refuses while stage 1 is draft in non-DEV (mock `import.meta.env.DEV` via `vi.stubEnv` if needed, or test `isStagePlayable` directly and only the DEV path through the store), `pickHero` in gauntlet mode creates `mode: 'gauntlet'` with `gauntletStage` and a 2-seat lobby; a finished cleared gauntlet run records the clear and sets `gauntletResult`, and does not call the upload functions (spy on the imported `uploadBoards` / `uploadRunHistory` via `vi.mock` of their modules — find them).
  For the finished-run test you need a stage with boards: build a `GauntletStage` fixture in the test and inject it by mocking `gauntletStage` from `@game/content` (`vi.mock('@game/content', async (orig) => ({ ...(await orig()), gauntletStage: () => fixture }))`), or drive a run to gameover by constructing it with `createGauntletRun` and setting `phase: 'gameover'` + seat0 alive before dispatching — pick the simplest that exercises the real run-end code path.
- Commit `feat(ui): Gauntlet start flow, local stage progress, run-end gates`.

---

### Task 2: Play menu card + stage select

**Files:** Modify `packages/ui/src/Title.tsx`, `packages/ui/src/store.ts` (`TitleView` += `'gauntlet'`), `packages/ui/src/styles.css`; create `packages/ui/src/gauntlet/StageSelect.tsx` (+ jsdom test).
- Mode picker: add a **Gauntlet** `modecard` (`data-mode="gauntlet"`, `mcname` "Gauntlet", `mcdesc` "Survive 10 rounds against a hand-built foe.", art via `modeArt('gauntlet')` falling back to an emblem icon). Place it in the mode picker rows; add `.mcframe[data-mode='gauntlet']` gradient and whatever `data-mp` positioning the row needs (read the existing `data-mp` blocks at styles.css ~8311-8333 and fit the card without overlapping the others; verify with a quick DOM/CSS reasoning — the owner will eyeball it).
- `titleView === 'gauntlet'` → `<StageSelect/>` inside the same `SidebarHost className="modepick sb-host"` + `MenuSidebar` back-to-modes pattern the Learn hub uses (Title.tsx ~363-393). Title "GAUNTLET".
- `StageSelect`: 10 slots in order from `GAUNTLET_STAGES` (fill 6–10 as "Coming soon"). Each slot: number, stage name (or "???" when soon), tribe emblem when the stage has a tribe (find the tribe icon component used elsewhere, e.g. the tribe badge on cards), and its state from `stageSlotState(n, { dev: import.meta.env.DEV, cleared: clearedStages() })`: locked (lock icon, disabled, `aria-disabled`, a `.gtip[data-tip]` "Clear Stage N−1 to unlock"), available (clickable → `startGauntlet(n)`), cleared (✓ + clickable), soon (disabled "Coming soon"), draft (DEV only, clickable, "Draft" tag). Buttons use the global cursor rule.
- Test: renders 10 slots; with no progress stage 1 is the only non-locked playable slot in DEV when it's a draft with a non-empty round (use a mocked `GAUNTLET_STAGES` fixture via `vi.mock('@game/content', …)`), clicking an available slot calls `startGauntlet`, locked/soon slots are disabled.
- Commit `feat(ui): Gauntlet play-menu card and stage select`.

---

### Task 3: In-run Gauntlet HUD + run-aware caps

**Files:** Modify `packages/ui/src/LobbyPanel.tsx`, `packages/ui/src/CombatOpponent.tsx`, `packages/ui/src/HudBar.tsx`,
`packages/ui/src/FightRecap.tsx`, `packages/ui/src/heroBlast/heroStrikeDamage.ts`, `packages/ui/src/announcer.ts`,
the odds callers `packages/ui/src/Recruit.tsx` (~2194) and `packages/ui/src/replay/replayPlayer.ts` (~185); create
`packages/ui/src/gauntlet/GauntletPanel.tsx` (+ test); styles.css.
- Replace every UI `lossDamageCap(x)` with the run-aware answer: `runLossCap(run)` where a run is at hand, else
  `roundLossCap(lobby.rules, lobby.round)`. Pass the run-aware cap to `computeCombatOdds` / `createOddsProbe` (their new
  trailing `cap` parameter from PR 1). Normal modes must produce identical numbers (lobbies without `lossCaps` fall back).
- `Recruit.tsx` mounts `{run.lobby && <LobbyPanel …/>}` — for `run.mode === 'gauntlet'` mount `<GauntletPanel/>` instead:
  the stage's opponent name (`lobby.seats[1].label`), its tribe emblem (from `gauntletStage(run.gauntletStage)`), the
  player's own Resolve/Armor, **"Round N / 10"** (`lobby.round`, capped display at 10 after the final round), and the
  current cap "Max loss: N" / "No cap" (`roundLossCap`). No scouting: it must NOT show the opponent's upcoming board or
  any hover ScoutCard. Match the rail's look (`.lobbyhead` etc.) — read LobbyPanel.tsx first.
- `CombatOpponent.tsx`: for gauntlet, show the tribe emblem instead of the stand-in hero portrait and hide the
  hero-power icon (the opponent has no hero); keep name, health and the rune column (runes already flow from the seat's
  snapshot).
- announcer/music: leave gated off for gauntlet (ruling: v1 has no announcer lines for Gauntlet — several fire on
  seat counts and would misfire on a 2-seat table). Do enable music: `music.ts` `isMusicWanted` add `'gauntlet'`, and
  make sure `announcer.ts` `isAnnouncerWanted` does NOT then turn on for gauntlet (it currently aliases `isMusicWanted`;
  split it).
- Test: GauntletPanel renders name, "Round 3 / 10", "Max loss: 5" at round 3 and "No cap" at round 9, and no seat list;
  a lobby-mode HUD still shows `lossDamageCap` numbers (regression: e.g. round 8 → 15).
- Commit `feat(ui): Gauntlet in-run panel, opponent display and run-aware loss caps`.

---

### Task 4: The Gauntlet shop timer

**Files:** Modify `packages/ui/src/Recruit.tsx` (turnSeconds / infiniteClock ~1132, tick effect ~4570, ShopTimer ~7712),
maybe `packages/ui/src/turnClock.ts`; create `packages/ui/src/gauntlet/gauntletClock.ts` (+ test) holding the pure rule.
- Pure rule: `gauntletClockState(goldSpentThisTurn: number): 'waiting' | 'running'` with the threshold constant
  `GAUNTLET_CLOCK_GOLD = 30` and `GAUNTLET_CLOCK_SECONDS = 60`.
- Behaviour in Recruit for `run.mode === 'gauntlet'`: at the start of each recruit turn the clock is not running and
  the timer plaque shows a waiting state (e.g. "∞" / a dim "—", matching how unlimited practice shows ∞). The first time
  `goldSpentThisTurn` reaches ≥ 30 in that turn, set the clock to 60 and let it tick with the normal pause rules
  (`turnClockMayTick`). At 0 the existing `timeUp` gates apply unchanged. Next turn resets to waiting. Save/Continue
  mid-turn must keep working: if a resumed turn already had ≥ 30 spent, resume the saved seconds (existing
  `pendingResumeSeconds` path); if not, stay waiting.
- Keep other modes byte-identical (the normal `turnSeconds` formula untouched).
- Tests: pure rule; and a focused test of the Recruit clock integration only if there is an existing Recruit clock test
  pattern (`grep -rl turnClock packages/ui/src/*.test.*`) — extend it; otherwise test the helper that decides the
  clock value per turn (extract one: `gauntletTurnClock({ goldSpent, current, startedThisTurn })`).
- Commit `feat(ui): Gauntlet shop timer — 60s once 30 Gold is spent`.

---

### Task 5: Gauntlet end screen

**Files:** Create `packages/ui/src/gauntlet/GauntletEndScreen.tsx` (+ jsdom test); modify `packages/ui/src/EndScreen.tsx`
(insert before the `if (lobby)` branch, ~238, like the tutorial branch), styles.css.
- Reads `gauntletResult` from the store (Task 1) with a fallback derivation from the run (`gauntletOutcome`,
  `run.gauntletStage`, `run.lobby.round - 1` for the round reached — check the exact off-by-one: when defeated, the round
  the player fell on).
- Defeated: "Defeated" + "Stage S · Round R"; buttons **Retry** (`startGauntlet(S)`) and **Home** (`openTitle`).
- Cleared: "Stage cleared!" + stage name; "Stage N+1 unlocked" when stage N+1 exists and this was the first clear (or it
  is now available); buttons **Next stage** (`startGauntlet(N+1)`, shown only when `isStagePlayable(N+1, DEV)` and
  unlocked) and **Home**. Leave a clearly named empty slot/prop for the PR 4 crate reveal (e.g. a `reward` child area)
  without inventing crate UI.
- Reuse the existing end-screen look (read EndScreen.tsx / TutorialGraduationScreen for classes).
- Test: defeated renders stage/round + Retry/Home and Retry calls `startGauntlet(S)`; cleared renders Next stage only
  when N+1 is playable; Home calls `openTitle`.
- Commit `feat(ui): Gauntlet win and loss screens`.

---

### Task 6: Practice without bots, Good Luck intro, patch notes, docs, gate

- `PracticeOptions.tsx`: remove the "Opponents" and "Bot difficulty" rows (and the now-unused constants). Practice is
  always vs players: `loadPracticeConfig` (store.ts ~874) and `confirmPracticeSetup` force `opponents: 'players'` so an
  old persisted `bots` draft can't stick. Keep `PracticeConfig.opponents` in the sim type (Scene Builder uses bots
  internally via `startSceneBuilder`, and old saved runs/rows still carry it). Update any practice-options test.
- `goodLuck/goodLuckIntroStore.ts:72`: include `'gauntlet'` so the run opens like a normal game.
- `patchNotes.ts`: prepend a plain-English, spoiler-light entry: Gauntlet — a new single-player mode in the Play menu:
  10 stages, each a 10-round duel against a hand-built foe; survive all 10 rounds to clear it and unlock the next; the
  first stages are on their way. Practice no longer offers bots. (Match the file's entry shape.)
- Devlog `docs/devlog/2026-09-29-gauntlet-screens.md`.
- Full gate: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:web` — report real summaries.
- Commit(s) accordingly.
