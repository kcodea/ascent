# Supabase cleanup: scope, measurements and phased plan

> Owner ask 2026-10-28: "scope out a massive supabase clean up so that we're running really cleanly across the board."
> This is the SCOPE: a read-only investigation of the live project (`zcwhbejpqcdcfdpfxeza`) plus the repo, and a plan of
> small PRs. Nothing in it has been applied. Every number below was measured on 2026-10-28 with read-only SQL
> (`supabase db query --linked`, SELECT only) or read from the repo at `origin/main` 367751219.
>
> Context: live Versus (all four modes) is moving to Cloudflare Durable Objects
> ([`2026-10-28-versus-cloudflare.md`](2026-10-28-versus-cloudflare.md), runbook [`../versus-cf-cutover.md`](../versus-cf-cutover.md)).
> Supabase stays for auth, saves, ratings/medals, leaderboards, Career, Hall, snapshots, Ranked Duos `duo_runs`, friends,
> progression/cosmetics/XP, Live Games, the Edge Functions and pg_cron. A large part of this cleanup is therefore
> "delete the Versus server once Cloudflare has run cleanly", and the rest is independent of the cutover.

## 0. Summary

**The measurement window is 16.0 days**: Postgres restarted at 2026-10-12 16:23 UTC, which reset `pg_stat_statements`,
`pg_stat_user_tables` and `pg_stat_user_indexes` together. All counts below cover 2026-10-12 to 2026-10-28.

**Who generates the load.** 2,534 auth users, of which **5 are email accounts** and 2,529 are anonymous; **2,476 of the
anonymous users own no profile, board or Career row** (750 were created in the window: new browsers, headless test
runs, Claudebots, Versus test bots). Only **4 accounts** wrote a Career row in the last 7 days. So today's bill and load
are almost entirely the dev team plus test traffic, which makes per-session waste (not per-player volume) the target.

Top findings, in order of payoff:

1. **One RPC is ~2/3 of the API egress.** `pool_runs_sample` returns 150 WHOLE runs (every board snapshot of each run,
   ~24 KB a run) = **~3.45 MB per call**, 3,872 calls in the window = **~13.4 GB / 16 days (~25 GB/month)** of uncompressed
   JSON. The pool it samples from is only 411 runs (9.9 MB in total), so every session re-downloads a third of the whole
   pool. It also spills **~13 GB of temp files** to disk (work_mem 2 MB) and is the single slowest client call
   (mean 496 ms, max 7.8 s). The earlier memo's "boards 17M row reads" were internal tuple fetches from this function and
   the strength triggers, not bytes shipped.
2. **A boot fan-out re-runs on every auth event.** `supabaseAuthProvider.onChange` re-runs progression probe + guides +
   flushes + handle claim on every `onAuthStateChange` fire (token refresh, and very likely every tab refocus), not only on an
   identity change. Result: **~87,000 calls each** of `progression_config` (x4 separate one-column reads),
   `cosmetic_catalog` (full 458-row list, 33.8 KB), `player_cosmetics` (x2), `profiles`, `loot_crates` (x2), `guides`,
   and **5,551 `UPDATE profiles`** for 58 profiles. That is **~1M of the 3.9M statements** and **~3 GB of egress** for
   data that changes a few times a week.
3. **Realtime Postgres Changes is a quarter of all DB time.** The WAL polling query ran 497,817 times (25.4% of all
   execution time, **7.5 TB of buffer hits**). Every subscribed table except `friend_invites` is a Versus table, so the
   Cloudflare cutover plus moving friend invites off Postgres Changes removes it entirely.
4. **Live Versus is another 28% of DB time** (342k RPC calls: `versus_heartbeat` 79k, `versus_group_reconcile` 46k, ...).
   After the cutover, **~120 of the 234 public functions, 12 tables, 9 publication entries, the `versus-sweep` cron and
   the `versus-resolve` Edge Function** go. Together with item 3 that is **~53% of database time**.
5. **Silent write drops are real and measurable.** Snapshot, telemetry, Career and fight uploads are fire-and-forget:
   failures are swallowed, the offline queue drops failed items, and the "schema fallback ladders" downgrade a row on ANY
   error (a timeout included). `pg_stat_statements` shows the fallback rungs actually fired in this window:
   **5 board inserts without strength columns, 2 without `unrated`** (a queued UNRATED board then lands as rated), and
   **10 telemetry inserts on lower rungs** (missing `set_id`/`source`, `derived`, `replay`). Board inserts take
   **1.35 s mean, 7.7 s max** against an 8 s `statement_timeout`, because the insert triggers synchronously recompute
   pool strength (often for every pool run): timeouts are cancelled and never appear in the stats. The pool triggers
   also catch every error and only `raise warning`, so a failed pool refresh is invisible.
6. **The Micro stalls line up with the 8 s timeout.** Unrelated statements all show `max ≈ 7.5-7.8 s`; the `authenticated`
   role's `statement_timeout` is 8 s and `lock_timeout` 8 s. Contributors: 24 GB of temp-file writes (13 GB from
   `pool_runs_sample`), realtime polling's buffer churn, synchronous strength refreshes that UPDATE up to all 419
   `pool_runs` rows per board insert (84,191 updates from 2,399 inserts, also a deadlock candidate), and the Versus lock
   choreography. **57 deadlocks** in the window (one known source, heartbeat/leave order, was fixed on 2026-10-26).
7. **Repo vs live functions: no hidden drift, but the files cannot be replayed safely.** A normalized comparison
   (comments + whitespace stripped) of all 234 live function bodies against every definition in `schema.sql` + the 92
   migrations: **229 equal the last definition by filename, 5 equal an earlier one, 0 match nothing.** The 5: two stale
   overloads still live (`versus_create_room`, `versus_submit`), and three where apply order ≠ filename order
   (`settle_rank` live = the bonus-floor 50 version; replaying files in name order would silently restore floor 30).
   There are 529 function definitions for 234 functions (`settle_progression` x20, `equip_cosmetic` x14), no
   `schema_migrations` ledger for `public`, and no way today to prove live == repo except by this kind of diff.
8. **Security.** All 173 SECURITY DEFINER functions pin `search_path` (good). Gaps: `boards` has an **`anon insert`
   policy with `check (true)`** (anyone with the public key can write boards for any user and poison the pool; zero
   legit anon inserts in the window); `run_telemetry` (140 MB of replays) and other heavy tables are readable by the
   no-session `anon` role (an egress-abuse lever); default grants leave INSERT/UPDATE/DELETE/TRUNCATE on almost every
   table for `anon`/`authenticated` (RLS holds today, but it is one bad policy away); 10 SECURITY DEFINER functions are
   executable by `anon`.
9. **Size is fine today, growth is not.** The database is **254 MB**; `run_telemetry` is **140 MB of it** (415 rows,
   ~305 KB of compressed replay each, ~100 MB/month at today's rate). Free's 500 MB would be reached in ~2.5 months
   without a replay retention rule.
10. **Free plan after cleanup:** feasible at today's traffic on the numbers (egress ~1.5-2 GB/month of 5 GB, database
    ~120-150 MB of 500 MB), but Free has no automatic backups and the smallest compute. Recommendation in section 8.

## 1. Inventory

### 1.1 Platform

| Item | Value |
|---|---|
| Postgres | 17.6 (aarch64), restarted 2026-10-12 16:23 UTC |
| Size | 254 MB (`public` ~220 MB; `run_telemetry` alone 140 MB, almost all TOAST) |
| Compute | Micro: `shared_buffers` 224 MB, `work_mem` 2 MB, `max_connections` 60 (29 in use at measure time; PostgREST pool 9 idle) |
| Timeouts | `anon` 3 s, `authenticated` 8 s, `authenticator` 8 s + `lock_timeout` 8 s, `service_role` none; `idle_in_transaction_session_timeout` off |
| Logging | `log_lock_waits` on, `deadlock_timeout` 1 s, `log_min_duration_statement` off, `track_io_timing` off, `track_functions` none |
| Health | cache hit 100.0%; **temp files 8,085 / 24 GB**; deadlocks 57; commits 2,924,151 / rollbacks 174,971 (5.6%, mostly RPCs raising expected errors) |
| Extensions | plpgsql, pg_stat_statements 1.11, uuid-ossp, pgcrypto, supabase_vault, pg_cron 1.6.4 |
| Storage | **0 buckets, 0 objects** |
| Auth | 2,534 users (5 email, 2,529 anonymous; 2,476 anonymous with no data; 1,115 anonymous idle > 30 days); `refresh_tokens` 1,022 dead tuples |

