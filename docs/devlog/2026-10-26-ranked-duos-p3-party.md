# 2026-10-26 — Ranked Duos phase 3: the party, the boards, Live Games

Branch `feat/ranked-duos-p3`. Owner design 2026-10-26 (`docs/design/2026-10-26-ranked-duos.md`); rules in GAME-RULES
"Ranked Duos" (no longer marked in development); oracle `R-RANKED-DUOS-PARTY-01`.

## What shipped

- **Solo | Duo above Play** (owner: "a toggle above 'play' that says solo/duo. if duo is selected it then puts you into a
  room specific for duo's where you can invite a friend"). `versus/playParty.tsx`: the Career's `.cv2-seg` segmented
  control over the sidebar Play and the main menu Play, remembered per viewer (localStorage, Solo when unavailable).
  Duo + Play asks the ranked confirmation (Title's own overlay, `DUOS_CONFIRM_*`), then `enterDuosParty` puts the
  player in their party: back into a room they already hold, else a new Ranked Duos room with them in p1. The Mode
  screen's interim "Ranked Duos" tile was dropped in favour of the toggle.
- **The party room** is the Versus room (`VersusRoom.tsx`) with `DuosParty.tsx`: the team plate over the seats
  ("Name1 & Name2" until named), Team name window (either teammate, between games, accounts only), the host's Friends
  only / Listed publicly switch, Invite a friend (kind `duos_party`; `RoomInvitePanel` picks the kind by mode), and
  Join a party (alone in a party: leave it and show the open parties). Room options are hidden in a party unless the
  test tools are on (the room-options `ranked_duos` mode stays dev-only).
- **Friends**: accepting a `duos_party` invite opens the Duos area, joins and takes the free seat
  (`friendsGo.acceptDuosPartyInvite`, `joinRoom` auto-seat for ranked parties).
- **After a game**: `loadDuosResult` reads `duos_rank_results` (a few tries) and `DuosResultOverlay` shows the solo
  `RankScreen` (place out of 4, delta, medal) over the room.
- **Boards**: Leaderboard Solo | Duos tabs (`DuosBoards.tsx`, `duos_leaderboard`), Career "Ranked Duos" teams
  (`duos_teams_of`).
- **Live Games**: one row per team, `duos:<room>`, from p1 only (`duosLive.ts` → `lobby_live_duos_heartbeat`, 15 s +
  on change, keyed backoff); delisted at the end and for friends-only parties. Watch joins the party's stands.
- **Rail fix** (owner live test): the team name no longer overlaps the first row's player name; it is a wrapped
  full-width line above the name inside `.lobbynameline` (`.hasteam`).

## SQL (the lead applies)

- `supabase/migrations/2026-11-01-ranked-duos-party.sql` — `versus_rooms.friends_only`, `versus_set_friends_only`,
  visibility in `versus_list_rooms` / `versus_open_rooms` (+ `duosOpen`, parties out of the Versus counts) /
  `versus_join_room` (`friends_only`), `versus__host_is_my_friend` (the one friendship check a security-invoker reader
  may make), `duos_leaderboard`, `duos_teams_of`, `lobby_live_duos_heartbeat`. Idempotent.
- `supabase/migrations/2026-11-01-ranked-duos-sweep-cron.sql` — schedules `versus_ranked_duos_sweep_abandoned()` every
  5 minutes as pg_cron job `ranked-duos-sweep` (needs the pg_cron extension).

## Tests

`packages/sim/src/versus/rankedDuosParty.db.test.ts` (PGlite: friends-only list/count/join, the duos count, the invite
path end to end, the leaderboard and teams-of, the Live Games heartbeat); the lock-order static test now includes the
party migration.

## Gotcha

`versus_open_rooms` is `security invoker`, so it cannot call the private `friends__are_friends` (PGlite: "permission
denied"). It asks `versus__host_is_my_friend(host)` instead: definer, answers only about the caller.
