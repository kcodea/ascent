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
  captured_at date,
  created_at  timestamptz default now()
);
create index if not exists runs_result_created on public.runs (result, created_at desc);

alter table public.runs enable row level security;
drop policy if exists "anon read runs"   on public.runs;
drop policy if exists "anon insert runs"  on public.runs;
create policy "anon read runs"   on public.runs for select to anon using (true);
create policy "anon insert runs"  on public.runs for insert to anon with check (true);

-- ── Maintenance (run by hand in the SQL Editor when needed) ────────────────────────────────────────────────
-- Clear everything EXCEPT the current patch (the "regenerate per balance patch" op):
--   delete from public.boards where patch not like '0.1.0+%';
-- Clear one stale build:
--   delete from public.boards where patch = '0.1.0+oldsha';
-- Remove the connectivity test row created during setup:
--   delete from public.boards where patch = '__conntest__';
