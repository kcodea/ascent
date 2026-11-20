# Strength while you faced them: per-game-length strength on the game recap

Date: 2026-11-20. Owner: Mike. Status: DRAFT, awaiting Mike's approval.
Builds on strength v2 (`docs/superpowers/specs/2026-11-16-strength-v2-design.md`, shipped in #2749 and the peak-cap
PRs). Touches the pool SQL and the pool mirror Worker (`workers/versus`) as well as the UI; coordinate with Kevin
before starting.

## 1. Intent

Mike, 2026-11-20: "if a game ends on turn 8, i want the player to go to their overview page, and see all of the
board's strengths calculated as if 8 rounds was the full length of the game. so they understand that yes, they faced
very strong 1-8 round boards, even if they petered out later by round 15, and ended with a total strength of 40, they
were at a 90 when the player was dealing with them".

And on the weighting: "create weighting for every single individual round amount. for example. if a game ends on round
one: round 1: 100%. round 2: round 1: 50%, round 2: 50%. and so on. so we can get very granular with the strength at
that moment".

So the recap must answer "how strong was this opponent **while I was playing against them**", not "how strong was
their whole recorded run". A recorded run that went to round 15 and faded is a 40 on its whole run, but if your game
ended on round 8 and its rounds 1-8 were brutal, the recap should say 90.

## 2. How it works today (verified on origin/main, 2026-11-20)

- **Board score** (v2, `set2-v2`): a board's win rate over 160 seeded fights against 40 frozen reference boards of its
  round (`packages/sim/src/lobby/boardStrength.ts`). Stored on `boards` (`strength_raw`, `strength_ref`,
  `strength_wave`). A run that ended before round N also has **carried scores**: its final board scored against each
  later reference round (`strength_carried`), because that final board is what it fields there.
- **Board percentile**: that win rate ranked among the live runs' boards at the same round (real or carried), ties
  half, 1-100. The client fetches the histogram (`board_strength_histogram`, `remoteBoards.ts`).
- **Game strength** (the number players see): the round-weighted mean of a run's board percentiles (rounds 1-5 share
  20%, 6-9 35%, 10+ 45%; `STRENGTH_ROUND_GROUPS`), then ranked among runs. Real rounds only.
- **Match details record** (`packages/sim/src/lobby/matchDetails.ts`), frozen at game end:
  - your seat: `strength` (your Game strength) and `roundStrength` (each round's board percentile);
  - an opponent seat: `strength` = its recorded run's pool Game strength (`runStrength`, stamped on its boards when the
    pool was loaded). No per-round numbers.
- **Where it shows**: the lobby tiles on the overview (hover prints "Game strength: N", `LobbyPicker.tsx`), the
  scoreboard rows (`MatchScoreboard.tsx`), and "Game strength by round" for your own seat.
- **The gap**: the pool delivers each run's board snapshots (`pool_runs_sample` returns `boards jsonb` of snapshots
  only, and the Worker mirror the same). The per-board scores sit in the database but never reach the client, so the
  client cannot work out an opponent's strength over a window of rounds.

## 3. Goals, non-goals, anti-goals

Goals
- On the recap, every recorded opponent shows its strength over **the rounds you shared**, weighted for that exact
  game length.
- Your own number on the recap is computed the same way, over your own rounds, so every number on the page means the
  same thing.
- An opponent's per-round board numbers are available, like yours are today.

Non-goals
- **Display only.** Matchmaking bands, caps, the peak cap, EARLY / LATE and the rank strength bonus keep reading
  today's numbers (`pool_runs.strength*`). Nothing about pairing or Rating changes.
- No re-ranking among runs: the recap number is the weighted average of board percentiles, not a "top X% of runs".
  (Mike 2026-11-20 chose this over re-ranking.)
- Older match records are not rewritten; they keep the number they were saved with.
- No re-scoring of boards on the player's machine (Mike chose approach A, section 4).

Anti-goals
- Any cost on the end screen or an interaction path. The new work at game end is about 100 histogram lookups; it must
  not add fights.
