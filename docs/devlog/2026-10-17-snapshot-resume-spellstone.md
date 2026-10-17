# Snapshot serving: resumed seats + Spellstone Rubies (2026-10-17)

Owner (Kevin), on the snapshot-serving audit: "we need the game serving integrity to be literally perfect", then
"4,5,6,7 arent problems right now. fix 1, 2, and 3". This PR is findings 1 and 3. Finding 2 (empty boards, `boardAt`
never reaching forward, hero Armor for recorded seats) is `fix/round1-snapshot-tier`.

## 1. A resumed lobby swapped real seats for stand-ins (R-LOBBY-SERVE-01)

A seat stores only how to find its boards (a run key, or a seed + hero). The seat recordings travelled with a save only
when a cloud copy was adopted from another device. A same-device Continue resolved run keys against the new session's
pool, a random 150 of 301 eligible runs, so a seated run was often missing. `driverFor` then seated a generated
stand-in under the real player's name. Proof on the live pool: `Orangez|drakko|932453328` served
`k_beggy, d2_cinderchef, dm_leech` in round 3 instead of its own `dw_orin 2/2, dw_brunni 3/2`. Not seen in the 170
recorded games (the Bronze to Gold bands fit inside one sample), but certain to happen when a sample missed a run.

- `sim/lobby/savedSeats.ts`: `lobbySeatRecordings` (each recorded seat's whole run + each generated seat's BUILT
  recording), `restoreLobbySeatRecordings` (runs into the pool, recordings into the cache), `parseLobbySeatRecordings`
  (the old bare-array shape still parses).
- `sim/lobby/seats.ts`: `builtRecording` / `primeRecording`, so a generated seat keeps the recording it was saved
  with even after a deploy changes the autoplay.
- `sim/lobby/runLobby.ts`: `lobbyStandIns` + telemetry `standIns` (should always be 0).
- `ui/store.ts`: `persistSeatRecordings` writes `ascent.save.seatruns` beside every lobby save, only when the bundle
  grows (a few times per game, never every autosave). Boot restores it before any driver is built. The cloud copy
  carries `seatHybrids` too. `resumeLobbySeats`: a pre-fix save with unresolved seats waits for the pool (8 s cap)
  before building those drivers, and a seat still unresolved is warned in DEV and counted in telemetry.
- Judgement call: "surface it" is telemetry + a DEV warning, not a player-facing notice. Say if you want a visible one.
- Spectator mirror: not changed. It already fetches the seated runs by key (`setWatchedSeatRuns`). Only a failed read
  leaves stand-ins, which `lobbyStandIns` now lists. A spectator's boards never affect the game.

## 3. Rune of the Spellstone was dropped from served boards (R-SNAPSHOT-RUBY-01)

`snapshotBoard` stored the raw `rubyBonus`; the owner's own fight reads `rubyStatBonus` (plus spell power with the
Spellstone). New captures store the folded value as `rubyPower`. Old captures (3 runs, 14 boards) are recomputed on
read (`snapshotRubyPower`: the Spellstone flag rides their `questMods`, their `spellPower` is stored). No stored data
edited. Only a pending Starpath Vendor one-shot cannot be told apart on an old capture (rare).

`snapshotParity.test.ts` is the guard that would have caught it: two EXHAUSTIVE mapped-type tables over
`CombatSideState` and `BoardMinion` (a new field fails typecheck until classified), every carried field staged
non-default and diffed across capture -> serve. Excluded with reasons: `poolIds`, `align` (Celestials not live; owner
"not a problem right now"), `critChance`, and the display-only `text` / `goldenText` / `name` / `tribe`.
