-- ASCENT board backend — Supabase schema. Paste into the Supabase SQL Editor (New query → Run) once per
-- project. Idempotent (safe to re-run). See docs/board-backend.md for the full setup. The game runs fully
-- offline without this; the backend just adds a live shared opponent pool on top of the committed pool.

create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  patch       text not null,             -- "<version>+<git sha>", e.g. "0.1.0+82dd78b" — sort/filter/clear key
  wave        int  not null,
  hero_id     text not null,
  power       int  not null,             -- Σ(atk+hp), the strength index
  rating      real,                      -- wave-relative band rating (0..1), if known
  origin      text,                      -- self | friend | synthetic | house
  author      text,                      -- display name on the opponent frame
  tribes      text[],
  captured_at date,
  seed        bigint,
  snapshot    jsonb not null,            -- the full BoardSnapshot, verbatim (this is what's served back)
  created_at  timestamptz default now()
);

-- Serve "current patch by wave/power" fast; also the natural index for patch pruning.
create index if not exists boards_patch_wave_power on public.boards (patch, wave, power);

-- Row Level Security: ON. Friend-scale = allow anon (the publishable key) to read the pool + insert your boards.
-- No update/delete for anon: pruning stale patches is a dev op (dashboard or the SQL below). Hardening later =
-- server-side replay validation (a Worker re-derives boards from the uploaded replay) — see docs/board-pool.md.
alter table public.boards enable row level security;

drop policy if exists "anon read boards"   on public.boards;
drop policy if exists "anon insert boards"  on public.boards;
create policy "anon read boards"   on public.boards for select to anon using (true);
create policy "anon insert boards"  on public.boards for insert to anon with check (true);

-- ── runs — completed-run log for the leaderboard ("Hall of Champions") ─────────────────────────────────────
-- One row per completed VICTORY run (15 wins). `board` holds the final winning warband (shown on hover in the
-- leaderboard). Separate from `boards` (which feeds the opponent pool). The UI inserts only victories today;
-- the `result` column leaves room to log losses later (the tabled dev-tracker).
create table if not exists public.runs (
  id          uuid primary key default gen_random_uuid(),
  patch       text not null,
  hero_id     text not null,
  author      text,
  wave        int  not null,           -- the wave the run won at ("Survived all N waves")
  wins        int,
  result      text not null,           -- 'victory' (future: 'gameover')
  seed        bigint,
  board       jsonb,                   -- the final BoardSnapshot (winning warband) for the hover reveal
  history     text,                    -- per-round result spread: one char per round, 'W'|'L'|'D' (e.g. "LLWLWWW…")
  captured_at date,
  created_at  timestamptz default now()
);
create index if not exists runs_result_created on public.runs (result, created_at desc);

alter table public.runs enable row level security;
drop policy if exists "anon read runs"   on public.runs;
drop policy if exists "anon insert runs"  on public.runs;
create policy "anon read runs"   on public.runs for select to anon using (true);
create policy "anon insert runs"  on public.runs for insert to anon with check (true);

-- ── board_results — per-board fight ledger (win-tracking) ──────────────────────────────────────────────────
-- One row per combat fought AGAINST a served board, reported by the player who fought it (single reporter per
-- fight, since the opponent is a static snapshot). `outcome` is from the SERVED board's perspective — you lose
-- to it → 'win'. `board_id` is the client-stamped `BoardSnapshot.id` (also denormalized onto boards/runs below),
-- so the leaderboard (round-17 slots) and the Career per-round log both aggregate the same ledger. Friend-scale:
-- low write, aggregate-on-read over a bounded fetch. Hardening later = the same server-side replay validation.
-- This is the ONLY object win-tracking needs — a new, isolated table. The board's id travels inside the existing
-- boards/runs `snapshot`/`board` jsonb (BoardSnapshot.id), so NO changes to those tables are required and existing
-- uploads keep working unchanged whether or not you've run this yet.
create table if not exists public.board_results (
  id          bigint generated always as identity primary key,
  board_id    text not null,             -- the served BoardSnapshot.id this result is for
  round       int  not null,             -- the wave the fight happened at (1..17); leaderboard filters to 17
  outcome     text not null,             -- 'win' | 'loss' | 'tie', from the SERVED board's perspective
  patch       text,                      -- build the fight ran under (prune old patches like boards/runs)
  created_at  timestamptz default now()
);
create index if not exists board_results_board_round on public.board_results (board_id, round);

