-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- BALANCE REPORT — the set + source stamps  (2026-09-22)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). The same block is appended to
-- schema.sql (the cumulative paste file) — keep the two identical. Owner runbook: the 2026-09-22 devlog
-- (docs/devlog/2026-09-22-balance-report-active-set.md). RLS is untouched: two nullable text columns and an
-- index on a table whose policies stay exactly as they are.
--
-- WHAT THIS IS (owner ask 2026-09-22: "it should only have data for the active set in it, and nothing from
-- scene builder"). Every finished lobby run uploads one run_telemetry row; the in-game Balance Report reads
-- them. Until now a row did not say which CARD SET the run was played under, so the report could not read one
-- set. From this patch the client stamps two columns on every new row:
--   set_id  — the run's pinned set ('set1' | 'set2' | 'set3'), the value createRun pinned at creation.
--   source  — what produced the row: 'ladder' for a real lobby run, 'sandbox' for a Scene Builder run,
--             or the run's mode for anything else. The run-end gates already let only ladder runs upload;
--             this makes that fact a column, so a sandbox row can never pass for a ladder row.
-- Both values ALSO ride inside the `derived` jsonb (derived->>'setId', derived->>'source'), so a client that
-- runs before this migration still records them there; the client's insert falls back to the pre-migration
-- column set until this has run (nothing is lost either way).
alter table public.run_telemetry add column if not exists set_id text;
alter table public.run_telemetry add column if not exists source text;
create index if not exists run_telemetry_set on public.run_telemetry (set_id);

-- ── BACKFILL the rows written before the column existed ──────────────────────────────────────────────────
-- The report reads a row with NO set stamp as set 1 (the same legacy default as every other pre-sets surface)
-- and never as the live set. Every lobby row in the table today was created under SET 2, deterministically:
-- the report went lobby-only and set 2 went live on the SAME day (2026-07-31; a run pins the active set at
-- creation and only lobby runs upload), and a Scene Builder run (the one thing that can pin another set) has
-- never uploaded. So stamping those rows 'set2' is correcting the data, not guessing. Idempotent: it touches
-- only unstamped lobby rows from that date on. Delete this block if you would rather leave them as set 1
-- (the report is then empty until new runs bank).
update public.run_telemetry
   set set_id = 'set2'
 where set_id is null
   and 'mode:lobby' = any(hero_offer)
   and created_at >= '2026-07-31';
