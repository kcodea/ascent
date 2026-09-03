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
  `UTILITY_ROSTER`, never before `UTILITY_FROM_ROUND` (7), then per-seat per-round with `utilityChance`, gated by
  unlock level + the bot's current tier, at the SLOT's stats with Venom pinned to 1
  Attack. Old 'easy'/'medium'/'hard' strings in saves/drafts go through `normalizeBotDifficulty`),
  `health` (`unlimited` = the classic invulnerability + round-15 curtain, gated in the reducer; `normal` =
  real elimination — the reducer gates now read `practiceConfig?.health !== 'normal'`), `timeMult` (feeds
  `practiceTimer`), and `tribeSurge` (a tribe whose shop cards get 2× draw weight in `shop.ts drawOfferId` —
  only the surge branch changes the RNG, so non-surge seeds are untouched). Practice is **always unrated**
  regardless of these (rating/upload gates key on `mode === 'lobby'`). There is no standalone `bots` RunMode —
  bots live inside Practice.
- `DEFAULT_LOBBY_RULES`: `seatCount: 8`, `startingResolve: 30`, `startingArmor: 15`, `maxRounds: 60`. The
  round cap is a **stalemate backstop**, not a course length.
- **Resolve each paired encounter ONCE** and apply both `playerDamage` and `enemyDamage` from that single
  result. Combat is not symmetric — re-running with sides swapped produces a different fight, not the mirror.
- Armor absorbs before Resolve. A seat at zero total is eliminated and takes a placement.
- Placement drives Rating. A lobby never reaches phase `victory` — `advanceCombat` ends every lobby at
  `gameover`, so a lobby win is placement 1, not a victory phase.
- Lobby state is serializable; runtime seat drivers are reconstructed from serializable metadata.
- Missing snapshot data degrades deterministically — fill the seat, never shrink the table.
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

Spec: `docs/replay-v2-handoff.md`.

## Compatibility

Changes must consider saved lobbies, replays, telemetry, Career/Recent Games, the End Screen, tutorial
authored seats, bot ladders, and remote snapshot availability.

Test determinism, odd survivor counts, rematches, mutual lethal, missing recordings, restoration, placement
ties, player elimination, and winner completion. Run focused lobby tests plus `npm run lobby`,
`npm run lobby:snapshots`, and `npm run replay`.