alter table public.board_results enable row level security;
drop policy if exists "anon read board_results"   on public.board_results;
drop policy if exists "anon insert board_results"  on public.board_results;
create policy "anon read board_results"   on public.board_results for select to anon using (true);
create policy "anon insert board_results"  on public.board_results for insert to anon with check (true);

-- ── profiles — the player Leaderboard (top players by rating / "MMR") ──────────────────────────────────────
-- One row per NAMED player, keyed by author (display name), UPSERTED on every finished Ascent run: their skill
-- rating (the "MMR" the leaderboard ranks by), total games played, and favorite hero (most-played, derived from
-- local history). Friend-scale trust model: anon may insert AND update (upsert overwrites your own slot by name).
-- Dormant until this runs — the game + all other uploads work unchanged whether or not you've migrated it.
create table if not exists public.profiles (
  author        text primary key,          -- display name (the leaderboard slot key)
  rating        int  not null default 0,   -- skill rating = the "MMR" the leaderboard ranks by
  games_played  int  not null default 0,   -- total finished Ascent runs (win or loss)
  favorite_hero text,                       -- hero id of the most-played hero
  patch         text,                       -- build of the last run that wrote this row
  updated_at    timestamptz not null default now()
);
create index if not exists profiles_rating on public.profiles (rating desc);

alter table public.profiles enable row level security;
drop policy if exists "anon read profiles"   on public.profiles;
drop policy if exists "anon insert profiles"  on public.profiles;
drop policy if exists "anon update profiles"  on public.profiles;
create policy "anon read profiles"   on public.profiles for select to anon using (true);
create policy "anon insert profiles"  on public.profiles for insert to anon with check (true);
create policy "anon update profiles"  on public.profiles for update to anon using (true) with check (true);

-- ── run_telemetry — the player Balance Report (offer / pick / win / avg) ───────────────────────────────────
-- One row per finished Ascent run: what the player was OFFERED + PICKED (heroes, quests, runes, shop cards) + the
-- outcome, reconstructed from the run's replay at run-end. The in-app Balance Report fetches recent rows and
-- aggregates them client-side. Append-only (insert + read for anon); dormant until this runs. `quest_turns` maps a
-- completed quest id → the wave it finished on (for "avg turns to complete").
create table if not exists public.run_telemetry (
  id             bigint generated always as identity primary key,
  patch          text,
  author         text,
  hero_id        text not null,             -- the hero the player picked
  hero_offer     text[],                    -- the 3 heroes the picker offered
  won            boolean not null default false,
  wins           int not null default 0,    -- scored wins over the course
  offered_quests text[],
  picked_quests  text[],
  quest_turns    jsonb,                      -- { questId: completionWave }
  offered_runes  text[],
  picked_runes   text[],
  offered_cards  text[],                     -- every card seen in the shop this run
  bought_cards   text[],                     -- cards bought from the shop
  created_at     timestamptz not null default now()
);
create index if not exists run_telemetry_created on public.run_telemetry (created_at desc);

alter table public.run_telemetry enable row level security;
drop policy if exists "anon read run_telemetry"   on public.run_telemetry;
drop policy if exists "anon insert run_telemetry"  on public.run_telemetry;
create policy "anon read run_telemetry"   on public.run_telemetry for select to anon using (true);
create policy "anon insert run_telemetry"  on public.run_telemetry for insert to anon with check (true);

-- ── Maintenance (run by hand in the SQL Editor when needed) ────────────────────────────────────────────────
-- Clear everything EXCEPT the current patch (the "regenerate per balance patch" op):
--   delete from public.boards where patch not like '0.1.0+%';
-- Clear one stale build:
--   delete from public.boards where patch = '0.1.0+oldsha';
-- Remove the connectivity test row created during setup:
--   delete from public.boards where patch = '__conntest__';
-- Migration for an EXISTING project — add the per-round spread column to the leaderboard (safe to re-run;
-- old rows keep a null history and simply show no spread until a fresh victory is logged):
--   alter table public.runs add column if not exists history text;
