# Strength v2 Scoring (Plan 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The game scores recorded runs with the v2 reference and carry-forward ranking, keeps runs under 7 rounds and unscored runs out of banded lobbies, and locks Continue behind a "Calculating Score" bar while a rated game is scored.

**Architecture:** One probe in `@game/sim` scores a board against any reference round; the client, the backfill tool and the tests all call it. The client scores the final board against every later reference round at run end and uploads the run once, complete. SQL ranks every live run once per round and is pinned to the TypeScript rules (`rateRunsV2`) by a PGlite parity test; the hub Worker's draw is pinned to the SQL draw by the existing parity test.

**Tech Stack:** TypeScript, Vitest, PGlite db tests, Supabase SQL migrations, Cloudflare Worker (`workers/versus`), React + Zustand.

**Spec:** `docs/superpowers/specs/2026-11-16-strength-v2-design.md` (sections 6.A, 6.B, 6.B2, Transition, 9). Plan 1 (tooling) is merged: `docs/superpowers/plans/2026-11-16-strength-v2-tooling.md`.

**Owners:** Tasks 1 to 6 are engine, SQL and Worker (Kevin's side: he reviews before merge). Tasks 7 to 9 are presentation (Mike's side).

## Global Constraints

- Reference version `set2-v2`: 40 reference boards per round, 4 fights each (160 fights per board), reference rounds 1 to 15.
- `MIN_RUN_LAST_ROUND = 7`, `LATE_LAST_ROUND = 15`, EARLY = rounds 1-9, LATE = rounds 10-15 (already in `packages/sim/src/lobby/strengthV2.ts`).
- Game strength (`pool_runs.strength`) is computed over REAL rounds only; EARLY and LATE over real and carried rounds.
- An empty board is raw 0 in the population and costs no fights.
- A run is scored only when complete: every real board with minions has a `set2-v2` score and the final board has a carried score for every round from its last round + 1 to 15. Otherwise `strength`, `strength_early`, `strength_late` are all null.
- An unscored run is outside any non-null band (Bronze, Silver, Gold, and the same Practice ranks) and stays seatable with no band.
- Scores from different reference versions are never compared.
- The Continue lock: text exactly `Calculating Score`; unlocks after 5,000 ms at the latest; never applies to Practice, tutorial, gauntlet, versus, sandbox, an unrated lobby, or a run that ends before round 7.
- UI rules (CLAUDE.md): bar animates `transform` only; no `title=`; no bare `cursor:`; no raw `vw`/`vh`; no per-frame layout reads.
- `Math.random` is banned in `core` / `content` / `sim`.
- Strength tools never write to the backend: `backfill` emits a SQL file an owner runs.
- Never edit an existing migration; add `supabase/migrations/2026-11-23-strength-v2.sql` and append its copy to `schema.sql` as the other migrations do.
- No "Ship Ascent" without the exact phrase from Mike or Kevin.

## Review Focus

- A slow device where scoring is not done at 5,000 ms: Continue unlocks, the run uploads without carried scores, and SQL treats it as unscored (not as a low score).
- A run restored from a save mid-game: boards from before the restore are still scored at run end (the catch-up enqueue covers every captured board, then the carried rounds).
- A run that ends on round 15 or later: no carried rounds, the lock clears as soon as its real boards are scored.
- An installed v1 client after the SQL switch: its uploads carry `set2-v1` scores, are unscored, and never enter a Bronze, Silver or Gold table.
- A final board with no minions (wiped on the last round): carried scores are all 0 with no fights, and the run is still complete.

---

### Task 1: One probe that scores a board at any reference round

**Files:**
- Modify: `packages/sim/src/lobby/boardStrength.ts`
- Create: `packages/sim/src/lobby/strengthReference.v2.json` (copy of `packages/tools/.cache/strengthReference.v2.candidate.json` after `npm run strength -- ref --v2`)
- Test: `packages/sim/src/lobby/boardStrengthV2.test.ts`

