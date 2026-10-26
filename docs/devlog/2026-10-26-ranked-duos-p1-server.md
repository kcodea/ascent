# 2026-10-26 — Ranked Duos, phase 1: the server

Owner design 2026-10-26 (a ranked lobby for two live teammates against three recorded teams; the team's own rating and
name; no Gold Fuse; the clock never stops; both End Turns move the game on). Design and rulings:
`docs/design/2026-10-26-ranked-duos.md`; rules: GAME-RULES.md "Ranked Duos" (in development); oracle
R-RANKED-DUOS-GATE-01, -RATING-01, -NAME-01, -SEATING-01, -LEAVE-01, -ROUND-01 (approved/foundation.ts). Built on top of
Versus Health / Armor (#2318). Nothing reaches players until phase 3 ships the door.

## What

- **Room option `ranked_duos`** (`sim/versus/options.ts` + SQL whitelist): two seats, no modifiers. Its match is a Versus
  Group match (seat_count 2) with four team rows: `a` (the live pair) and `b`-`d` (recorded, no seats of their own).
  `versus_duos__is` now covers it, so the Duos passing RPCs and the seeded fight order apply unchanged.
- **Teams and names.** `duos_teams` (the unordered pair of accounts), created with the match; `duos_team_set_name`
  (either teammate, between games): 2-16 letters, digits and single spaces, the guides word filter ported to SQL
  (`duos__name_blocked`, parity-tested against `isBlockedText` / `isReservedByline`).
- **Team rating.** `duos_team_ranks` + `duos_rank_results` + `settle_duos_rank` (the medal ladder with
  `DUOS_RANK_RULES`: +34 / +11 / -11 / -34, top 2 / 1st gates, 3rd-4th demote). Settled only by the server through
  `versus_ranked_duos__place_team` (the one place a team is placed; it also ends the match and records the duo run).
  Unrated: any generated served member, a test bot in the team, a dev-forced match, or a table never seated.
- **Duo pool.** `duo_runs` / `duo_run_rounds`, written from the match's own final submissions when the live team is
  placed (every round, both sides as fought, sources, the fight order the round really used); eligibility mirrors
  R-LOBBY-07. `duo_runs_sample` (service role).
- **Seating.** `selectRankedDuosTable` (`sim/versus/rankedDuosSeating.ts`): per band step (the team's own medal), duo
  runs first, then solo runs paired as two different players; unique heroes; at most 2 of 6 served seats per player;
  generated fills the rest. `handleRankedDuosSeat` + `versus-resolve`'s `seat_ranked_duos` sample SERVER side (60 solo
  runs, 40 duo runs) and pin the table, whole recordings copied, into `versus_ranked_duos_served`
  (`versus_ranked_duos_seat`, idempotent, validated, no client read policy).
- **The round.** `versus_ranked_duos_round_input` (one read; the SQL applies the round-exact serving rule to every
  recorded member: its own round, a hole = empty in the previous state, before its start = nothing, past its end = its
  final board), `resolveRankedDuosRound` (`sim/versus/rankedDuosRound.ts`: the lobby's pairing over teams, proven equal to
  `pairRunLobby`; the bye's ghost; one tag-team simulate() per pairing; lobby damage to the team pools; shared places;
  the round-60 backstop), `handleRankedDuosFinalize` + `versus-resolve`'s `finalize_ranked_duos` (seats the table first if
  needed), `versus_ranked_duos_commit_round` (fights in `versus_ranked_duos_fights`: the live team's fight in full,
  every other one only its result, owner Q11; pools; placements; the live team through place_team).
- **End-turn gate** (`rankedDuosCloseAt` / `versus_ranked_duos__close_at`): both ended = at once; one ended = 0:00 + 5 s;
  nobody at 0:00 = first End Turn + 5 s; 30 s AFK backstop; auto and left seats count as ended.
  `versus_ranked_duos_submit` accepts candidates past 0:00 until the close (re-ordering), `versus_ranked_duos_reconcile`
  never pauses (a lapsed lease = auto; the caller's own call clears it). `versus_group_submit` / `versus_group_reconcile`
  hand a Ranked Duos match to these.
- **Leaving.** The Ranked Duos branch of `versus_group__eliminate`: a leaver's seat goes on auto for good, the team
  plays on; both left = lowest open place, settled. `versus_ranked_duos_sweep_abandoned` (service role) places a pair
  that has been silent for 10 minutes, so closing the game cannot dodge a loss.
- **Bundle hygiene.** `MAX_SEATS_PER_PLAYER` moved to `lobby/seatCap.ts` (re-exported) so `strengthBands` no longer
  pulls the bundled opponent pool into the Versus server bundle (it would have doubled it, 1.7 -> 3.2 MB); the bundle
  test's allow-list names the pure leaf modules the seating reads (rank, lobbyStrength, boardSide, strengthBands,
  seatCap, handles).
- `versusLockOrder.test.ts` covers the new migration (the sweep and the press-gate branch were reshaped to keep the one
  lock order).

## Readings made (flag to the owner / lead)

- **Generated members** have no server-side recording yet (building one needs the reducer, which the Edge bundle must
  not carry), so they field no board, and a table with ANY generated member is unrated. With ~150 runs a set and the
  band widening down to the overall cap, this should be rare; a real fix is a server-side recording job.
- The solo and duo samples filter by set only (not by build / patch prefix); the pinned copy then never changes.
- The fight order of a live or paired team is the Duos 50/50 seeded per team letter; a recorded duo run keeps its own.
- Damage on a tag-team fight is the lobby formula read from the board that ended it (the Versus Duos reading).

## Verification

- `rankedDuos.test.ts` (20), `rankedDuosRound.test.ts` (9: pairing equal to `pairRunLobby` over 300 tables, ghost /
  bye, damage, hand-over, shared places, backstop, determinism).
- `rankedDuos.db.test.ts` (22, PGlite, every Versus migration through versus-health, then this one twice): the party,
  names + filter parity, SQL vs TS rating over a 160-game walk + dedupe, seating through the real handler, every gate
  case, no pause, the group RPC hand-over, the round-exact member board, a WHOLE MATCH through the real finalize handler
  to a 1st place (+34 to the team, the duo run recorded), leaving, unrated paths, the sweep.
- `versusDuos.db.test.ts` and `versusGroup.db.test.ts` re-run with this migration appended: unchanged.

## Deploy (the lead; nothing reaches players until phase 3)

1. Apply `supabase/migrations/2026-10-29-ranked-duos.sql` (after `2026-10-28-versus-health.sql`).
2. `npm run versus:bundle && npx supabase functions deploy versus-resolve --no-verify-jwt` (adds `seat_ranked_duos` and
   `finalize_ranked_duos`; the other actions are unchanged), then `npm run versus:parity -- remote <url>`.
3. Before launch: schedule `select public.versus_ranked_duos_sweep_abandoned()` with pg_cron (every 5 minutes).
