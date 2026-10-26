# 2026-10-25 — Versus Group: Watch opens the live match (R-VERSUS-GROUP-WATCH-01)

Owner bug report (room "test3", 3-4 players, round 10, two players left, owner in the stands): "i just jumped into this
game and 'watch' isnt taking me into the lobby to watch it."

## Root cause

The watch screen's seat starts at `p1` (`useSpectate`). `render()` in `packages/ui/src/versus/spectate.ts` shows
nothing while that seat has no view, and `spectatorRunOf` returns null for a view on its end screen (`gameover`). In a
group match `p1` can be a player already knocked out (their last keyframe is their end screen) or a seat no one sat in
(a group starts with three of four seats). Then the screen never opened, and the room's Watch (`resumeSpectating`) only
re-rendered the same dead seat. The "move off a player who is out" effect lives in `SpectatorBar`, which only mounts
once the screen is active, so nothing ever moved the seat. 1v1 is unaffected (p1 always exists and plays to the end);
Duos is unaffected (no seat goes out on its own).

## Fix

`watchableSeat(match, seat)` (pure): keep a living seat, else the first player still in, in seat order. `spectateSync`
and `resumeSpectating` move the seat onto it BEFORE the screen opens (`pickLivingSeat`), and when the new seat has no
cached view they ask the players for a keyframe and re-read the stored ones. Watch with nothing cached also asks.

## The other oddities in the report

- **Two seated, two "Open seat" mid-match**: by design. The knockout-to-stands trigger
  (`2026-10-24-versus-group-knockout-stands.sql`) moves a knocked-out player's member row to the stands, so their seat
  shows as open. `versus_take_seat` refuses a seat while the room is not `open`, so no one can sit mid-match.
- **Room `status = 'open'` while "Round 10 is live"**: the client only shows "Round N is live" and Watch when the room
  is `in_game`, so it was `in_game` when the owner saw it. `versus_group__complete` reopens the room when the match
  ends. The row was most likely read after the match finished. The SELECTs in the PR confirm it.

## Verification

`spectateGroupWatch.test.ts`: p1 out with an end-screen frame, p1 never seated, Watch after Leave once the watched
player went out, a seat with no frames asks for a key, and the 1v1 Watch regression. The four group cases fail on the old
`spectate.ts`.

Live check (prod build of this branch on `vite preview`, live backend, unrated): Claudebot5 hosted a 3-4 player room
from the stands, with test bots Claudebot6/7/8 on p2/p3/p4 and p1 left empty. The watch screen opened on its own at round
1 on Claudebot6 (p2), and Leave then the room's Watch reopened it. By round 10, Claudebot7 (p3) was out and in the stands,
so the room matched the owner's report: two seated, p1 and p3 open. A fresh reload (seat back to p1) re-entered the
room and opened the live watch screen at round 11 on Claudebot6, with the fight picker listing Claudebot6, Claudebot8 and
the out Claudebot7. The rooms are gone, the bots left, and the browser and server are closed.
