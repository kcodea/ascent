-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- REPLAY FACTS: the small replay facts the Social screens list, precomputed once per row  (2026-10-09, perf)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent: safe to re-run. The same block is appended to schema.sql;
-- keep the two identical. Owner runbook + the measurements: docs/devlog/2026-10-09-menus-social-perf.md.
--
-- WHY (owner 2026-10-09: "our social tab takes forever to load and is also laggy"): the Career page, Recent Games and
-- the Practice tab list a few scalars that live INSIDE the replay jsonb (`replay->>seed`, `replay->v2->>version`, the
-- first and last frame clocks, the final board, the record ...). Each replay is hundreds of KB to a few MB, stored
-- compressed out of line, so EVERY list read decompressed and parsed every listed replay whole to pull a handful of
-- numbers out. Measured on live (anon reads): the Career probe took 0.6 to 3.3 s for one player's 90 runs and
-- sometimes hit the statement timeout (HTTP 500 at ~3.2 s); Recent Games 1 to 3.5 s for 20 rows; the practice list
-- 0.5 to 1.4 s for 20 rows. The same selects over plain columns take ~0.1 to 0.3 s.
--
-- WHAT: STORED generated columns (`tp_*`) holding exactly those facts. Postgres computes them once when a row is
-- written (and once for every existing row when this runs), so a list read never opens the replay again. The
-- expressions are the very JSON paths the client used to send, so the values are identical. Nothing writes them:
-- the client keeps inserting `replay` as before. The client asks for the `tp_*` columns first and, if they are
-- missing (this file not run yet), falls back to the old JSON-path selects for the rest of the session, so the
-- build works before and after.
--
-- COST: one rewrite of each table (run_telemetry ~220 rows, practice_games ~25 at the time of writing; seconds).
-- The ALTER holds a brief exclusive lock, so a run that finishes during it waits a moment to upload.

begin;

-- ── 1. run_telemetry: the Career probe + the Recent Games list ─────────────────────────────────────────────
alter table public.run_telemetry
  add column if not exists tp_seed           text  generated always as (replay ->> 'seed') stored,
  add column if not exists tp_v2_version     text  generated always as (replay -> 'v2' ->> 'version') stored,
  add column if not exists tp_first_t        text  generated always as (replay -> 'v2' -> 'frames' -> 0 ->> 'tMs') stored,
  add column if not exists tp_last_t         text  generated always as (replay -> 'v2' -> 'frames' -> -1 ->> 'tMs') stored,
  add column if not exists tp_active_ms      text  generated always as (replay -> 'v2' ->> 'activeMs') stored,
  add column if not exists tp_final_board    jsonb generated always as (replay -> 'v2' -> 'result' -> 'finalBoard') stored,
  add column if not exists tp_record         jsonb generated always as (replay -> 'v2' -> 'result' -> 'record') stored,
  add column if not exists tp_partial        text  generated always as (replay -> 'v2' ->> 'partial') stored,
  add column if not exists tp_first_wave     text  generated always as (replay -> 'v2' ->> 'firstRecordedWave') stored,
  add column if not exists tp_lobby_strength jsonb generated always as (replay -> 'v2' -> 'result' -> 'lobbyStrength') stored,
  add column if not exists tp_board_strength text  generated always as (replay -> 'v2' -> 'result' ->> 'boardStrength') stored;

-- The Career probe filters by player and sorts newest first (the existing `run_telemetry_user` index is user_id only).
create index if not exists run_telemetry_user_created on public.run_telemetry (user_id, created_at desc);

-- ── 2. practice_games: the Practice lists (Recent Games tab + the Career's Practice tab) ───────────────────
alter table public.practice_games
  add column if not exists tp_v2_version text  generated always as (replay -> 'v2' ->> 'version') stored,
  add column if not exists tp_match      jsonb generated always as (replay -> 'match') stored,
  add column if not exists tp_active_ms  text  generated always as (replay -> 'v2' ->> 'activeMs') stored;

create index if not exists practice_games_user_created on public.practice_games (user_id, created_at desc);

commit;

-- ── 3. Tell the REST API about the new columns ──────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';