- The SQL, the TypeScript twin and the Worker mirror drifting apart (the v2 parity tests must be extended, not
  bypassed).
- A recap number that is quietly a guess: a seat without enough scored rounds shows no number.

## 4. Approaches considered

1. **Deliver the stored board scores with the pool (chosen, Mike 2026-11-20: "yes, A plus weighted average").** The
   pool already stores every board's win rate and carried scores. Return them with each run; at game end the client
   ranks them with the histogram it already fetches, exactly as it ranks your own boards. No fights, no new cost.
   Cost: an SQL change, a Worker mirror change, a pool cache version bump. A board the server never scored has no
   number, so that round is left out.
2. **Re-score every opponent board on the player's machine at game end.** Fills every gap, but up to 7 seats x 15
   rounds x 160 fights is about 17,000 fights competing with the end screen. Rejected (performance is the north
   star).
3. **A plus B as a fallback for the missing boards.** Deferred: only worth it if the gaps turn out to be common.

Final number (Mike chose the first):
- **Weighted average of board percentiles** over the window. Reads directly as "they were a 90 while you faced them".
- Re-ranked among runs over the same window: stricter, but needs a server ranking per game length. Rejected.

## 5. Design

### 5.1 The window

- **Your seat**: rounds 1 to the game's end round (`MatchDetails.endRound`).
- **An opponent seat**: rounds 1 to the last round you were both in the game: `min(endRound, its eliminatedRound)`.
  A player you knocked out on round 5 is judged on rounds 1-5; one still standing when your game ended is judged on
  rounds 1 to `endRound`.
- **Which board counts at round r** is the board the seat actually fielded in your game at round r: its real recorded
  round-r board, or, past the end of its recording, its final board with the **carried score** for round r (the same
  rule the lobby serves by, R-LOBBY-08, and strength v2 scores by). A round past the last reference round uses that
  last round's score, as everywhere else.

### 5.2 The weights

- A weight table indexed by **game length N** (the window size), one weight per round 1..N, summing to 100%. Mike's
  anchors are fixed: N = 1 is 100%; N = 2 is 50% / 50%.
- From N = 3 up, later rounds count more (Mike 2026-11-20, "this is right"). Proposed formula, honouring both anchors:
  **weight(r) = max(1, r - 1)**, normalised. That gives N = 3: 25 / 25 / 50; N = 8: rounds 1-8 at 3, 3, 7, 10, 14,
  17, 21, 24%; N = 14: round 14 at 14%, round 1 at 1%.
- The table lives in one function (`strengthWindowWeights(n)` in `boardStrength.ts`) with a test pinning N = 1 and
  N = 2 to Mike's numbers, so it can be swapped for a hand-written table later without touching callers.
- A round with no score drops out and the remaining weights are renormalised.

### 5.3 The number

- `windowStrength = round(sum(w_r * pct_r) / sum(w_r))` over the window's scored rounds, clamped 1-100.
- **Not enough data**: a seat shows no number when fewer than half of its window's rounds are scored. Generated and bot
  seats show none, as today.

### 5.4 Data delivery (approach A)

- `pool_runs_sample` (and the Worker mirror's run payload, `workers/versus/src/core/poolMirrorCore.ts` /
  `poolPick.ts`) adds, per run, the board scores at the current reference version: for each real board its
  `(wave, raw)`, and the final board's carried `(wave, raw)` pairs. A score at another reference version is not sent.
- The client keeps them on `PoolRun` and stamps them on the run's boards like `runStrength` (a new optional
  `BoardSnapshot` field, display only). Bump `POOL_CACHE_VERSION` so cached runs without them are re-fetched.
- **Feature detection**, as the earlier strength SQL did: before the SQL is applied the rows carry no scores, the
  opponent's recap number is simply absent, and nothing else changes.

### 5.5 At game end

- When the Match details record is built (`store.ts`, beside `runStrengthFromScores`), for each recorded opponent seat:
  look up its fielded board per round in the window, rank each raw score with the v2 board histogram already fetched
  for your own seat (`percentileOf`), apply the weights. For your seat, apply the same weights to your own
  `roundStrength`.
