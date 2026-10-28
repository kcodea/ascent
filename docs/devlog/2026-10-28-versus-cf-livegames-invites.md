# 2026-10-28 · Every game is a live game; Friends shows a friend's game; Cloudflare invites checked at send time

Started as two gaps left after the Cloudflare Ranked Duos port (`docs/versus-cf-cutover.md`), then grew with two owner
rulings the same day: "all games should show as live games, and pressing watch from friends list should take the
spectator into that game", and a richer Friends status for in-game friends.

**Every game is a live game (R-LIVE-ALL-GAMES-01, R-VERSUS-CF-LIVE-01).** `lobby_live_games` now lists lobby games of
every kind (ranked, casual, Practice: `lobby_live_heartbeat(..., p_mode)`), Versus 1v1 / Group / Duos as
`versus:<room>` / `versus:cf:<room>`, and Ranked Duos as `duos:<room>` / `duos:cf:<room>`. New columns `mode`,
`players`, `private_host`, `live_until`. Writes stay event-driven:
- Supabase Versus rooms: a DEFERRED constraint trigger on `versus_matches` / `versus_group_matches` writes the row from
  state the server already holds, only when phase, round, pause or the first hero changes; it removes it on `complete`
  and can never fail a match (errors become warnings). No client traffic at all.
- Cloudflare rooms: the room writes through the key-gated `versus_cf_live` from a "latest wins" slot
  (`workers/versus/src/live.ts`) only when the listing's key changes plus a 2-minute keep-alive. About two writes per round.
- Event-driven rows carry `live_until` (4 minutes past the last write, 11 while paused); heartbeated rows keep the 60 s rule.
- Friends-only Versus rooms are listed only to the host and the host's friends (`lobby_live__may_see` in the read
  policy, the room list's rule); a friends-only Ranked Duos party stays unlisted.
The page labels each row (Versus 1v1 / Group / Duos, Ranked Duos, Casual, Practice) and shows the players' line, in the
existing row UI. Watch goes to the game (`live/liveTargets.ts`): the watch screen for a lobby game, the room's stands in
Versus or Duos on its own host. The client reads its old columns on a server without the migration (one retry).

**Friends Watch everywhere + the friend's game at a glance (R-FRIENDS-STATUS-01).** Practice and casual games are now
watchable from Friends; a Ranked Duos friend is watched from the Duos area (it used to open the Versus area, which never
shows a party). A friend in a game shows a small hero portrait, the round and phase, Health + Armor, tier, and their place
among those left or the Versus players. One typed shape, `FriendGameStatus` (`friends/gameStatus.ts`), rides the presence
beat (`friends_beat(..., p_game)`, `player_presence.game`, 1 KB cap) and is sent only when it changes; the shape is meant
for the Cloudflare presence hub to reuse. A server without the column takes the old beat (the client drops `p_game` after
one refusal).

**Invites into a Cloudflare room (R-VERSUS-CF-INVITE-01).** The client asks `invite_proof` on its room socket; the room
runs `friends_invite`'s checks and answers `<exp>.<hmac-sha256>` over `ascent.invite.v1|room|from|to|kind|exp`, keyed with
sha256(writer secret), the value `versus_cf_writer_keys` already holds. `friends_invite(..., p_proof)` refuses a `cf:`
invite without a valid proof (`room_check`). Chosen over a room-status table (egress) and Postgres calling the Worker.

Migration: `supabase/migrations/2026-11-08-versus-cf-live-games-invites.sql` (write only). No versus-resolve redeploy.

Still open: spectator XP for a Cloudflare match; a Versus "score" beyond the players' line; Tutorial and Gauntlet are not
live games (not lobby games).
