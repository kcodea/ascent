# 2026-10-14 · Removing the old wave mode: audit and staged plan (phase 1, no code deleted)

Owner, verbatim: *"there are remnants of the old wave based mode that you can outright remove. we do not use that
mode ever anymore and dont need it anywhere. make sure it doesnt break our lobby/versus modes though"*

This is the audit and plan only. Nothing is deleted on this branch yet. Audited against `origin/main` at
`610486e86` (after #2075, #2077, #2079 merged). #2072 (Versus) and #2088 (Versus spectating, stacked) are still open.

## TL;DR

1. **No player can start the old mode today.** The Ascent and Rift doors were removed on 2026-09-30
   (`2026-09-30-continue-no-legacy-course.md`, R-PERSIST-01), and "Oath" was removed from all player text today
   (`2026-10-14-remove-oath-climb.md`, R-TERM-01). Old course saves are already discarded at boot.
2. **But the old mode's ENGINE is still load-bearing for live lobbies.** Generated (hybrid) lobby seats are
   recorded by `autoplayRun` (`sim/src/snapshot.ts:514`), which calls `createRun(seed, heroId)` with the default
   mode `'ascent'`: a 17-round course run that takes its own loss damage, ends at the course clock
   (`reducer.ts` `advanceCombat`, `wave >= CONFIG.courseRounds` → `victory`) or at Resolve 0, and fights
   wave-first pool picks (`nextOpponent` / `pickOpponent`). Live bot seats (`botSeat`, `lobby/seats.ts:200`) are
   lobby-less `'lobby'` runs that also progress against `pickOpponent`. Deleting the course clock, `pickOpponent`
   or the `'ascent'` default without a replacement silently changes every generated opponent in every lobby.
3. **`servedBoards` must stay.** It is also the hermetic foe pin for the Scene Builder / God Mode
   (`sandboxFoeWave`), QA scenarios, docbot trajectories, the FX harness and bug tools.
4. **The test suite runs on the old mode.** 1,741 `createRun` calls in 417 test files; ~1,600 of them (367 files)
   omit the mode and get `'ascent'`. Making the mode required, or changing the default to `'lobby'` (which skips
   own-damage and has no clock), breaks or hangs a large part of the suite.
5. **Two live bugs come from the old mode's leftovers** (below). They are the best first PR.

So the honest scope is: delete the old mode's *product surface* (UI, Line/Oath, rift, course victory, telemetry
labels, dead tools) and move the few engine behaviours that live code still needs into explicitly named,
non-mode homes. "Delete `'ascent'` from `RunMode`" is the last step, not the first.

## Live bugs found

### Bug 1: the `board_results` ledger credits a board nobody fought, every lobby round

- The reducer pins a wave-first pool pick into `servedBoards` on the first recruit action of every turn and again
  at `faceOmen`, in every mode, lobby included (`reducer.ts` ~905-911 and ~3759-3761).
- A lobby fight actually serves the paired seat (`lobbyOpponentBoard`, `reducer.ts` ~3833-3842), not that pin.
- `store.ts:1565-1572` gates only on `mode !== 'practice' && mode !== 'gauntlet' && !sandbox`, recomputes
  `nextOpponent(s.run)` (the unfought pin), and calls `recordFightResult` (`remoteBoards.ts:1798`). Result: one
  bogus `board_results` row per round of every ranked lobby AND tutorial game.
- Those rows come back through `fetchAndRegisterBoardRecords` (`store.ts:159`, `remoteBoards.ts` ~2141-2160) →
  `registerBoardRecords` → `selectionWeight` (`matchmaking.ts:76`) → `pickOpponent` (`opponents.ts:107`). The only
  consumer of that weighting today is the self-progression of bot/hybrid seats, so the pollution leaks into which
  boards generated lobby seats grow against. The per-round board log readers (`fetchPlayerRoundBoards`,
  `fetchBoardStats`) have no callers.
- Related, dormant: the archived spell Rival's Reflection (`spellDiscoverFromLastOpponent`, `recruit.ts` ~8596,
  `spellFizzle.ts` ~82) reads `servedBoards[wave - 1]`, so in a lobby it would discover from the unfought pin.
  Archived everywhere since 2026-10-10, so not live. Farseer's Report already reads the lobby seat first.

