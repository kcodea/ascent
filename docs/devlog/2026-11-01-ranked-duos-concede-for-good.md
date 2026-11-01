# 2026-11-01: a Ranked Duos concede is for good (R-RANKED-DUOS-CONCEDE-01)

Owner report (live build 8d8f71914): "i was in a duos ranked game w/ mike and i conceded, but then in scene builder it
looked like i was still in a duos game with him and then i reloaded the game and it put me in a lobby where i faced
opponents until the game ended?"

## Root cause

A Ranked Duos concede never knocks the team out. `RankedEngine.eliminate` (the Worker) only stamps the seat `left_at`
and puts it on auto; the teammate plays on, and the room stays `in_game` with the conceder still in a PLAYER role. But
every "is this seat out?" check on the client read `eliminatedRound` only, so:

1. **Still a player in the store.** After the concede's end gate, `returnToRoom` re-ingested the match and
   `groupViewer` projected it from my seat again (not eliminated, `builtFor` reset). The Versus store held a live Duos
   match with Mike as my teammate.
2. **Scene Builder leak.** `DuosMateDock` picked `versusKey ?? localKey`: the held Versus match won over the rig's
   local placeholder teammate, so the Scene Builder's portrait (Duos toggle on) showed Mike.
3. **Reload resumed it.** Boot's `resumeVersusMatch` re-enters any in-game room where I hold a player role; the
   in-memory `endGated` set was empty after the reload, so `ensureRun` rebuilt a playable run of the table (the
   "lobby"), and the Worker accepted that seat's boards (`requireLive` checked only `eliminated_round`).

## Fix

- `versusGroupView.ts`: `groupSeatGone` (out, or `leftAt` on the seat row / the match json's `leftAt` map) and the pure
  `groupViewerOf`; a gone seat is a spectator once its run is off screen.
- `concededMatches.ts`: the device remembers its concedes (localStorage, last 12). `forfeitMatch` marks it before the
  request; `resumeVersusMatch` skips a conceded match; `ensureRun` never builds one.
- `DuosMateDock.tsx`: with a local teammate installed (the Scene Builder), the Versus store is never read.
- Worker `RankedEngine.requireLive`: a seat with `left_at` is refused (`left`) for submit / unpause. **Ships with the
  next hub/pack deploy**; the client half alone already stops the resume.

Not changed: the conceder stays a player member of the party room until the match ends (moving them to the stands
would change the party's seating after the game). Their in-session view after a concede is unchanged (the stands).