**Interfaces:**
- Produces: `STRENGTH_REF_VERSION = 'set2-v2'`; `loadStrengthReference()` imports `./strengthReference.v2.json`; `createStrengthProbe(board, ref, atRound?: number)` and `scoreBoard(board, ref, atRound?: number)`; `lastReferenceRound(ref): number`.
- `atRound` omitted = `board.wave` (today's behaviour). The reference bucket is `referenceWaveOf(ref, atRound ?? board.wave)`, the fight seed is `strengthFightSeed(ref.version, bucket, refIndex, fight)`, and `StrengthScore.wave` is that bucket.

- [ ] **Step 1: Write the failing tests**
  - `scoreBoard(b, ref)` equals `scoreBoard(b, ref, b.wave)` exactly.
  - `scoreBoard(round7Board, ref, 12).wave === 12` and `.fights === 160`.
  - Same board, `atRound` 8 then 12: both deterministic across two calls.
  - `scoreBoard(emptyBoard, ref, 12) === null`.
  - `lastReferenceRound(ref) === 15`; `ref.version === 'set2-v2'`; every round 1-15 has 40 boards; `fightsPerRef === 4`.
- [ ] **Step 2: Run** `npx vitest run packages/sim/src/lobby/boardStrengthV2.test.ts`. Expected: FAIL (no `atRound`, v1 file).
- [ ] **Step 3: Implement**, and delete nothing from v1 yet except the import (leave `strengthReference.v1.json` in the repo: the tools still read it).
- [ ] **Step 4: Run** the test again, then `npx vitest run packages/sim/src/lobby`. Expected: PASS. Any v1-pinned golden that fails on the new version is updated in this task and listed in the commit message.
- [ ] **Step 5: Commit** `feat(sim): strength reference v2 and a probe that scores at any round`.

### Task 2: The rating rules move into sim; the tools score through the probe

**Files:**
- Modify: `packages/sim/src/lobby/strengthV2.ts` (receive `RawRound`, `RunV2`, `rawRoundsOfRun`, `rateRunsV2` verbatim from `packages/tools/src/strength/measureV2.lib.ts`, plus `runCompleteV2`)
- Modify: `packages/tools/src/strength/measureV2.lib.ts` (re-export from `@game/sim`), `cliV2.ts`, `cli.ts`
- Test: `packages/sim/src/lobby/strengthV2.test.ts`, `packages/tools/src/strength/measureV2.lib.test.ts` (moved cases keep passing)

**Interfaces:**
- Produces: `runCompleteV2(run: { realRounds: readonly { round: number; minions: number; ref: string | null }[]; carried: readonly number[] }, lastRefRound: number): boolean`. True when every real round with `minions > 0` has `ref === STRENGTH_REF_VERSION` and `carried` holds every round from the last real round + 1 to `lastRefRound`.
- Produces: `npm run strength -- backfill --v2` writing `packages/tools/.cache/strength-backfill-v2.sql`: one `update public.boards` per board setting `strength_raw`, `strength_ref = 'set2-v2'`, `strength_wave`, and on each run's final board `strength_carried` (Task 3's column), wrapped in one `begin; ... commit;`. It scores EVERY pool board, live or not.
- `cliV2.ts` scores only through `scoreBoard(board, ref, atRound)`.

- [ ] **Step 1: Failing tests** for `runCompleteV2`: complete run true; one real board on `set2-v1` false; carried missing round 15 false; final round 15 with no carried true; an empty real board does not need a score.
- [ ] **Step 2: Run**, expected FAIL. **Step 3: Implement** the move and the function. **Step 4:** `npx vitest run packages/sim/src/lobby packages/tools`. Expected PASS.
- [ ] **Step 5: Backfill test** in `packages/tools/src/strength/backfill.lib.test.ts`: for a two-run fixture the generated text contains one `begin;`, one `commit;`, a `strength_carried` only on each run's final board, and no statement other than `update public.boards`.
- [ ] **Step 6: Commit** `feat(sim,tools): v2 rating rules in sim; backfill --v2 emits one SQL file`.

### Task 3: SQL: carried scores, the 7-round floor, live-run ranking, unscored out of bands

**Files:**
- Create: `supabase/migrations/2026-11-23-strength-v2.sql` (append its copy to `schema.sql`)
- Test: `packages/sim/src/lobby/strengthV2.db.test.ts` (PGlite, same harness as `poolRollingWindow.db.test.ts`)

**Interfaces (all `create or replace`, based on the definitions in `2026-11-22-pool-rolling-window.sql`):**
- `alter table public.boards add column if not exists strength_carried jsonb` : `{"<round>": <raw>}`, only on a run's final board, same `strength_ref` as the row.
- `public.strength_ref_current() returns text` = `'set2-v2'`; `public.strength_ref_last_round() returns int` = `15`. The ONLY places SQL names them.
- `public.pool_run_eligible(p_wave_count int, p_first_wave int, p_max_gap int, p_tiers_ok boolean, p_last_wave int) returns boolean`: the old test with `p_wave_count >= 4` replaced by `p_last_wave >= 7`. `pool_runs_upsert_from` calls it; the migration ends by re-marking existing rows (`update pool_runs set eligible = ...`) and calling `pool_live_refresh()`. No row is deleted.
- `pool_strength_refresh`, `pool_strength_hist_refresh`: the population of round N (1-15) is each LIVE run's real board at N (empty = 0) or its carried raw; a round above 15 is ranked against round 15's population without joining it; an incomplete run gets null `strength`, `strength_early`, `strength_late`. `board_strength_histogram('set2-v2')` returns that population.
- `pool_runs__pick` and `pool_runs_sample`: when any of `p_strength_min`, `p_strength_max`, `p_strength_cap` is non-null, a run whose `strength` is null is excluded. With none of them the draw is unchanged, row for row.
- `ops.pool_digest` adds `live_unscored` (count of live runs with null `strength`).

