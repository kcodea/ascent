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
  a fix fails it with "fixed: delete its KNOWN entry", so the fix PR edits `chaosKnown.ts` (a race-only entry is marked
  `sometimes`: its absence does not fail). The client's own `Math.random` (the backstop jitter) is seeded per scenario.
- `versusChaos.db.test.ts`: `npm test` runs an 8-cell smoke subset; `CHAOS_FULL=1` runs all; `CHAOS_ONLY=<regex>` picks
  cells; `CHAOS_LOG=<file>` streams each match's narrative. A full matrix is ~16 minutes locally; the PGlite instance is
  rebooted every 12 matches (it hits "stack depth limit exceeded" after ~90).
- `npm run versus:soak` (packages/tools/src/versus-soak.ts): a STUB for a live-backend Playwright soak (max 4 Claudebot
  clients, rooms closed, quiet hours). It validates and prints a plan; `--live` refuses.

## What it found

Before the reliability fixes (main at #2358/#2360), every cell where Realtime was up failed `realtime` (the match channel
reused the room topic: realtime-js handed back the leaving channel, so every match ran on the 4 s heartbeat), the
clock-closed rounds of Group / Duos / Ranked Duos made two resolver calls, and a returning player's pause never lifted
without Unpause (with #2362 alone it lifted ~7 s after the return). #2362 (server) + #2363 (client) fixed those; the
harness proved each fix by failing its cell with "fixed: delete its KNOWN entry".

On main with #2362 + #2363 (2026-10-28; two full runs, identical):

| scenario | duel | group3 | group4 | duos | ranked_duos |
|---|---|---|---|---|---|
| baseline | pass | pass | pass | pass | pass |
| timer | pass | pass | pass | pass | pass |
| simultaneous | pass | pass | pass | pass | pass |
| dropRestore | pass | pass | FAIL: pauseLift | FAIL: pauseLift | pass |
| dropShort | pass | pass | pass | pass | pass |
| dropInFight | FAIL: pauseLift | pass | FAIL: pauseLift | FAIL: pauseLift | pass |
| background15s | pass | pass | pass | pass | pass |
| background6min | pass | pass | pass | pass | pass |
| hang | pass | FAIL: oneCall | FAIL: oneCall | pass | pass |
| realtimeDown | pass | pass | pass | pass | pass |
| resolverSlow | FAIL: oneCall | FAIL: oneCall | FAIL: oneCall | FAIL: oneCall | FAIL: oneCall |
| resolverFail3 | pass | pass | pass | pass | pass |
| resolver409 | pass | pass | FAIL: oneCall | pass | pass |
| lockHeld | pass | pass | pass | pass | pass |
| lostCombatReady | pass | pass | pass | pass | pass |
| eotHeavy | pass | pass | pass | pass | pass |
| emptyAll | pass | pass | pass | pass | pass |
| emptyOne | pass | pass | pass | pass | pass |
| sellout | pass | pass | pass | pass | pass |
| duosFirstEmpty | n/a | n/a | n/a | pass | pass |
| duosSecondEmpty | n/a | n/a | n/a | pass | pass |
| mendArmor | pass | pass | pass | pass | pass |

Still failing (listed in `chaosKnown.ts`):
- **pauseLift**: the pause lifts by itself but ~4.9 s after the player is back (Group of 4, Duos; a drop during the fight
  in 1v1); the bar is 4 s.
- **oneCall**: with a 10 s resolver another client's backstop still asks ~5 s after the round has committed (every mode);
  after a 15 s hang (Group) or an injected 409 (Group of 4) two clients ask at once.

Clean everywhere else: empty boards (all empty, one side, sold out, a Duos teammate or the whole team, round 1 and
later), heavy End of Turn boards, lost combatReady, the held lock, 15 s and 6 minute backgrounds, a 15 s hang, Realtime
down, Health / Armor on every rail every round and live during the shop (Mend), same fights everywhere, final placements.

Judgement calls: a background tab is "gone" only past 5 minutes (heartbeats once a minute); a hang counts as gone when it
is longer than the 12 s lease; Ranked Duos is seated from generated teams (no recorded pool in PGlite).
