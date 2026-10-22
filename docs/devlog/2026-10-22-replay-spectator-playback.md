# 2026-10-22 — Replays play through the live spectator pipeline

Owner (2026-10-22): "is our replay as good as spectating is? spectating seems basically perfect now... would love to
keep them both maintained". PR 3 of 3 (PR 1: one drag path for both consumers; PR 2: replays record the spectator
stream).

**What changed.** A replay that carries `ReplayV2.stream` now plays the recorded hand through the watch screen's own
code, so one pipeline maintains both:
- `packages/ui/src/replay/replayStreamPlayer.ts` (new) feeds the recorded messages into `spectate.ts`'s cursor feed
  (`ingestCursor`, split out of `receiveSpectatorCursor`) every 30 ms, up to 120 ms (x speed) ahead of the replay
  clock. The feed's clock is the replay frames' clock (`setCursorFeedClock`), so the hand is drawn AT the replay clock:
  pause and the speed slider work for free, and an action's frame lands as the drawn hand gets there.
- `SpectatorCursor` (mounted in `Game.tsx` while `replaySession.hasStream`) draws the hand, the held card with the drop
  gap the rows open, the aim line, the hover previews (`spectatorHover.ts`) and the refused-drop spring-back.
- `replayPlayer.ts`: in stream mode a drag frame lands at its recorded moment with NO ghost flight (the step is the
  full recorded delta) and the held card lands through the watch screen's own drop (`presentHeldDrop`, factored out of
  `spectate.ts land`). Every seek calls `seekStream(t)`: the feed is cleared and rebuilt from the last message at or
  before t (state at once, no pick-up cue, no drop verdict), so a target always rebuilds the same hand.
- Recorded overlay minimize state and Skip reach Recruit through `useReplayStream` (the same setters and the same
  skip the button runs). The viewer's Cursor toggle hides only the pointer sprite; the pick-up sound follows the
  Sounds toggle. The viewer's own rune hover still wins on their screen (`watchLocalHover`).
- The uploaded replay leaves out the old `cursorTrail` when it has a stream (the stream carries the same hand).

**Old replays** (no stream, or a malformed one) play exactly as before: the 20 Hz cursor sprite and the drag ghost.

**Performance** (headless prod build, a recorded Practice game played back, same replay with and without its stream):
- 1x, 30 s: p50 / p95 / p99 4.2 / 4.3 / 4.3 ms on both paths; 2 frames over 6.25 ms with the stream, 3 without.
- 3x, 15 s: 4.2 / 4.3 / 4.3 ms on both; 12 frames over 6.25 ms with the stream, 14 without.
- Ten seeks: the same on both (each seek remounts the shop, existing behaviour).
The per-frame work is SpectatorCursor's: two transform writes, no layout reads. The feeder reads the clock 33 times a
second and decodes each segment once, lazily.

**Verified.** `streamPlayback.test.ts`: the held card follows the replay clock; a drag frame lands at its recorded
moment with no ghost and hands its card to the drop; seek determinism (the same target gives the same feed after
playing and scrubbing, and from a fresh start); overlay state follows the clock and seeks; a recorded Skip is requested
at its point; an old replay still flies its ghost and leaves the feed alone; a malformed stream falls back. Headless
screenshots confirmed the hand, the hover preview and a held card rebuilt by a mid-drag seek. Oracle rule
R-REPLAY-PLAYBACK-01. Patch note added (Systems).
