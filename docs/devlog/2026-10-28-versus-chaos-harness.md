# 2026-10-28 — Versus chaos harness: full matches, every mode, with chaos, in CI

Owner bar: Versus and Ranked Duos must be spotless (real play showed End of Turn freezes and broken reconnects). This adds
a deterministic multi-client harness that plays FULL matches and proves (or disproves) that, and catches regressions.

## What it is (`packages/ui/src/versus/chaos/`)

- `chaosServer.ts`: PGlite with every Versus / Ranked Duos migration (a base list, then any newer `versus` /
  `ranked-duos` migration by file order, so the fix branches' migrations apply with no edit), the server clock on the fake
  timers (`versus.test_now`), seeded `random()` per scenario (match and hero seeds replay), a realtime feed from triggers
  on the subscribed tables, and the resolver: the SAME pure handlers `versus-resolve` runs, with the same reads, plus
  delay / fail N / 409 knobs and a call log. "Hold the match row lock" delays every call that names the match.
- `fakeSupabase.ts`: one client's `SupabaseClient` (rpc, the PostgREST read subset, `functions.invoke`, channels) under
  `makeVersusRemote`, the REAL adapter. Per-client network (latency, offline, hang, background throttling: 1 s, and once a
  minute past 5 minutes hidden). Channels follow realtime-js 2.x where it matters: `channel(topic)` returns the existing
  channel while it is registered (also while LEAVING), `.on('postgres_changes')` throws after subscribe, `.subscribe()`
  only rejoins a closed channel.
- `chaosClient.ts`: each player is its own module graph (`vi.resetModules()`): its own `useGame`, `versusStore`, identity
  and ranked gate. A UI driver plays the parts of the screen the store relies on through the store's exported functions:
  the gate crystal, Hero Select + launch, Recruit's End Turn intercept, the 0:00 lock, the real End Turn after the fight
  lands (with an End of Turn animation delay per End of Turn card), the fight, End Combat and the leave, the stale re-read.
  Seeded bot policies: `buyer`, `empty`, `sellout`, `eotHeavy`; Mend injected into the shop for the Armor probe.
- `chaosMatch.ts`: the runner + invariants: close (deadline + 2 s; Ranked Duos: its gate), resolve (5 s), oneCall,
  stuck (10 s), falsePause, pauseLift (4 s, no press), vitals (every client's rail and own pools = the server's after
  every round, Mend included), fights, final, finished, realtime (every present client subscribed to the match).
- `chaosScenarios.ts` (22 scenarios, 104 scenario x mode cells) and `chaosKnown.ts` (what fails on main, by cell and
  invariant, with the cause). A cell passes only when its violations are exactly its known ones: a regression fails it, and
  a fix fails it with "fixed: delete its KNOWN entry", so the fix PR edits `chaosKnown.ts`.
- `versusChaos.db.test.ts`: `npm test` runs a 7-cell smoke subset; `CHAOS_FULL=1` runs all; `CHAOS_ONLY=<regex>` picks
  cells; `CHAOS_LOG=<file>` streams each match's narrative. A full matrix is ~16 minutes locally; the PGlite instance is
  rebooted every 12 matches (it hits "stack depth limit exceeded" after ~90).
- `npm run versus:soak` (packages/tools/src/versus-soak.ts): a STUB for a live-backend Playwright soak (max 4 Claudebot
  clients, rooms closed, quiet hours). It validates and prints a plan; `--live` refuses.

## What it found on main (2026-10-28)

1. **Realtime is dead for every match, in every mode** (the audit's "channel reuse on match start", confirmed): the room
   channel is swapped for the match channel with `removeChannel` (async) + `channel(same topic)`, which returns the leaving
   channel; its `subscribe()` does nothing and the leave ack tears it down. Matches still play on the 4 s heartbeat.
2. **Duplicate resolver calls**: when a round closes on the clock in Group / Duos / Ranked Duos, two clients' own
   reconciles both see `resolving` and both call the resolver; a slow (10 s) or failing resolver gets backstop duplicates.
3. **A returning player does not auto-resume**: after a real 20 s drop (or a 15 s hang in Group / Duos) the match pauses
   correctly but never resumes without an Unpause press, so it never finishes.

Clean everywhere: empty boards (all empty, one side empty, a player who sold out, a Duos teammate or whole team empty,
round 1 and later), heavy End of Turn boards, lost combat acks, the 409, the held lock, 15 s and 6 minute backgrounds,
Health / Armor on every rail every round (Mend's shop Armor included), same fights on every client, final placements.

Judgement calls: a background tab is "gone" only past 5 minutes (heartbeats once a minute); a hang counts as gone when it
is longer than the 12 s lease; Ranked Duos is seated from generated teams (no recorded pool in PGlite).
