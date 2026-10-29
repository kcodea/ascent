# 2026-10-29 — Where late-game slowdown comes from (degradation hunt, part 1)

Owner, top priority: "Performance degrades over the course of a game. It degrades massively by end game, causing
major hitching and jank, and it degrades even faster on mobile obviously."

**How it was measured.** One seeded Practice game, the gauntlet's Dwarf Ale engine (150 actions a turn), on a
`VITE_PERF_BENCH` prod build in headless Chrome. New `perf:gauntlet` flags:
- `--round-scenes` tags every measured scene with its round and writes `raw-run*.json`.
- The `--round-probe` rows now also carry timers, the store's biggest slices and a heap snapshot (`--snap`).
- `--perf-timings` adds the in-game monitor's spans per wave.
- `--cpu-throttle N` is available for a phone-like run.

`perf:late` gained a column for the bug-report state hash.

**What does NOT grow** (each probe runs after a full GC at the start of a shop, r2 to r14):
- DOM nodes stay at 3.3-4.1k and listeners at 790-1,050.
- Running CSS animations, GSAP tweens, intervals (4) and pending timeouts stay flat. Detached DOM stays flat.
- The heap grows about 1.5 MB a round (44 to 62 MB), almost all of it replay frames held for the end-of-game upload.
  That is memory, not frame time.
- The bookkeeping stays small: autosave is 0.25 to 1.3 ms (on idle time, at phase boundaries only), a replay frame
  0.3 ms and telemetry under 0.1 ms. Moving replay or snapshot assembly to a server would not change how a late
  game plays.

**What grows: main-thread script per frame, in every scene that is not dominated by its own actions.**

| scene | early | late (r12-14) |
|---|---|---|
| idle shop | 0.03 ms | 0.62 ms |
| drag | 0.27 ms | 0.95 ms |
| End Turn | 0.68 ms | 1.3 ms |
| combat | 0.34 ms | 1.1 ms |
| return | 0.3 ms | 0.9 ms |

**Cause 1 (the steady climb): the milestone badge loops.** Every unit at 5,000+ Attack or Health wears a permanent
looping Pixi effect (about 142 particles each). Each loop reads its badge's rect every frame, and each stat's loops
draw through a shared full-screen Bloom + Glow pass. Live loops in an idle shop went 0, 0, ..., 1 (r10), 4 (r11),
5 (r12-14). The Pixi ticker then never stops, and the script cost tracks the loop count. Not changed here: capping
their rate or count changes the authored look, so it needs an owner call.

**Cause 2 (fixed here): the bug-report action ring hashed the whole run on idle time.**
- Every accepted action is recorded, including the display-only previews a fight dispatches per friendly death and
  spell cast. One idle callback then hashed every owed entry, up to 32, each a JSON round-trip of a run that grows
  all game.
- The perf monitor recorded 40-52 ms `IdleRequestCallback` long frames during most rounds from round 5 on.
- Now the hashes are computed only when a bug report reads the window, and the same run shows none in rounds 1-14.
- Rule R-PERF-RING-LAZY-01; test `packages/ui/src/bug-report/actionRing.test.ts`.

**Still open.** `setTimeout` long frames of 21-40 ms, 4-10 a round, source not named yet. A CPU-throttled run. The
lobby-only paths (board strength scoring, replay drafts) are not exercised by Practice.
