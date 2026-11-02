# 2026-11-01 · Duos on the Docked rail reads in teams

Owner ask 2026-11-01, with screenshots of the Docked rail in a Duos game (YOU, Rayse, Soren, Midas, places 1 to 4):
"this should just show the teams with their medals together, so the top t2 would have a 1", "the combat history should
show the team that they fought, not an individual hero", "health should show on both heroes in the rail". Branch
`fix/duos-rail-teams`. Rule R-DUOS-RAIL-TEAM-02 (approved/foundation.ts).

## What

- **Team placement.** In Versus Duos / Ranked Duos (player or spectator), the Docked rail no longer draws a placement box
  per seat. `duosTeamPlaces(rows)` numbers the teams in the rail's (already team-grouped, `groupDuosRailRows`) order, and
  LobbyPanel draws ONE `.lrv-rank.lrv-teamrank` per `DockTeam`, positioned off the layout's team box (left = pair's right
  edge + the usual `--rkg`, top / height = the pair's), so it spans both slices. Same navy box, states and podium metal as
  the seat box (CSS twin in lobbyRailDocked.css; the seat rules key off `.lobbyseat`, so they could not be reused as-is).
- **Health on both.** The docked slice used to hide Health on the first slice of each pair (`teamBarIds`, the docked port
  of R-DUOS-RAIL-TEAM-01's "pool once"), which is why YOU and Soren showed nothing. Removed: every slice draws its row's
  pool, and both rows carry the team's shared pool (groupLobbyView / rankedRoundsAsGroup already did that).
- **Team fight log.** A Duos round is recorded as ONE encounter between the two boards that went first, so `seatResults`
  named a single hero and gave the teammate who did not go first an empty log. `duosTeamResults(lobby, seatId)` reads
  encounters by TEAM (rail ids pair `s0+s1`, `s2+s3`, ..., `duosRailTeamOf`): one row a round, the other team's members
  as `foes`, "A + B", the team's damage. ScoutCard takes `teams` and draws both faces (compact card: `.lrv-sc-foes`; the
  Gem card's log too).

## Not changed

- The Gem rail's team slot (R-DUOS-RAIL-TEAM-01) still draws the pool once at its foot; the ask was about the Docked rail.
- Solo modes: no team boxes, per-seat places, `seatResults` as before.
- No sim / content change, so no versus-resolve redeploy.