### 1.2 Where database time goes (16 days, 19,631 s total)

| Area | Calls | Exec time | Share |
|---|---:|---:|---:|
| Live Versus (RPCs + table reads) | 342,047 | 5,497 s | **28.0%** |
| Realtime Postgres Changes polling | 517,380 | 4,993 s | **25.4%** |
| Opponent pool + strength (`pool_runs_sample`, histograms, boards) | 15,601 | 3,224 s | 16.4% |
| Stats / Career / telemetry reads + writes | 34,162 | 2,276 s | 11.6% |
| Progression / cosmetics / Aether | 1,024,528 | 1,041 s | 5.3% |
| PostgREST/system overhead (`set_config` per request, schema-cache reloads) | 1,603,888 | 714 s | 3.6% |
| Cloud saves (`put_saved_run`) | 15,677 | 594 s | 3.0% |
| Live Games / friends / presence | 21,762 | 496 s | 2.5% |
| Profiles / rating | 25,045 | 295 s | 1.5% |
| Guides | 99,840 | 40 s | 0.2% |

Roles: client roles (`anon` + `authenticated`) 65.6%, realtime 24.8%, `service_role` (Edge Functions) 4.0%.

### 1.3 Tables (public)

Sizes are total (heap + TOAST + indexes). Row counts are `pg_stat` estimates. Reads = seq + index scans; writes =
inserts / updates / deletes, all in the 16-day window. Classification is explained in section 2.

| Table | Size | Rows | Reads | Ins / Upd / Del | Dead | Class |
|---|---:|---:|---:|---|---:|---|
| `run_telemetry` | 140 MB | 415 | 7,020 | 174 / 0 / 0 | 2 | **SIMPLIFY** |
| `perf_runs` | 25 MB | 39 | 13 | 39 / 0 / 0 | 0 | **SIMPLIFY** |
| `versus_group_submissions` | 17 MB | 1743 | 16,081 | 1,743 / 4,501 / 0 | 282 | **RETIRE-after-CF** |
| `boards` | 10 MB | 5298 | 388,338 | 2,399 / 0 / 0 | 142 | **KEEP** |
| `practice_games` | 8552 kB | 13 | 75 | 13 / 0 / 0 | 0 | **SIMPLIFY** |
| `versus_submissions` | 6416 kB | 645 | 15,023 | 691 / 8,132 / 46 | 90 | **RETIRE-after-CF** |
| `lobby_fights` | 4280 kB | 13739 | 26,394 | 7,871 / 0 / 0 | 0 | **KEEP** |
| `versus_group_fights` | 3728 kB | 475 | 2,851 | 475 / 0 / 0 | 0 | **KEEP** (result history) |
| `run_history` | 2448 kB | 323 | 7,840 | 176 / 176 / 0 | 29 | **KEEP** |
| `bug_reports` | 2280 kB | 8 | 84 | 8 / 23 / 0 | 13 | **KEEP** |
| `versus_group_spectator_frames` | 2184 kB | 453 | 2,376 | 453 / 1,664 / 0 | 100 | **RETIRE-after-CF** |
| `versus_rounds` | 1752 kB | 303 | 13,793 | 324 / 0 / 21 | 21 | **KEEP** (result history) |
| `board_results` | 1088 kB | 4561 | 16,820 | 479 / 0 / 0 | 0 | **UNKNOWN** (writes retired 2026-10-14, still read at boot) |
| `versus_ranked_duos_served` | 912 kB | 36 | 972 | 36 / 0 / 0 | 0 | **RETIRE-after-CF** (verify the phase-4 port) |
| `progression_results` | 904 kB | 468 | 814 | 341 / 0 / 0 | 1 | **KEEP** |
| `achievement_progress` | 640 kB | 2806 | 43,224 | 1,778 / 8,022 / 0 | 156 | **KEEP** |
| `runs` | 552 kB | 143 | 21 | 72 / 0 / 0 | 29 | **KEEP** |
| `versus_spectator_frames` | 528 kB | 107 | 554 | 115 / 351 / 8 | 16 | **RETIRE-after-CF** |
| `versus_ranked_duos_fights` | 496 kB | 94 | 377 | 154 / 0 / 0 | 8 | **RETIRE-after-CF** (verify the phase-4 port) |
| `duo_run_rounds` | 464 kB | 50 | 43 | 50 / 0 / 0 | 0 | **KEEP** |
| `saved_runs` | 408 kB | 1 | 23,747 | 208 / 8,098 / 208 | 35 | **KEEP** |
| `lobby_live_games` | 384 kB | 1 | 71,574 | 193 / 14,747 / 191 | 29 | **KEEP** |
| `pool_runs` | 368 kB | 419 | 12,243,527 | 181 / 84,191 / 0 | 0 | **KEEP** (SIMPLIFY its triggers) |
| `loot_crates` | 320 kB | 466 | 89,533 | 230 / 210 / 2 | 102 | **KEEP** |
| `versus_group_rounds` | 280 kB | 455 | 22,953 | 485 / 0 / 0 | 30 | **KEEP** (result history) |
| `achievement_completions` | 280 kB | 912 | 829 | 470 / 0 / 0 | 9 | **KEEP** |
| `versus_group_seats` | 232 kB | 457 | 337,356 | 457 / 14,492 / 0 | 63 | **KEEP** (result history) |
| `rank_results` | 232 kB | 420 | 903 | 251 / 0 / 0 | 4 | **KEEP** |
| `player_cosmetics` | 168 kB | 477 | 300,557 | 238 / 223 / 2 | 52 | **KEEP** |
| `versus_group_seat_private` | 160 kB | 457 | 2,496 | 457 / 922 / 0 | 27 | **RETIRE-after-CF** |
| `profiles` | 160 kB | 58 | 213,397 | 42 / 6,750 / 0 | 50 | **KEEP** |
| `guides` | 152 kB | 1 | 91,804 | 1 / 1 / 0 | 1 | **KEEP** |
| `achievement_catalog` | 152 kB | 36 | 839 | 36 / 0 / 0 | 0 | **KEEP** |
| `aether_ledger` | 144 kB | 317 | 671 | 329 / 0 / 0 | 12 | **KEEP** |
| `versus_matches` | 144 kB | 88 | 139,078 | 92 / 3,066 / 4 | 56 | **KEEP** (result history; CF writes here) |
| `cosmetic_catalog` | 144 kB | 458 | 681,518 | 193 / 45 / 0 | 45 | **KEEP** |
| `client_crash_reports` | 144 kB | 11 | 10 | 12 / 0 / 1 | 1 | **KEEP** |
| `versus_members` | 136 kB | 0 | 586,584 | 757 / 80,479 / 756 | 43 | **RETIRE-after-CF** |
| `lobby_live_watchers` | 136 kB | 0 | 50,552 | 102 / 7,313 / 102 | 42 | **KEEP** |
| `versus_duos_passes` | 128 kB | 155 | 49,626 | 155 / 150 / 0 | 22 | **RETIRE-after-CF** |
| `versus_group_matches` | 120 kB | 119 | 162,423 | 119 / 5,815 / 0 | 60 | **KEEP** (result history; CF writes here) |
| `versus_group_teams` | 96 kB | 232 | 6,865 | 232 / 916 / 0 | 33 | **KEEP** (result history) |
| `achievement_hero_stats` | 88 kB | 215 | 641 | 152 / 165 / 0 | 6 | **KEEP** |
| `lobby_live_frames` | 88 kB | 0 | 1,074 | 62 / 677 / 62 | 20 | **KEEP** |
| `versus_seat_private` | 80 kB | 176 | 1,007 | 184 / 373 / 8 | 23 | **RETIRE-after-CF** |
| `versus_rooms` | 64 kB | 0 | 158,536 | 277 / 4,493 / 276 | 26 | **RETIRE-after-CF** |
| `friend_invites` | 64 kB | 7 | 2,231 | 8 / 7 / 1 | 8 | **KEEP** (leave the Realtime publication) |
| `player_presence` | 64 kB | 5 | 5,912 | 5 / 1,808 / 0 | 47 | **KEEP** |
| `spectate_presence` | 64 kB | 14 | 3,020 | 14 / 1,495 / 0 | 24 | **KEEP** |
| `spectate_sessions` | 64 kB | 53 | 3,059 | 53 / 1,456 / 0 | 10 | **KEEP** |
| `duo_runs` | 64 kB | 6 | 317 | 6 / 0 / 0 | 0 | **KEEP** |
| `cosmetic_loadouts` | 64 kB | 155 | 92,297 | 72 / 76 / 9 | 36 | **KEEP** |
| `player_titles` | 64 kB | 32 | 39 | 33 / 0 / 0 | 1 | **KEEP** |
| `versus_test_bots` | 56 kB | 35 | 459 | 35 / 249 / 0 | 33 | **RETIRE-after-CF** |
| `aether_wallets` | 56 kB | 58 | 44,256 | 68 / 329 / 0 | 47 | **KEEP** |
| `versus_housekeeping` | 56 kB | 1 | 618 | 1 / 95 / 0 | 44 | **RETIRE-after-CF** |
| `friendships` | 48 kB | 6 | 11,896 | 6 / 6 / 0 | 6 | **KEEP** |
| `duos_teams` | 48 kB | 3 | 3,692 | 3 / 1 / 0 | 1 | **KEEP** |
| `duos_team_ranks` | 40 kB | 3 | 285 | 3 / 6 / 0 | 6 | **KEEP** |
| `guide_reports` | 40 kB | 0 | 8 | 0 / 0 / 0 | 0 | **KEEP** |
| `versus_host_config` | 32 kB | 4 | 9 | 4 / 2 / 0 | 2 | **SIMPLIFY** (after the Supabase path is gone) |
| `aether_config` | 32 kB | 1 | 42,675 | 1 / 0 / 0 | 0 | **KEEP** |
| `cosmetic_categories` | 32 kB | 2 | 96,557 | 2 / 0 / 0 | 0 | **KEEP** |
| `tutorial_progression_claims` | 32 kB | 0 | 4 | 0 / 0 / 0 | 0 | **KEEP** |
| `friend_rate` | 32 kB | 10 | 29 | 14 / 0 / 4 | 4 | **KEEP** |
| `duos_rank_results` | 32 kB | 6 | 92 | 6 / 0 / 0 | 0 | **KEEP** |
| `progression_config` | 32 kB | 1 | 304,934 | 0 / 19 / 0 | 19 | **KEEP** |
| `versus_events` | 32 kB | 0 | 114 | 0 / 0 / 0 | 0 | **RETIRE-after-CF** |
| `versus_cf_writer_keys` | 32 kB | 2 | 2 | 2 / 0 / 0 | 0 | **KEEP** (while the Worker writes) |
| `rated_runs` | 24 kB | 0 | 4 | 0 / 0 / 0 | 0 | **RETIRE-now** |
| `guide_writes` | 24 kB | 2 | 8 | 2 / 0 / 0 | 0 | **KEEP** |
| `gauntlet_progress` | 24 kB | 2 | 5,616 | 2 / 2 / 0 | 2 | **KEEP** |
| `guide_team` | 24 kB | 2 | 3,989 | 2 / 0 / 0 | 0 | **KEEP** |
| `user_blocks` | 16 kB | 0 | 243 | 0 / 0 / 0 | 0 | **KEEP** |
| `guide_bookmarks` | 16 kB | 0 | 3,987 | 0 / 0 / 0 | 0 | **KEEP** |
| `guide_bookmark_log` | 8 kB | 0 | 6 | 0 / 0 / 0 | 0 | **KEEP** |

