# Strength v2: sharper board strength and a bounded "what you can face"

Date: 2026-11-16. Owner: Mike. Status: APPROVED by Mike 2026-11-16 ("approve").
Touches Kevin's side (`packages/sim`, pool SQL, the pool mirror Worker); coordinate before starting.

## 1. Intent

Mike, 2026-11-16: "time to do a robust deep dive on our snapshot logic. 1. i want to refine how we determine
strength of boards. 2. i want to better determine what a player may face. i want to absolutely nail this down so
we are crystal clear".

Two outcomes:

1. A board's strength number is trustworthy at every round and at both ends of the scale.
2. For any medal we can state, as a hard rule, the strongest thing a player can meet, per round, not only on
   average.

## 2. How it works today (verified 2026-11-16)

- **Board raw score**: win rate over 60 seeded fights (30 frozen reference boards of the board's round, 2 fights
  each, one per side). `packages/sim/src/lobby/boardStrength.ts`, reference `strengthReference.v1.json`
  (`set2-v1`, built 2026-09-30, rounds 1 to 15, round 15 covers everything later). Stored on `boards`
  (`strength_raw`, `strength_ref`, `strength_wave`).
- **Board percentile**: rank of the raw score among every scored pool board at the same reference round, ties
  half, 1 to 100. Derived, never stored.
- **Run numbers**, each a mean of board percentiles ranked among the set's runs:
  Game strength (rounds 1-5 20%, 6-9 35%, 10+ 45%; `pool_runs.strength`), EARLY (rounds 1-9), LATE (10+).
- **Bands** (`strengthBands.ts`): Bronze 0-20 on EARLY, cap 40 on Game strength; Silver 10-30 on 80% EARLY,
  cap 60; Gold 10-50 on 60% EARLY, cap 75; Platinum and up none. A band widens by 10 per side when it cannot
  fill a table; the cap never widens; an unscored run is inside every band.
- **Table** (`runLobby.ts seatRunLobby`): seeded shuffle of the in-band runs; one run per seat, unique heroes,
  at most 4 seats per player, own runs included; generated seats only when the band runs dry.
- **Rolling pool** (R-POOL-ROLLING-01, live in production, checked 2026-11-16): a table is seated only from the
  newest 250 eligible runs of the set (`pool_runs.live`), and run strengths are ranked among those live runs. The
  board histogram still counts every scored board. The strength tools do not read `live` yet.
- **Each round**: a seat fields exactly its recorded round-N board, and its final board once the recording has
  ended. Pairing avoids a rematch within 3 rounds; an odd table gives one of the bottom three the most recently
  eliminated seat's board.

## 3. What is wrong

Measured 2026-11-16 with `npm run strength -- measure` over all 560 eligible runs (the tool ignores the window),
then re-checked on the 250 live runs (7 players: Rooks 59, IonLime 57, LazerLemon 42, Orangez 41, LEMON 41,
BraveLynx12 9, LuckyOwl79 1). Rows marked LIVE are live-window figures.

| # | Weak spot | Evidence |
|---|---|---|
| 1 | Reference set is stale and too easy | Median pool board beats it 55-69%; the top 10% beat it 92-97%. Strong boards bunch at the ceiling. |
| 2 | Late percentiles rank survivors only | 266 boards at round 14 against 575 at round 5. Rounds 15-18 share one bucket (147, 50, 12, 4 boards). |
| 3 | A run's number hides its swings | EARLY vs LATE correlation 0.34. LIVE: of the 43 Bronze-band runs, 88% hold a board over the 60th percentile, 35% over the 80th, 9% over the 90th; the strongest is a 96. Silver (44 runs): 48% over 80. Gold (109 runs): 66% over 80. |
| 4 | Short runs are overrated late | LIVE: 23 of 250 runs end by round 9 and are banded on EARLY alone, yet keep fielding that last board. 42 end by round 10, 109 by round 12. |
| 5 | Five players are 96% of the pool | LIVE: five players hold 240 of 250 runs, but evenly (59, 57, 42, 41, 41). The lopsided 180-run share of the whole pool is already gone inside the window. |
| 6 | Results are ignored | Strength never reads a fight outcome, so nothing tells us whether it predicts one. |
| 7 | 60 fights is noisy | About +/-6 points of win rate on a mid-strength board; round 1 has only 30 distinct scores. |

