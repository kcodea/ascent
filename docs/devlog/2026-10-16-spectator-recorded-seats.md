# Live-game watchers drive recorded seats from the real recordings (2026-10-16)

Owner (rail audit call 5): "how big of a fix is it? if it's not that hard yes fix it. spectators should get as close
to 1:1 experience as a player". Rule: R-SPECTATE-SEATS-01.

## Problem

A watcher receives the player's lobby, but drives the seats on its own client against its own opponent pool. That
pool is sampled for the WATCHER's rank, so it rarely holds the watched game's recorded runs. Those seats fell back to
generated stand-ins: the next opponent board, the opponent preview and the scout cards could differ from the player's.

## Fix

- `packages/sim/src/lobby/runLobby.ts`: `setWatchedSeatRuns(boards)` holds whole runs (grouped and checked exactly as
  the pool does, `playerRunsFrom`) APART from the opponent pool; `driverFor` serves a snapshot seat from them first.
  Kept out of the pool so a Bronze game's runs never seat the Gold watcher's own next table (R-PRACTICE-RANK-01).
- `packages/ui/src/live/liveRemote.ts`: `seatRecordings(seeds)`, every board of those seeds (paged, R-NET-01).
- `packages/ui/src/live/liveWatch.ts`: on the watched game's first lobby, fetch the missing runs once, hand them over,
  evict the stand-in drivers, re-issue the lobby (`refreshSpectatorSeats` in `versus/spectate.ts`, skipped mid-fight).
  Leaving clears them.

Cost: one REST read per watch session (~7 runs x up to ~20 boards). Nothing on the broadcast channel; the player's
client is untouched.

## Test

`packages/sim/src/lobby/watchedSeats.test.ts` plays a real lobby with seven recorded seats and, every round, computes
the rail's reads on the player's client and on a watcher's client (pool without the runs, then the hand-over). They must
be equal; a control shows they differed without it.
