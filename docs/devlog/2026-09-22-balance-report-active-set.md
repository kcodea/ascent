# 2026-09-22 — Balance Report: active set only, nothing from Scene Builder, Export all

Owner ask (verbatim): *"fix up our balance report. it should only have data for the active set in it, and
nothing from scene builder. also make the export export everything so that an ai can analyze all of the data
for me at once. Make sure the balance report is extremely thorough and represented well so it's easy to
glean insights into overpowered and underpowered units."*

Branch `feat/balance-report-active-set`. Oracle rule **R-REPORT-01**. Patch note under 2026-09-22 "Balance
Report".

## What shipped

**Set stamp.** Every new `run_telemetry` row carries `set_id` (the run's pinned set, `setIdOf(run)`) and
`source` (see below). Both ride on the flat row (a NEW top rung of the upload ladder, never a key in `base`,
so a pre-migration table costs the stamps and nothing else) AND inside the `derived` jsonb (`setId`,
`source` on `DerivedRun`), so a client running against a pre-migration table still records them.

**The report reads one set.** `applyReportFilters` (`packages/sim/src/playerReport.ts`) keeps ladder rows
only, then the ACTIVE set only (`activeSet().id`). **A row with no set stamp reads as set 1**, the same
legacy default as `setIdOf` / `poolOf` / `deserialize`, and is never substituted with the live set. The
header prints `Set 2 only · N of M runs · ladder only`, and an amber line names how many ladder rows carry
no stamp and count as Set 1. The hero, tier and tribe pickers are VIEW filters on top.

**Source stamp (defence in depth, not a bug fix).** The claim that Scene Builder runs upload telemetry was
stale at HEAD: the run-end block has been gated on `!next.sandbox` since #1236 (2026-08-26), the rig
launches under mode `practice` (#1385, 2026-09-09), and `bugScenarioLoad.test.ts` already asserted no
upload on a sandbox finish. What this PR adds: the gate is repeated on the telemetry `if` itself, every row
is stamped `source` (`ladder` for a real lobby, `sandbox` for any sandbox run whatever mode it kept, else
the mode), a reader treats any non-`ladder` source as not-ladder, and `telemetrySandboxGate.test.ts` drives
the same real lobby run to `gameover` with and without the flag (one upload stamped `ladder` + set; none).
`source` is a COLUMN (so it is SQL-filterable: `where source is distinct from 'ladder'`) and a field inside
`derived` (so it survives a pre-migration table and reaches the export).

**Pre-existing sandbox rows: ~0 by construction, and indistinguishable by column.** Before #1236 the rig
only made `practice` runs, which the mode gate has excluded since the A-series; after it the flag gates; the
rig is DEV-only. `patch` cannot identify a dev build (`__BUILD_DIRTY__` is not in the patch string), so
there is no purge to promise. For scale: 54 of the 114 live rows were written on or after 2026-09-09 (the
day the sandbox became a lobby run), all 114 read `mode:lobby`, and none can be told apart by column; the
expected count of sandbox rows among them is zero by construction. The inspect query is in the runbook.

**Export all.** ONE JSON file, `ascent-balance-<set>-<date>.json`, built by `buildBalanceExport` from the
SAME filtered rows the panel renders (every hero; view filters are not applied): `meta` (generated at, app
version, active set, content revision, patches, date range, the counts before and after every filter, the
filters in plain words, the sample gates), `readme` (every top-level key and every column described in the
file), `aggregates` (the classic report tables + shop curve, the impact tables, per-tier and per-tribe
roll-ups, demand, economy, upgrades), `cards` / `heroes` / `runes` (id → name dictionaries so an AI needs no
codebase), `runs` (every raw row, `derived` lifted out, `user_id` never fetched), `derived` (every payload,
keyed `rowId`). The per-card CSV stays as the second button over the same rows. `replay` is not fetched or
exported (100 to 450 KB per row; the derived streams are the analysable form).

**Minions / Spells redesigned as the impact table** (`cardImpact`, PER RUN: a run that bought a card three
times is one buyer run): buyers (with the `SAMPLE_GATES.preliminary` = 20 dim gate), runs seen, shop seen /
bought / buy %, Discover seen / picked / %, average place, 1st %, top 4 % (Wilson 95% on hover), 8th %,
**Delta** = average placement of buyer runs minus every other placed run (negative = buyers finish better),
its 95% interval (pooled-variance normal approximation on the difference of two means), **Impact** = the delta
shrunk toward zero for a thin sample, delta × n / (n + 20) over placed buyer runs (the default sort; a
t-statistic was tried first and put two-run cards whose both buyers won at the very top, because their
within-group variance is zero), **Vs Tier** = the delta minus the placed-buyer-weighted average delta of the
card's tier, minions and spells apart (the live data showed every high tier reading green, because only runs
that survive long enough buy T5 and T6 cards; this is the within-tier read), average buy wave. Heat on the
delta, Vs Tier and Impact (green better, red worse). Tier and tribe chip
strips above the table roll the cards up (delta weighted by placed buyer runs) and filter the table when
clicked. Compact (9 columns, 17px) / Detailed (18 columns, 15px) switch. A Chart view: ranked diverging bars
of the delta, thin marks, hairline baseline, fading with a thin sample, every bar a hover target; thin samples
are hidden by default when anything clears the 20-buyer gate (one click shows them), because the first live
render ranked a column of faded two-run outliers at the top.
Note the per-run definition differs from the classic `aggregatePlayerReport` per-acquisition `avgPlace`
(still used by Heroes / Runes and carried in the export); the legend says so.

**Fetch.** `fetchRunTelemetry` walks `BALANCE_SELECTS` richest → plainest, dropping the NEWEST migration's
columns first (a select that kept `set_id` on every rung would 42703 on every rung and empty the report).
The derived payloads are fetched in their own id-keyed query (newest 400) and joined onto the rows, so the
derived sections and the export obey the same filters (they used to be an unjoinable parallel read).
Measured on the live table: flat columns 1.2 MB / 0.9 s, derived 16.6 MB / 2.0 s (114 rows, median 99 KB).

## The owner decision inside this PR: what to do with the 114 unstamped rows

Every lobby row in the live table today was created under **set 2**, deterministically: the report went
lobby-only and set 2 went live on the same day (2026-07-31), a run pins the active set at creation, only
lobby runs upload, and a Scene Builder run (the one thing that can pin another set) has never uploaded. But
the code rule is "no stamp = set 1, never the live set", so **until the backfill below is run the report
reads 0 runs** and says why. Three options were weighed: (1) the owner runs the one-line backfill (chosen:
it corrects the data once, deterministically, and the code keeps one rule with no special cases); (2) a
client-side date fallback (rejected: that is the guess the rule forbids, and it would re-guess forever);
(3) accept an empty report until new runs bank. The backfill is part of the migration file, delimited, with
the reasoning, and can be deleted before pasting.

## Supabase runbook (the owner runs every step; nothing here executes against production)

1. **Look before touching.** SQL Editor → run and keep the output:

   ```sql
   select patch, min(created_at), max(created_at), count(*)
     from public.run_telemetry group by patch order by min(created_at);
   select count(*) as lobby_rows from public.run_telemetry where 'mode:lobby' = any(hero_offer);
   ```

   Expect 114 rows total as of 2026-09-22, all lobby, oldest 2026-08-19.

2. **Run the migration.** SQL Editor → New query → paste the whole of
   `supabase/migrations/2026-09-22-balance-report-set.sql` → Run. Idempotent. It adds `set_id text`,
   `source text`, the index `run_telemetry_set`, and then runs the backfill (`set_id = 'set2'` on every
   unstamped lobby row created on or after 2026-07-31). Delete the `update` block before pasting if you
   would rather leave those rows as set 1. RLS is untouched.

3. **Verify the columns and the backfill.**

   ```sql
   select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'run_telemetry' and column_name in ('set_id', 'source');
   -- expect both rows
   select set_id, source, count(*) from public.run_telemetry group by set_id, source order by set_id;
   -- expect: set2 / null / 114 (the backfilled legacy rows); new runs then appear as set2 / ladder
   ```

4. **Sandbox suspects (none expected).**

   ```sql
   select id, patch, created_at from public.run_telemetry
    where source is distinct from 'ladder' and source is not null
       or (derived->>'source') is distinct from 'ladder' and (derived->>'source') is not null;
   ```

   Before the column existed no row can say what produced it; a dev-build row could only be found by its
   `patch` sha not being a released one. Nothing is deleted by this PR.

5. **Verify from the client side** (the anon REST probe; replace the two placeholders from `apps/web/.env`):

   ```
   curl -s -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>" \
     "<VITE_SUPABASE_URL>/rest/v1/run_telemetry?select=id,set_id,source&limit=3"
   ```

   Expect three rows with `set_id: "set2"` and no `42703` error. Then open the Balance Report (dev build):
   the header should read `Set 2 only · 114 of 114 runs · ladder only` and the amber line should be gone.

6. **Play one ranked lobby on the new build** and re-run step 3: the newest row should read
   `set2 / ladder`, and `select derived->>'setId', derived->>'source' from public.run_telemetry order by
   created_at desc limit 1;` should agree.

## Verification

- New tests: `packages/sim/src/reportFilters.test.ts` (source stamp, legacy = set 1, ladder rule, the
  counts), `packages/sim/src/cardImpact.test.ts` (the per-run delta math on a hand-checked fixture, the
  interval, the signal, the gates, the tier/tribe roll-ups), `packages/sim/src/balanceExport.test.ts` (every
  section present with counts equal to the aggregates, the readme covers every key, no account id, JSON
  idempotent), `packages/ui/src/telemetrySandboxGate.test.ts` (a real lobby finish uploads one stamped row;
  the same run flagged sandbox uploads nothing; the Scene Builder rig uploads nothing),
  `packages/ui/src/balanceFetch.test.ts` (the select ladder drops `set_id, source` first; the derived join;
  the full walk to the original columns). `BalancePanel.tsx` joined `noEmDashPlayerText.test.ts`'s scanned
  screens, so every hover on the report is under the owner's writing rule.
- Live check on port 5212 against the real backend (read-only): pre-migration the report loads all 114 rows,
  filters them to 0 (all unstamped → set 1) and explains itself; the export was measured over the same 114
  rows through the same builder.
- Gate: `npm run typecheck && npm run lint && npm test && npm run build:web`.

## Follow-ups

- `.balchip`, `.balrun`, `.balsort`, `.balpick` carry a pre-existing bare `cursor: pointer` (the CLAUDE.md
  gauntlet rule); left alone here, flagged for a cleanup PR. Nothing new adds one.