## 4. Goals, non-goals, anti-goals

Goals
- A re-baselined reference (v2) that separates boards across the whole range, top included.
- Percentiles that mean "against every run, with the board it would really field that round".
- Every run has a LATE rating.
- A hard per-medal limit on the single strongest board a seated run may hold.
- A percentile scale no single prolific player dominates.
- A standing report that checks strength against real fight results.

Non-goals
- No change to pairing, ghosts, the per-player seat cap of 4, hero uniqueness, or how a seat serves its round.
- No change to the band numbers, early weights or overall caps (they may be retuned later from v2 data).
- No use of fight results as an input to strength (report only).
- Ranked Duos' recorded duo TEAMS (`duo_runs`, never scored today) are out of scope: they keep today's rule,
  unscored and inside every band, and get no peak. Solo runs that fill Ranked Duos seats come through the solo
  sample and follow every rule here.
- No change to the rolling window or its size.
- No deletion of existing board rows (Mike 2026-11-16: "exclude them"): Career, Match details, replays and saved
  games keep reading them.
- No change to Platinum and up being open.

Anti-goals (a failure even if it "works")
- Any cost on an interaction path. Scoring stays in idle slices (`strengthScorer.ts`); performance is the north
  star.
- Any change to the boards a seat serves (R-LOBBY-08) or any path that fetches less than a whole run.
- The SQL, the TypeScript twin and the Cloudflare pool mirror (`workers/versus/src/core/poolPick.ts`) drifting
  apart. A change to the draw changes all three in one PR, with the existing parity tests extended.
- Reading any strength number in combat.
- A band that silently admits a run we could not score.

## 5. Approaches considered

1. **Re-baseline the fixed reference and repair the ranking population (chosen).** Keep the model (win rate vs
   a frozen reference, percentile among pool boards) and fix its four defects: the reference, the population,
   the missing late rating, the missing peak bound. Cheapest path; every existing storage and parity shape
   survives; numbers stay stable between re-baselines.
2. **Floating rating (Elo / Bradley-Terry over pool boards).** Never goes stale and needs no reference file, but
   every board's number moves whenever the pool does, scoring cannot be a pure function stored once, and the
   client could not score its own board offline in idle time. Rejected.
3. **Outcome-based strength (placement or real win rate).** Uses what actually happened, but a result depends
   on the lobby it happened in (a Bronze 1st is not a Platinum 1st), so it would bake matchmaking into the
   score it feeds. Kept as a check (bundle E), not an input.

Mike picked approach 1 with all five bundles on 2026-11-16.

## 6. Design

### A. Reference v2 (weak spots 1, 7, part of 5)

- New file `strengthReference.v2.json`, version `set2-v2`, built by `npm run strength -- ref` from the current
  pool. v1 stays in the repo until no code reads it.
- **40 reference boards per round, 4 fights each (160 fights per board).** 28 evenly spaced by rank across the
  round robin of that round's real boards, plus 12 evenly spaced inside the top 20%.
- **No player supplies more than 10 of a round's 40 references.** When a pick would exceed that, take the
  nearest-ranked board of another player.
- A round gets its own reference round when it has at least 40 real boards; later thin rounds merge into the
  last one, as today. On today's pool that gives rounds 1 to 16, with 16 covering 16+.
- Cost: about 0.4 ms per fight measured, so 65-130 ms per board, still spread over idle slices. The lazy chunk
  grows from about 0.65 MB to about 1 MB.
- The reference is built from LIVE runs only, and the tools learn to read `live`: `measure`, `ref`, the peak
  table and the band feasibility counts all use the live window; `backfill` scores every pool board.
- **Drift alarm**: `measure` prints, per round, the median and 90th-percentile raw score, and flags
  `RE-BASELINE` when any round's median is above 0.60 or its 90th percentile above 0.92. Advisory only.

### B. Carry-forward ranking (weak spots 2, 4)

