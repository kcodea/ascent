# 2026-10-22 — Replays record the live spectator stream

Owner (2026-10-22): "is our replay as good as spectating is? spectating seems basically perfect now... would love to
keep them both maintained". PR 2 of 3 (PR 1: one drag path for both consumers; PR 3: play replays through the
spectator pipeline).

**What changed.** The player's cursor messages are now built ONCE, in `packages/ui/src/versus/cursorSource.ts` (moved
out of `spectateTap.ts`): 60 Hz points on the player clock, anchored to the UI element under the pointer, the held
card and its drop gap, the aim line, the hovered element, the drop outcome. Two subscribers get the same message
object: the live spectator sender (`spectateTap.ts`, adds its seat and sends) and the new replay recorder
(`packages/ui/src/replay/streamRecorder.ts`). The recorder stores them in `ReplayV2.stream` (version stays 2) while a
ranked lobby or Practice run is in the shop, plus the overlay minimize state and the fight's Skip as events.
`tapAct` now counts committed actions even with nobody watching, so the recorder's drop outcomes are right.

**Format** (`packages/sim/src/replayStream.ts`): one segment per round, on the frames clock. Messages are flat integers
(coordinates in thousandths, deltas; ms deltas; anchored fx/fy as deltas from the previous anchored point), packed as
zigzag varints in a base64 string. A string because a JSON number array in Postgres jsonb costs several bytes per
small integer at rest. Held card and aim are stored only when they change. Segments ride the per-round IndexedDB draft
(`chunk.stream`) and move along the clock on a resume (`prependStream`).

**Sizes** (headless prod build, offline Practice, scripted hand):
- 30 s of continuous motion: 567 messages; plain JSON 15.9 KB, packed 8.8 KB.
- A full 15-round game with the hand moving for every round's whole standard turn (798 s, a worst case; real players
  rest): 15,324 messages, **270 KB** packed (gzip would be 156 KB). The same messages as live-wire JSON: 2.4 MB.
- Caps: 3,000 messages per round and 30,000 per run, past which only messages that change something are kept.
- Backend: `run_telemetry.replay` and `practice_games.replay` are plain jsonb with no size check; no migration needed.

**Recording cost** (same scripted 30 s hand, prod build, A/B against PR 1's build): frame times identical (p50/p95/p99
4.2 / 4.3 / 4.3 ms on both; the worst frames are the drag-buy moments on both builds). The 20 Hz cursor tick averages
0.03 to 0.04 ms (max 0.4 ms). No per-move allocation: the pointer listener writes into a fixed pool of six slots.

**Verified.** `replayStream.test.ts` (exact round trip of every message shape, caps, events, packing),
`streamParity.test.ts` (driven with the same pointer, drag, aim and idle inputs, every message the live sender sent
comes back out of the recorded stream exactly, minus seat and the legacy window fractions), `replayDraft.test.ts`
(stream segments in the draft chunks). The full-game recording also round-tripped exactly through a re-encode. Oracle
rule R-REPLAY-STREAM-01.