- [ ] **Step 1: Failing db tests**
  - `parity`: seed 30 runs (mixed last rounds 7-16, two empty boards, three owners) with v2 raws and carried maps; after `pool_refresh_dirty()`, each run's `strength`, `strength_early`, `strength_late` equals `rateRunsV2(...)` for that run, as integers.
  - `floor`: a run ending on round 6 has `eligible = false`; round 7 `true`.
  - `incomplete`: drop one carried round from a run: its three ratings are null; `ops.pool_digest` reports `live_unscored: 1`.
  - `old version`: a run scored `set2-v1` is unscored.
  - `banded draw`: `pool_runs_sample_keys(p_strength_min => 0, p_strength_max => 100)` omits the unscored run; with no band args it is present.
  - `text parity`: the picking blocks of `pool_runs_sample` and `pool_runs__pick` are still identical (extend the existing comparison in `poolRollingWindow.db.test.ts` to read the new file).
- [ ] **Step 2: Run** `npx vitest run packages/sim/src/lobby/strengthV2.db.test.ts`. Expected FAIL (migration missing).
- [ ] **Step 3: Write the migration.** **Step 4: Run** that file plus `npx vitest run packages/sim/src/lobby`. Expected PASS.
- [ ] **Step 5: Commit** `feat(db): strength v2 ranking, 7-round floor, unscored runs out of banded draws`.

### Task 4: TypeScript twins of the floor and the unscored rule

**Files:**
- Modify: `packages/sim/src/lobby/strengthBands.ts` (`runInStrengthBand`), `packages/sim/src/lobby/snapshotSeats.ts` (`playerRunsFrom`, `playerRunByKey`), `packages/sim/src/lobby/runLobby.ts:372`, `packages/ui/src/opponentPool/poolFetch.ts:214`, `packages/sim/src/lobby/boardStrength.ts` (`RUN_STRENGTH_FORMULA`)
- Test: `packages/sim/src/lobby/strengthBands.test.ts`, `packages/sim/src/lobby/poolWholeRuns.test.ts`

**Interfaces:**
- `runInStrengthBand(run, band)`: `band === null` → true (unchanged); otherwise a run with `matchScore100(run, band.earlyWeight) === null` → **false**.
- `MIN_RUN_WAVES` is deleted. Its four uses become `runLongEnough(lastWave)` where `lastWave` is the run's highest recorded wave. `poolRuns.db.test.ts` and `poolEmptyBoards.db.test.ts` switch to `MIN_RUN_LAST_ROUND`.
- `StrengthFormula` gains `'earlyLateV2'`; `RUN_STRENGTH_FORMULA = 'earlyLateV2'`.

- [ ] **Step 1: Failing tests**: an unscored run is outside Bronze, Silver, Gold and every widened step including the last (`{ min: 0, max: 100, overallCap }`); inside `null`. A 6-round recording is not returned by `playerRunsFrom`; a 7-round one is. A table whose only in-band candidates are unscored fills with generated seats.
- [ ] **Step 2-4:** run (FAIL), implement, `npx vitest run packages/sim/src/lobby packages/sim/src/versus packages/ui/src/opponentPool` (PASS). Older tests that relied on unscored runs inside a band are rewritten to give their runs scores, and named in the commit message.
- [ ] **Step 5: Commit** `feat(sim): 7-round floor and unscored runs outside banded tables`.

### Task 5: Hub Worker draw

**Files:**
- Modify: `workers/versus/src/core/poolPick.ts` (`pickRuns`)
- Test: `workers/versus/test/sessionCf.db.test.ts`

- [ ] **Step 1:** Add `2026-11-22-pool-rolling-window.sql` and `2026-11-23-strength-v2.sql` to the test's migration chain (it stops at 11-20 today), mark the seeded runs `live`, null the strengths of 5 of the 40, and add two parameter sets with `p_strength_min: 0, p_strength_max: 100`.
- [ ] **Step 2: Run** `npx vitest run workers/versus/test/sessionCf.db.test.ts`. Expected FAIL on the banded sets (the port still admits unscored runs).
- [ ] **Step 3: Port** the SQL exclusion into `pickRuns`, line for line. **Step 4:** PASS, all 56 parameter sets.
- [ ] **Step 5: Commit** `feat(worker): pool mirror draw excludes unscored runs from banded draws`.