- Saved in the record and never recomputed (so the page never drifts):
  - `MatchSeat.windowStrength` (new, 1-100) for every seat that has one;
  - `MatchSeat.roundStrength` now also filled for opponent seats.
  - `MatchSeat.strength` keeps its current meaning, so older records and anything else reading it are unaffected.

### 5.6 What the player sees

Two named numbers (Mike 2026-11-20: "lets call it Relevant Strength and Run Strength"), shown side by side, so the
"they were a 90 while you faced them, a 40 over their whole run" contrast is on screen:

- **Relevant Strength** = `windowStrength` (this design). The headline number: larger, first.
- **Run Strength** = today's `strength` (the whole-run Game strength, ranked among runs). Smaller, beside it.
- Sketch of a lobby tile hover and a scoreboard row:

  ```
  Relevant Strength 90   ·   Run Strength 40
  ```

- **Where**: the lobby tiles (hover), the scoreboard rows, and your own header (where "Game strength 67" sits today:
  your Relevant Strength over your rounds, with your Run Strength beside it).
- Clicking any seat shows its strip, labelled "Relevant Strength by round", not only your own.
- **A seat with no Relevant Strength in a NEW record shows none** (no fallback to Run Strength in its place, so the
  two numbers never swap meaning on one page). It still shows its Run Strength when it has one. The record carries a
  version marker so the UI can tell a new record from an older one.
- **Older records** (before this ships) have no Relevant Strength: they show Run Strength alone, under that label.
- Tips, in player voice:
  - Relevant Strength: "How strong this board was across the rounds you played against it, compared with everyone
    else's. Later rounds count more."
  - Run Strength: "How strong this player's whole run was, compared with every other run."
- The two numbers are on different scales (Relevant Strength is an average of board ranks and sits nearer the middle;
  Run Strength is ranked among runs and spreads to the ends). Accepted; the tips say what each one is.
- Career and Recent Games rows are unchanged in this work (see section 7).

### 5.7 Rules, docs, tests

- New rule in `packages/rules/src/registry/approved/` (results domain), e.g. `R-RESULTS-STRENGTH-WINDOW-01`, pinned by
  a test that builds a record for a short game and checks an opponent's number uses only the shared rounds.
- Unit tests: the weight function (N = 1, N = 2 anchors, sum to 100, monotonic from N = 3), window bounds per seat,
  carried rounds, the not-enough-data rule.
- Extend the v2 TypeScript / SQL / Worker parity tests for the new payload.
- `docs/GAME-RULES.md`, a devlog entry, and a patch note (the recap numbers change meaning).

### 5.8 Rollout order

SQL first (the sample RPC returns the scores; an old client ignores the extra column), then Ship Ascent for the
Worker mirror and the client together. Ship Ascent is called only by Mike or Kevin.

## 6. Left to the builder

- The exact payload shape of the per-board scores (an array per run vs a field per board in the jsonb).
- The name and type of the new `BoardSnapshot` / `MatchSeat` fields.
- Where in the end-of-game flow the computation runs, as long as it rides the existing scoring step and adds no fights.
- The tip wording, within the player-voice rule.

## 7. Rulings and calls

Mike, 2026-11-20:
- Approach A plus the weighted average (section 4).
- The names: **Relevant Strength** and **Run Strength**, both shown (section 5.6).

Claude's calls (Mike to correct while reading):
- The weight formula `max(1, r - 1)` (section 5.2): honours Mike's 100% and 50/50 anchors and makes later rounds
  heavier after that. Swappable in one function.
- A seat with no Relevant Strength in a new record shows none rather than falling back (section 5.6).
- The "fewer than half of the window's rounds scored" cut-off for showing a number (section 5.3).
- **Career and Recent Games keep their "Game strength" label and number for now**, so this stays a recap-only change.
  That leaves two names for the whole-run number (Run Strength on the recap, Game strength on those rows and in the
  rank-cap patch notes); renaming those to Run Strength is a one-label follow-up if Mike wants it.