- **Fielded board**: for a run whose recording ends at round L, the board it fields at any round N > L is its
  final board. That is already what the lobby serves; strength now scores it the same way.
- For every run, the final board is also scored against each reference round from L+1 to the last reference
  round. These are **carried scores**.
- The percentile population of round N is the LIVE runs: each live run's real board at N, or its carried score
  when it ended before N. Every live run appears exactly once per round. (Today the board histogram counts every
  scored board, live or not; v2 narrows it to match the run rankings.) A run outside the window is still ranked
  against that population and keeps its numbers for Career and Match details.
- An **empty board** counts as raw 0 (it loses every fight). It is no longer skipped by the scorer's
  population, though it still costs no fights.
- **EARLY** = mean percentile of rounds 1-9, **LATE** = mean percentile of rounds 10-15, both over real and
  carried rounds, each then ranked among runs as today. LATE is never empty. Rounds past 15 do not enter LATE.
- **Game strength (the number players see) keeps its formula over REAL rounds only**: a group the run never
  reached still drops out. Being eliminated early must not retroactively lower the number a player sees. Its
  board percentiles do come from the new population, so late-round percentiles in Match details will read
  higher than before for boards that survived (they now beat the runs that had already fallen).
- The overall cap keeps reading Game strength.
- **Where the carried scores are computed** (Mike 2026-11-16: "can we have the continue button greyed out and
  unavailable to click while the games are being scored?"): on the client at run end, BEFORE the upload. On the
  end screen of a rated game, Continue is disabled until the run's board
  scores and carried scores are done; the run then goes up once, complete. The backfill tool covers every run
  already in the pool.
  - **The player is told why** (Mike 2026-11-16: "i want to make sure it says something like 'Calculating Score'
    while the button to continue is greyed out. players should know why this is happening. preferably with a
    timer bar as well"): while Continue is disabled the end screen shows the text "Calculating Score" and a bar
    that fills as the scoring completes (fights done out of fights to do, so it is real progress, not a guess).
    When it is full the text and bar go away and Continue becomes clickable. The bar animates with
    transform only (a scaleX fill), no looping paint animation, no `title=` tooltip, and is added to the stage,
    per the UI conventions in CLAUDE.md.
  - Safety limit: after 5 seconds Continue unlocks regardless and the run goes up with what is ready (an
    incomplete run is unscored). The button must never stay locked.
  - Measured 2026-11-16 (node, v1 reference): a carried fight costs 0.8 ms at the median, 1.1 ms at the 90th
    percentile, 2.2 ms worst. The worst case under the 7-round floor is a run ending on round 7 (9 rounds x 160
    fights = 1,440 fights): about 1.1 s typical, 1.6 s at the 90th percentile, 3.2 s worst. A typical run ends
    around round 12 (640 fights): about 0.5 s.
  - The work must not hitch the end screen (performance is the north star): the builder chooses between a Web
    Worker and frame-budgeted slices on the main thread; slices roughly double the wall time.
  - Practice, the tutorial and every unscored mode never lock Continue.
- **A run is scored only when it is complete**: every real board with minions has a current-version score and
  the final board has every carried score. Anything less is an unscored run (see Transition). This closes the
  gap where a run missing its strongest board's score would slip under a cap. `measure` prints the number of
  live unscored runs and the ops digest reports it, so a growing backlog is visible; re-scoring stays a tool an
  owner runs.

### B2. No run under 7 rounds (Mike 2026-11-16)

"we should never have any snapshots of boards that are below 7 rounds. those should be wiped and never included";
on what wiped means: "exclude them".

- A run whose recording ends on round 6 or earlier is never seated, never counted in any ranking population,
  never a reference board, and is not uploaded to the pool by a v2 client. A run that ends on round 7 is in.
- This replaces the 4-board minimum (`MIN_RUN_WAVES`) in the client eligibility, the SQL `pool_runs`
  eligibility and the Worker mirror, which must stay in parity.
- Short runs already in the database are marked ineligible, not deleted.
- Today no eligible run ends before round 7 (11 of the 250 live runs end on rounds 7 or 8), so nothing leaves
  the pool now; this is a guard, mostly against abandoned games.
- The player's own short game still shows in their Career and Match details; it just never becomes an opponent.

### C. Peak cap (weak spot 3)

- New per-run number **peak**: the highest board percentile among the run's real rounds 3 and later (rounds 1
  and 2 are one or two minions and too coarse to judge). Stored as `pool_runs.strength_peak`, stamped on
  delivered boards like `runStrength`.
- `StrengthBand` gains an optional `peakCap`. A run whose peak is above it is outside the band. Exactly the cap
  is inside. It behaves like `overallCap`: hard, carried through every widening step, never widened away,
  enforced by the server draw (`p_peak_cap`), re-checked on the client at seat selection, and mirrored in the
  Worker draw.
- `bandVersionLabel` adds `/pN`, so the regime stamp names it.
- Practice's Opponent Rank inherits it automatically (it reads the medal's own band entry).
- **The numbers (Mike 2026-11-16, after the v2 measurement: "90 for all"): Bronze 90, Silver 90, Gold 90.** They
  go in with the mechanism, in the same PR.
