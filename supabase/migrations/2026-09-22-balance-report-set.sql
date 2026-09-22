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
-- runs before this migration still records them there (and the report reads them from there until the
-- columns exist); the client's insert falls back to the pre-migration column set until this has run
-- (nothing is lost either way).
alter table public.run_telemetry add column if not exists set_id text;
alter table public.run_telemetry add column if not exists source text;
create index if not exists run_telemetry_set on public.run_telemetry (set_id);

-- ── BACKFILL the rows written before the column existed ──────────────────────────────────────────────────
-- The report reads a row with NO set stamp as set 1 (the same legacy default as every other pre-sets surface)
-- and never as the live set. Most rows in the table today were played under SET 2 (the report went
-- lobby-only and set 2 went live on the same day, 2026-07-31), but NOT all of them: a read-only probe of the
-- 114 live rows on 2026-09-22 found FOUR whose Shop offered cards that only set 3's pool holds (ids 48, 77,
-- 87 and 89: Celestials, Spirits, set-3 Undead and Kobolds, played on dev or Scene Builder builds), so a
-- blanket 'set2' stamp would have put set-3 runs into the Set 2 report. The backfill therefore CHECKS every
-- row against its shop offers: a row is stamped set2 only when NO card it was offered in the Shop lies
-- outside set 2's pool. The list below is every card in set 3's resolved pool that is in neither set 2's nor
-- set 1's pool: 112 ids, generated from the content registry at revision 3f273677 as
--   poolFor('set3').all minus poolFor('set2').all minus poolFor('set1').all
-- (regenerate it the same way if the registry moves before this is run). A row that fails the check is LEFT
-- UNSTAMPED: it reads as set 1 and stays out of the Set 2 report, and the runbook's step 4 lists it so the
-- owner can decide what it is. Idempotent: it touches only unstamped lobby rows from that date on. Delete
-- the update if you would rather leave every row as set 1 (the report is then empty until new runs bank).
update public.run_telemetry
   set set_id = 'set2'
 where set_id is null
   and 'mode:lobby' = any(hero_offer)
   and created_at >= '2026-07-31'
   and not (coalesce(offered_cards, '{}'::text[]) && array[
         'accretion', 'aspectsblessing', 'blaster', 'ce3_accretionwarden', 'ce3_adept', 'ce3_artificer', 'ce3_conductor', 'ce3_constellationprime',
         'ce3_coronadevotee', 'ce3_courier', 'ce3_dawnsentinel', 'ce3_eclipsewarden', 'ce3_herald', 'ce3_lensgrinder', 'ce3_lodestar', 'ce3_novaherald',
         'ce3_orbitkeeper', 'ce3_peddler', 'ce3_seer', 'ce3_shootingstar', 'ce3_spellcore', 'ce3_starcharter', 'ce3_starform', 'ce3_starseed',
         'ce3_twinstar', 'ce3_vendor', 'ce3_wishingstar', 'ce3_zenith', 'crescendo', 'dw3_hangover', 'dw3_hankpepe', 'dw3_kneel',
         'dw3_pourman', 'dw3_shiftbroker', 'dw3_striker', 'dw3_tankerchief', 'dw3_thymes', 'dw3_tromboneer', 'e3_frank', 'e3_sculptor',
         'graverobbery', 'handsoap', 'k3_blastsurveyor', 'k3_doubletrouble', 'k3_facetbound', 'k3_forkedcrown', 'k3_forksong', 'k3_forkvein',
         'k3_goldvein', 'k3_jeweler', 'k3_kaura', 'k3_korn', 'k3_kurse', 'k3_porkbelly', 'k3_prismpick', 'k3_rubyroach',
         'k3_runespark', 'k3_splitpick', 'k3_veinchant', 'n3_calibration', 'n3_charger', 'n3_defender', 'n3_hustler', 'n3_pell',
         'n3_recruiter', 'n3_rig', 'n3_shredder', 'n3_splitboon', 'n3_yeti', 'rushorder', 'sharedspirit', 'sp3_aspect',
         'sp3_bondweaver', 'sp3_dreamcurrent', 'sp3_dreamingdeep', 'sp3_dreamtide', 'sp3_festivalkeeper', 'sp3_flamebanner', 'sp3_flamereveler', 'sp3_forestcolossus',
         'sp3_gatheringguide', 'sp3_grandprocession', 'sp3_grovereveler', 'sp3_handboundtitan', 'sp3_handyflame', 'sp3_hearthwhisperer', 'sp3_kindled', 'sp3_luminary',
         'sp3_nurturer', 'sp3_paradeartificer', 'sp3_revelator', 'sp3_seedling', 'sp3_slumbering', 'sp3_tidebud', 'sp3_tidereveler', 'sp3_treasurer',
         'splitdecision', 'starcrash', 'stellarchorus', 'u3_adeptus', 'u3_bicyclebob', 'u3_cagebreaker', 'u3_ems', 'u3_hierophant',
         'u3_noggin', 'u3_poochy', 'u3_revenant', 'u3_risingtide', 'u3_robinson', 'u3_rodrick', 'u3_skeleton', 'u3_squatimus'
       ]::text[]);