Plus one view, `run_fight_records` (`security_invoker = true`, aggregates ALL of `lobby_fights` per call: 1,052 calls,
mean 97 ms). Non-public schemas of note: `realtime.subscription` 19,164 inserts / 19,158 deletes (channel churn),
`cron.job_run_details` 591 rows (never purged).

Hot read patterns worth naming: `board_results` is read with `ORDER BY created_at DESC` and **has no index on it**
(16,458 seq scans reading 74M tuples); `versus_group_seats` 111,606 seq scans; `versus_members` 255,038 seq scans;
`guides` 87,813 seq scans (1 row, harmless); `aether_wallets` 43,823 seq scans.

### 1.4 Functions / RPCs

234 functions in `public` (232 names: `versus_create_room` and `versus_submit` each have a stale second overload).
173 are SECURITY DEFINER, all with `search_path=public` pinned (one adds `lock_timeout=2s`). 32 are executable by `anon`,
100 by `authenticated` (the rest are revoked from both: internal helpers, triggers, service-role writers).

| Family | Functions | After the CF cutover |
|---|---:|---|
| Versus 1v1 + rooms (`versus_*`, `versus__*`) | 60 | RETIRE |
| Versus Group (`versus_group*`) | 31 | RETIRE |
| Versus Ranked Duos live (`versus_ranked_duos*`) | 15 | RETIRE (after the phase-4 port), keep `__record_run`'s writes if the Worker calls them |
| Versus Duos (`versus_duos*`) | 10 | RETIRE |
| Versus dev/test (`versus_dev_*`, `versus_test_bot_register`) | 5 | RETIRE |
| Versus kept: `versus_cf_persist`, `versus_records`, `versus_host_config`, `versus_sweep` | 4 | keep the first three; `versus_sweep` retires with the cron |
| Progression / cosmetics / Aether / achievements / gauntlet | 31 | KEEP (SIMPLIFY: 20 versions of `settle_progression`) |
| Friends (`friends_*`, `friends__*`) | 23 | KEEP |
| Opponent pool + strength (`pool_*`, `board_strength_*`, `run_strength_histogram`) | 19 | KEEP, SIMPLIFY (sections 3.2, 4) |
| Guides | 13 | KEEP |
| Ranked Duos team + rating (`duos_*`, `duo_runs_sample`, `settle_duos_rank`) | 9 | KEEP |
| Live Games / spectate (`lobby_live_*`, `spectate_beat`) | 9 | KEEP |
| Rating (`settle_rank`, `rank_*_json`) | 3 | KEEP |
| Cloud saves (`put_saved_run`, `clear_saved_run`) | 2 | KEEP |

Busiest and slowest RPCs (16 days):

