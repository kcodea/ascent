# 2026-10-20 — Versus / live spectating: smooth hand playback and drops that land once

Owner: "cursor tracking is janky sometimes, shop buys and moves still don't seem to work with re-orienting cards
etc, things happen once placed instead of in real time with buying/placing/moving/selling." Oracle rule
R-SPECTATE-SMOOTH-01 (`packages/rules/src/registry/approved/foundation.ts`), test
`packages/ui/src/versus/spectateSmooth.test.tsx`. The room's spectator hand (the hover flicker) is its own PR
(`fix/versus-room-hand-hover`, R-VERSUS-HAND-HOVER-01).

## What was janky, and why

- **The cursor stalled and jumped.** `spectate.ts receiveSpectatorCursor` stamped each sample with its ARRIVAL time
  and `SpectatorCursor` drew it a fixed 100 ms behind. Realtime delivers in bursts, so the arrival stamps carried the
  network jitter straight into the motion: two samples in one frame, then nothing for 150 ms, i.e. the hand sped up,
  held at the end of the buffer and jumped. At 15 samples a second the path was also a 15 Hz polygon.
- **Drops snapped back, then slid again.** The card in hand rode the cursor channel (every 66 ms) while the action
  rode the ordinary spectator publish, which waits for idle time (up to 250 ms). So the stands saw the card let go,
  the board close its gap and the card reappear at its source, then the action land and the rows slide a second time
  (the "replay the sliding motion" fault the player's own drop fixed long ago). Measured in the loopback: a played
  minion's neighbours went 808 -> 741 -> 806 px; a board move replayed the whole swap; a sell re-centred twice; a buy
  hid the new hand card for ~370 ms and then popped it in.
- **The board moved before the hand got there.** The drag decision applied on arrival, ~100 ms before the drawn
  hand reached that spot.

## The fix

- **Sender** (`spectateTap.ts`): each cursor message carries the player's clock (`ts`, `performance.now()`) and up to
  three points ~16 ms apart (`tr`), 20 messages a second (was 15 single points). While a card is held or an aim is
  out, points travel in design space only (the rows under an anchor slide). A drop says whether it committed (`de`:
  `c` when an action was tagged since the pick-up, `x` when refused or the card is springing back). Every action
  carries `ts` and hurries the next publish (`ACT_FLUSH_MS` 40 ms) instead of waiting for idle time. Old fields are
  unchanged, so an older spectator still works.
- **Clock** (`cursorPlayback.ts`, pure): the fastest recent delivery maps the player's clock onto ours; the buffer is
  one send interval plus the 90th-percentile jitter (+12 ms), clamped 60 to 240 ms, growing fast and shrinking
  slowly. The hand is interpolated at the playback moment and carried up to 40 ms on its velocity when data runs dry.
- **Receiver** (`spectate.ts`, `SpectatorCursor.tsx`): each message's state (card in hand, gap, aim, hover, drop) is
  queued on the player's clock and applied when playback reaches it. A committed drop PARKS the card where it was
  let go (gap still open) until its action lands; the action is landed when the drawn hand reaches its `ts`, takes the
  parked card (`takeLanding`) and presents a new `dropping` action, which Recruit turns into the SAME commit FLIP the
  player's own `onUp` primes (rows snapshotted with the gap open, the card slides home, a buy's new hand card slides in
  through `buyPendingRef`). A refused drop springs back to its slot (the player's `snapMs`). The overlay is one rAF
  loop (guarded against re-entrant restarts), two transform writes per frame, no layout reads per frame.
- An older player (no `ts`) plays exactly as before (state on arrival, fixed 100 ms buffer).

## Verification

A two-client loopback (two headless Chromium contexts, a player page and a spectator page at a different window size
and aspect, joined by a node relay that delivers in order with 30 to 110 ms of random latency; no backend), dev build,
main (`cd4e247e8`) vs this branch, a 2-loop cursor path and a scripted buy / play (sweeping the gap) / move / cancel
/ sell:

| | main | this branch |
| --- | --- | --- |
| cursor stall frames (player moving, hand still) | 14 to 24 | 0 to 6 |
| cursor jump frames | 35 to 51 | 1 to 9 |
| per-frame motion error vs the player, p95 (‰ of the game box) | 4.1 to 5.3 | 1.0 to 1.5 |
| hand latency (emulated network included) | 185 to 200 ms | 185 to 205 ms |
| drop: neighbours | close the gap, snap back, slide again | stay put; the card slides home once |
| buy: the new hand card | hidden ~370 ms, then pops | slides in from the release point |
| sender `tick` cost, mean / p99 | 0.14 to 0.20 / 1.4 to 2.7 ms | 0.07 to 0.23 / 0.7 to 1.4 ms |
| overlay frame cost, mean / p99 | 0.03 / 0.2 ms | 0.06 to 0.08 / 0.6 to 0.8 ms |
| cursor messages | 15/s, ~0.6 KB/s | 20/s, ~1.1 KB/s |

Frame timings are dev-build numbers from two pages sharing one machine (the absolute frame p99s are dominated by
that); the per-call costs are what the change adds. Tests: `spectateSmooth.test.tsx` (10), the existing spectator
suites unchanged except an End Turn tag now carrying `ts`.

## Deploys

None. The broadcast payloads gained optional fields only; no SQL, no Edge Function. Old and new clients interoperate
in both directions (an older spectator reads the newest point's old fields; an older player sends no `ts` and is
played the old way).
