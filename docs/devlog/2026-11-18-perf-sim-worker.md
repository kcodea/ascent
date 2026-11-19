# 2026-11-18 — Background combat simulation runs in a Web Worker

Owner bar (2026-11-18): a 2D HTML card game has no excuse for dropped frames; frames stay at or under 6.25 ms on the
prod build from round 1 to the end. The seven-agent audit of the same day (S2 state growth, S5 leaks) put this at the
top: after every End Turn the page ran **360 `simulate()` calls on the main thread** (the 200-sim odds probe, and in
a rated lobby the 160-fight board-strength scorer), about 100 ms a round early and 450-600 ms by rounds 10-15, all
during the combat replay, with single strength steps of 7-21 ms that a 250 ms timeout forced into busy frames. Since
#2768 Versus and Duos fights also carry `oddsInput` (a tag-team fight is about twice the work).

## What changed

- **One sim worker** for the session: `packages/ui/src/simWorker/`.
  - `protocol.ts`: the messages. Plain data only (`oddsInput`, a `BoardSnapshot`, seeds, caps). The card index, the
    effect factories and the strength reference are imported BY the worker, never posted.
  - `handler.ts`: the worker's logic as a plain function (no Worker global), so the parity test runs it in Node. It
    runs the same `createOddsProbe` / `createStrengthProbe` with the same seeds, in 8 ms chunks with a yield between
    them so a `cancel` gets in. The odds jump the queue (the player reads them); boards are first in, first out.
  - `simWorker.entry.ts`: binds the handler to the worker's port. `client.ts`: the page side (create once, lazily,
    keep alive; job ids; cancel; sticky failure). `backgroundOdds.ts`: worker first, idle slices as the fallback.
