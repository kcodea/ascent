# 2026-10-24 — Versus Group + room options: the room and the game (phase 2 of 3)

Phase 1 (#2280) put the 3-4 player round robin and the room options on the server. This phase makes them playable.
Owner 2026-10-24: the room options live on the room ("customizable within a lobby ... game to game"), mode 1v1 or
3-4 players plus a modifier (time and lives removed for now); in game "we'd replace the 'enemy hero' ui element we
made with versus, with the lobby rail we have in the normal ranked mode ... and show a 'Copy' in the 4th slot if only
3 players are playing". The phase-1 readings were approved ("yes") and are recorded on R-VERSUS-GROUP-01/02.

## How the client plays a group match: PROJECTION

The whole 1v1 client (versusStore's run building, reconnect catch-up, lock and candidate uploads, End Combat barrier,
pause, end gate, Hero Select) is built around one opponent per match. A group player also has exactly one opponent
per round, so `versusGroupView.ts` projects the group match onto the 1v1 row from the viewer's seat: `p1` = me, `p2` =
this round's opponent (a Copy is `Copy of X` and never the copied user). The table rides on `match.group`
(raw seats, my real seat, my foe, living counts, who paused). Round rows project the same way (`p1_result` = my side of
my fight) and also carry every seat's own result (`results`) for spectators.

- **`mx`** in versusStore: every match-scoped call (reconcile, submit, intro, combat ready, forfeit, unpause, resume,
  finalize, offer/pick/re-roll, checkpoint, frames) goes to the 1v1 RPCs or the `versus_group_*` ones by which table
  the match id lives in (learned on its first read), and a group answer comes back projected. The 1v1 path is the
  same code it was.
- **A player who is out** sees their own match as finished at the round they went out (end reason `hearts` = watch the
  deciding fight first; conceded = the gate at once). Behind the gate they are re-projected as a
  spectator (seatless) and land on the watch screen of the same match (R-VERSUS-GROUP-06, below).
- **The rail**: `versusGroupLobby` (sim, groupLobbyView.ts) builds the display lobby: `s0` me, `s1..` the others in seat
  order (their boards from the public fight rows), a `sc` Copy row while the round has a copy fight, hearts on
  `resolve`, the seats that are out dead with placements. `RunLobby.forcedOpponent` (new, display lobbies only) makes
  `playerOpponent` serve the server's pairing, so the rail's mark and the combat scene name the right foe. LobbyPanel
  renders it as the ordinary ranked rail (`versusDuel` keeps the 1v1 block for two-seat lobbies).
- **Spectators**: spectate.ts holds four receivers; frames and emotes carry the REAL seat (a group player publishes as
  p3, not as its projected p1); `SpectatorBar` becomes the fight picker (plates grouped by fight, "vs X", 1-4 keys, out
  players dimmed, auto-moves off a player who goes out); a switch inside one fight keeps the moment, a switch to the
  other fight rejoins it.
- **Emotes**: `setVersusEmoteSeatMap` lands each sender's emote on their own rail row.
- **Turn pill**: `versusTurn` counts living seats from `match.group.counts` ("Players ready 3/4", "Everyone else is
  ready").

## Knocked out = into the stands (owner addition, R-VERSUS-GROUP-06)

"when a player loses/is knocked out in this mode they go into a spectator seat so they can watch the rest of the game".
New migration `2026-10-24-versus-group-knockout-stands.sql`: a trigger on `versus_group_seats` moves a seat that goes out
(hearts, missed rounds, concede) to `spectator` in the room's members, past the 20 cap (the cap only gates joins and seat
moves). The client's `returnToRoom` for a knocked-out player clears the opt-out so the end gate opens on the watch screen
of the same match, with the placement notice (LiveWatchBar's numeral panel, reused) for 6 s. A reload lands in the
stands. Without the migration the player stays in their seat but still watches as a spectator.

## The room

`VersusRoom` lays out four seats (`.vsgroup`, a size down) for a 3-4 player room; Start game shows with three seated.
`readRoomGeo` / `isSeat` / `seatDrag` know p3/p4. The options chip under the room name and the Room options button open
`VersusOptionsPanel` (Practice's `Segmented`, now exported): editable for the host while Open, greyed for everyone
else. `optionsNotice` shows "Room options changed: ..." to non-hosts when `options_rev` grows. The browser card shows the
mode and the right number of seat sockets. `createVersusRun` gets the match's pinned options (a modifier's rift).

## Not done / flagged

- Group XP/achievements: not wired (progression reads 1v1 matches; another agent owns Versus XP).
- `versus_records` reads at most 22 ids: in a full group room (4 seats + 20 spectators) the last two spectator cards show "-".
- Previous match stats after a group match show the viewer's own fights (the 1v1 record shape), not the table.
- The 4-seat layout and the rail were checked by tests (jsdom), not yet by eye: phase 3's live 4-account test covers it.
- The dev test bot (`versusBot`) still plays 1v1 only.

## Verification

New tests: `versusGroupLobby.test.ts` (sim), `versusGroupView.test.ts`, `versusGroupRoom.test.tsx`, the group case in
`versusEmotes.test.ts`. Full typecheck / lint / test / build:web green.