| RPC | Callers | Calls | Mean | Max | Total | Note |
|---|---|---:|---:|---:|---:|---|
| `pool_runs_sample` | `remoteBoards.poolApi` (anon 1,378 + authenticated) | 3,872 | 496 ms | 7.8 s | 1,920 s | 3.45 MB/answer, 13 GB temp spill |
| `versus_heartbeat` | `versusStore` every 4 s | 79,242 | 21 ms | 7.6 s | 1,679 s | retires |
| `versus_group_reconcile` | `versusStore` | 46,079 | 36 ms | 7.7 s | 1,670 s | retires |
| `board_strength_histogram` | `remoteBoards.strengthHistogram` | 7,053 | 133 ms | 6.1 s | 940 s | GROUP BY over all boards; changes only on insert |
| `put_saved_run` | cloud Continue, every save | 8,548 | 68 ms | 6.5 s | 577 s | 285 MB dirtied |
| `versus_list_rooms` | Versus menu | 7,618 | 48 ms | 7.5 s | 364 s | retires (prunes inside) |
| `versus_group_submit` | Versus | 6,200 | 57 ms | 7.8 s | 355 s | retires |
| `lobby_live_heartbeat` | `livePublisher` | 14,635 | 21 ms | 7.5 s | 303 s | KEEP; 25 GB buffer hits |
| `settle_progression` | `submit-progression` Edge Function | 385 | 645 ms | 7.2 s | 248 s | 20 redefinitions |
| `versus_duos_commit_round` | `versus-resolve` | 796 | 216 ms | 7.3 s | 172 s | retires |
| `versus_open_rooms` | `menuPoll` (45 s) | 8,629 | 20 ms | 4.0 s | 169 s | retires |
| `friends_beat` | `friendsStore` | 1,814 | 86 ms | 5.2 s | 156 s | KEEP |
| `versus_records` | room cards | 2,322 | 56 ms | 5.0 s | 130 s | KEEP |
| `settle_rank` | `submit-rating` | 268 | 359 ms | 7.3 s | 96 s | KEEP |
| `run_strength_histogram` | `remoteBoards.runStrengthHistogram` | 3,742 | 27 ms | 3.2 s | 101 s | cacheable |
| `versus_group_unpause` | Versus | 56 | 1,000 ms | 5.8 s | 56 s | retires |
| `versus_ranked_duos_seat` | `versus-resolve` | 17 | 1,132 ms | 6.7 s | 19 s | retires |

Client-callable functions with **zero calls in the window** (candidates to confirm dead or rare): `duos_leaderboard`,
`friends_block` / `_unblock` / `_cancel` / `_remove` / `_invite_respond` / `_invite_cancel` (friends shipped today),
`versus_ranked_duos_submit`, `versus_ranked_duos_reconcile`, `versus_request_resume`, `versus_set_friends_only`,
`versus_unready`, `versus_group_unready`, `versus_unpause`, `versus_dev_set_vitals`, `versus_dev_skip_shop`.

PostgREST overhead worth knowing: `SELECT name FROM pg_timezone_names` ran 433 times at 680 ms mean (294 s): that is
PostgREST reloading its schema cache, once per DDL/`NOTIFY pgrst` (every migration run). It disappears as migration churn
does.

### 1.5 Triggers (public, 21)

| Table | Trigger | Function | Class |
|---|---|---|---|
| `boards` | `pool_runs_boards_insert/update/delete` (statement-level, AFTER) | `pool_runs_after_boards_*` -> `pool_runs_upsert_from` | **SIMPLIFY**: catches all errors as a WARNING; runs inside the upload |
| `boards` | `pool_strength_boards_insert/update` | `pool_strength_after_boards` -> `pool_strength_refresh` | **SIMPLIFY**: full refresh of every pool run when any run is >10 min stale; swallows errors |
| `achievement_completions`, `achievement_progress` | `*_collection_guard` (BEFORE) | `achievement_collection_guard` | KEEP |
| `guide_bookmarks` | `guide_bookmarks_count` | `guide_bookmark_counted` | KEEP |
| `loot_crates` | `loot_crates_transition_guard` (BEFORE) | same | KEEP |
| `player_cosmetics` | `player_cosmetics_collections`, `player_cosmetics_mirror_titles` | same | KEEP |
| `profiles` | `profiles_aether_launch_grant`; `profiles_progression_guard` (BEFORE) | same | KEEP |
| `progression_results` | `progression_results_immutable` (BEFORE); `versus_dev_no_xp` (BEFORE) | same; `versus_dev__no_xp` | KEEP; `versus_dev_no_xp` RETIRE-after-CF |
| `versus_matches`, `versus_group_matches` | `*_phase_watch` (BEFORE) | `versus__phase_watch` | RETIRE-after-CF (CF rows arrive complete) |
| `versus_group_seats` | `versus_group_seat_out_to_stands` | `versus_group__seat_out_to_stands` | RETIRE-after-CF |
| `versus_submissions`, `versus_group_submissions` | `*_raise_armor` | `versus*__raise_reported_armor` | RETIRE-after-CF |
| `versus_rounds` | `versus_rounds_scouts` (BEFORE) | `versus__round_scouts` | check: `versus_cf_persist` round rows may still rely on it |

### 1.6 Realtime publications

`supabase_realtime`: `friend_invites`, `versus_duos_passes`, `versus_group_matches`, `versus_group_rounds`,
`versus_group_teams`, `versus_matches`, `versus_members`, `versus_rooms`, `versus_rounds` (9 tables). Live Games and
the Versus frame relays use **Broadcast** (no WAL cost). The WAL poller (`SELECT wal->>...`) runs as long as ANY
Postgres Changes subscription exists, which is why it is 25% of DB time with this little traffic.
`supabase_realtime_messages_publication` holds the daily `realtime.messages_*` partitions (platform-managed).

### 1.7 pg_cron

| Job | Schedule | Runs (window) | Avg / max | Class |
|---|---|---:|---|---|
| `versus-sweep` (`select public.versus_sweep()`) | `*/2 * * * *` | 112 | 37 ms / 278 ms | RETIRE-after-CF |
| (deleted job id 1, most likely the Ranked Duos abandon sweep) | was every 2 min | 479 | 41 ms / 10 s; **1 failure "job startup timeout" today 12:50 UTC** | gone; its history rows remain |

`cron.job_run_details` is never purged (591 rows now; it grows ~700 rows a day while a 2-minute job runs).

### 1.8 Edge Functions (7 deployed = 7 in the repo)

| Function | Version | `verify_jwt` | DB work it drives | Class |
|---|---:|---|---|---|
| `versus-resolve` | 52 | false (verifies inside) | `versus_*commit_round`, `versus_ranked_duos_*` | RETIRE-after-CF (all four modes) |
| `submit-progression` | 18 | true | `settle_progression` (385 calls, 645 ms mean) | KEEP |
| `progression-inventory` | 53 | true | `open_crate`, `equip_*`, `buy_crate` | KEEP |
| `submit-rating` | 5 | true | `settle_rank` (268 calls) | KEEP |
| `gauntlet-clear` | 3 | true | `record_gauntlet_clear` | KEEP |
| `guide-write` | 1 | true | `guide_*` | KEEP |
| `submit-bug-report` | 1 | true | `bug_reports` | KEEP |

There is no record of WHICH commit each deployed version came from. The CLI exposes each version's `ezbr_sha256`; the
ledger in section 5 should store it next to the commit.

### 1.9 RLS, grants, indexes

- Every public table has RLS enabled except the view `run_fight_records` (security invoker, so `lobby_fights`' RLS
  applies). 15 tables have RLS on and **no policy** (deny-all to clients, written by SECURITY DEFINER code): fine.
- **Grants:** on 58 of 76 tables `anon` and `authenticated` hold the Supabase defaults (SELECT, INSERT, UPDATE,
  DELETE, TRUNCATE, REFERENCES, TRIGGER). RLS is the only guard. Only the newer tables (friends, guides, presence,
  `saved_runs`, `versus_host_config`, `versus_cf_writer_keys`, ...) were revoked down to what clients use.
- **Indexes:** 154 indexes, 7.2 MB in total: no bloat problem. Unused (0-4 scans in 16 days, non-unique):
  `boards_patch_wave_power` (304 kB), `board_results_board_round`, `boards_user`, `perf_runs_patch`,
  `run_telemetry_content_rev` / `_set` / `_player_key`, `runs_result_created`, `duo_runs_sample`, `guides_sets`, the
  guide moderation indexes (tiny tables, keep). **Missing:** `board_results (created_at desc, id desc)` (or retire the
  read), and an idempotency key on `boards` / `run_history` / `run_telemetry` (section 4).
