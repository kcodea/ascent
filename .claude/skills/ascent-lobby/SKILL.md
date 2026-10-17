---
name: ascent-lobby
description: Implement or review ASCENT's asynchronous eight-seat lobby — seats, pairing, scouting, placement, rating, snapshots, bots, persistence, replay capture and playback. Use for lobby, matchmaking, ladder or replay work. Not for ordinary card effects.
---

# ASCENT Lobby & Replay

The live `Play` route is an **asynchronous eight-seat elimination lobby**. Read `packages/sim/src/lobby/`
before changing anything. The retired 17-round course still has constants in `CONFIG` (`courseRounds`,
`defaultLine`, `calibrationRounds`) — they are read by tools and non-lobby modes. **Never infer current
behaviour from a legacy symbol.**

## Load-bearing invariants

- Seat 0 (`s0`) is the live player. Others are `snapshot`, `hybrid`, `bot`, or `authored` (the Tutorial's omen
  seats, and **Practice's Bots option** — see below).
- **Practice is a configurable sandbox** (`run.practiceConfig`, owner 2026-08-24; setup screen
  `PracticeOptions.tsx` → `createLobbyRun(..., 'practice', cfg)`). The knobs: `opponents` (`players` = recorded
  seats, `bots` = seven authored scaling-omen seats from `lobby/practiceBots.ts`), `botDifficulty`
  (a `BotLevel` 1–10 since 2026-09-02; the dials per level are the `BOT_LEVELS` table — 1/3/5 are the retired
  Easy/Medium/Hard, 3 is the raw authored table, 6+ swap 1–3 omen slots for real utility minions from
  `UTILITY_ROSTER`, gated by unlock level + the bot's current tier, at the SLOT's stats with Venom pinned to 1
  Attack. Old 'easy'/'medium'/'hard' strings in saves/drafts go through `normalizeBotDifficulty`),
  `health` (`unlimited` = the classic invulnerability + round-15 curtain, gated in the reducer; `normal` =
  real elimination — the reducer gates now read `practiceConfig?.health !== 'normal'`), `timeMult` (feeds
  `practiceTimer`), and `tribes` (the picked run tribes, empty = Normal; `practiceTribes.ts`: `createLobbyRun`
  passes them to `createRun` as the run's tribes, and `poolOf` narrows the pool to them plus neutral for a
  practice run with picks. Replaced the 2x-weight `tribeSurge` on 2026-09-27; old drafts drop it to Normal), and `rank` (the Opponent
  Rank, owner 2026-10-13, R-PRACTICE-RANK-01: `all` = no band; a medal = that medal's `STRENGTH_BANDS` entry through
  `practiceStrengthBand`, applied inside `createLobbyRun`, so the table is the one a rated lobby of that medal
  seats; read old values through `normalizePracticeRank`). Practice is **always unrated**
  regardless of these (rating/upload gates key on `mode === 'lobby'`). There is no standalone `bots` RunMode —
  bots live inside Practice.
- `DEFAULT_LOBBY_RULES`: `seatCount: 8`, `startingResolve: 30`, `startingArmor: 15` (only for seats with no hero;
  a seat that plays a hero starts on its hero's Armor via `seatStartingArmor`, R-LOBBY-SEAT-ARMOR-01), `maxRounds: 60`. The
  round cap is a **stalemate backstop**, not a course length.
- **Resolve each paired encounter ONCE** and apply both `playerDamage` and `enemyDamage` from that single
  result. The RULES are symmetric (R-SYMMETRY-01, 2026-10-13: both sides read, grow, show and carry back the same
  things), but the tie-break for simultaneous things (`CombatConfig.firstSide`) and the RNG draw order follow the
  labels, so a naive re-run with sides swapped is a different fight; only a swap that also flips `firstSide` is
  the mirror. Never re-resolve: take both damages from the one result (`enemyCarry` for the enemy seat).
  The run-end **fight-ledger play-out** (`lobby/fightLedger.ts playOutRunLobby`, 2026-09-22) does not break
  this: it resolves only the rounds the table never reached (after the player's elimination), on a CLONE, in
  the store's run-end path — never in the reducer and never against `run.lobby`. A reducer-side play-out
  collided with the balance instrument's own play-out once (devlog 2026-09-22-hall-of-champions-table-wins);
  keep it out of the reducer.
- Armor absorbs before Resolve. A seat at zero total is eliminated and takes a placement.
- Placement drives Rating. A lobby never reaches phase `victory` — `advanceCombat` ends every lobby at
  `gameover`, so a lobby win is placement 1, not a victory phase.
- **Quitting a rated game costs Rating** (R-RANK-05; off 2026-10-02 to 2026-10-11, ON again):
  `ABANDON_PENALTY_ENABLED = true` in `ui/src/rank/ratedRun.ts`. `store.settleAbandonedRun` (title Clear, `pickHero` /
  `newRun` / `startTutorial` over the save, `adoptCloudRun` replacing a different run) settles an unfinished rated
  save at the lowest open place (`abandonPlacementOf` = seats still alive) through the rank queue, tagged
  `kind: 'abandon'`. Save & Quit + Continue is not an abandon. A new door that overwrites or clears the save slot
  must call `settleAbandonedRun(savedRun)` first.
- **The ranked entry** (owner 2026-10-11, R-RANK-06; `ui/src/rank/rankedEntry.ts`): the Play card opens a
  confirmation, and only its "Yes" calls `startLobby`, which commits `rankedEntry` (ranked run id + seed + hero
  offer, in the store and in `ascent.rankedentry`). `pickHero` spends it (the run takes the entry's `runId`);
  `abandonRankedEntry` (hero select's two-press Back, Settings' Abandon match) settles it as an 8th via
  `settleAbandonedEntry`; a closed game boots straight back into the same hero offer (`BOOT_ENTRY`), and a live
  entry is RESUMED by `startLobby`, never re-rolled. A new door that opens the ranked hero select must go through
  `startLobby`, and a new door OUT of it must choose: `abandonRankedEntry` (costs an 8th) or `openTitle` (keeps
  the entry owed).
- Lobby state is serializable; runtime seat drivers are reconstructed from serializable metadata.
- Missing snapshot data degrades deterministically — fill the seat, never shrink the table.
- **A save carries its seats' boards** (R-LOBBY-SERVE-01, 2026-10-17): `lobbySeatRecordings` (each recorded seat's run,
  each generated seat's built recording) is written beside every lobby save (`ascent.save.seatruns`, the cloud copy's
  `seatRuns` + `seatHybrids`) and restored at boot BEFORE any driver is built (`restoreLobbySeatRecordings`). A seat
  served by a stand-in must be visible (`lobbyStandIns`, telemetry `standIns`); a new door that resumes a lobby must
  restore the recordings first.
- **The shared pool is WHOLE RUNS** (R-LOBBY-08, 2026-09-29): fetched as a uniform random sample of eligible runs
  (`pool_runs_sample` RPC, one row per run with every board; `opponentPool/poolFetch.ts`), checked complete
  (`isWholeRun`), registered all-or-nothing (`registerOpponentRuns`), cached as whole runs (cache v2). Never add a
  path that fetches or caches boards per wave, per page or with any row limit that can cut a run. A recorded seat
  serves EXACTLY its round-N board: the round number is the truth (`boardAt`: a hole in an old recording is an EMPTY
  board in the previous round's state via `emptyRoundOf`, never its minions; a round before the recording begins is an
  EMPTY tier-1 board; never a later round's); a later board appears only past the run's end (repeatFinal).
  EVERY round is uploaded, empty boards included (2026-10-17): an empty board is a wave of its run in the SQL
  (`pool_runs`, `pool_runs_sample`), `isWholeRun`, `registerOpponentRuns` and `playerRunsFrom`, but `pickOpponent`
  (per-wave opponents), the god-board sample and the strength scorer skip it. Never re-add an empty-board filter on
  a run path.
  Seat selection caps one player at `MAX_SEATS_PER_PLAYER` (4) seats, without weighting the shuffle. The player's
  OWN runs are seated like anyone else's under that same cap (owner 2026-09-30); nothing excludes them (the client
  sends `p_exclude_user: null`, and `excludeOwnerId` is gone).
- **Board strength + rank bands** (R-LOBBY-09, 2026-09-30): a board's raw strength is its seeded win rate against the
  frozen reference set (`lobby/boardStrength.ts`, `strengthReference.v1.json`), stored with the board; percentiles and
  a run's strength (`pool_runs.strength`: its board-percentile average RANKED among the runs, so bands hold their nominal share) are derived server-side. Since 2026-10-06 (R-LOBBY-13) each run
  also has EARLY (rounds 1-9) and LATE (10+) ratings (`pool_runs.strength_early` / `_late`, stamped on boards as
  `runStrengthEarly` / `runStrengthLate`), and a band carries an `earlyWeight`: the band filters `matchScoreOf` =
  w x EARLY + (1 - w) x LATE (EARLY alone without LATE; the weighted strength without either). "Game strength" stays the
  weighted number. Since 2026-10-09 (R-LOBBY-15) a band may also carry an `overallCap` on the WEIGHTED `strength`
  (Bronze 40, Silver 60, Gold 75; exactly the cap is in; `runUnderOverallCap`), a HARD cap: `widenBand` carries it and
  a capped band's last step is the cap alone `{ min: 0, max: 100, overallCap }`, never null. A RATED lobby passes
  `strengthBand` (Bronze 0-20 w1.0 c40, Silver 10-30 w0.8 c60, Gold 10-50 w0.6 c75, none from
  Platinum) to both the pool fetch (`p_early_weight` / `p_strength_cap`, each dropped for the session when the RPC lacks
  it; the cap then holds in seat selection, since every row carries `strength`) and
  `createRunLobby` (`runInStrengthBand`); unscored runs are in every
  band, and a band that cannot fill the table widens +10 per capped side before generated seats. With no band the
  selection is R-LOBBY-08's, seat for seat. **One session can hold samples for several bands** (2026-10-13: Practice
  can ask for another rank): the loader fetches the wanted band's sample (`matchBand`; `poolBandFor` in
  `ui/src/boardStrength` decides which band is wanted now) and names the runs fetched only for OTHER bands
  (`foreignRuns`), which every table passes as `LobbySeatOptions.excludeRuns`. Registration only ever adds; never
  remove runs from the pool to "clean" it (a saved game may be seated from them). A new door that builds a lobby
  must pass those exclusions (`ratedSeatOptions` / `seatExclusionsFor` in the store), or a Practice game set to
  Bronze makes the next rated lobby easier. Your own boards are scored in idle slices from capture
  (`ui/src/boardStrength/`), never on an interaction path; the run-end freeze reads them. Never read `runStrength`
  in combat.
- A generated (hybrid) seat is seated only if its RECORDING fields a board (`hybridSeat.canFieldBoard` checks a
  one-board `autoplayRun` prefix, not just the live bot). `autoplayRun` must answer every blocking modal a hero
  can raise (quest, Runeforge, `powerOffer`, Discover, chooseOne, target) or that hero records nothing — the
  Mimic bug (R-LOBBY-05). A player paired with a boardless seat fights the latest ghost, logged as a ghost fight.
- Do not synchronously rebuild seven runs inside a render or click handler. Warm expensive seats off the
  interaction path.
- Scouting reveals only recorded/intended information, never hidden future decisions.

## Replay: state replay, not action replay

Replays are **recorded frames**, not a re-simulation. Playback is a **pure renderer** — no `reduce()`, no
`simulate()`. This is deliberate: action replay was built and killed because re-deriving a run from
`{seed, actions}` diverges (a recorded 1st-place win replayed as a 4th-place death), and because it re-runs
against *today's* code, so any content change silently breaks every old replay.

- A shop frame is a projection of run state; a combat frame IS a recorded `lastCombat`.
- Deep-clone every captured frame — the reducer shares `lastCombat` by reference and combat mutates boards in
  place.
- Explicitly-undefined keys must travel as REMOVALS in a delta frame; `JSON.stringify` drops `undefined`, and
  a cleared field that survives serialization as "unchanged" is a real shipped bug class.
- Pacing is literal 1:1 — recorded deltas play verbatim. Speed changes resume the REMAINDER of the current
  step, never restart it.
- Frames carry a summon's committed board index; a projection that appends instead renders arrivals in the
  wrong slot and then snaps.
- Frames are persisted **per round to IndexedDB**, never to `ascent.save` (localStorage is synchronous and far
  too small). A chunk keyed `[runId, wave]` is written when the round closes and REPLACES its predecessor, so
  a mid-round flush converges instead of duplicating. Capture is best-effort: a storage failure downgrades the
  recording to `partial` and the run plays on. On resume, the restored rounds are spliced in front and the new
  session's frames are shifted along the cumulative clock — real time away must never become a replay pause.
- `partial` means "does not begin at round 1", not "was resumed". A partial recording must state its recorded
  RANGE up front; a rail that silently starts at R7 reads as filtering, not as missing capture.
- Three OPTIONAL side channels ride the recording (version stays 2; older recordings simply lack them): the
  `inspectTrail`, the `cursorTrail` (`[tMs, x, y]` viewport fractions, ≤20 Hz, capped at 6,000 per run) and a
  combat frame's stamped `odds` (`stampReplayOdds` after the deferred probe — absent at `faceOmen` time). The
  viewer backfills a missing Win % from the recorded rosters in idle time and marks it `~`.
- Playback fires the live `actionSfx` per APPLIED shop frame (never on a seek) and lifts a ghost's source card
  through the live `dragStore.drag` slice flagged `ghost` — never a parallel "held" state.

Spec: `docs/replay-v2-handoff.md`.

## Compatibility

- **Skins ride the recorded payloads (2026-09-28).** `RunState.cosmetics` (recorded at run start),
  `BoardSnapshot.cosmetics` (scoped to that board) and `LobbySeatState.cosmetics` (copied from the player run at
  lobby creation) are display-only and optional: absent = default art. Render them only through
  `packages/ui/src/skins/` (it applies liveness, the target check and the opponent toggle); never read them in
  combat or matchmaking.

- **Match details (2026-09-28)** are a RECORD, not a derivation: `buildMatchDetails` (lobby/matchDetails.ts) reads each
  seat's board through the lobby's own `prepare(round) ?? finalBoard()` ONCE at run end (store `matchDetailsOf`, in
  the deferred run-end blocks, before the fight ledger's play-out) and it is stored in `run_history.entry.match` /
  `practice_games.replay.match`. Readers go through `parseMatchDetails` (null for old records) and never touch a
  driver. It also carries each board's owned runes and each real run's ledger key (the Hall of Champions crown).
  A change to how a seat fields its board must keep that call the one the settle uses.

Changes must consider saved lobbies, replays, telemetry, Career/Recent Games, the End Screen, tutorial
authored seats, bot ladders, and remote snapshot availability.

Test determinism, odd survivor counts, rematches, mutual lethal, missing recordings, restoration, placement
ties, player elimination, and winner completion. Run focused lobby tests plus `npm run lobby`,
`npm run lobby:snapshots`, and `npm run replay`.