### Task 6: Scorer: carried rounds, progress, a run-end rush

**Files:**
- Modify: `packages/ui/src/boardStrength/strengthScorer.ts`, `packages/ui/src/boardStrength/index.ts`
- Test: `packages/ui/src/boardStrength/boardStrength.test.ts`

**Interfaces:**
- `StrengthScorer` gains:
  - `enqueueCarried(seed: number, finalBoard: BoardSnapshot, toRound: number): void` : one job per round from `finalBoard.wave + 1` to `toRound`, each `createStrengthProbe(finalBoard, ref, round)`; an empty final board records raw 0 for each round with no fights.
  - `carried(seed: number): ReadonlyMap<number, number>` (round → raw).
  - `progress(seed: number): { done: number; total: number }` in fights, over real and carried jobs.
  - `rush(seed: number): void` : from now on that seed's jobs run in frame-budgeted slices (`STRENGTH_RUSH_BUDGET_MS = 8` per `requestAnimationFrame`), not idle callbacks. `StrengthScorerDeps` gains `requestFrame(fn): () => void`.
- `STRENGTH_RUN_END_WAIT_MS = 5000`.
- Decision recorded: main-thread slices, not a Web Worker (a Worker needs a second copy of the engine and the card registry). Task 9 measures it.

- [ ] **Step 1: Failing tests** with fake deps: a round-7 final board and `toRound` 15 queues 8 jobs and `progress().total === 8 * 160` plus the real jobs; `carried()` has keys 8..15 when settled; an empty final board settles at once with eight zeros; after `rush`, no `requestSlice` call is made and each frame stops within the budget; `settled(seed, 5000)` resolves on the timer with whatever is done.
- [ ] **Step 2-4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(ui): strength scorer scores carried rounds, reports progress, rushes at run end`.

### Task 7: Run end: score, then upload once

**Files:**
- Modify: `packages/ui/src/store.ts` (run-end block, about lines 1960-1990), `packages/ui/src/remoteBoards.ts` (`BoardUpload`, `uploadBoards`)
- Test: `packages/ui/src/boardStrength/runEndStrength.test.ts`

**Interfaces:**
- Store state `runScoring: { done: number; total: number } | null`. Set when the gate below opens, updated at most every 100 ms from `scorer.progress(seed)`, set to `null` when `settled` resolves.
- Gate (`shouldScoreRunEnd(run, unrated, capturedBoards): boolean`, exported for the test): `run.mode === 'lobby' && !run.sandbox && !unrated && runLongEnough(lastCapturedWave)`.
- When the gate is open: catch-up enqueue, `enqueueCarried(seed, finalBoard, lastReferenceRound(ref))`, `rush(seed)`, `settled(seed, STRENGTH_RUN_END_WAIT_MS)`.
- `BoardUpload` gains `strengthCarried?: Record<string, number>`; `uploadBoards` writes it to `strength_carried` on the final board's row only, and only when every round from last + 1 to 15 is present.
- A run whose last captured wave is under 7 does not call `uploadBoards` at all. Before deleting that call path, grep every reader of the `boards` table; if anything other than the opponent pool depends on a short run's rows, keep the upload and record a ruling (SQL already marks the run ineligible).

- [ ] **Step 1: Failing tests**: the gate truth table (rated 12-round run true; unrated false; practice false; 6-round false; 7-round true); a settled run uploads `strength_carried` with keys 8..15 on its last row and on no other row; a timed-out run uploads no `strength_carried`; a 6-round run makes no boards upload; `runScoring` ends `null` in every case.
- [ ] **Step 2-4:** run (FAIL), implement, `npx vitest run packages/ui/src/boardStrength packages/ui/src/store` (PASS).
- [ ] **Step 5: Commit** `feat(ui): a rated run is scored in full before it uploads`.

### Task 8: "Calculating Score" lock on the end screen

**Files:**
- Modify: `packages/ui/src/rank/RankScreen.tsx` (props, Continue at line 237), `packages/ui/src/EndScreen.tsx` (`LobbyEndScreen` passes the prop), `packages/ui/src/styles.css` (next to `.rankend-actions`)
- Test: `packages/ui/src/rank/RankScreen.test.tsx` (or the existing RankScreen test file)

**Interfaces:**
- `RankScreenProps.scoring?: { done: number; total: number } | null`. `LobbyEndScreen` reads `s.runScoring`.
- While `scoring` is non-null: Continue has `disabled` and class `scoring`; above it render
  `<div className="rankend-scoring" role="status" aria-live="polite"><span className="rankend-scoring-text">Calculating Score</span><span className="rankend-scoring-track"><span className="rankend-scoring-fill" style={{ transform: `scaleX(${total ? done / total : 0})` }} /></span></div>`.
  When it is null the block is not rendered and Continue behaves as today. "Skip animation" and "Match details" are not locked.
- CSS: `.rankend-continue.scoring { opacity: 0.45; filter: saturate(0.4); }`; the fill has `transform-origin: left center` and `transition: transform 120ms linear`; no looping animation. Copy track colours from `.rankbar-track` / `.rankbar-fill`.

- [ ] **Step 1: Failing tests**: with `scoring={{ done: 40, total: 160 }}` the text "Calculating Score" is present, the fill's inline transform is `scaleX(0.25)`, Continue is disabled and clicking it does not call `onContinue`; with `scoring={null}` the text is absent and one click calls `onContinue` once; `total: 0` renders `scaleX(0)` without NaN.
- [ ] **Step 2-4:** run (FAIL), implement, `npx vitest run packages/ui/src/rank packages/ui/src/stageTripwire.test.ts` and `npm run lint` (PASS).
- [ ] **Step 5: Commit** `feat(ui): Continue waits behind "Calculating Score" while a rated game is scored`.

### Task 9: Measure, rules, docs

**Files:**
- Modify: `packages/rules/src/registry/approved/foundation.ts`, `docs/GAME-RULES.md`, `.claude/skills/ascent-lobby/SKILL.md`, `packages/ui/src/patchNotes.ts`, `docs/performance.md` (one line with the measurement)
- Create: `docs/devlog/2026-11-16-strength-v2-scoring.md`

- [ ] **Step 1: Measure** on the prod build (`npm run build:web`, then a rated game ended on round 7 and one on round 12): time from the end screen appearing to Continue unlocking, and the longest frame in between (Chrome Performance). Gate: no frame over 20 ms from scoring, and the round-12 game unlocks in under 2 s. If either fails, lower `STRENGTH_RUSH_BUDGET_MS` first; a Web Worker is a follow-up plan, not this one. Write both numbers in the devlog.
- [ ] **Step 2: Rules.** Amend R-LOBBY-09 (unscored runs are outside every band), R-LOBBY-12 and R-LOBBY-13 (population = live runs once per round; LATE = 10-15 with carried rounds), R-LOBBY-15 (unchanged cap, reads Game strength over real rounds). Add, with the next free numbers after R-LOBBY-17: carry-forward ranking (ref: `strengthV2.db.test.ts`), the 7-round floor (ref: the floor tests in Tasks 3 and 4), a run is scored only when complete (ref: the `incomplete` db test), and `R-ENDSCREEN-SCORE-01` "Continue is locked while a rated game is scored, says why, shows real progress, and always unlocks within 5 seconds" (ref: the RankScreen and run-end tests). Each quotes Mike's words from the spec as `owner-chat` evidence.
- [ ] **Step 3:** Patch note (Systems): Game strength and round percentiles are measured against a harder test set and against every recent game, so numbers shift; opponents never include a game that ended before round 7; "Calculating Score" at the end of a rated game.
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm test && npm run build:web`, `npx vitest run packages/rules`, `npm run docbot:report -- --check`. Expected: all pass.
- [ ] **Step 5: Commit** and open the PR. Do not merge without Kevin's review of Tasks 1 to 5.

### Task 10: Rollout (owners only; nothing here is run by an agent without being told)

Order, and why it differs from the spec's "hub first": the `strength_carried` column must exist before any v2 client uploads, or the boards upsert fails. The SQL draw does not call the hub, and an old hub only ignores the new digest field.

1. After the PR merges: `npm run strength -- backfill --v2` on the live pool. It writes `packages/tools/.cache/strength-backfill-v2.sql`.
2. In Supabase, in ONE transaction: `2026-11-23-strength-v2.sql`, then the backfill file, then `select public.pool_refresh_dirty();`. Check `ops.pool_digest` reports `live_unscored: 0`.
3. "Ship Ascent" (Mike or Kevin). Until a player updates, an old client shows no Game strength and its uploads are unscored (kept out of Bronze, Silver and Gold tables).
4. One week later: `npm run strength -- backfill --v2` again for runs uploaded by old clients, and `npm run strength -- measure --v2` for the drift alarm.
