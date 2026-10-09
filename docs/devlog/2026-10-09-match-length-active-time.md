# 2026-10-09: Match length counts only active play time

Owner bug: "can you fix the match length time - it should not count time outside of the game, it should only count
time while a player is actually in a game." A Recent Games row read LENGTH 246 min for a 16-round game.

## Root cause

Every "Length" was the replay recording's clock span (last frame `tMs` minus first). That clock
(`replayClockTick` in `store.ts`) adds the real time between two committed actions with no ceiling, so a shop
left open in a background tab, a minimised window, or a sleeping laptop all became "game". The lobby turn clock
waits for 10 Gold spent before it counts down, so a shop can sit open indefinitely. A quit-and-Continue did NOT
add closed time (the draft resume shifts frames by `RESUME_GAP_MS`), but any time away with the app still open did.

## What shipped (R-MATCH-LENGTH-01)

- **`packages/ui/src/activePlayClock.ts`**: a pure accumulator (`createActivePlayClock`: reset / restore / tick /
  read / freeze, `now` injected) with a 60 s per-step cap, and `matchLengthMs`, the one function every surface
  reads a length through.
- **Store wiring** (`store.ts`): module-level `activePlay`, reset in `beginReplayCapture` (every new run), restored
  PAUSED from `ascent.save`'s new `activeMs` (boot, cloud adoption, God Mode exit), written into every save, and
  frozen the moment the run ends. Live = `documentIsActive()` (visible AND focused) and `!isPreRun` and not
  replaying and `isResumableRun(run)`. Sampled on a store subscription (only when that boolean flips), on
  visibility/focus/blur, and on a 15 s heartbeat, so every live step is well inside the cap.
- **Stored**: `entry.activeMs` on the run_history entry, `replay.v2.activeMs` on the telemetry and practice replay
  payloads (`ReplayV2.activeMs?`, display only), and `practice_games.duration_ms` now holds the active time.
- **Read**: Career (`careerRunOf` / `joinTelemetry` / `replaySummary`), Recent Games (`asRecentGameRow`), the
  Practice tabs (`asPracticeGameRow`). The light selects gained `active_ms` JSON paths (`entry->>activeMs`,
  `replay->v2->>activeMs`); a missing key projects NULL, never an error. APM follows the corrected length.

## Legacy records (owner ruling)

A record without `activeMs` has only the wall-clock span. It is shown as-is up to 35 minutes; a longer one prints
"35+ min" (owner 2026-10-09: "lets just default any games over 35 minutes to 35+ historically";
`LEGACY_LENGTH_CAP_MS`). So the earlier "31 min" game still shows 31 min and the 246-min 16-round game shows
"35+ min". No number is kept past the cap, so no APM is derived from it. The cap is a BACKFILL for old records
only: a game with recorded active time prints its real length however long it is (owner: "rounds over 35 minutes
should show their actual time"). A run resumed from a save written before this build has an UNKNOWN active time
(the clock never stamps a partial number): a practice row stores its raw span and the reader caps it the same way.

## Not changed

- The replay frame clock and replay pacing (a separate contract; an idle stretch inside a session is still a
  pause in the replay).
- No SQL, no Edge Function: nothing server-side reads the length, and `duration_ms` keeps its int type.
- Core/sim determinism: the clock never touches run state (a test pins identical `serialize` output).
