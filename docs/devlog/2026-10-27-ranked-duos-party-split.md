# 2026-10-27 — Ranked Duos: the party is its own place

Branch `feat/ranked-duos-lobby-split`. Oracle `R-RANKED-DUOS-SPLIT-01`. Owner: "lobby/versus modes need to stay separate
from ranked modes ... the duo ranked lobby should just have an invite player option and then start game and a back
button to get back to the play screen"; "make the team naming more obvious in lobby".

## What shipped

- **Its own view.** `Title.tsx` has `duos` (my party opening, or why it could not: `DuosDoor`, Try again) and
  `duos-party` (the party stage) views, picked by the store's `area`, which `enterRoom` now sets from the room's mode
  (`areaOfRoom`), so every path (invite, resume, rejoin) lands in the right place.
- **The party screen** (`VersusRoom.tsx` with `party`): the TEAM heads the stage ("Your team", the name or
  "Name1 & Name2", "Invite a teammate" while alone) with Rename team; only Invite player, Start game and Back. Removed
  from the party: Room options, Leave party, Friends only, Join a party, Previous match stats, the empty stands label.
  The old team plate over the seats is gone (the header carries it). Phones: one-line header, 40-44 pt controls.
- **Back** = `leaveDuosParty`: mode screen + leave (before the game nothing exists to settle); a running game is never
  conceded from Back.
- **No crossing.** The Versus browser lists Versus rooms only (store filter + server); the Versus options no longer
  offer Ranked Duos (was test tools only); opening Versus while holding an open party leaves it; Duo + Play while
  holding an open Versus room leaves it; a party invite accepted while alone in my own open party swaps parties.
- The open parties list and the friends-only switch are off screen; the server keeps both.

## SQL (the lead applies)

`supabase/migrations/2026-11-02-ranked-duos-party-split.sql`: `versus_list_rooms(p_area default 'versus')` (dropped the
0-arg one; the client call is unchanged) and `versus_set_options` refusing a change across the ranked_duos line. No
versus-resolve redeploy (no core/content/sim change).

Rating check: `settle_duos_rank` is reached only from `versus_ranked_duos__place_team`, which needs a match row that only
`versus_press_gate` creates once both gates are pressed. Leaving an open or sealed party makes no match (db test).

## Gotcha

The room's card layer measures `.vsbench` for its geometry (`readRoomGeo`): unmounting the bench leaves every seat card
unplaced. Hide its label, never the bench.