- **Dead tuples / bloat:** negligible everywhere (largest: `versus_group_submissions` 282). Autovacuum keeps up.

## 2. Classification rules

- **KEEP**: live data the game reads or writes after the cutover.
- **SIMPLIFY**: keep, but trim payload, move work off the hot path, or add retention.
- **RETIRE-after-CF**: the live-Versus server (rooms, presence, submissions, private rows, spectator frames, passes,
  housekeeping, sweep, the Postgres Changes publication entries, `versus-resolve`). Result tables
  (`versus_matches`, `versus_rounds`, `versus_group_matches/seats/teams/rounds/fights`) stay: XP, room-card records,
  Previous match and Career read them, and the Worker writes them through `versus_cf_persist`.
- **RETIRE-now**: dead today with no reader or writer: `rated_runs` (0 rows, no function, Edge Function or package
  references it; `rank_results` replaced it).
- **UNKNOWN (owner)**: `board_results` (writes retired 2026-10-14 by R-LEDGER-01, but every boot still reads it:
  17,113 reads, ~250 KB per full read, seq scans); `perf_runs` (25 MB dev tool, readable by everyone);
  `practice_games` replays (8.5 MB for 13 rows); `versus_ranked_duos_served` / `_fights` (depends on how phase 4 ports
  Ranked Duos); `run_telemetry` replay retention.

## 3. Hot spots

### 3.1 Egress drivers (16-day window, uncompressed JSON; Realtime and Edge Function egress not included)

PostgREST answers are measured here as the JSON the client receives. Whether the billed number is lower depends on
response compression at Supabase's edge; the dashboard's Usage -> Egress per-service split is the check (step 0.1).

| Driver | Calls | Bytes per call | 16 days | Fix |
|---|---:|---:|---:|---|
| `pool_runs_sample` (150 whole runs) | 3,872 | ~3.45 MB | **~13.4 GB** | delta cache (3.1a) |
| `cosmetic_catalog` full list | 87,675 | 33.8 KB | **~3.0 GB** | auth fan-out dedupe + hash cache (3.1b) |
| Career detail (`run_history` 50 x full `entry`) | 3,152 | up to ~630 KB (12.7 KB an entry) | **~2.0 GB** | light select, detail on open (3.1c) |
| `board_results` full read (frozen table) | 15,304 pages | <= 55 KB | ~0.8 GB | cache forever / retire (3.1d) |
| Versus RPC answers (heartbeat, reconcile, list) | ~200k | ~1-3 KB | ~0.4 GB | retires |
| `loot_crates` x2, `player_cosmetics` x2, `profiles`, `guides`, `progression_config` x4 | ~87k each | 0.1-4 KB | ~0.6 GB | auth fan-out dedupe (3.1b) |
| `run_telemetry` feeds (recent games, balance, career probe) | ~2,800 | ~80-160 KB | ~0.3 GB | already incremental for recent games |
| **Total measured** | | | **~20 GB / 16 days (~38 GB / month)** | |

**3.1a Opponent pool: a delta cache that serves the same runs.** Today every session start and every between-runs
refresh (`refreshOpponentPoolAndRecords`, 4 s after a run) downloads 150 complete runs. Proposal: the server keeps
choosing the sample exactly as now (same uniform draw, same band/cap/exclude filters, same `p_seed`), but a new RPC
`pool_runs_sample_keys` returns only `run_key`, strengths and a per-run content hash (`pool_runs.updated_at` or a hash of
the board ids); the client fetches only the runs its IndexedDB cache lacks (`pool_runs_boards(keys[])`) and serves from
the cache. Same runs, same boards, no serving change: but it touches the opponent-serving path, which carries the owner
bar in `snapshot-serving-integrity` (exact runs on exact turns), so it needs an explicit go-ahead. Expected: ~13.4 GB ->
~0.1-0.4 GB per 16 days (each device downloads each new run once: ~170 new eligible runs per 16 days x 24 KB). Interim
zero-risk step: `set work_mem = '16MB'` on the function itself, which removes the 13 GB temp spill and most of its
latency without changing its answer.

**3.1b The auth fan-out.** `initAccounts` (store.ts) wires `supabaseAuthProvider.onChange`, which Supabase fires on
SIGNED_IN, TOKEN_REFRESHED and USER_UPDATED (and, in supabase-js v2, very likely again when a hidden tab becomes visible: that is the only way to reach ~5,400 probes a day with this few players; confirm with a console counter in PR 1.1). Each fire runs `probeProgression` (catalog,
`progression_config` x4, own profile, seen list, crates x2, achievements, Aether), `loadGuides`, `flushUploadQueue`,
`flushPendingRanks`, `flushBugReportQueue`, and for real accounts `syncCloudAtTitle`, `syncProfileFromServer` and
`claimHandle` (an UPDATE on `profiles`). Fix (client only):
1. Run the fan-out only when `(userId, anonymous)` actually changes; a token refresh does nothing.
2. Read `progression_config` once (one row, all four columns) instead of four single-column requests.
3. Send `cosmetic_catalog` only when it changed: `sync_cosmetic_catalog` already receives a catalog hash; expose it on
   `progression_config` and cache the list in IndexedDB keyed by that hash.
4. `claimHandle` writes only when the handle/email actually differs (today: 5,551 profile UPDATEs for 58 profiles).
Expected: ~1M fewer requests and ~3.5 GB less egress per 16 days.

**3.1c Career.** `fetchCareer` reads the light rows (`CAREER_LIGHT_SELECT`, up to 1,000) AND 50 full `entry` blobs
(12.7 KB each, p90 15 KB) on every open. Read the detail lazily (the row the player expands) or project only the detail
fields the page draws.

**3.1d `board_results`.** The table is frozen (no writes since R-LEDGER-01, 2026-10-14), yet every boot re-reads it
(`fetchAndRegisterBoardRecords`). Either cache it once forever (it cannot change) or retire the reader. Owner call:
does anything still need those records?

### 3.2 Slow queries and their fixes

| Query | Symptom | Fix |
|---|---|---|
| `INSERT boards` (1,350 ms mean, 7.7 s max) | Statement triggers run `pool_runs_upsert_from` and `pool_strength_refresh` inside the upload. The strength trigger does a FULL refresh of every pool run whenever any run's `strength_at` is >10 min old (true after any quiet spell), i.e. UPDATEs up to all 419 `pool_runs` rows per upload (84,191 updates from 2,399 inserts). | Make the insert cheap: the triggers only enqueue the touched run keys into a `pool_dirty` table; a pg_cron job every minute runs one `pool_runs_upsert_from` + `pool_strength_refresh(keys)` for the batch, and the nightly job does the full rank refresh. Errors go to the ops log (section 4.3), not `raise warning`. |
| `pool_runs_sample` (496 ms mean, 13 GB temp) | `jsonb_agg(x.snapshot order by ...)` per picked run spills with `work_mem` 2 MB; the correlated subquery matches boards by `coalesce(author,'anon'), hero_id, seed` | `set work_mem` on the function; then 3.1a. Long term: store `pool_run_id` on `boards` at insert so the join is an index lookup. |
| `board_strength_histogram` (133 ms x 7,053; 109 GB buffer hits) | GROUP BY over every board of a strength ref on each call; the answer changes only when boards arrive | Materialize into `board_strength_hist` (refreshed by the same per-minute job), RPC reads it; client caches by a version number. Same for `run_strength_histogram`. |
| `INSERT run_telemetry` (667 ms mean, 7.5 s max) | ~300 KB replay jsonb compressed into TOAST inside the request | Retention or Storage for replays (section 3.5); keep the insert, drop the fallback ladder. |
| `run_telemetry` `replay->>seed` (294 calls, 115 ms) | detoasts a 300 KB replay to read a seed | read `tp_seed` (the column already exists) |
| `board_results` order by `created_at` | seq scan of 4,561 rows per page | retire the read (3.1d) or add the index |
| `run_fight_records` (97 ms) | view aggregates all of `lobby_fights` per call | fine at 13.7k rows; materialize if it grows 10x |
| `settle_progression` (645 ms), `settle_rank` (359 ms) | big plpgsql writers on Micro | measure again after the load drops; no action yet |
| PostgREST schema reload (680 ms x 433) | every migration run | fewer, batched migrations (section 5) |