- As first written: the three numbers are Mike's to set, after v2 is measured. The mechanism ships with no `peakCap` on any
  medal; `measure` prints, per medal, how many runs each candidate cap (60, 70, 80, 90, 95) removes and whether
  the band can still seat 7 under the per-player cap. On the v1 scale and the live window today: a Bronze cap of 80
  removes 35% of the 43 Bronze runs, 90 removes 9%.

### D. A population no player dominates (rest of weak spot 5): RECOMMEND DROPPING

Mike approved "count each player equally". Building it literally would hand the seven players with one or two
runs 58% of the scale, which is noisier than the problem it solves. The design instead **caps how many runs
one player contributes to the ranking population**:

- Only each player's 30 most recent eligible runs count in the board-percentile population and in the run
  rankings (EARLY, LATE, Game strength). `runOwnerOf` defines the player; runs with no owner each count.
- Runs outside the population are still ranked (against the population, not counting themselves) and still
  seated like any other run.
- Counts stay whole numbers, so the exact-integer parity between `pctFromCounts` and the SQL is kept.
- On the whole pool the population would become 167 runs and the largest share fall from 32% to 18%.
- **Re-measured on the live window, it buys almost nothing**: the population would fall from 250 to 160 runs and
  the largest share from 24% to 19%. The rolling window already removed the lopsided share. Recommendation: do
  not build D; keep only the 10-of-40 limit on reference boards (bundle A). Mike to confirm (section 9).

### E. Results report (weak spot 6)

- New read-only command `npm run strength -- validate`, reading `lobby_fights` (one row per resolved fight,
  both sides named by run key).
- It prints: the real win rate of the stronger board by percentile gap (0-10, 10-20, ... points); the
  correlation between a run's EARLY / LATE rating and its real win rate in early / late rounds; and the 20 runs
  whose results disagree most with their rating.
- No runtime behaviour reads it.

### Transition and unscored runs

- Scores from different reference versions are never compared (unchanged). The SQL gains one place that names
  the current reference version; a run with no score at that version is unscored.
- The backfill tool rewrites every pool board's score to v2 (and the carried scores) as a generated SQL file an
  owner runs. It never writes to the backend itself.
- `boards` holds one score per row, so the backfill REPLACES v1 scores. Switching the current reference version
  and the backfill are one transaction (the generated file does both), so there is no moment where every run is
  unscored.
- Strength columns also live in `pool_mirror_index`, `pool_mirror_version` and `ops.pool_digest`; the peak and
  the completeness rule go there too.
- Order: deploy the hub first (it must understand the new draw before the SQL uses it; hub deploys ride Ship
  Ascent, which only Mike or Kevin can call), then apply the migration and backfill, then ship the client that
  scores with v2.
- The backfill touches every board, so every run's `rev` moves: each client and the hub mirror re-download the
  250 live runs once (a few MB per client). Accepted as a one-time cost.
