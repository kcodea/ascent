# Relevant Strength Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The game recap shows every seat's **Relevant Strength** (its strength over the rounds you shared, weighted
for that game's length) beside its **Run Strength** (today's whole-run number).

**Architecture:** The server folds each pool board's stored v2 score (and the final board's carried scores) into the
board JSON it already sends, so neither the RPC signatures nor the Cloudflare Worker change; a salted run `rev` makes
every client and the mirror re-fetch once. At game end `buildMatchDetails` (pure sim) ranks each opponent's fielded
board per round against the v2 board histogram the client already holds, applies the per-length weights, and freezes
`windowStrength` + `roundStrength` into the match record. The UI reads them.

**Tech Stack:** TypeScript (sim + React UI), Vitest, Supabase SQL (plpgsql).

**Spec:** `docs/superpowers/specs/2026-11-20-strength-while-you-faced-them-design.md`

## Global Constraints

- Labels, verbatim: **"Relevant Strength"** and **"Run Strength"**.
- Tips, verbatim: Relevant Strength: "How strong this board was across the rounds you played against it, compared with
  everyone else's. Later rounds count more." Run Strength: "How strong this player's whole run was, compared with
  every other run."
- Weights: game length 1 = 100%; length 2 = 50% / 50%; generally `weight(r) = max(1, r - 1)`, normalised.
- Display only: nothing that reads `pool_runs.strength*`, bands, caps, peak, EARLY / LATE or the rank bonus changes.
- No new fights anywhere; the game-end work is histogram lookups only (performance is the north star).
- A score at a reference version other than `STRENGTH_REF_VERSION` is never used.
- UI: no `title=` attributes, no bare `cursor: pointer`, no raw `vw`/`vh` (CLAUDE.md UI conventions).
- Career rows and the classic/party-home Career pages keep "Game strength" (out of scope, spec section 7).
- Branch off latest `origin/main`; `npm install` in the worktree before trusting checks.

## Review Focus

1. An opponent eliminated before your game ended: window must stop at its `eliminatedRound` (Task 3 test
   `window stops at the opponent's elimination round`).
2. An opponent whose recording ended before the window ends: rounds past it use the final board's carried score, and
   rounds past 15 use the round-15 bucket (Task 2 test `carried rounds and the last reference round`).
3. A pool delivered by an old server or an old cache (no `poolScore` on boards): no Relevant Strength, Run Strength
   still shown, nothing throws (Task 3 test `unscored seat shows run strength only`; Task 5 test).
4. An older match record with no `strengthWindow` marker: shows Run Strength alone, under the "Run Strength" label
   (Task 5 test `old record shows Run Strength only`).
5. Generated, bot and authored seats: never a Relevant Strength (Task 3 test `generated seats get none`).

---

### Task 1: The server sends each board's score

**Files:**
- Create: `supabase/migrations/2026-11-26-pool-board-scores.sql`
- Modify: `supabase/schema.sql` only if the two strength migrations before this one did (they did not; leave it)
- Test: `packages/sim/src/lobby/poolRunsDelta.db.test.ts` (extend)

**Interfaces:**
- Produces, on every board object in `pool_runs_sample.boards` and `pool_runs_boards.boards` (and so the mirror's
  opaque `boards` text): optional `poolScore: { ref: string; raw: number; wave: number }` when the row's
  `strength_raw` is set at `strength_ref_current()`, and optional `poolCarried: { ref: string; rounds: Record<string,
  number> }` copied from `strength_carried` when its `ref` is current. Keys absent otherwise.
- Produces: `pool_run__rev` and the inline `rev` in `pool_runs_boards` both become `md5('scores1|' || <old string>)`
  so every cached run and the mirror re-download once.

- [ ] **Step 1: Write the failing db test** in `poolRunsDelta.db.test.ts`: `boards carry their current-version
  score`: seed a run whose round-3 board has `strength_raw 0.6, strength_ref = strength_ref_current(), strength_wave
  3` and whose final board has `strength_carried {"ref": <current>, "rounds": {"9": 0.4}}`, plus one board scored at
  `'set2-v1'`; assert `pool_runs_boards([id])` returns `poolScore {ref, raw: 0.6, wave: 3}` on round 3, `poolCarried`
  on the final board, and no `poolScore` on the v1 board; assert `pool_runs_sample` returns the same board objects;
  assert the returned `rev` equals `pool_run__rev(author, hero, seed)`.