### 3.3 Deadlocks

57 since 2026-10-12. Known source fixed 2026-10-26 (heartbeat vs leave lock order, `2026-10-26-versus-lock-order.sql`).
Remaining candidates: (1) the live Versus RPCs (retire); (2) concurrent board uploads whose statement triggers UPDATE
overlapping `pool_runs` sets in no fixed order (fixed by the dirty-queue change in 3.2). `log_lock_waits` is already on,
so the dashboard Logs Explorer ("deadlock detected", with both statements) can attribute each one: do that once before
3.2 ships, and add a daily snapshot of `pg_stat_database.deadlocks` to the ops metrics so the trend is visible.

### 3.4 Connections and Micro headroom

Connections are not the constraint (29 of 60, PostgREST holds a small pool). The constraint is burst I/O and CPU on a
shared 2-core Micro: unrelated cheap statements all hit ~7.5 s maxima at the same moments, which points at whole-box
stalls (temp-file writes, realtime polling churn, a full strength refresh) rather than slow SQL. After the cutover and
section 3.2 the steady load drops by roughly half (Versus 28% + realtime 25% of DB time) and the 13 GB spill goes, so
Micro should have comfortable headroom. Re-measure with a stats reset (`pg_stat_statements_reset()`) after each phase.

### 3.5 Database size