### Bug 2: every end screen runs course-only work, including a full re-simulation

`EndScreen.tsx` computes its course derivations as hooks and constants ABOVE its early returns (tutorial ~236,
gauntlet ~239, lobby ~240):
- `buildTags(run)` (~193) and `lineResult(run)` / `metLine` (~221-225) on every end screen;
- a `useMemo` that calls `replayRun({ seed, heroId, actions })` (~203-209) on every non-practice end screen
  (lobby, tutorial, gauntlet). It replays the whole action log under course rules with no seats, on the main
  thread, and the result is only used by the course screen's round pips. Pure waste at the moment the player
  lands on the result screen (performance north star).
- Separately, `runHistory.ts` ~126-142 calls `lineResult` + `buildTags` for every finished run and stores
  `line` / `lineStatus` / `completed` on every history entry (meaningless for a lobby).

## (a) What the old mode is in code

`RunMode` values `'ascent'` (also the meaning of an absent `mode`) and `'rift'`. Exclusive pieces:

| Piece | Where |
|---|---|
| Mode values + default | `state.ts:405` `RunMode`; `createRun(seed, hero, mode = 'ascent', line = CONFIG.defaultLine, setId, tribes)` ~2927; "absent = ascent" in `state.ts` ~784, `snapshot.ts` ~469/483, `runDerive.ts:509`, `runTelemetry.ts:35`, UI `perfCaptureScope.ts:39`, `bugReportCapture.ts:109`, `bugScenario.ts:88` |
| Line / Oath / calibration | `RunState.line`; `runRecord`'s calibration slice (no-op, `calibrationRounds: 0`), `isCalibrationRound`, `LineStatus`, `lineResult`, `metLine` (`state.ts` ~2820-2909); `CONFIG.calibrationRounds/courseRounds/defaultLine/maxWave` (`config.ts:12-23`); `buildTags.ts` ~163-174; `playerRating.ts` `lineForRating`/`resolveRunRating`, `store.ts` ~3160 `legacyRatingChangeOf`, `profileStore.ts` ~22 `currentLine` |
| Course clock | `advanceCombat` course victory (`reducer.ts` ~5427-5437, the only producer of phase `'victory'`); practice no-lobby curtain at `courseRounds` (~5402) |
| Own-damage for a lobby-less run | `settleCombat` (~5313): loss damage applies to the run only when mode is not practice/lobby/tutorial/gauntlet (Versus adds itself on #2072) |
| Wave-first matchmaking | `nextOpponent` + turn-boundary pinning (`reducer.ts` ~492-519, ~899-911), `faceOmen` served/procedural branch (~3745-3845), `opponents.ts` `pickOpponent`, `matchmaking.ts` (winrate weighting + loss-streak softener), `streakSoftened`/`lossStreak` |
| Rift | `config.ts` ~155-240 `RIFTS` (all three `enabled: false`), `activeRift`, `RIFT_BONUS_ARMOR`; pinned only when `mode === 'rift'` (`state.ts` ~2941); `s.rift === 'freedom'` / `'runic'` reads (`reducer.ts:291`, ~5673); UI `RiftPill.tsx`, `RiftButton.tsx`, `HudBar.tsx` ~21/80, `HeroSelect.tsx` ~76/176, `Recruit.tsx` ~7816-8232, rules-wiki `rift-mode` article (`rulesWiki/lobbyModes.ts` ~202, ~299-303), `tooltipRegistry.ts:93`. `maxTierFor(rift)` / `hasTier7Access` must stay (Tier 7 comes from Brackus / Summit cards) but `maxTierFor` collapses to a constant 6 |
| Course UI | `EndScreen.tsx` ~186-360 (course screen + derivations), `Game.tsx:474` `phase === 'victory'` screen, `HudBar.tsx` ~12-85 (`!lobby` plaque, pips, Max-loss row, `OpponentFrame`), `OpponentFrame.tsx` (whole file), `boardLibrary.ts` ~67-100 `saveRunBoards` + its `store.ts:1724` branch, `runHistory.ts` `careerStats` / `runVerdict` fallback (tests only), `announcer.ts` ~1206-1212 fallbacks, CSS (`.oppframe`, `.riftpill`, `.riftbtn`, `.endpip`, `.endtag`, `.endstat`, `.bar .alt`, `.rd-*`, `.wavecol`, `.maxdmg`, ~150-250 lines) |
| Persistence gates for legacy data | `parseSave` lobby-less drop (`store.ts` ~1036-1048), `isResumableRun`, `historyEntryWatchable`, `careerData.ts:337` |
| Telemetry labels | `TelemetrySource` `'ascent' | 'rift'` (`runTelemetry.ts:30`), `perfCaptureScope.ts` `CAPTURED_MODES = ['lobby', 'ascent']` |
| Course-era tools | npm `bot`, `analyze`, `report`, `report:export` (`sim/balanceReport.ts`), `bot:ladder` (superseded by `lobby:ladder`), `bot:rollouts`, `bot:tune`, `curve`, `player`, `board-gap.ts`; partly `perf`, `replay`, `balance`, `board:elo` |

## (b) Dependency table: what live code needs from each piece

| Piece | Live dependents | Verdict |
|---|---|---|
| UI entry doors (Ascent / Rift cards, `startAscent`, `startRift`) | none (gone 2026-09-30) | done already |
| Title throwaway run (`store.ts` 2110, 2177, 2335, 3242, 3266: `createRun(randomSeed())`) | the dormant run behind the title; never rendered or saved | **replace** (a lobby-less `'lobby'` shell, or explicit harness mode) |
| `pendingMode` `'ascent'`/`'rift'` mapping, HeroSelect rift pill | none reachable | **delete** |
| Course end screen, `victory` phase screen, HudBar `!lobby` plaque, `OpponentFrame`, Rift UI, `saveRunBoards` | none (every live run has a lobby) | **delete** |
| EndScreen derivations above the early returns | lobby / tutorial / gauntlet all pay for them (Bug 2) | **delete** (fixes Bug 2) |
| `runHistory` `line` / `lineStatus` / `completed` fields | written for every run, read by nothing live; old `run_history.entry` rows carry them | **stop writing**, keep the parser tolerant |
| `careerStats`, `runVerdict` course fallback | tests only | **delete** |
| `recordFightResult` call, `board_results` ledger client | Bug 1; `fetchAndRegisterBoardRecords` feeds the weighting below | **delete the write**; delete the read with the weighting |
| `matchmaking.ts` winrate weighting + streak softener | bot/hybrid seat self-progression via `pickOpponent` | **delete with owner OK** (changes generated seats' growth slightly; it already varies per client because records come from the network) |
| `pickOpponent` / `nextOpponent` / wave-first pool pick | `botSeat` + `autoplayRun` (generated lobby seats), `npm run pool` bootstrap | **must stay** until generated seats get another progression foe; turn-boundary pinning can be **gated to lobby-less runs** (stops the per-turn pool pick in every real lobby, which is also a small perf win) |
| `servedBoards` | Scene Builder / God Mode rig, QA scenarios, docbot, FX harness, bug tools, ~116 test lines | **must stay** (re-document as "the lobby-less foe pin", not course matchmaking) |
| Course clock (victory at `courseRounds`) | `autoplayRun` recording length (17 boards) → every hybrid seat; ~10 tests | **replace**: cap the recording at 17 boards inside `autoplayRun` (byte-identical, see below), then delete the clock and the `'victory'` phase |
| Lobby-less own-damage + Resolve-0 gameover | `autoplayRun` recordings (a recording can die early), ~1,600 test runs, docbot | **must stay**, keyed on "lobby-less, not versus" instead of on `'ascent'` |
| `'ascent'` as `createRun`'s default | 367 test files, docbot, tools, `autoplayRun`, `replayRun`, `reconstructRunTelemetry`, bug repro | **replace** by a named harness default (owner decision 1) |
| `'rift'` mode + `RIFTS` registry | none live (all disabled; only `mode === 'rift'` adopts one) | **delete** (owner decision 2); `maxTierFor` keeps its signature or becomes a constant |
| `CONFIG.courseRounds` / `defaultLine` / `calibrationRounds` / `maxWave` | `lineResult`, practice no-lobby curtain (only bare `createRun('practice')`, e.g. `perf-odds`), tools | **delete** after the clock and Line go; the curtain uses the lobby's 15 |
| `opponentPool.data.ts` + `npm run pool` | `store.ts:138` registers it; production bots `fightScore.ts:62` + `scout.ts` read it unfiltered; `botSeat`/`hybridSeat` self-progression; God Mode fallback; `lobby:ladder`, `board:elo` | **must stay** (never seats a lobby player; `snapshotSeats.ts:182` skips synthetic) |
| `rating.ts` "calibration ladders" | board strength rating | unrelated name clash, **keep** |
| Lobby (`createLobbyRun`, `runLobby`, `seatCombatSide`, settle) | everything | untouched |
| Practice / tutorial / gauntlet | own lobbies; tutorial/gauntlet use authored seats | untouched, except they stop paying Bug 2 |
| **Versus (#2072, #2088)** | `createRun(runSeed, heroId, 'versus', undefined, setId)` (positional `line`!), lobby-less, `faceOmen { deferFight }`, adds `'versus'` to the two `settleCombat`/`advanceCombat` mode lists, `TelemetrySource`, `RunMode`; spectator hides `servedBoards` | any change to `createRun`'s signature, `RunMode`, those two reducer lines or `TelemetrySource` **waits for #2072 to merge** |
| Balance self-play (`selfPlayLobby`, `pinnedLobby`, `strategy/benchmark`) | lobby-less `'lobby'` runs with `deferFight` | untouched (`'legacyCourse'` manifest mode already refused) |
| Replays v2 | `ReplayV2.mode: RunMode`; non-lobby `nextFoe` / served-board branches (`replayV2.ts` ~258, ~353; `ui/replay/synthRun.ts` ~21) used by synthRun/Stage Builder | keep the type tolerant of legacy strings; branches stay while `servedBoards` stays |
| Rules registry | R-PERSIST-01, R-REPORT-02/04, R-SNAP-01 cite the course; R-LOBBY-05/06/07 depend on `autoplayRun` + pool; R-PRESENT-09 on `servedBoards` | amend in the PR that changes each behaviour; add rules for the two bug fixes |

## (c) Data and back-compat

Nothing on the server is old-mode only, and no database change is needed for any step. Do not touch the DB.

- **Local `ascent.save`**: lobby-less saves are already dropped at boot (`parseSave`, R-PERSIST-01,
  `continueNoLegacyCourse.test.ts`). Risk: `deserialize` (`state.ts` ~3127) calls `createRun(seed, hero, mode)`
  before the gate. It must keep accepting `'ascent'`, `'rift'` and no mode without throwing (a throw still drops the
  save via the try/catch, but skips the warning). Keep that test as the regression check.
- **Cloud `saved_runs`**: stored as-is, adopted through the same `parseSave`; a course row fails to adopt and is
  replaced by the next real run. No action.
- **Replays**: v1 action replays are no longer viewable; every Watch path needs v2 (`isReplayV2`). No old-mode v2
  replays exist (telemetry/v2 capture are lobby-only since 2026-07-31 / 2026-08-19). Career Watch already skips
  non-lobby rows. Keep `ReplayV2.mode` and `Replay.mode` accepting legacy strings.
- **Career / Recent Games**: old course rows show "—" for placement and still count toward games played
  (`fetchCareerTotals`, the 2026-10-12 backfill). Untouched.
- **Bug capsules** (`bug_reports`): old capsules may carry `mode: 'ascent'` or none; `windowReplay.ts:68`,
  `bug-repro.lib.ts:131`, `bug-qa-scenario.lib.ts:70` must map legacy strings to the harness mode.
- **Telemetry**: uploads are lobby-only and the Balance Report keeps ladder rows only, so narrowing
  `TelemetrySource` hides nothing; old `'ascent'` rows stay in the table untouched.
- **Supabase objects that are legacy (list only, do not touch)**:
  - `board_results` (schema.sql ~69): course-era per-board ledger, currently polluted by Bug 1. After PR 1 it is
    write-dead; after PR 3 read-dead. Owner may later drop or archive it.
  - `runs` table / `uploadVictory` (schema.sql ~38): write-only (its reader `fetchVictories` has no caller), but
    lobby 1st places still write it. Not course-exclusive.
  - `submit_own_rating`, `rated_runs` (schema.sql ~345, ~419): the old client rating door, already revoked.
  - Comments in `profiles` / `run_telemetry` say "Ascent run"; `profiles.current_line` (if present) is a Line-era
    column. Cosmetic.
  - Everything else (submit-rating, settle_rank, progression with modes `ranked|practice|tutorial`, pool_runs,
    Hall of Champions, saved_runs, submit-bug-report defaulting to `'lobby'`) is lobby-native.

## Byte-identity of generated seats (the one subtle step)

`autoplayRun` captures one board per `faceOmen` and stops at `victory` (wave 17) or `gameover` (Resolve 0). With
the clock gone, a recording would run on. Capping it with `maxBoards = Math.min(maxBoards, RECORDING_WAVES)`
(`RECORDING_WAVES = 17`, a constant owned by `snapshot.ts`) yields the same prefix: the course run produced at most
17 boards and the run's own damage/death rules are unchanged. That PR must land a hash test over
`recordingFor(seed, hero)` for a spread of seeds × all heroes, written and green on `main` FIRST, then kept green
across the change. Same for `buildBootstrapPool` (`snapshot.test.ts`), which `npm run pool` uses.

## Owner decisions needed

1. **What replaces `'ascent'` as the engine default.** The lobby-less "takes its own damage, dies at Resolve 0"
   run is what tests, docbot, bug repro and generated-seat recordings run on. Options:
   - (A, recommended) a clearly internal value, e.g. `'solo'`, documented as "headless harness, never a player
     mode", default of `createRun`. Legacy `'ascent'`/`'rift'` map to it in `deserialize` and bug-capsule loading.
     Zero churn for the ~1,600 default calls; ~72 explicit `'ascent'` calls change.
   - (B) default `'lobby'` and re-key own-damage on "no lobby attached". Changes live `botSeat` (lobby-less
     `'lobby'` runs today never die), so it changes live lobbies. Not recommended.
   - (C) keep the string `'ascent'` but strip everything else. Least churn, but the name survives.
2. **Rifts**: delete the `'rift'` mode, `RIFTS` registry, Freedom/Runic/Summit and the rift rules-wiki article
   outright (all disabled since July)? Recommended yes; `maxTierFor` keeps Tier 7 via Brackus/Summit cards.
3. **Generated-seat matchmaking weighting**: OK to delete the winrate weighting + loss-streak softener
   (`matchmaking.ts`) and the `board_results` read? It shifts which boards bot/hybrid seats grow against (small,
   and already per-client today). Alternative: freeze the weighting off (`winrateWeighting: false`) first.
4. **Course-era tools**: delete `bot`, `analyze`, `report`, `report:export`, `bot:ladder`, `bot:rollouts`,
   `bot:tune`, `curve`, `player`, `board-gap`, or port any of them to the lobby? `balance:*` and `lobby:*` already
   cover balance work. Recommended delete; port `perf` and `replay` to a lobby run.
5. **`board_results` table**: leave it (write-dead after PR 1) or schedule a drop later? No DB work in this plan.
6. **History fields**: stop writing `line` / `lineStatus` / `completed` on new `run_history` entries (old rows keep
   them, the parser stays tolerant)? Recommended yes.

## (d) Staged plan, safest first

Line counts are rough net deletions.

| PR | Scope | Files | ~Lines | Waits for |
|---|---|---|---|---|
| **1. Fix the two live bugs** | Delete the `recordFightResult` call (`store.ts` ~1557-1573) and its upload-queue `'fight'` case + `recordFightResult`; move the course derivations in `EndScreen.tsx` below the lobby/tutorial/gauntlet returns (or delete them with PR 2's screen); stop `runHistory` calling `lineResult`/`buildTags` for lobby runs. Tests: lobby faceOmen never calls the ledger; a lobby end screen never calls `replayRun`. Rules: two new R- rules. Patch note: not gameplay (perf/data), no entry. | `ui/store.ts`, `ui/remoteBoards.ts`, `ui/EndScreen.tsx`, `ui/runHistory.ts` | -60 | nothing (UI only, no hot sim file) |
| **2. Delete the course UI** | Course end screen + `victory` screen in `Game.tsx`, HudBar `!lobby` plaque + `OpponentFrame.tsx`, `RiftPill`, `RiftButton`, rift bits in `Recruit`/`HeroSelect`/`instView`, rules-wiki rift article, `saveRunBoards`, `careerStats`/`runVerdict`, `perfCaptureScope` `'ascent'`, announcer/Game fallbacks, dead CSS; update the ~15 UI tests that assert `'ascent'` | ~25 UI files + CSS | -900 to -1,100 | nothing (UI only) |
| **3. Matchmaking cleanup** (decision 3) | Delete `matchmaking.ts` weighting + softener, `fetchAndRegisterBoardRecords`, dead `fetchPlayerRoundBoards`/`fetchBoardStats`; gate turn-boundary pool pinning to lobby-less runs (no per-turn pool pick in a real lobby); re-document `servedBoards` | `sim/matchmaking.ts`, `sim/opponents.ts`, `sim/reducer.ts` (~15 lines), `ui/remoteBoards.ts`, `ui/store.ts`, `matchmaking.test.ts` | -250 | best after #2072 (touches `reducer.ts`; small hunk) |
| **4. Course-era tools** (decision 4) | Delete the listed npm scripts + files, port `perf`/`replay` to a lobby run | `packages/tools/*`, root `package.json`, `sim/balanceReport.ts` | -1,500 to -2,500 | nothing (but #2072 edits root `package.json`: trivial rebase) |
| **5. Recording cap + course clock** | Golden hash test on `main` first; `RECORDING_WAVES` cap in `autoplayRun`; delete the course victory and the `'victory'` phase producers/readers; practice no-lobby curtain → 15 | `sim/snapshot.ts`, `sim/reducer.ts` (`advanceCombat`), `sim/state.ts` (`Phase`), UI `phase === 'victory'` checks (~15 sites), ~10 tests | -150 | **#2072** (it edits the same `advanceCombat` line) |
| **6. Line / Oath / calibration + rift engine** (decisions 2, 6) | Delete `RunState.line`, `lineResult`, `metLine`, `LineStatus`, `isCalibrationRound`, the calibration slice, `CONFIG.courseRounds/defaultLine/calibrationRounds/maxWave`, `buildTags` Line tags, `playerRating` Line helpers, `profile.currentLine`; delete `RIFTS`, `activeRift`, `RIFT_BONUS_ARMOR`, rift reads; `createRun` signature becomes `(seed, heroId, mode, setId, tribes)` or an options object | `sim/state.ts`, `sim/config.ts`, `sim/reducer.ts`, `sim/shop.ts`, `sim/recruit.ts`, `sim/ancients.ts`, UI rating/profile, ~70 tests that pass `CONFIG.defaultLine`, `rifts.test.ts` | -500 | **#2072** (positional `line` in Versus's `createRun` call; `RunMode`; `state.ts`) |
| **7. Retire `'ascent'` / `'rift'` from `RunMode`** (decision 1) | New harness default per decision 1; legacy-string mapping in `deserialize`, bug capsules, `Replay`/`ReplayV2`; narrow `TelemetrySource`; title throwaway runs; ~72 explicit `'ascent'` calls; docbot / tools callers; skills + CLAUDE.md + GAME-RULES notes on retired symbols | `sim/state.ts`, `sim/runTelemetry.ts`, `sim/runDerive.ts`, `sim/snapshot.ts`, `sim/windowReplay.ts`, `sim/bugReport.ts`, docbot, tools, `ui/store.ts`, ~50 test files, docs | -100 net, wide | **#2072 and #2088** |

Every PR: `npm run typecheck && npm run lint && npm test && npm run build:web`, plus `npm run lobby`,
`npm run lobby:snapshots`, `npm run replay` for PRs 3, 5, 7 (the lobby skill's checklist), and a prod-build
smoke of a ranked lobby, Practice (bots + players), the tutorial and a Gauntlet stage. Versus is checked by
rebasing #2072 onto each sim PR (or by its author after merge).

## Recommended first PR

**PR 1, the two live bugs.** It is UI-only (no hot sim files, no conflict with #2072), it stops the
`board_results` pollution that is feeding generated-seat matchmaking today, it removes a full re-simulation from
every end screen, and it needs no owner decision. PR 2 can follow immediately in parallel since it is also
UI-only. PRs 5-7 should wait for #2072 and #2088.
