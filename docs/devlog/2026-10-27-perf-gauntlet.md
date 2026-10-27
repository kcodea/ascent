# 2026-10-27 — `npm run perf:gauntlet`: the late-game desktop frame judge

The owner wants perf passes to keep happening, run as a "gauntlet loop": a builder fixes, a separate critic judges
blind against a bar, and the loop repeats until ours wins. That only works if the judge is real, so this PR builds the
judge: `npm run perf:gauntlet` (scripts/perf-gauntlet.mjs, R-PERF-GAUNTLET-01). Full usage is in
docs/performance.md §2b.

**What it does.** It builds two `VITE_PERF_BENCH` production bundles: the working tree, and `origin/main`, cached by
sha and built in a throwaway worktree with its own `npm install`. It drives each through the same game in headed
Chrome at 1920x1080 with real mouse input, alternating builds, under blind X/Y labels. Per scene it reports
worst / p99 / p95, long / jank, frames over the 4.17 ms budget, main-thread ms per frame and LoAF blocking. A metric
names a winner only when every run of one build beats every run of the other.

**What the game is (all owner rulings, 2026-10-27).** Desktop only ("im talking to desktop performance"). Measure the
late game, "turns 9-14 when a LOT of cards have been played". One Dwarf-only Practice game against level-10 bots at a
fixed seed, so both builds play the identical game:
- On turn 1 the board becomes the owner's: a gilded Edward Keg-hands, two gilded Tapkeepers, Mountainbond and Chef
  Gary Toast. They are printed into the shop through God Mode's print action, bought three times to triple, and
  played from hand.
- Every turn the walk buys and plays as many cards as it can, with the Gold topped up.
- When the hand is full, it sells every other unit, plays the hand and sells those too, then carries on.
- A Discover takes the middle option and sells what it gave.
- Rounds 1-8 are fast-forwarded with the fights skipped. Rounds 9-14 are measured in full.

**Gotchas found while building it.**
- God Mode's real-player opponent boards come from the network, which the bench blocks. The bundled
  `OPPONENT_POOL` is empty, so the fights are against Practice bots instead.
- The combat replay waits for the player at the end: `.etbwrap.ready` marks "replay done", and `.etbwrap.skip` is
  the mid-fight Skip button.
- A triple replaces the board card with a gilded one under a NEW uid. The five are protected by card (with a
  quota), not by uid. Protecting them by uid sold the tripled Mountainbond as filler.
- This board wins the eight-seat lobby by round 13, so the bot seats are made unkillable, as God Mode does. A game
  that still ends early just stops measuring.
- A Discover left open blocks End Turn. Every turn resolves all open choices before it ends.

**First late-game numbers** (one clean run, this branch = `origin/main` game code, 370 Hz display):
- The buy-and-play turn (`shop-actions`) is p95 16.7 ms / p99 25 ms with 3,645 dropped frames. That is about 4x the
  budget on the typical frame, so it is the first target for the loop.
- A late fight had a 967 ms worst frame.
- End Turn's worst frame was 147 ms.

A full run takes about 9 minutes, so the default A/B (3 runs per build) takes about an hour; `--from` / `--to` /
`--runs` shorten it.

**A possible game bug it surfaced (not fixed here).** On the `origin/main` bench bundle, twice in two runs, the walk
skipped a fast-forward fight (round 3) and then the "End combat and go back to shop" press was ignored, leaving the
game stuck in combat. The same game code in the other bundle never hit it, and the two bundles differ only by
their build stamps, so it is timing-dependent. The walk now presses up to five times and logs "End combat needed N
presses ... a possible game bug" whenever a press was ignored. One retest on that bundle got past round 3, but it ran
before the retry log existed, so it is unknown whether a press was ignored there. Not yet confirmed as a bug. Worth a look at `Recruit.tsx` `endCombat` (`wipeExitRef`).
