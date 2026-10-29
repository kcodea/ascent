# 2026-10-29 — Live Games rows show the game at the Friends list's granularity

Owner ask: "give live games the same granularity that friends show". Rule: R-LIVE-STATUS-01.

**What.** Each Live Games row now has a middle column: the mode (Ranked, Practice, Versus 1v1, ...) and the Friends
game line, drawn by the friends' own `FriendGame` from a `FriendGameStatus`: the step ("Round 6 · Fighting Cat",
"Picking a hero", "Finished 3rd"), place among those left, Health + Armor pills, tier. The old right-column
"Round 5 · Fight" text (`liveStatusText`) is gone; the right column is watchers + Watch.

**How.** One status shape, one builder, one set of formatters:
- `lobbyStatusNow` (moved into `friends/gameStatus.ts` with `lobbyFoeName`, so the publisher can use it without an
  import cycle through `friendsStore`) builds the status for BOTH the presence beat and the live listing.
- The live publisher sends it with every listing it already sends: Supabase `lobby_live_heartbeat(..., p_status)`,
  Cloudflare `listing { status }` (the object passes it through to `lobby_live_cf` and the watchers' `row`). No new
  beats; Health / tier ride on the 15 s refresh.
- `liveGameStatusOf(row)` (pure, `liveTargets.ts`) turns any row into the shape: the sent status when its round and
  phase match the row, else the row's own round/phase/players/placement (vitals kept, a stale foe dropped).
- The listing read asks for `status` (column level 3) and falls back like the other columns; the heartbeat drops
  `p_status` for the session after one `PGRST202`.

**Needs.** `supabase/migrations/2026-11-13-lobby-live-status.sql` (column + heartbeat + `lobby_live_cf`), and a
versioned Worker redeploy for Cloudflare-hosted lobby games. Either order works: an older Worker sends null.

**Judgement calls.** Versus and Ranked Duos rows carry no status: the server writes them from match state and a match
row has no single player's Health/tier to show (whose?). They show mode, step and players through the same formatter.
The CF object's row key includes the status, so a lobby game's row is written a few more times a round (at most once
per 15 s listing, only when it changed).
