# 2026-10-26 — Ranked Duos, phase 1 part 1: the server pieces that do not need Versus Health / Armor

Owner design 2026-10-26 (a ranked lobby for two live teammates against three recorded teams; the team's own rating and
name; no Gold Fuse; the clock never stops; both End Turns move the game on). Design and rulings:
`docs/design/2026-10-26-ranked-duos.md`; rules: GAME-RULES.md "Ranked Duos" (in development); oracle R-RANKED-DUOS-GATE-01,
-RATING-01, -NAME-01, -SEATING-01, -LEAVE-01 (approved/foundation.ts).

## What

- **Room option `ranked_duos`** (`sim/versus/options.ts` + SQL whitelist): two seats, no modifiers. Its match is a Versus
  Group match (seat_count 2) with four team rows: `a` (the live pair) and `b`-`d` (recorded, no seats of their own).
  `versus_duos__is` now covers it, so the Duos passing RPCs and the seeded fight order apply unchanged.
- **Teams and names.** `duos_teams` (the unordered pair of accounts) is created at match start; `duos_team_set_name`
  (either teammate, between games): 2-16 letters, digits and single spaces, the guides word filter ported to SQL
  (`duos__name_blocked`, parity-tested against `isBlockedText` / `isReservedByline`).
- **Team rating.** `duos_team_ranks` + `duos_rank_results` + `settle_duos_rank` (the medal ladder with
  `DUOS_RANK_RULES`: +34 / +11 / -11 / -34, top 2 / 1st gates, 3rd-4th demote). Settled only by the server through
  `versus_ranked_duos__place_team` (the one place a team is placed; it also ends the match and records the duo run).
  Unrated: all three served teams generated, a test bot in the team, a dev-forced match, or a table never seated.
- **Duo pool.** `duo_runs` / `duo_run_rounds`, written from the match's own final submissions when the live team is
  placed (every round, both sides as fought, sources, the recorded fight order from `versus_group_rounds.first`);
  eligibility mirrors R-LOBBY-07. `duo_runs_sample` (service role).
- **Seating.** `selectRankedDuosTable` (`sim/versus/rankedDuosSeating.ts`): per band step, duo runs first, then solo runs
  paired as two different players; unique heroes; at most 2 of 6 served seats per player; generated fills the rest.
  `handleRankedDuosSeat` + the `seat_ranked_duos` action in `versus-resolve` sample SERVER side (60 solo runs, 40 duo
  runs) and pin the table, whole recordings copied, into `versus_ranked_duos_served` (`versus_ranked_duos_seat`,
  idempotent, validated, no client read policy).
- **End-turn gate** (`rankedDuosCloseAt` / `versus_ranked_duos__close_at`): both ended = at once; one ended = 0:00 + 5 s;
  nobody at 0:00 = first End Turn + 5 s; 30 s AFK backstop; auto seats count as ended. `versus_ranked_duos_submit`
  accepts candidates past 0:00 until the close (re-ordering), `versus_ranked_duos_reconcile` never pauses (a lapsed
  lease = auto; the caller's own call clears it). `versus_group_submit` / `versus_group_reconcile` hand a Ranked Duos match
  to these.
- **Leaving.** The Ranked Duos branch of `versus_group__eliminate`: a leaver's seat goes on auto for good, the team
  plays on; both left = lowest open place, settled. `versus_ranked_duos_sweep_abandoned` (service role) places a pair
  that has been silent for 10 minutes, so closing the game cannot dodge a loss.
- **Bundle hygiene.** `MAX_SEATS_PER_PLAYER` moved to `lobby/seatCap.ts` (re-exported) so `strengthBands` no longer
  pulls the bundled opponent pool into the Versus server bundle: the bundle grows 1.73 MB -> 1.78 MB instead of 3.2 MB.

## Not yet (P1 part 2, after feat/versus-lobby-health merges)

- `finalize_ranked_duos`: team pairing over `pairRunLobby`, the two tag-team fights (ours in full, the recorded one
  outcome + damage only), team Health / Armor with the lobby damage formula, the ghost team, `versus_group_rounds.first`,
  placing teams through `versus_ranked_duos__place_team`. It serves each recorded member's round-N board from the pinned
  copy (solo: `boardAt` semantics; duo: its round row; generated: a hybrid recording built at seating).
- Generated served members are pinned as `{ heroId, seed }` only; their recording is built when part 2 serves them.
- The solo sample is filtered by set only (not by build / patch prefix), and duo runs by set only; part 2 decides the
  build filter with the serving code.

## Verification

- `rankedDuos.test.ts` (20): the gate table, the Duos rating table, names, seating rules and determinism.
- `rankedDuos.db.test.ts` (20, PGlite, every Versus migration then this one twice): the party, names + filter parity,
  SQL vs TS rating over a 160-game random walk + dedupe, seating through the real handler, every gate case, no pause,
  the group RPC hand-over, leaving, placement + duo run, unrated paths, the sweep.
- `versusDuos.db.test.ts` and `versusGroup.db.test.ts` re-run with this migration appended: unchanged (14 + 12 pass).

## Deploy (the lead; nothing reaches players until phase 3)

1. Apply `supabase/migrations/2026-10-29-ranked-duos.sql` (after the Versus chain; independent of 2026-10-28-versus-health.sql).
2. `npm run versus:bundle && npx supabase functions deploy versus-resolve --no-verify-jwt` (adds `seat_ranked_duos`; the
   other actions are byte-identical).
3. Optional now, needed before launch: schedule `select public.versus_ranked_duos_sweep_abandoned()` with pg_cron
   (every 5 minutes).
