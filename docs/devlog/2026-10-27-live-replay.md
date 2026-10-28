# 2026-10-27 — Live replay: a recorded game played back through the real UI

Owner worry: late, high-APM games feel choppy, and a bot doesn't play like the owner does. So instead of a bot,
replay the owner's own game.

- Recorded lobby games already hold enough to rebuild them exactly: the seed, the full action log, and the v2
  frames (every shop and fight, with timestamps). The 7 opponent seats are recorded runs whose boards live in the
  `boards` pool. Re-run headlessly on its own build (`26ea443d9`), game 405 (Drakko, 15 waves, 996 actions,
  ~36 APM) matched the recording on every shop and fight, with no action refused.
- Without the recorded seats it drifts by wave 4: a fresh lobby seats different opponents. Without the right
  build it drifts as soon as game data differs.
- `packages/ui/src/liveReplay.ts` (`?livereplay=<id>`) does this live: it rebuilds the run as a sandbox, dispatches
  shop actions at the player's recorded times, presses the real End Turn / End Combat button (Skip when the player
  had skipped), leaves game-dispatched actions (settle, combat previews, the shop clock) to the screen, and stops on
  the first shop that differs from the recording. Pure schedule + comparison in `liveReplaySchedule.ts` (tested).
- Gotcha: it needs a visible tab. In a hidden pane `requestAnimationFrame` runs at ~2 Hz and the End Combat exit
  never completes.

How to use it: `docs/performance.md` §2, "Live replay".