- An installed v1 client finds no v1 histogram and shows no Game strength until it updates.
- A client still on v1 uploads v1 scores. Those runs are unscored under v2 until the next backfill.
- **Unscored runs leave banded lobbies.** Today an unscored run is inside every band, which would let a
  top-strength run from an old build into Bronze. Under v2 an unscored run is outside any band that has a min,
  max or cap, and stays seatable where there is no band (Platinum and up, Practice on All Ranks). This reverses
  one clause of R-LOBBY-09 and needs Mike's ruling (see section 9).
- `RUN_STRENGTH_FORMULA` gets a new value so the Balance Report can tell v2-matched runs apart.

### Rules, docs, tests

- Amend R-LOBBY-09, -12, -13, -15 and add rules for carry-forward, the peak cap and the capped population,
  each with a pinning test, in the same PR as the behaviour.
- Update `docs/GAME-RULES.md`; add a devlog entry; add a patch note (the meaning of round percentiles and Game
  strength shifts for players).
- Extend the existing TypeScript / SQL / Worker parity tests rather than adding new unpinned copies.

### As built (Plan 2, 2026-11-16): where the build departs from the text above

Each is recorded with its reason in `docs/devlog/2026-11-16-strength-v2-scoring.md`.

- **Rollout order is SQL first, then Ship Ascent straight away**, not "deploy the hub first": the
  `strength_carried` column must exist before a client that sends it ships. The SQL is one generated file (the
  migration with the backfill inside its transaction); until the hub ships, the old hub still seats unscored runs
  in banded tables, so the two steps go back to back.
- **A carried score is fought without the board's banked next-combat spells**, as a table meets a final board past
  its round.
- **A game under 7 rounds still uploads its boards** (the live replay and the record board read them); the database
  marks the run ineligible, so it is never seated or ranked.
- **The 7-round floor is applied where a table is seated**, not in the run lookup, so a saved game or a replay still
  finds a run seated before the floor existed.
- **The reference covers rounds 1 to 15** (round 16 has under 40 real boards in the live window).
- **The count of live unscored runs is `pool_live_unscored()`**, not a field of `ops.pool_digest` (a content hash).
- **The lock also covers an offline (unrated) lobby game.**
- **A game not scored within the 5 second limit keeps scoring after Continue unlocks**, and its boards upload when
  it is done (Mike 2026-11-16: "Yes, finish scoring"), instead of going up unscored.

## 7. Delivery order

1. Tooling only: v2 reference builder, drift alarm, peak table, `validate`. No behaviour change.
2. v2 scoring, carry-forward and the capped population (client, SQL, Worker mirror, backfill file).
3. Peak cap mechanism; then a one-line PR setting the three numbers once Mike has chosen them.

## 8. Left to the builder

- Storage shape of carried scores (a column on the final board's row or a side table) and of `strength_peak`.
- How "most recent 30" is ordered (upload order or capture time).
- Exact SQL structure of the refresh job and histograms, within the once-a-minute job that exists.
- Whether scoring a board against a later round needs anything beyond overriding its round in the probe.
- Idle-slice sizing for the larger fight count, and Web Worker versus main-thread slices for the run-end scoring.
- The look and placement of the "Calculating Score" text and bar (Mike reviews it in the running game before merge).

## 9. Rulings (Mike, 2026-11-16, approved as recommended)

1. Unscored runs are kept out of Bronze, Silver and Gold lobbies.
2. The three peak caps are set by Mike after the v2 measurement; the mechanism ships with none.
   **Set 2026-11-16, after the measurement: "90 for all"**: Bronze, Silver and Gold each get `peakCap: 90`. On the
   live window under v2 that removes 1 of 39 Bronze runs, 3 of 54 Silver and 23 of 106 Gold.
3. Bundle D is dropped; only the 10-of-40 limit on reference boards per player is built.

The questions as they were put:

1. Unscored runs leave Bronze, Silver and Gold lobbies (recommended), or stay inside every band as today?
2. The three peak caps, after the v2 measurement. The live bands are small (Bronze 43 runs, Silver 44): a Bronze
   cap of 80 would leave about 28 runs from five players.
3. Drop bundle D (recommended), or build the 30-run cap anyway?