- **Odds** (`Recruit.tsx`): the effect now calls `runBackgroundOdds` and does exactly what it did with the result
  (set the Summary's odds, stamp the replay, tap the spectators). A new fight or the run ending cancels the job.
  The replay viewer's odds backfill (`replay/replayPlayer.ts`) uses the same runner.
- **Board strength** (`boardStrength/strengthScorer.ts`): with `deps.remote` every job goes to the worker the moment
  it is queued; the scorer only keeps the books (pending, progress for the "Calculating Score" bar, scores, carried
  rounds, `settled`, `forget`). The run-end rush no longer runs fights on the page at all.
- **The fallback** (no `Worker`, the chunk cannot load, the worker errors, never answers `hello` within 10 s, or one
  job throws) is the old idle-sliced main-thread path, with two changes: the strength step is sized by measured cost
  (`createOddsStepper`, about 2 ms, at most 4 fights; it was a fixed 4 fights), and a slice the browser had to
  force (`didTimeout`) runs nothing while a fight plays. Failure is sticky for the session; every job in flight is
  re-run on the page, so nothing is lost. Triage switch: `localStorage['ascent:simWorker'] = 'off'`.
- **Startup**: created at the boot warm-up on desktop (`bootWarm.ts`, which no longer evaluates the 1 MB strength
  reference on the page: the worker loads its own copy), and at the first shop everywhere else (`Recruit.tsx`).
- **Build**: `worker: { format: 'es' }` in `apps/web/vite.config.ts` (a module worker; the reference stays a lazy
  chunk inside it). The worker URL is relative to the bundle (`new URL('simWorker.entry-<hash>.js', import.meta.url)`),
  so it loads under itch.io's sub-path and the exe's `app://ascent/assets/` (same origin, `text/javascript`).

## Same numbers, byte for byte

`simWorker/handler.test.ts` passes every request and reply through `structuredClone` (what `postMessage` does) and
requires the worker's odds to equal `computeCombatOdds` and its scores to equal `scoreBoard`, for three chunk sizes,
a mirrored (Versus / Duos) probe and carried rounds. `odds.test.ts` is unchanged. In the browser run below the odds
the worker posted were also compared with `computeCombatOdds` run on the page for the same fight: identical in every
measured round.

## Measured

Headless prod build (`VITE_PERF_BENCH=1`), Playwright's Chromium headless shell on the GPU (`--use-angle=d3d11`),
1920 x 1080, port 5221, an isolated profile, `supabase.(co|in)` and `workers.dev` blocked. One seeded lobby game
(seed 424242, the same hero, the same scripted buy-and-play turns, so both builds play the identical game), rounds 1-9
fast-forwarded through the store, rounds 10-13 played out for real (End Turn, the whole fight). Baseline =
`origin/main` 5d8f3d972. The main-thread sim time is every `odds:deferred` / `strength:slice` /
`strength:rush` call, timed around `perfMonitor.measure`. Two runs of each build (another agent was measuring on
the machine, so runs were repeated).

| build | round | fight events | sim ms on the main thread | slices | longest slice ms | slices > 6.25 ms | odds / strength ms | odds back after | score back after | odds vs page |
|---|---|---|---|---|---|---|---|---|---|---|
| before, run 1 | 10 | 44 | 304 | 40 | 16.1 | 22 | 136 / 167 | | | |
| before, run 1 | 11 | 46 | 356 | 60 | 13.3 | 26 | 155 / 201 | | | |
| before, run 1 | 12 | 65 | 339 | 59 | 13.1 | 28 | 152 / 187 | | | |
| before, run 1 | 13 | 32 | 291 | 39 | 14.6 | 23 | 103 / 173 | | | |
| before, run 2 | 10 | 44 | 294 | 41 | 15.2 | 22 | 128 / 155 | | | |
| before, run 2 | 11 | 46 | 338 | 50 | 18.8 | 22 | 133 / 168 | | | |
| before, run 2 | 12 | 65 | 297 | 43 | 13.1 | 19 | 111 / 134 | | | |
| before, run 2 | 13 | 32 | 263 | 32 | 14.0 | 19 | 90 / 146 | | | |
| after, run 1 | 10 | 44 | 0 | 0 | 0 | 0 | 0 / 0 | 238 ms | 645 ms | identical |
| after, run 1 | 11 | 46 | 0 | 0 | 0 | 0 | 0 / 0 | 160 ms | 546 ms | identical |
| after, run 1 | 12 | 65 | 0 | 0 | 0 | 0 | 0 / 0 | 395 ms | 1007 ms | identical |
| after, run 1 | 13 | 32 | 0 | 0 | 0 | 0 | 0 / 0 | 183 ms | 519 ms | identical |
| after, run 2 | 10 | 44 | 0 | 0 | 0 | 0 | 0 / 0 | 148 ms | 320 ms | identical |
| after, run 2 | 11 | 46 | 0 | 0 | 0 | 0 | 0 / 0 | 160 ms | 377 ms | identical |
| after, run 2 | 12 | 65 | 0 | 0 | 0 | 0 | 0 / 0 | 144 ms | 306 ms | identical |
| after, run 2 | 13 | 32 | 0 | 0 | 0 | 0 | 0 / 0 | 100 ms | 276 ms | identical |

- **Before: 263-356 ms of simulation on the main thread in every fight**, in 32-60 slices, the longest 13-19 ms, and
  19-28 slices a fight over the 6.25 ms frame budget. **After: none.** The odds are back 0.1-0.4 s after the fight
  starts and the board's score in 0.3-1.0 s (they used to trickle in over the first seconds of the replay).
- "odds vs page": in every measured round the odds the worker posted were compared, in the browser, with
  `computeCombatOdds` run on the page for the same fight. Identical JSON every time.
- These bot boards are light (32-65 events a fight; the audit's real-player boards run 110-190 events at the median
  by rounds 10-14 and cost 450-600 ms a round), so the absolute saving on a real late game is larger than this table.
- WHAT THIS RUN CANNOT SHOW: the headless shell presents at 60 Hz, so a frame over 6.25 ms cannot be counted there.
  Frames over 25 ms (a dropped 60 Hz frame) during the fights were 16 / 22 / 11 / 5 and 18 / 9 / 2 / 3 before, and
  18 / 25 / 11 / 6 and 6 / 9 / 3 / 8 after: run-to-run noise, no measurable change, and long tasks (over 50 ms) were
  0-7 a fight in both. Those come from other work in the fight (after this change the sims are 0 ms of it); the combat render path is
  being worked on in other PRs of this pass.
  The sim slices mostly fit inside a 16.7 ms frame; on the owner's 160-240 Hz display each of the 19-28 slices over
  6.25 ms was a missed frame, and those are gone. The claim of this PR is the first table, not a frame count.

**A slow main thread (Chrome's 4x CPU throttle, the same game, rounds 10-12, one run each).** Before: 6.0-8.2 s of
simulation on the main thread per fight, single slices of 220-530 ms (strength) and 52-99 ms (odds); script time
14.7-19.3 s a fight, 215-278 long tasks. After: 0 ms of simulation; script time 5.5-10.8 s, 24-222 long tasks. Read
this one with two cautions. The throttle slows the page's thread only, not the worker's, and the baseline very likely arrives
at round 10 with a backlog (nine fast-forwarded rounds each queued a board within seconds; the queue was not
checked before measuring), so the "before" total is higher than a real slow laptop would see in one round. What it does show is the
failure mode: on a slow thread the old path falls behind and then steals whole frames for seconds; the worker
cannot. The fight is still far over budget at 4x after this change: that is other work in the fight, not the sims.

## Checked in the exe's loader and on the phone path

- **Electron** (`app://`, the same privileged scheme and disk handler as `apps/desktop/main.cjs`, a hidden window, the
  prod bundle): the worker was created from `app://ascent/assets/simWorker.entry-<hash>.js`, answered `ready`, and
  fetched its reference chunk during the boot warm-up. No worker error.
- **Phone path** (iPhone UA, 852 x 393 @3x, touch, `lite-art` on): no boot warm-up there, so the worker starts at the
  first shop; it answered `ready`, returned the odds and the score, and the odds matched the page. Worker heap
  9.7 MB used. A browser without module workers gets an error event on the worker and falls back to the page.

## Bundle and memory

- **Bundle**: the worker is its own chunk, `simWorker.entry-<hash>.js`, 1,780 KB (457 KB gzip): core + content +
  the parts of sim the two probes reach (the main bundle is 9,280 KB). It lazy-loads its own copy of the strength
  reference, 987 KB (123 KB gzip); the page keeps its copy as a lazy chunk for the fallback only and no longer
  evaluates it at boot. The main bundle grew 2.9 KB. Net: +2.77 MB on disk, about +580 KB gzip over the wire, fetched
  once off the main thread.
- **Memory**: the worker's JS heap after four scored rounds, forced GC, read over CDP: 9.6-11.7 MB used (14.6-21.7 MB
  allocated) across three runs. The page's own heap no longer holds the reference (about 9 MB in Node).
- **Startup**: on desktop the worker is created behind the boot splash (it answered `ready` during the boot of a
  cold hidden-window Electron run); nothing in a fight waits on it (a job posted before it is up
  queues in its port).

## Follow-ups

- The worker is the home for any future batch of `simulate()` calls the UI wants (previews, what-ifs): add a message
  to `protocol.ts` and a case to `handler.ts` (docs/performance.md).
- Rule: R-PERF-SIM-WORKER-01 (foundation).
