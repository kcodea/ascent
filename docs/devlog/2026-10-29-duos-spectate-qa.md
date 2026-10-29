# 2026-10-29 · Duos + spectating QA on the Cloudflare host

Owner ask: "triple check the duos experience in ranked and versus ... extremely clean without jank. Make sure spectating is
also extremely clean", plus (coordinator, top priority) the teammate-view swap hitch.

## Tooling added

- **Spectators in the Cloudflare chaos matrix** (`packages/ui/src/versus/chaos/`, R-SPECTATE-HARNESS-01): a scenario can
  seat spectators (`ChaosScenario.spectators`), who join the stands through the real store and watch through the real
  `spectate.ts` (the harness renders on its fake clock, answers the replay-done and End of Turn cues Recruit would). New
  `spectate` invariant: the stands follow the watched player (same phase and wave within 12 s), never go back a phase,
  keep ONE fight object per fight, move to a newly chosen player within 3 s, and end back in the room. New cells
  `spectate/<mode>` (all five modes; duel, duos and ranked_duos are in the CI smoke set). The CF matrix now fakes
  `performance` too, so the cursor clock and the fake clock agree.
- **Real-browser QA scripts** (`scripts/versus-qa/`): headless Chrome contexts against `wrangler dev` (DEV_AUTH) and a
  `VITE_PERF_BENCH=1` prod bundle built with `VITE_SUPABASE_URL=` (no live sign-in; each context is its own dev account).
  `duos-swap.mjs` (teammate swap frame times, desktop and `--phone` 4x CPU), `swap-trace.mjs` (DevTools trace split),
  `ready-timing.mjs` (Ranked Duos both-ready close), `spectate-watch.mjs` (1v1 / Versus Duos with a spectator who switches
  players), `smoke.mjs`, `phone-dock.mjs`.

## Found and fixed

- **(b) "rebuilding the opponent board and showing a hit" at the end of a watched fight** (R-SPECTATE-FIGHT-STABLE-01):
  every Duos round projection built a new per-seat result object (`duosMemberView`), and the projection reruns on every
  match update. The first End Combat press of a Duos fight handed the watch screen a new `lastCombat`, so the replay
  restarted on every spectator. `resultsOf` is now memoised per stored round. The spectate cells flag it in every Duos
  and Ranked Duos round without the fix.
- **The stands sat on the shop through a whole fight, then went back to it** (R-SPECTATE-LANDWAIT-01): the action queue's
  400 ms "wait for the drawn hand" cap was per retry, so a hand clock reading ahead re-armed it forever; and a shop
  action landing after the fight was on screen took the screen back to that shop. Capped in total; stale pre-fight shop
  actions are dropped.
- **Teammate swap** (R-DUOS-VIEW-SWAP-01): desktop now swaps inside a View Transition (no DOM clone, no rendering in the
  click handler, compositor cross-fade). Phones keep the ghost: on the throttled phone bench the transition's snapshots
  measured far worse.
- **The hit landed seconds after the blow on the watch screen** (R-SPECTATE-STRIKE-01): the pinned fight let go a fixed
  2.6 s after the replay ended, so the Health drop and the lobby rebuild came after (or in the middle of) the hero strike,
  and the end gate keyed on the same 2.6 s. Recruit's strike now reports its start and impact to `spectate.ts`; the
  stands drop the Health on the impact beat and the end gate waits for it (9 s safety). Browser run (Versus Duos, 4
  players + a spectator switching players, 21+ rounds): settle 1.6-2.1 s after replay done (the impact), no fight replaced,
  no phase going backwards.
- **Hero pick retry** (R-VERSUS-HEROPICK-RETRY-01): a pick that did not land was never resent, leaving "Waiting for your
  opponent" up for the whole 20 s clock and a random server pick. Hardening for report (a), which did not reproduce.

## Numbers (prod bench bundle, local stack)

Teammate swap, desktop 1600x900, 6 swaps each way: click to next paint 80-216 ms (ghost) -> 16-72 ms (View Transition);
main-thread task per swap (trace) 35 + 65 ms in / 57-75 ms out (ghost) -> 25 + 19 ms in / 23 ms out. Still 1-2 frames
over 33 ms per direction: the board REMOUNTS (`Recruit key={runKey}`; the watch run has its own seed and hero), about
12 ms of it style recalculation and 10 ms a forced layout in `DuosMateDock`'s measure. Zero dropped frames needs the
"keep the teammate screen mounted" refactor: a lead/owner call (see the PR).

Ranked Duos both-ready close: 6 rounds (3 early, 3 after 0:00): both clients saw the round close 204-211 ms after the
second press (the poll interval).

## Open

- Phone layout: in a Duos game the help / Compendium / settings squares sit on top of the teammate portrait
  (`phoneLayout.css` corner row vs the dock), so a tap on the portrait opens the Compendium. Layout call for Mike.
- Report (a) not reproduced (see above).