`run_telemetry` is 140 MB of 254 MB, 126 MB of it the `replay` column (~305 KB compressed per run). New rows arrive at
~171 per 16 days (~100 MB/month). Options (owner call: replays power Recent Games, Live Games playback and the Balance
Report's derived streams):
- keep `replay` for 30 days (or the newest N per player), null it afterwards; `derived` (20 KB) stays forever, or
- move replays to Storage (1 GB on Free, 100 GB on Pro) as gzip objects named by row id; the row keeps a pointer.
`perf_runs` (25 MB, 39 rows, ~218 KB each) and `practice_games` (8.5 MB, 13 rows) need the same rule. Dropping the
retired Versus tables frees ~30 MB.

## 4. Reliability: the write paths

### 4.1 Current state

| Write | Path | Idempotent? | Retries? | Failure handling | Verdict |
|---|---|---|---|---|---|
| Rating settle | durable `ascent.rankqueue` -> `submit-rating` -> `settle_rank` | yes (`rank_results` per user+run) | yes: boot, `online`, identity, Retry | kept until confirmed or rejected | **good: the model** |
| XP / progression | durable progression queue with backoff -> `submit-progression` -> `settle_progression` | yes (`progression_results` immutable) | yes | kept until confirmed or rejected | **good** |
| Cloud saves | `put_saved_run(p_expected)` compare-and-swap | yes (revision) | next save | conflict surfaced | good |
| Snapshots (`boards`) | `uploadBoards`, fire-and-forget | **no** key | **no** (queued only when there is no session; the queue clears up front and drops failed items) | errors swallowed; **any** error walks a schema ladder that drops `strength_*` then `unrated` | **silent drops + silent downgrades** |
| Pool index (`pool_runs`) | statement triggers on `boards` | yes (upsert) | no | `exception when others then raise warning` | **silent**; repaired only by a manual `pool_runs_rebuild()` |
| Telemetry (`run_telemetry`) | `uploadRunTelemetry`, 6-rung ladder | no key | no | swallowed; any error downgrades the row | **silent drops + downgrades** (10 downgraded rows in the window) |
| Career (`run_history`) | `uploadRunHistory` | **no** key (a retry would duplicate) | no | swallowed | silent drop |
| Fight ledger (`lobby_fights`) | `recordLobbyFights` upsert, unique key, `ignoreDuplicates` | yes | no | swallowed | silent drop |
| Victory (`runs`) | `uploadVictory`, 2-rung ladder | no key | no | swallowed | silent drop |
| Versus results (CF) | Worker outbox -> `versus_cf_persist`, upsert by primary key | yes | yes, exponential backoff, in order | logged in the Worker | good; check that one permanently rejected job cannot block the outbox forever |
| Ranked Duos results | inside `versus_ranked_duos_commit_round` today | atomic with the commit | n/a | n/a | good; re-check in the phase-4 port |
| Live Games | heartbeat + broadcast frames | n/a (ephemeral) | next beat | lossy by design | fine |

Two facts make the drops worse than they look: `pg_stat_statements` records only statements that SUCCEED, so the
first-rung failures (8 s timeouts, deadlock victims) are invisible; and the inserts that fail are exactly the slow ones,
the board uploads that run the strength refresh.

### 4.2 Fixes ("no silent drops")

1. **One durable outbox for every run-end write** (boards, telemetry, history, fights, victory), modelled on
   `rankSubmission.ts`: written to storage first, account-bound, flushed oldest-first, removed only on success or a
   permanent rejection, retried with backoff on boot / `online` / identity / a timer. The generic `ascent.uploadqueue`
   (clears up front, drops failures, forces UNRATED) goes away. An item that was played rated stays rated.
2. **Idempotency keys** so retries are safe: unique `(user_id, (snapshot->>'id'))` on `boards` (the board id already
   rides in the snapshot), unique run key on `run_telemetry` and `run_history` (`user_id, entry->>'seed'` or an explicit
   `run_key` column), inserts with `on conflict do nothing`. Check existing duplicates before adding each index.
3. **Delete the schema fallback ladders.** Every column they step around exists in production now; keep the ladders
   only as an explicit "column missing" (`42703` / `PGRST204`) check, never on a timeout or 5xx.
4. **Get the expensive work off the request** (3.2): a board insert becomes a plain insert plus a dirty-key enqueue.
5. **Trigger errors are recorded, not warned** (4.3).

### 4.3 A failure log

`ops.events (at, source, kind, key, detail jsonb)` written by: the pool/strength jobs on error; a rate-limited
`report_write_failure(kind, key, error)` RPC the outbox calls when an item is permanently rejected or exceeds N
attempts; pg_cron job failures (copied from `cron.job_run_details`). A daily read-only digest (one query, run by the lead
or a scheduled task) lists anything new. `client_crash_reports` is the precedent for a client-written ops table.

## 5. Migration hygiene

### 5.1 What exists

- `schema.sql` (12,889 lines) is a concatenation of the history, and `supabase/migrations/` holds 92 date-named files
  (several dated in November, written in October). Nothing records which were applied, when, or in what order: the
  `supabase_migrations` schema does not exist (files are pasted or run with `db query`).
- 529 `create function` statements for 234 functions. The worst: `settle_progression` 20, `equip_cosmetic` 14,
  `open_crate` 12, `settle_rank` 10, `pool_strength_refresh` 10, `pool_runs_sample` 10.
- The drift check prototype (normalize comments and whitespace on both sides, compare md5 of every live body against
  every repo definition): **229 / 234 equal the last definition in filename order, 5 equal an earlier one, 0 unknown.**
  Live bodies have their `--` comments stripped (the way they were applied), so a raw byte compare reports false drift.
- Apply order is not filename order: `2026-10-25-versus-duos-random-order.sql` was applied after
  `2026-10-25-versus-duos.sql`; `lobby-strength-bonus-floor` after `lobby-strength-going-in`. Replaying the folder in
  name order would regress `settle_rank`'s bonus floor (50 -> 30) and `versus_group__open_shop`.

### 5.2 Proposal

1. **A ledger first (additive, now).** `ops.schema_ledger (file, sha256, applied_at, applied_by, note)`, and an
   `npm run db:apply -- <file>` wrapper that runs the file through the CLI and records the row. Backfill one row per
   existing file marked `pre-ledger (verified by drift check 2026-10-28)`. From then on, "is it applied?" is a query.
   Record Edge Function deploys the same way (`ops.function_deploys (slug, version, ezbr_sha256, commit)`), written by
   the deploy scripts.
2. **A drift check script (read-only, now).** `npm run db:drift`: pulls live `pg_proc` bodies (plus triggers, policies,
   grants, publication tables and cron jobs) and compares them to the repo's latest definitions with the normalization
   above; exits non-zero and names each mismatch. Run before and after every apply, and nightly from a scheduled task.
   The prototype is ~60 lines of Node (it produced the numbers in 5.1).
3. **Squash into a baseline AFTER the Versus retirement** (so the baseline never contains the dead server):
   - `pg_dump --schema-only --schema=public --no-owner` from production (plus the `cron.job` rows, publication, grants
     and default privileges) into `supabase/baseline/<date>-baseline.sql`.
   - Prove it: restore into a local `supabase start` database and run `db:drift` against BOTH local and production:
     the two must be identical.
   - Move `schema.sql` and the 92 files into `supabase/archive/` (history, never run again) with a README saying so.
   - New migrations: `supabase/migrations/<YYYYMMDDHHMMSS>_<slug>.sql`, where name order IS apply order, each one
     idempotent, applied only through `db:apply`.
   - Production is never re-run from the baseline: squashing is a repo operation; the ledger marks the baseline as
     "matches production at <date>". Risk to production: none.

## 6. Security pass

| # | Finding | Severity | Fix |
|---|---|---|---|
| S1 | `boards` policy `anon insert` (`to anon with check (true)`) plus `anon read`: any holder of the public key, with no session, can insert boards with any `user_id`, `author`, strength or snapshot, and the triggers feed them into `pool_runs` (opponent pool + strength ranks). No anon insert happened in the window (all inserts are `authenticated`). | **High** | drop the policy; revoke INSERT from `anon` |
| S2 | No-session `anon` can SELECT `run_telemetry` (140 MB incl. replays, `user_id`, `author`), `boards`, `lobby_fights`, `practice_games`, `runs`, `pool_runs`, `player_cosmetics`, `cosmetic_loadouts`, `board_results`. Not secret data, but a script with the public key can pull 140 MB in a loop and bill the egress. | Medium | restrict to `authenticated` (anonymous sign-in is still `authenticated`). The client calls `pool_runs_sample` as `anon` 1,378 times before its session lands: make those calls wait for the session first, then revoke. |
| S3 | Default grants: `anon`/`authenticated` hold INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES on 58 tables. RLS blocks every write today, and PostgREST cannot issue TRUNCATE, but a single permissive policy added later would open the table. | Medium | revoke TRUNCATE/TRIGGER/REFERENCES everywhere; revoke INSERT/UPDATE/DELETE on tables written only by SECURITY DEFINER code; `alter default privileges in schema public revoke ... from anon, authenticated` (incl. EXECUTE on functions) so new objects start closed. |
| S4 | 10 SECURITY DEFINER functions executable by `anon`: `versus_cf_persist` (intended: key-gated), `versus_host_config` (intended), `versus_records`, `versus_ranked_duos_reconcile` (its lock-free first look has no caller check before returning a match's JSON by id), `versus_ranked_duos_submit`, `versus_dev_set_vitals`, `versus_dev_skip_shop`, `versus_test_bot_register`, `duos_team_set_name`, `is_guide_team`. All the write ones check `auth.uid()` inside. | Low | revoke from `anon` where a session is required; most retire with Versus anyway |
| S5 | `search_path` on SECURITY DEFINER | none | all 173 pin `search_path=public` |
| S6 | Exposed columns: `profiles.email` is hidden by column grants (2026-09-29 migration); `profiles` table-level SELECT is not granted. | ok | re-verify after any `profiles` migration (add to `db:drift`) |
| S7 | `client_crash_reports` accepts anon inserts (`user_id is null`); `bug_reports` via Edge Function | Low | add a per-IP/day cap if it is ever abused |
| S8 | 2,476 anonymous auth users with no data; anonymous sign-in is open | Low | a periodic purge of anonymous users idle >30 days with no data (Auth admin API, owner approved); consider the auth rate limit for anonymous sign-ins |
| S9 | `versus-resolve` runs with `verify_jwt = false` (verifies the caller itself) | Low | retires with Versus |
| S10 | Dev/test surfaces in production: `versus_dev_*`, `versus_test_bots`, `versus_dev__no_xp` trigger | Low | retire with Versus; re-add dev ops only on a dev project |

## 7. Phased plan

Each phase is a few small PRs; each PR names its risk and rollback. "Agent-days" are build + verify for one builder.
Database PRs ship as migration files only; the lead applies them (owner rule) and records them in the ledger.

### Phase 0: measure and prove (now, zero risk)

| PR | What | Effort | Risk / rollback |
|---|---|---:|---|
| 0.1 | `scripts/supabase/audit.mjs`: the read-only measurement pack behind this doc (sizes, scans, statements, grants, policies, cron, publication), writing a dated report; take a per-service egress screenshot from the dashboard Usage page as the baseline | 0.5 | none |
| 0.2 | `scripts/supabase/drift.mjs` + `npm run db:drift` (section 5.2.2) | 0.5 | none (read-only) |
| 0.3 | Migration: `ops` schema, `ops.schema_ledger`, `ops.function_deploys`, `ops.events`, `ops.metrics` (daily deadlocks/temp/size via cron); `db:apply` wrapper; ledger backfill | 1 | additive; drop schema `ops` to roll back |

### Phase 1: egress and request churn, client only (now)

| PR | What | Saves (per 16 days) | Effort | Risk / rollback |
|---|---|---|---:|---|
| 1.1 | Auth fan-out runs only on identity change; one `progression_config` read; `claimHandle` writes only on change | ~1M requests, ~0.6 GB, 5.5k profile UPDATEs | 1 | low; revert |
| 1.2 | `cosmetic_catalog` cached by hash (needs a `catalog_hash` column on `progression_config`, written by `sync_cosmetic_catalog`) | ~3 GB | 1 | low; the client falls back to a full read when the hash is missing |
| 1.3 | Career: light rows + detail on demand | ~2 GB | 0.5 | low |
| 1.4 | `board_results`: cache forever or remove the boot read (owner call) | ~0.8 GB, 16k seq scans | 0.5 | low |
| 1.5 | `run_telemetry` seed reads use `tp_seed` | DB CPU | 0.25 | none |
| 1.6 | **Pool delta cache** (3.1a), behind a client flag. **Owner go-ahead required** (opponent serving path) | ~13 GB, 13 GB temp spill | 2 | medium; the flag returns to `pool_runs_sample` |

### Phase 2: database health (now; migrations, low to medium risk)

| PR | What | Effort | Risk / rollback |
|---|---|---:|---|
| 2.1 | `pool_runs_sample`: `set work_mem = '16MB'` (no answer change) | 0.25 | none; `reset work_mem` |
| 2.2 | Pool/strength off the insert path: dirty-key table + pg_cron every minute + nightly full rank; errors to `ops.events`. Pool freshness lag <= 1 min | 1.5 | medium; the migration keeps the old trigger definitions in a commented rollback block |
| 2.3 | Materialized strength histograms (`board_strength_hist`, `run_strength_hist`) refreshed by the same job | 1 | low; the RPC can fall back to the live GROUP BY |
| 2.4 | Durable run-end outbox + idempotency keys + remove the fallback ladders (section 4.2). Unique indexes only after a duplicate check on prod | 2.5 | medium; client flag back to the old fire-and-forget; indexes are additive |
| 2.5 | Ops failure log wiring + `report_write_failure` RPC + daily digest query | 1 | low |
| 2.6 | Retire-now: drop `rated_runs`; drop the never-used indexes listed in 1.9 that are not on tiny tables | 0.25 | low; recreate from the archive |

### Phase 3: security (now)

| PR | What | Effort | Risk / rollback |
|---|---|---:|---|
| 3.1 | Drop `boards` `anon insert` (S1) | 0.25 | none (no anon inserts happen); re-create policy |
| 3.2 | Client waits for its session before the first pool/strength read, then revoke `anon` SELECT on the heavy tables (S2) | 1 | medium for very old desktop builds that read before their session; ship the client first, revoke a release later |
| 3.3 | Grant hygiene: revoke TRUNCATE/TRIGGER/REFERENCES, revoke writes on RPC-only tables, default privileges closed, revoke `anon` EXECUTE where a session is needed (S3, S4) | 1 | low; every revoke has its grant in the rollback block; verify with the README's `has_table_privilege` probes |

### Phase 4: size and retention (now, owner calls)

| PR | What | Effort | Risk / rollback |
|---|---|---:|---|
| 4.1 | `run_telemetry.replay` retention or move to Storage (3.5). **Owner call** on the window and on what must stay replayable | 1.5 | medium (data removal): export before nulling; Storage move is reversible |
| 4.2 | `perf_runs` / `practice_games` retention; `cron.job_run_details` purge job | 0.5 | low |
| 4.3 | Anonymous-user purge (idle >30 days, no data). **Owner call** | 0.5 | medium: irreversible for those identities, but they own nothing |

### Phase 5: retire the Supabase Versus server (WAIT: after the cutover has run cleanly 1-2 weeks)

Gate, all of: every mode's `versus_host_config.host = 'cf'` for 14 days; zero new rows in `versus_rooms` for 14 days
(measurable: `n_tup_ins` and `max(created_at)`); no open Supabase match; the chaos harness green on CF; XP, records and
Career verified on CF rows. And one product decision first: **builds without a Worker URL are Supabase-only for Versus**,
so before the server goes, the oldest live desktop/zip build must either carry the Worker or be told to update. Add a
minimum-protocol refusal (`versus_create_room` / `versus_list_rooms` answer "Update your game to play Versus") one
release before Phase 5.

| PR | What | Effort | Risk / rollback |
|---|---|---:|---|
| 5.1 | Version gate for old builds (above) | 0.5 | low |
| 5.2 | Friend invites off Postgres Changes: Broadcast from `friends_invite` (or the existing `friends_beat` poll picks them up); remove `friend_invites` from the publication. Then no Postgres Changes subscriptions remain and the WAL poller stops (**-25% DB time**) | 1 | low; re-add the table to the publication |
| 5.3 | Remove the 8 Versus tables from `supabase_realtime`; unschedule `versus-sweep`; stop deploying `versus-resolve` (keep the last version deployed, unreferenced, for a week) | 0.5 | low; re-add / re-schedule |
| 5.4 | Step 1 of the drop: REVOKE EXECUTE on the ~120 live-Versus RPCs and rename the 12 live tables to `_retired_<name>` | 1 | low; re-grant and rename back |
| 5.5 | One week later, step 2: DROP those functions, tables, triggers, `versus_housekeeping`, `versus_test_bots`, the stale overloads; delete the `versus-resolve` function; keep result tables, `versus_records`, `settle_progression`'s Versus branch, `versus_cf_persist`, `versus_cf_writer_keys`, `versus_host_config` (until the router drops the Supabase host) | 1 | **high (destructive)**: export the dropped tables first (`pg_dump -t`); restore from the dump |
| 5.6 | Client: delete the Supabase Versus remote, the Realtime heal/re-open code and the router's Supabase branch | 1.5 | medium; ordinary code revert |

### Phase 6: migration baseline (after Phase 5)

| PR | What | Effort | Risk / rollback |
|---|---|---:|---|
| 6.1 | Baseline squash (5.2.3) with the local restore + double drift proof | 1.5 | none for production; the risk is a wrong baseline, removed by the proof |
| 6.2 | Timestamped migration naming + idempotency lint + `db:drift` nightly | 1 | none |

### Phase 7: plan decision (one month after Phase 5)

Re-run the Phase 0 audit and the dashboard egress split for a full 30 days, then decide (section 8).

**Total: ~25-28 agent-days across ~25 PRs.** Phases 0-4 can start now and run in parallel lanes (client egress, DB
health, security); Phase 5 waits for the cutover gate; Phase 6 waits for Phase 5.

## 8. Free plan after cleanup?

Free (as of this writing; re-check supabase.com/pricing before deciding): 500 MB database, 5 GB egress, 1 GB Storage,
50k monthly active users, 500k Edge Function invocations, 200 concurrent Realtime connections and 2M messages, the
smallest shared compute, **no automatic backups**, and a project pauses after a week of inactivity.

| Budget | Today (measured) | After Phases 1-5 (projected, same traffic) | Free limit |
|---|---|---|---|
| API egress | ~38 GB/month (uncompressed JSON) | ~1.5-2 GB/month: pool deltas ~0.2-0.8 GB, catalog/progression ~0.1 GB, Career light ~0.1 GB, everything else ~1 GB | 5 GB |
| Database | 254 MB, +~100 MB/month | ~120-150 MB steady (Versus live tables gone, replay retention, perf/practice pruned) | 500 MB |
| Realtime | Postgres Changes (Versus) + Broadcast | Broadcast only (Live Games, CF has its own sockets) | fits |
| Edge Functions | 7 functions, ~1-2k invocations/16 days excluding `versus-resolve` | 6 functions | fits |
| Compute | Micro, stalls at bursts | ~half the steady load, no 13 GB spill | smallest shared |

So **on the numbers, yes, at today's traffic**, with ~2.5x egress headroom. The reasons to stay on Pro are not usage:
(1) **backups**: ratings, medals, saves, Career and progression live here, and Free has no automatic backups (a nightly
`pg_dump` to Cloudflare R2 or similar would be required first); (2) the headroom vanishes with ~3x more active
players; (3) the smallest compute is weaker than Micro. Recommendation: stay on Pro until Phases 1-5 are done, measure
30 days, then decide with real numbers; if moving to Free, ship the off-site nightly backup first.

## 9. Open questions for the owner

1. **Pool delta cache (1.6):** OK to change HOW the sampled runs reach the client (same runs, same boards, served from a
   local cache)? It is the main egress fix.
2. **`board_results`:** still needed by anything? If not, remove the boot read and drop the table later.
3. **Replay retention (4.1):** how long must `run_telemetry` replays stay playable, and is Storage acceptable for older
   ones?
4. **Anonymous-user purge (4.3):** OK to delete anonymous users idle >30 days that own no data (2,476 today)?
5. **Old builds and Versus (5.1):** when Supabase Versus goes, old builds without a Worker lose Versus. OK to ship an
   "update to play Versus" refusal one release before?
6. **Free vs Pro (8):** decide after a 30-day measurement; Free needs an off-site backup first.

## Appendix: how the numbers were taken

All read-only, against production with `npx --yes supabase@2.120.0 db query --linked --project-ref zcwhbejpqcdcfdpfxeza
-f <file>`: `pg_stat_user_tables` / `pg_stat_user_indexes` (sizes, scans, tuples), `pg_stat_statements` (grouped by the
RPC or table name parsed from the PostgREST statement), `pg_stat_database`, `pg_settings`, `pg_roles.rolconfig`,
`pg_policy`, `information_schema.role_table_grants`, `has_function_privilege`, `pg_trigger`, `pg_publication_tables`,
`cron.job` / `cron.job_run_details`, `storage.buckets`, `auth.users` (counts only). Response sizes are
`octet_length(...::text)` of exactly the columns each client query selects (e.g. the pool size is the sum of every board
snapshot of each eligible run, x150). Function drift: md5 of `regexp_replace(regexp_replace(prosrc, '--[^\n]*', ''),
'[[:space:]]+', '')` per live function, compared with the same normalization of every `create function` body in
`schema.sql` and `supabase/migrations/*.sql`. Edge Functions: `supabase functions list`.