- [ ] **Step 2: Run it to see it fail.** Run: `npx vitest run packages/sim/src/lobby/poolRunsDelta.db.test.ts`
  (needs the local Supabase the other `.db.test.ts` files use). Expected: FAIL, no `poolScore`.
- [ ] **Step 3: Write the migration.** One helper `public.pool_board__json(x public.boards) returns jsonb` (stable,
  `x.snapshot || jsonb_strip_nulls(jsonb_build_object('poolScore', ..., 'poolCarried', ...))`, current ref from
  `strength_ref_current()`); `create or replace` `pool_runs_sample` (same 11-arg signature, body copied from
  `2026-11-24-strength-peak-cap.sql`, `jsonb_agg(public.pool_board__json(x) ...)`), `pool_runs_boards` (from
  `2026-11-08-pool-runs-delta.sql`) and `pool_run__rev` with the `'scores1|'` salt. Keep grants; end with
  `notify pgrst, 'reload schema';`. Header comment: what, why (link the spec), rollback (re-apply the three source
  migrations' definitions), and "apply BEFORE the client ships; an old client ignores the extra keys".
- [ ] **Step 4: Run the test.** Expected: PASS. Also run `npx vitest run packages/sim/src/lobby` for the other pool
  db tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sql): pool boards carry their v2 score (Relevant Strength, spec 2026-11-20)`.

### Task 2: Weights and per-round percentiles (sim)

**Files:**
- Modify: `packages/sim/src/snapshot.ts` (two optional fields)
- Modify: `packages/sim/src/lobby/boardStrength.ts` (new exports at the end of the percentile section)
- Modify: `packages/sim/src/lobby/index.ts` / `packages/sim/src/index.ts` (export them)
- Test: `packages/sim/src/lobby/relevantStrength.test.ts` (create)

**Interfaces:**
- Produces on `BoardSnapshot`: `poolScore?: { ref: string; raw: number; wave: number }`,
  `poolCarried?: { ref: string; rounds: Record<string, number> }` (display only; doc comment says never read in
  combat or matchmaking).
- Produces: `strengthWindowWeights(n: number): number[]` (length n, sums to 1; n < 1 returns `[]`).
- Produces: `boardPctAtRound(board: BoardSnapshot, round: number, hist: StrengthHistogram, ref?: string): number | null`
  : when `board.wave === round` use `poolScore` (bucket `poolScore.wave`); when `board.wave < round` use
  `poolCarried.rounds[String(min(round, STRENGTH_REF_LAST_ROUND))]` (bucket the same number); null when the ref does
  not match `ref` (default `STRENGTH_REF_VERSION`), when the value is missing, or when the bucket has no entries.
  Ranks with `percentileOf(raw, hist[bucket], true)`.
- Produces: `windowStrengthOf(rounds: readonly { round: number; value: number }[], n: number): number | null`:
  weights from `strengthWindowWeights(n)` over rounds 1..n, missing rounds dropped and the rest renormalised, result
  `clampPct`; null when fewer than `Math.ceil(n / 2)` of rounds 1..n are present.

- [ ] **Step 1: Write failing tests** in `relevantStrength.test.ts`:
  - `weights: one round is 100%, two rounds are 50/50` (`[1]`, `[0.5, 0.5]`);
  - `weights: later rounds heavier from three rounds` (n = 8 rounded to whole percent `[3, 3, 7, 10, 14, 17, 21, 24]`,
    sums to 1 within 1e-9, non-decreasing for every n in 1..20);
  - `window strength renormalises over missing rounds` (n = 4, rounds 3 and 4 only, values 80 and 100 -> weights 2 and
    3 -> 92);
  - `window strength needs half the rounds` (n = 5 with 2 rounds -> null; with 3 -> number);
  - `carried rounds and the last reference round` (a wave-7 board with `poolCarried.rounds {"8": r8, "15": r15}`:
    round 8 ranks r8 in bucket 8, round 18 ranks r15 in bucket 15; round 7 uses `poolScore`);
  - `another reference version is ignored` (`poolScore.ref = 'set2-v1'` -> null).
- [ ] **Step 2: Run them to see them fail.** Run: `npx vitest run packages/sim/src/lobby/relevantStrength.test.ts`.
  Expected: FAIL, functions not exported.
- [ ] **Step 3: Implement** the fields and the three functions with the signatures above.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(sim): per-game-length strength weights and per-round board percentiles`.

