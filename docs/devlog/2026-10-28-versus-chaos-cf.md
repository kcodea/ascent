# 2026-10-28 — Versus chaos matrix on Cloudflare: the cutover's acceptance gate

The chaos harness (`packages/ui/src/versus/chaos/`, devlog `2026-10-28-versus-chaos-harness.md`) now plays every
scenario against the Cloudflare room as well as Supabase, with the SAME scenarios and the SAME invariants, so the two
tables compare cell by cell before any mode is flipped.

## What was built

- `chaosBackend.ts`: the seam the runner needs of a server (reads, chaos knobs, the push path). `chaosMatch.ts` keeps
  every invariant unchanged; its SQL reads moved into `chaosServer.ts` (the Supabase backend) as they were.
- `cfChaosServer.ts`: the Cloudflare backend. The REAL room rules (`workers/versus` `RoomCore`, the group, Duos and
  Ranked Duos engines, the storage split) inside a Node mirror of the Durable Object shell (`room.ts`) and the Worker
  routes (`index.ts`, `directory.ts`), on the fake clock. One event at a time per room, storage written before pushes,
  one alarm re-armed as `rearm()` does, the 15 s stale-socket sweep, the runtime's ping auto-response, one live socket
  per account, the rate limit, the hello version check. Ranked Duos' Supabase reads are stubbed like the Supabase
  harness stubs them (the Worker's `LocalRankedService`: unrated, generated teams).
- WHY NOT MINIFLARE: workerd runs on the wall clock (alarms, `Date.now`, socket timers), so a full match (15-45 minutes
  of game clock) cannot run on the harness's fake clock there; the matrix would take hours per run and not be
  deterministic. The workerd round trip of the shell stays covered by `npm run versus:cf:test` (passes on Node 24).
- `chaosClient.ts` transport switch: on Cloudflare each client runs the REAL cutover router (every mode switched to
  `cf`) over the REAL `makeCfVersusRemote` + `VersusCfClient`; the global `WebSocket` / `fetch` are that client's fake
  network. Any call that leaks to the Supabase side of the router is an error.
- Fault translations: socket drop = the client sees its socket close at once, the object hears nothing (half-open until
  the keep-alive goes stale); hang = every frame held both ways; background = frames wait for the throttle slot;
  realtimeDown = the room object restarts (one socket carries pushes and requests on Cloudflare, so the analogue of
  Realtime dying is every socket dropping at once; state reloads from storage); resolverSlow = the resolve holds the
  object 10 s; resolverFail3 = the object dies mid-resolve 3 times (not committed, the trigger retried after the
  reconnect / alarm retry); resolver409 = the in-room resolver answers 409 (the room voids the match by design);
  lockHeld = the object is busy 6 s; lost combatReady, heavy EoT, empty boards, Mend, Duos empties unchanged.
- Two Cloudflare-only scenarios beside the shared matrix: `dropLong` (a 45 s silent loss: found stale, paused, lifted)
  and `dropFin` (a 20 s loss the object hears: paused in the 3 s grace, lifted on return). Without them the
  pause / auto-resume path would never run on Cloudflare (see "silent drops" below).
- `chaosKnownCf.ts`: its own ledger (empty). `versusChaosCf.test.ts`: `npm test` runs an 11-cell smoke (~40 s);
  `CHAOS_FULL=1` runs all 114 cells in ~8 minutes; `CHAOS_TABLE=<file>` writes the table.

## Found and fixed

- **Pause lift 4.1 s after a return (dropFin, every mode that pauses).** The client waited out its reconnect backoff
  (up to 3 s) before the 3-2-1 could start. `VersusCfClient` now reconnects at once on the browser `online` event
  (`wake`, wired in `versusCfRemote.ts`): 3.1 s. R-VERSUS-CF-RECONNECT-01; `workers/versus/test/clientWake.test.ts`.
- The Supabase chaos harness was red on main for Group / Duos (`versusRemote.hostOf is not a function`); #2378 fixed it
  the same way this branch had (the router with no Worker). The full Supabase matrix: 91/104, ledger unchanged.
- The Ranked Duos resolver is injectable (`CoreDeps.resolveRanked`, like the 1v1 / Group / Duos ones), so its resolver
  faults and the one-call count apply.

## Results (2026-10-28; SB = Supabase on main, CF = Cloudflare; two CF runs identical)

| scenario | duel SB / CF | group3 SB / CF | group4 SB / CF | duos SB / CF | ranked_duos SB / CF |
|---|---|---|---|---|---|
| baseline | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| timer | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| simultaneous | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| dropRestore | pass / pass | pass / pass | FAIL: pauseLift / pass | FAIL: pauseLift / pass | pass / pass |
| dropShort | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| dropInFight | FAIL: pauseLift / pass | pass / pass | FAIL: pauseLift / pass | FAIL: pauseLift / pass | pass / pass |
| background15s | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| background6min | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| hang | pass / pass | FAIL: oneCall / pass | FAIL: oneCall / pass | pass / pass | pass / pass |
| realtimeDown | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| resolverSlow | FAIL: oneCall / pass | FAIL: oneCall / pass | FAIL: oneCall / pass | FAIL: oneCall / pass | FAIL: oneCall / pass |
| resolverFail3 | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| resolver409 | pass / pass, void | pass / pass, void | FAIL: oneCall / pass, void | pass / pass, void | pass / pass, void |
| lockHeld | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| lostCombatReady | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| eotHeavy | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| emptyAll | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| emptyOne | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| sellout | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| duosFirstEmpty | n/a | n/a | n/a | pass / pass | pass / pass |
| duosSecondEmpty | n/a | n/a | n/a | pass / pass | pass / pass |
| mendArmor | pass / pass | pass / pass | pass / pass | pass / pass | pass / pass |
| dropLong (CF only) | - / pass | - / pass | - / pass | - / pass | - / pass |
| dropFin (CF only) | - / pass | - / pass | - / pass | - / pass | - / pass |

Supabase 91/104. Cloudflare 104/104 on the shared matrix + 10/10 extras (dropFin was 0/4 before the reconnect fix).
Why Cloudflare clears the Supabase failures: the room is the only resolver (no client backstop can ask twice:
oneCall), and a returning socket IS the return (no heartbeat lease to wait out: pauseLift).

## Open (not fixed here; owner calls)

- ~~Silent drops are found late on Cloudflare~~ (a match paused ~22 s after a silent drop; Group / Duos had no stale
  sweep armed at all): fixed by `2026-10-28-versus-cf-stale-socket.md` (R-VERSUS-CF-STALE-01), guarded by `latePause`.
- **A resolve that answers non-200 voids the match** (resolver409). By design in the room (R-VERSUS-RESOLVE-TIMEOUT-01:
  the object IS the resolver, so it will not resolve later either); in practice unreachable, since a Worker is
  versioned by content revision and hello refuses any other client.
