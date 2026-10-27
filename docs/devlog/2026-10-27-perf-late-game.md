# 2026-10-27 — `npm run perf:late`: does game logic slow down late in a lobby game?

Owner question: late games feel choppy and it may not all be graphics. Something that calculates might be
overloaded by the end of a game.

Added `packages/tools/src/perf-late-game.ts` (`npm run perf:late`). It plays a full 8-seat lobby game headlessly
and times, per wave, everything the store does that is not rendering: the reducer, End Turn, settle/resolve, the
telemetry + derive commit steps, the replay frame, and the autosave's serialize + stringify, plus the sizes they
carry. Details in `docs/performance.md` §2.

First reading (22-wave game, seed 4110):

- Autosave: ~0.2 ms → ~1 ms, payload 29 → 125 KB (the action log and captured boards grow). Runs on idle time.
- Reducer `freeze` probe: 0.08 → 0.18 ms. Shop actions, End Turn, telemetry, replay frames: under 1.5x growth.
- Over the 4.17 ms frame budget: only **settle + resolve combat while all 8 seats are alive** (~4-5 ms,
  waves 4-6). It gets cheaper as seats are eliminated.

Conclusion: the run logic does not pile up badly over a game. Late-game choppiness most likely comes from the UI
side (React renders of growing lists, DOM size, memory/GC, replay drafts written to IndexedDB). The next step is
a Perf HUD recording of a choppy late game. A possible follow-up is moving the 8-seat resolve off the frame.