### Task 3: The match record freezes Relevant Strength

**Files:**
- Modify: `packages/sim/src/lobby/matchDetails.ts` (types near line 100-160, builder near 274-310, `parseSeat`)
- Modify: `packages/rules/src/registry/approved/foundation.ts` (append one rule, shaped like `R-RESULTS-ANCIENT-01`)
- Test: `packages/sim/src/lobby/matchDetails.test.ts` (extend)

**Interfaces:**
- Consumes: Task 2's `boardPctAtRound`, `windowStrengthOf`.
- Produces: `MatchSeat.windowStrength?: number` (1-100); `MatchSeat.roundStrength` now filled for opponent seats too;
  `MatchDetails.strengthWindow?: 1` (present on every record built by this code, absent on older ones);
  `MatchDetailsInput.strengthHistogram?: StrengthHistogram | null`.
- Window per seat: self `1..endRound`; opponent `1..seatBoardRound(seat, endRound)`. Opponent rounds come from
  `fieldedBoard(lobby, seat, r)?.snapshot` for each r, only for `seat.kind === 'snapshot'`. Self uses
  `input.selfStrength.rounds`. `windowStrength` is set only when `windowStrengthOf` is non-null. `strength` keeps
  today's meaning (Run Strength). `parseSeat` / the record parser round-trip `windowStrength`, opponent
  `roundStrength`, and `strengthWindow`.

- [ ] **Step 1: Write failing tests** in `matchDetails.test.ts`, building lobbies the way the existing tests do:
  - `window stops at the opponent's elimination round` (your game ends round 10, opponent out on round 5, its boards
    1-10 scored with distinct raws: `roundStrength` has rounds 1-5 only and `windowStrength` uses n = 5);
  - `unscored seat shows run strength only` (boards without `poolScore`: no `windowStrength`, `strength` still the
    stamped `runStrength`);
  - `generated seats get none` (a hybrid/bot seat with scored-looking boards: no `windowStrength`, no `roundStrength`);
  - `your seat uses your own rounds` (selfStrength rounds 1-8, endRound 8 -> `windowStrengthOf(rounds, 8)`);
  - `the record round-trips` (`strengthWindow`, opponent `roundStrength`, `windowStrength` survive the parser; an old
    record without them parses with none).
  - `fielded boards are read without side effects` (calling the builder twice on the same lobby gives equal records).
- [ ] **Step 2: Run them to see them fail.** Run: `npx vitest run packages/sim/src/lobby/matchDetails.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** the fields, the builder logic and the parser.
- [ ] **Step 4: Add the rule** `R-RESULTS-STRENGTH-WINDOW-01` (domain of `foundation.ts`): statement "On a game's
  results, each seat's Relevant Strength counts only the rounds that seat shared with you, weighted for that game's
  length; Run Strength is the whole recorded run."; evidence: owner-chat quote from spec section 1 and a `code` entry
  for `matchDetails.ts`; enforcement `scenario` refs `packages/sim/src/lobby/matchDetails.test.ts` and
  `packages/sim/src/lobby/relevantStrength.test.ts`, `lastVerifiedAt` today.
- [ ] **Step 5: Run** `npx vitest run packages/sim/src/lobby packages/rules` and `npm run docbot:report -- --check`.
  Expected: PASS.
- [ ] **Step 6: Commit** `feat(sim): match record freezes each seat's Relevant Strength (R-RESULTS-STRENGTH-WINDOW-01)`.

### Task 4: Wire the histogram and refresh caches (UI data)

**Files:**
- Modify: `packages/ui/src/store.ts` (`matchDetailsOf` ~1760 and its caller near the run-end scoring ~2008)
- Modify: `packages/ui/src/opponentPool/poolLoader.ts:79` (`POOL_CACHE_VERSION` 2 -> 3)
- Test: `packages/ui/src/matchDetails/runEndMatch.test.ts` (extend)

**Interfaces:**
- Consumes: Task 3's `MatchDetailsInput.strengthHistogram`.
- Pass `strengthHistogram()` (the same v2 histogram `runStrengthFromScores` reads) into `buildMatchDetails`. Boards keep
  `poolScore` / `poolCarried` through `register` untouched (spread copies them); no new stamping.

