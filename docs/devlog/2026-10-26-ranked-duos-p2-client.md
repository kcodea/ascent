# 2026-10-26 — Ranked Duos, phase 2: the client game loop

Phase 1 (#2321) built the server. This phase plays a Ranked Duos match on the client by reusing the whole Versus Duos
client. Rules: GAME-RULES.md "Ranked Duos" (in development); design `docs/design/2026-10-26-ranked-duos.md`; oracle
R-RANKED-DUOS-CLIENT-01 (approved/foundation.ts). Reachable only from a Versus room with the test tools on (the room
options window shows "Ranked Duos"); the real door is phase 3.

## How it plugs into the Duos client

- **Virtual seats.** Every recorded team member sits at a stable seat by its team letter (b = p3 / p4, c = p5 / p6,
  d = p7 / p8; `rankedDuosSeatOf`). The resolver now stamps the live team's fight with `duosBoards` / `duosFirst` by those
  seats (the Versus Duos shape), so the tag-team playback, the member views, the hand-off portraits, the teammate view
  and passing all run unchanged. `withServedSeats` (`ui/versus/rankedDuosView.ts`) seats them on the match row, marked
  `served` (never counted for "Players ready N/2", never offered to spectators).
- **The opponent while shopping.** `rankedFoeAt` runs the resolver's own pairing (`pairRankedDuosTeams`) on the same
  data (the teams' pools, the meetings so far, who fell when), so the rail marks this round's opponent from the shop on,
  exactly as a solo lobby does. A unit test plays four rounds against the real resolver and checks they agree.
- **Rounds.** `rankedRoundsAsGroup` turns committed rounds into the Duos round shape: the live team's fight first (in
  full), the other pairing as a result only (owner Q11), every team's pool on its seats. Read with
  `versusRemote.rankedRounds` (the group rounds row + `versus_ranked_duos_fights`, only committed rounds).
- **The recorded teams** come from `versus_ranked_duos_table` (new, `2026-10-30-ranked-duos-client.sql`): names, heroes,
  each member's board for THIS round (the round-exact rule), recorded fight orders, duo-run team names. Read ONCE per shop
  and backed off (`syncRankedTable`); the client asks the server to seat the table once the heroes are in.
- **The clock.** No Gold Fuse (Versus never had one). At 0:00 `expireVersusShop` only takes the engine lock
  (`shopClockExpired`: buying / selling / rolling / playing / tier / hero power refused; re-order and freeze allowed) and
  does NOT end the turn. The tick reconciles at the gate's close moment (`rankedCloseIso`) instead of at 0:00. Once a
  teammate has ended past 0:00 the clock face counts the 5 s window down (`graceAt` in `useVersusRecruit`). Candidates
  keep flowing past 0:00 so a re-order counts; the server promotes the newest at the close.
- **The rail** is `versusGroupLobby` generalised: the mate by `duosMateOf`, start pools from both heroes of any pair, and
  each recorded member's current board (`current`) on its row and scout card. `groupDuosRailRows` keeps four teams
  together; each team's name sits on its first row (`.lobbyteam`, static, inside the row).
- **Finalize** routes to `finalize_ranked_duos`; the dev bots route the same and seat only p1 / p2.

## Verification

- `rankedDuosView.test.ts` (5): virtual seats + the pill; the client's opponent equals the resolver's over four rounds;
  a committed round projects as a Duos fight (own view, team outcome and pool; the other fight result-only); the gate's
  close moment; the 8-row rail, team grouping and team names.
- `rankedDuos.db.test.ts` (+1): the table read (boards by the round-exact rule, recorded order, members only).
- Versus suites (ui + sim): 488 pass.

## Deploy (the lead) — needed before the live test

1. Apply `supabase/migrations/2026-10-30-ranked-duos-client.sql`.
2. `npm run versus:bundle && npx supabase functions deploy versus-resolve --no-verify-jwt` from this branch (the live
   fight now carries `duosBoards` / `duosFirst`), then `npm run versus:parity -- remote <url>`.
