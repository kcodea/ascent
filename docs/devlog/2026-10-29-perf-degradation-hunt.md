# 2026-10-29 — Where late-game slowdown comes from (degradation hunt, part 1)

Owner, top priority: "Performance degrades over the course of a game. It degrades massively by end game, causing
major hitching and jank, and it degrades even faster on mobile obviously."

## How it was measured

Every run below uses a `VITE_PERF_BENCH` prod build in headless Chrome, with network blocked. A probe at the start of
every shop (after a full GC) records heap, DOM, listeners, timers, FX plays, store slice sizes and images. Every
measured scene is tagged with its round. The new `perf:gauntlet` flags are listed in `docs/performance.md`.

Four game setups:
- **Ale engine:** the gauntlet's Dwarf board, 150 actions a turn, high stats.
- **Typical Practice:** balance-bot shop turns, no Gold top-up, 4 tribes.
- **Typical lobby:** the same, but `--mode lobby` (replay draft, scorer, announcer, autosave all live).
- **4x CPU throttle:** the typical Practice game, throttled.

Two older comparisons:
- The typical game on main as of 2026-10-02 (`e9163d6ea`).
- The Ale game with the milestone badge FX switched off.

## What does NOT accumulate (all four setups, rounds 2-14)

- **DOM nodes and listeners** grow only with what is on screen (board and hand size), then go flat. Detached DOM stays
  flat. CSS animations, GSAP tweens and timers (4 intervals, 1-2 timeouts) stay flat. Pixi managed textures go flat
  after the opening rounds.
- **Heap** grows about 1.5 MB a round in the Ale game (replay frames kept for the end-of-game upload) and about
  0.4 MB a round in a typical game. GC is 0.3% of a late fight's CPU profile, so it is not a source of hitches.
- **Bookkeeping stays small:**
  - autosave: 0.25 to 1.3 ms, idle time, phase boundaries only
  - replay frame capture: 0.3 ms per action
  - telemetry: under 0.1 ms
  - the lobby's store commit: about 0.2 ms average

  None of these grows into a hitch. Moving replay or snapshot assembly to a server would not change how a late game
  plays.
- **Every image is fetched at boot** (about 1,800 URLs), so the image working set does not grow by round in a
  desktop session.

## What grew, and what was done

**1. The bug-report action ring hashed the whole run on idle time. Fixed (R-PERF-RING-LAZY-01).**
- Every accepted action queued a whole-run hash. That includes the display-only previews a fight dispatches per
  friendly death and spell cast.
- One idle callback hashed up to 32 entries. The hash grows with the run, from 1.0 to 1.9 ms a call over a lobby game.
- The perf monitor recorded 40-52 ms `IdleRequestCallback` long frames in most rounds from round 5 on.
- Now the hashes are computed only when a bug report reads the window. The same game shows none in rounds 1-14.

**2. Milestone badge loops (units at 5,000+ Attack or Health). The only steady per-frame climb in the Ale game.**

| main-thread script per frame | badges on | badges off |
|---|---|---|
| idle shop | 0.03 → 0.62 ms | 0.03 ms, flat |
| combat | 0.34 → 1.1 ms | 0.39 → 0.55 ms |

The owner ruled this is not the long-standing cause, since typical games rarely reach 5,000. Not changed here.

**3. Board size.** In typical games, per-frame combat and End Turn cost rises while the board fills (rounds 2-6), then
goes flat. The 2026-10-02 build shows the same shape, with more style time.

## Not found

The `setTimeout` long frames the perf monitor showed (21-40 ms) are the walk's own shop actions resuming after its
pacing timer, i.e. what a buy or play costs. No game timer runs long.

Nothing else measured grew round over round in the headless main thread. If players still feel the game get slower
late, the cost is in something this harness cannot see:
- GPU, raster or compositing (headless uses software GL)
- the network (realtime, uploads, recorded seats)
- hover and preview input
- a real phone

The next step is a Perf HUD export from a real late game.