- [ ] **Step 1: Write the failing test** `run end freezes opponents' Relevant Strength` in `runEndMatch.test.ts`: a
  lobby with one snapshot seat whose boards carry `poolScore` and a fake histogram; the stored `lastMatch.details` has
  that seat's `windowStrength`.
- [ ] **Step 2: Run it to see it fail.** Run: `npx vitest run packages/ui/src/matchDetails/runEndMatch.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** the pass-through and the cache bump.
- [ ] **Step 4: Run** the test and `npx vitest run packages/ui/src/opponentPool`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): run end passes the board histogram to the match record`.

### Task 5: Show Relevant Strength and Run Strength

**Files:**
- Modify: `packages/ui/src/matchDetails/matchDetailsText.ts` (labels + tips)
- Modify: `packages/ui/src/matchDetails/LobbyPicker.tsx` (~65 aria text, ~183 tile hover)
- Modify: `packages/ui/src/matchDetails/MatchScoreboard.tsx` (~93-125 row, ~159-175 strip for any seat)
- Modify: `packages/ui/src/partyHome/pages/RecentGamesPh.tsx:269-276` (header facts)
- Modify: the CSS beside each (`matchDetails.css`, `lobbyRail*.css` as used) for the smaller second number
- Modify: `packages/ui/src/patchNotes.ts` (prepend), `docs/GAME-RULES.md`, new `docs/devlog/2026-11-20-relevant-strength.md`
- Test: `packages/ui/src/matchDetails/matchDetails.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 3's `MatchSeat.windowStrength`, opponent `roundStrength`, `MatchDetails.strengthWindow`.
- Produces in `matchDetailsText.ts`: `RELEVANT_STRENGTH_LABEL = 'Relevant Strength'`, `RUN_STRENGTH_LABEL = 'Run
  Strength'`, `RELEVANT_STRENGTH_TIP`, `RUN_STRENGTH_TIP` (Global Constraints copy), and
  `seatStrengthParts(seat, record): { relevant: number | null; run: number | null }` (relevant only when
  `record.strengthWindow` and `seat.windowStrength`). `GAME_STRENGTH_LABEL` / `_TIP` stay for Career and Recent Games
  rows.
- Rendering: `Relevant Strength 90 · Run Strength 40`, Relevant first and larger; either part omitted when null. The
  strip label becomes "Relevant Strength by round" and renders for any seat with `roundStrength`. The party-home game
  header facts: `Relevant Strength` from the record's self seat, `Run Strength` from `r.boardStrength`.

- [ ] **Step 1: Write failing tests** in `matchDetails.test.tsx`:
  - `a seat shows both numbers` (tile hover text and scoreboard row contain "Relevant Strength 90" before "Run
    Strength 40");
  - `old record shows Run Strength only` (no `strengthWindow`: "Run Strength 40", no "Relevant");
  - `new record, unscored seat shows Run Strength only` (marker set, no `windowStrength`);
  - `an opponent's strip renders` (clicking an opponent seat with `roundStrength` shows "Relevant Strength by round");
  - `no title attributes` (no element in the rendered recap has a `title` attribute).
- [ ] **Step 2: Run them to see them fail.** Run: `npx vitest run packages/ui/src/matchDetails`. Expected: FAIL.
- [ ] **Step 3: Implement** the text helpers, the three surfaces and the header facts; style the run number smaller
  (static CSS only, no looping paint animation).
- [ ] **Step 4: Run** `npx vitest run packages/ui/src/matchDetails packages/ui/src/partyHome`. Expected: PASS.
- [ ] **Step 5: Docs.** Patch note (player voice: "Game results now show each opponent's Relevant Strength: how
  strong they were during the rounds you played them, next to their Run Strength."), the GAME-RULES strength section,
  the devlog entry (what shipped, the SQL-first rollout, the one-time re-download).
- [ ] **Step 6: Full gates.** Run: `npm run typecheck && npm run lint && npm test && npm run build:web`. Expected: all
  green.
- [ ] **Step 7: Commit** `feat(ui): game results show Relevant Strength and Run Strength`.

## Rollout (after merge)

1. Mike or Kevin runs `2026-11-26-pool-board-scores.sql` in Supabase. Every client and the hub mirror re-fetch the
   live runs once (the salted `rev`).
2. The next Ship Ascent carries the client. Until a pool reaches a player with scores, their recaps show Run Strength
   only, as before.
