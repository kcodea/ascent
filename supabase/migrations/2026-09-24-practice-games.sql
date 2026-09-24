-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- PRACTICE GAMES — the Recent Games "Practice" tab  (2026-09-24)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). The same block is appended to
-- schema.sql (the cumulative paste file); keep the two identical. Owner runbook: the devlog
-- docs/devlog/2026-09-24-leaderboard-rank-practice-tab.md.
--
-- WHAT THIS IS. Owner ask 2026-09-24: "can we add a practice tab to recent games, which shows the latest practice
-- mode games played?" Practice runs upload nothing to the ladder tables (run_telemetry, run_history, boards,
-- the fight ledger, ranks) and that stays true, so the Balance Report, the Hall and the Career never see a
-- practice game. This is a separate table: one LIGHT row per finished practice game (who, hero, placement,
-- record, final board, runes, length, the practice options). No replay payload, so a practice row has no Watch.
--
-- Reads are public, like every other ladder table; a player may only insert rows they own. Additive and
-- isolated: nothing else in the schema changes, and the game keeps working (the Practice tab shows its empty
-- state, the client's insert fails quietly) until this has been run.
create table if not exists public.practice_games (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users(id) on delete set null,
  author        text,
  patch         text,
  hero_id       text    not null,
  placement     int,                      -- the placement the practice end screen showed (1-8); null without a lobby
  wins          int     not null default 0,
  record        jsonb,                    -- { wins, losses, draws }
  wave          int,                      -- the round the game ended on
  final_board   jsonb,                    -- the end-state board snapshot (the same shape run_history.entry.board carries)
  picked_runes  text[],
  duration_ms   int,                      -- first to last recorded frame
  config        jsonb,                    -- { opponents: 'players'|'bots', botDifficulty: 1-10, health: 'unlimited'|'normal' }
  created_at    timestamptz default now()
);
create index if not exists practice_games_created on public.practice_games (created_at desc);

alter table public.practice_games enable row level security;
drop policy if exists "read practice_games"       on public.practice_games;
drop policy if exists "insert own practice_games" on public.practice_games;
create policy "read practice_games"       on public.practice_games for select using (true);
create policy "insert own practice_games" on public.practice_games for insert to authenticated with check (auth.uid() = user_id);
