# 2026-10-24 — Versus Group phase 3: edge cases, the live 4-account test, XP, records, group match stats

Phases 1 (#2280) and 2 (#2285) built the 3-4 player round robin and room options. This phase checks the edges live and
fixes what the test found. Oracle: R-VERSUS-GROUP-07, R-VERSUS-GROUP-08, R-SPECTATE-END-02.

## The live end-to-end test (live backend, unrated)

A `VITE_PERF_BENCH=1` prod build of this branch served locally (`vite preview`, port 4417), four headful Chrome windows
each on ONE persistent profile (`pw-claudebot1..4` in the session scratchpad), named Claudebot1..4, driven over CDP: a
page-side autopilot plays the shop (answer decisions, play the hand, buy minions, End Turn) and presses End Combat; a
"passive" flag makes a player buy nothing so it gets knocked out. Nothing of "Test Bot" was touched; browsers and the
preview server were closed and every Claudebot left the room (the room is gone).

1. **4 players** (room options set to 3-4 players by the host from the room; four seats taken; Start; every player's
   gate crystal; Hero Select timeouts): the round robin ran 15 rounds, the Copy row appeared in every 3-alive round
   ("Copy of Claudebot3", changing per round), and the passive player went out 4th in round 7. Places: Claudebot1 1st,
   Claudebot3 2nd, Claudebot2 3rd, Claudebot4 4th. **XP: 125 / 80 / 50 / 50** (`progression_results`, run id
   `versus:<match>`). A reload of all four after the match: the room, and Previous match stats with the whole table.
2. **3 players + a spectator**: copy fights each round, the spectator's fight picker ("vs Claudebot3", "vs Copy of
   ..."), switching the watched player. **Disconnect**: Claudebot3's tab left the game; the others saw "Claudebot3
   disconnected", the 30 s reconnect time, then "has not come back" with Unpause; a player who was already out was refused
   (`eliminated`, which showed as "Connection problem": it now reads "You are out of this match."); a living player's Unpause put Claudebot3 on auto (its last locked board), and it
   went out on hearts. **Knockout to the stands** (the 2026-10-24-versus-group-knockout-stands.sql trigger, applied by
   the lead mid-test): the knocked-out players' room role became `spectator`. **Host leaving**: the host left the open
   room; the host role passed to a seated player.
3. **3 players + a spectator again** after the fixes below: **XP 125 / 50 / 50**, the knocked-out player moved to the
   stands and onto the watch screen of the same match, and the **spectator earned 50** (`watch:group:<match>`).
4. **1v1 with the Summit modifier** (the host switched the room back to 1v1 with three seated: the third went to the
   stands, everyone else saw "Room options changed: 1v1 · Summit"): the match snapshotted `{ mode: duel, modifiers:
   [summit] }`, every run pinned `rift: summit`, XP 125 / 50, spectator 50, and the watch screen stayed closed.
5. **Rejoin mid-match**: a living group player reloaded at round 9; the client re-entered the running match on its own
   (the lock checkpoint plus the committed rounds) and went on to win at round 12.

## Found and fixed

- **Group players never earned XP** (my phase-2 guard `if (match.group) return` in `settleVersusProgression`, written
  before #2283 taught the server group matches). Removed: a group player settles `versus:<match>` when their result is
  final. Verified live (above).
- **A spectator lost the XP for watching when the last fight held the screen past 45 s** (#2283's flow): the screen
  holds the final fight up to 60 s, the server takes beats only up to 45 s after the end, and the final beat's refusal
  dropped the settlement. `spectatorEnd.ts` now records when any beat saw the game end (`spectate_beat`'s `ended`) and
  settles then too. Server unchanged (it checks the watch record, which those beats wrote).
- **The closed watch screen reopened on the winner's last-fight frames** (seen behind the end notice). `spectate.ts`
  remembers the match whose end closed it (`watchDone`) and `render` never reopens it.
- **"N left" counted the Copy row** ("4 left" with three players). The rail now leaves the Copy out.
- **Players published no frames to a knocked-out player before the stands migration** (it still held its seat role):
  a player who is out now counts as a watcher.
- **Records cap**: `2026-10-24-versus-records-24.sql` (24 ids, was 22) + `MAX_RECORD_IDS = 24`.
- **Previous match stats for a group match** (R-VERSUS-GROUP-07): `buildGroupMatchRecord` from the raw group rows from
  my seat; `VersusMatchStats` shows my place, the table and each round's opponent.
- `perfBench.ts` (bench builds only) gained `versus`, `spectate`, `sim` and `db` handles for driving a live match by CDP.

## Not done

- The dev test bot (`versusBot.ts`) still fills one 1v1 seat only: it keeps one anonymous session per browser, so filling
  two or three group seats would need a session per bot. Not cheap; the live test used real windows instead.
- The room cards' wins/losses still count 1v1 matches only (a group win is not counted).
- Seen once, not chased: a spectator's view of the winner's final fight did not play to its end before the 60 s hold
  (the end flow then closed it correctly).

## Deploy (the lead)

Apply `supabase/migrations/2026-10-24-versus-records-24.sql` (replaces `versus_records`; no function redeploy).
