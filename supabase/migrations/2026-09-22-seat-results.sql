-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- SEAT LEDGER — the Hall of Champions record  (2026-09-22)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). The same block is appended to
-- schema.sql (the cumulative paste file) — keep the two identical. Owner runbook: the devlog
-- docs/devlog/2026-09-22-hall-of-champions-table-wins.md.
--
-- WHAT THIS IS. The Hall of Champions now ranks WINNING RUNS by the games they have won against other players
-- (owner 2026-09-22: "track the run that beat the player when they were knocked out … if i play a board that
-- wins on turn 14 and it knocks a player out on turn 9, that board should probably get a win. subsequently, if
-- that same board is served to a player and it comes in 3rd against the player on turn 13, my board should get
-- a loss recorded"). A finished run is served into other players' lobbies as a RECORDED SEAT (`run_key` =
-- author|heroId|seed, the key the client groups the opponent pool by). This table is one row per recorded seat
-- with a RESULT against the player it was served to: 'win' when it knocked that player out, 'loss' when it was
-- knocked out while that player still stood. A seat still standing when the player fell decided nothing and
-- writes no row. The Hall sums a run's own victory (its row in `runs`) with its wins here.
--
-- The client writes it at the end of every REAL lobby (never practice, the tutorial or a Scene Builder run),
-- from what the player's own run witnessed — nothing is simulated past the player's knockout. The unique key
-- makes the write idempotent: a run restored and finished twice cannot count a table twice (the client upserts
-- with ignoreDuplicates). Reads are public, like every other ledger; a player may only insert rows they own.
-- Additive and isolated — nothing else in the schema changes, and the game keeps working (every Hall run shows
-- 1–0) until this has been run.
create table if not exists public.seat_results (
  id                bigint generated always as identity primary key,
  user_id           uuid references auth.users(id) on delete set null,
  lobby_seed        bigint  not null,           -- the lobby (= the reporting run's seed); with run_key, the row's identity
  run_key           text    not null,           -- author|heroId|seed of the recorded run that drove the seat
  outcome           text    not null,           -- 'win' (knocked the reporting player out) | 'loss' (knocked out while they stood)
  round             int     not null,           -- the round it happened
  player_placement  int     not null,           -- where the reporting player finished (1-8), for context
  seats             int     not null default 8, -- seats at the table
  mode              text    not null default 'lobby',
  patch             text,                       -- build the lobby ran under
  created_at        timestamptz default now(),
  constraint seat_results_outcome check (outcome in ('win', 'loss')),
  constraint seat_results_one_per_table unique (lobby_seed, run_key)
);
create index if not exists seat_results_run_key on public.seat_results (run_key);

alter table public.seat_results enable row level security;
drop policy if exists "read seat_results"       on public.seat_results;
drop policy if exists "insert own seat_results" on public.seat_results;
create policy "read seat_results"       on public.seat_results for select using (true);
create policy "insert own seat_results" on public.seat_results for insert to authenticated with check (auth.uid() = user_id);
