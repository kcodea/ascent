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
`source` on `DerivedRun`), so a client running against a pre-migration table still records them. A missing
stamp is written as null, never manufactured as `ladder`: the reader treats null as legacy, so a caller that
forgot the stamp can never label a row as ladder.

**The report reads one set.** `applyReportFilters` (`packages/sim/src/playerReport.ts`) keeps ladder rows
only, then the ACTIVE set only (`activeSet().id`). **A row with no set stamp reads as set 1**, the same
legacy default as `setIdOf` / `poolOf` / `deserialize`, and is never substituted with the live set. The
header prints `Set 2 only · N of M runs · ladder only`, and an amber line names how many ladder rows carry
no stamp and count as Set 1. The hero, tier and tribe pickers are VIEW filters on top. A stamp the client
wrote INSIDE `derived` (a run played on this build against a pre-migration table) counts as a stamp: the
flat select reads `derived->>setId` and `derived->>source` as two scalars on the 2026-08-05 rung, so such a
run is in the report before the owner's migration lands the columns proper.

**Source stamp (defence in depth, not a bug fix).** The claim that Scene Builder runs upload telemetry was
stale at HEAD: the run-end block has been gated on `!next.sandbox` since #1236 (2026-08-26), the rig
launches under mode `practice` (#1385, 2026-09-09), and `bugScenarioLoad.test.ts` already asserted no
upload on a sandbox finish. What this PR adds: the gate is repeated on the telemetry `if` itself, every row
is stamped `source` (`ladder` for a real lobby, `sandbox` for any sandbox run whatever mode it kept, else
the mode), a reader treats any non-`ladder` source as not-ladder, and `telemetrySandboxGate.test.ts` drives
the same real lobby run to `gameover` with and without the flag (one upload stamped `ladder` + set; none).
`source` is a COLUMN (so it is SQL-filterable: `where source is distinct from 'ladder'`) and a field inside
`derived` (so it survives a pre-migration table and reaches the export).

**Pre-existing rows: checked against their shop offers, not assumed.** The first draft of this PR reasoned
that every live row was a set-2 run "by construction" (the report went lobby-only and set 2 went live on the
same day, 2026-07-31; only lobby runs upload; the rig never uploaded). The review falsified that with the
data: a read-only probe of the 114 live rows against today's pool membership found **four rows whose Shop
offered cards that only set 3's pool holds**: ids 48 (2026-09-01, 5 sightings of 2 set-3 cards), 77
(2026-09-15, 127 of 306 shop sightings; Celestials, `aspectsblessing`, the Starform token; a bare hero offer,
the Scene Builder's signature), 87 (2026-09-17, 41 sightings; Spirits, set-3 Undead) and 89 (2026-09-19,
13 sightings; Spirits, set-3 Kobolds). All four read `mode:lobby`, so nothing about them is distinguishable
by column; they are set-3 runs played on dev or Scene Builder builds whose row still uploaded. The backfill
below therefore does NOT stamp by date alone: it stamps `set2` only where no shop offer lies outside set 2's
pool, and those four rows stay unstamped (they read as set 1 and stay out of the Set 2 report) and are listed
by the runbook so the owner can decide what they are. `patch` cannot identify a dev build (`__BUILD_DIRTY__`
is not in the patch string), so the shop offers are the only evidence a row carries.

**Export all.** ONE JSON file, `ascent-balance-<set>-<date>.json`, built by `buildBalanceExport` from the
SAME filtered rows the panel renders (every hero; view filters are not applied): `meta` (generated at, app
version, active set, content revision, patches, date range, the counts before and after every filter, the
filters in plain words, the sample gates), `readme` (every top-level key and every column described in the
file; the test asserts every column of every aggregate table is named in its section's prose), `aggregates`
(the classic report tables + shop curve, the impact tables, per-tier and per-tribe roll-ups, demand, economy,
upgrades), `cards` / `heroes` / `runes` (id → name dictionaries so an AI needs no codebase), `runs` (every
raw row, `derived` lifted out, `user_id` never fetched), `derived` (every payload, keyed `rowId`). The
per-card CSV stays as the second button over the same rows. `replay` is not fetched or exported (100 to
450 KB per row; the derived streams are the analysable form). The button waits for the derived payloads to
land (it reads `Export (loading)` meanwhile), so the file always holds everything.

**Minions / Spells redesigned as the impact table** (`cardImpact`, PER RUN: a run that bought a card three
times is one buyer run): buyers (with the `SAMPLE_GATES.preliminary` = 20 dim gate), runs seen, shop seen /
bought / buy %, Discover seen / picked / %, average place, 1st %, top 4 % with its Wilson 95% range as its
own Detailed column (`Top 4 95%`), 8th %, **Delta** = average placement of buyer runs minus every other placed
run (negative = buyers finish better), its 95% interval (pooled-variance normal approximation on the
difference of two means), **Impact** = the delta shrunk toward zero for a thin sample, delta × n / (n + 20)
over placed buyer runs (the default sort; a t-statistic was tried first and put two-run cards whose both
buyers won at the very top, because their within-group variance is zero), **Vs Tier** = the delta minus the
placed-buyer-weighted average delta of the card's tier, minions and spells apart (the live data showed every
high tier reading green, because only runs that survive long enough buy T5 and T6 cards; this is the
within-tier read), average buy wave. Heat on the delta, Vs Tier and Impact (green better, red worse). Tier
and tribe chip strips above the table roll the cards up (delta weighted by placed buyer runs) and filter the
table when clicked; the filters belong to the section, so switching Minions / Spells starts clean, and a
filter that leaves nothing shows a `Clear filters` control instead of an empty table. Compact (10 columns,
17px) / Detailed (20 columns, 15px) switch. A Chart view: ranked diverging bars of the delta, thin marks,
hairline baseline, fading with a thin sample, every bar a hover target; thin samples are hidden by default
when anything clears the 20-buyer gate (one click shows them), because the first live render ranked a column
of faded two-run outliers at the top.
Note the per-run definition differs from the classic `aggregatePlayerReport` per-acquisition `avgPlace`
(still used by Heroes / Runes and carried in the export); the legend says so.

**Fetch, in two stages.** `fetchRunTelemetry` walks `BALANCE_SELECTS` richest → plainest, dropping the
NEWEST migration's columns first (a select that kept `set_id` on every rung would 42703 on every rung and
empty the report); the 2026-08-05 rung also reads `derived->>setId` / `derived->>source` as two scalars (see
the set stamp above). The flat rows render at once. Then `fetchRunDerived(ids)` fetches the derived payloads
BY ID, in chunks of 100, only for the newest 400 rows that survived the set filter, and the panel merges
them in when they land. Pre-migration that is no rows and no bytes; with data the ~16 MB parse never sits
on the frame that paints the flat report (the review's perf HUD read a 150 ms worst frame on Refresh with
the old one-shot fetch, which pulled and parsed every payload even when the report rendered nothing).
Measured on the live table: flat columns 1.2 MB / 0.9 s, derived 16.6 MB / 2.0 s (114 rows, median 99 KB).

## The owner decision inside this PR: what to do with the 114 unstamped rows

The code rule is "no stamp = set 1, never the live set", so **until the backfill is run the report reads 0
runs** and says why. Three options were weighed: (1) the owner runs the backfill (chosen: it corrects the
data once, and the code keeps one rule with no special cases); (2) a client-side date fallback (rejected:
that is the guess the rule forbids, and it would re-guess forever); (3) accept an empty report until new runs
bank. The backfill is part of the migration file, delimited, with the reasoning, and can be deleted before
pasting. It is NOT a blanket date stamp: it checks every row's shop offers against a list of the 112 cards
that only set 3's pool holds (generated from the registry at content revision `3f273677` as
`poolFor('set3').all` minus `poolFor('set2').all` minus `poolFor('set1').all`) and stamps `set2` only where
none of them was offered. Emulated read-only through PostgREST against the live table: **110 rows would be
stamped, 4 would stay unstamped** (ids 48, 77, 87, 89). A reader-side version of the same check was
considered and rejected: cards leave a set over time (Tauntbreaker, Chipwick Prospector, Pillager all did
this month), so a live-registry check in the reader would retroactively flag legitimate old runs; the check
belongs in the one-off, owner-run SQL, against a list the SQL names.

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
   unstamped lobby row created on or after 2026-07-31 whose Shop never offered a card outside set 2's pool).
   Delete the `update` block before pasting if you would rather leave every row as set 1. RLS is untouched.

3. **Verify the columns and the backfill.**

   ```sql
   select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'run_telemetry' and column_name in ('set_id', 'source');
   -- expect both rows
   select set_id, source, count(*) from public.run_telemetry group by set_id, source order by set_id;
   -- expect: set2 / null / 110 (the backfilled legacy rows) and null / null / 4 (the off-pool rows below);
   -- new runs then appear as set2 / ladder
   ```

4. **The rows the backfill left alone** (expect ids 48, 77, 87 and 89): the same list of set-3-only cards the
   migration uses, so paste the array from the migration file in place of `<the array>`:

   ```sql
   select id, created_at, patch, author, placement,
          cardinality(offered_cards) as shop_sightings,
          (select count(*) from unnest(offered_cards) c where c = any(<the array>)) as off_pool_sightings
     from public.run_telemetry
    where 'mode:lobby' = any(hero_offer) and set_id is null
      and offered_cards && <the array>
    order by created_at;
   ```

   They are set-3 runs from dev or Scene Builder builds (two carry a bare hero offer, which only the Scene
   Builder produces). Nothing is deleted by this PR; if you want them out of every future read, stamping them
   `source = 'sandbox'` by id is your call. The sandbox suspects query from the first draft still applies to
   rows written by the new client: `select id, patch, created_at from public.run_telemetry where source is
   distinct from 'ladder' and source is not null;`.

5. **Verify from the client side** (the anon REST probe; replace the two placeholders from `apps/web/.env`):

   ```
   curl -s -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>" \
     "<VITE_SUPABASE_URL>/rest/v1/run_telemetry?select=id,set_id,source&order=created_at.desc&limit=3"
   ```

   Expect three rows with `set_id: "set2"` and no `42703` error. Then open the Balance Report (dev build):
   the header should read `Set 2 only · 110 of 114 runs · ladder only`, the amber line should say 4 runs
   carry no stamp, and the Tribe strip should no longer show Celestial, Spirit or Undead chips.

6. **Play one ranked lobby on the new build** and re-run step 3: the newest row should read
   `set2 / ladder`, and `select derived->>'setId', derived->>'source' from public.run_telemetry order by
   created_at desc limit 1;` should agree.

## Review pass (same day)

A review of the build commit produced one blocker, one major and six minors; all eight were applied.

- **Blocker, the backfill's premise.** Four live rows carry set-3-only shop offers (above). The migration and
  `schema.sql` now stamp only where the shop offers agree with set 2, the comments no longer say
  "deterministic" or "zero by construction", and the runbook's step 4 lists the rows.
- **Major, the Top 4 hover.** The header tip promised a hover that no cell had. `Top 4 95%` is now a column
  of the Detailed table, exactly like `Delta 95%`, and the tip says so.
- Pre-migration, a run uploaded by the new build read as unstamped: the flat select now reads the stamps out
  of `derived` on the 2026-08-05 rung (test: `balanceFetch.test.ts`, the rung-2 case).
- `uploadRunTelemetry` no longer defaults a missing `source` to `ladder`; it writes null.
- `.balchip` / `.balrun` / `.balsort` lost their bare `cursor: pointer` (the global button rule paints the
  gauntlet); `.balpick`, a `<select>` the global rule does not cover, names the gauntlet in the URL form; the
  Demand table's sortable headers became real buttons; disabled buttons show the default gauntlet.
- The Compact tip says ten columns; this devlog says 10 / 20.
- The tier / tribe filters moved into the section (reset on Minions / Spells) with a `Clear filters` control.
- The readme names every column of every aggregate table (shop curve fields and their indexing, `totalRuns`,
  the economy row's `runs` and all eleven categories, every demand and upgrade column), and the export test
  asserts it for every table.
- The derived payloads are fetched by id, for the surviving rows, after the flat rows render.

## Verification

- New tests: `packages/sim/src/reportFilters.test.ts` (source stamp, legacy = set 1, ladder rule, the
  counts), `packages/sim/src/cardImpact.test.ts` (the per-run delta math on a hand-checked fixture, the
  interval, the signal, the gates, the tier/tribe roll-ups), `packages/sim/src/balanceExport.test.ts` (every
  section present with counts equal to the aggregates, the readme covers every key AND names every column of
  every aggregate table, no account id, JSON idempotent), `packages/ui/src/telemetrySandboxGate.test.ts` (a
  real lobby finish uploads one stamped row; the same run flagged sandbox uploads nothing; the Scene Builder
  rig uploads nothing), `packages/ui/src/balanceFetch.test.ts` (the select ladder drops `set_id, source`
  first; the stamps inside `derived` read on the rung below; the full walk to the original columns; the
  by-id, chunked derived fetch). `BalancePanel.tsx` joined `noEmDashPlayerText.test.ts`'s scanned screens, so
  every hover on the report is under the owner's writing rule.
- Live checks against the real backend, all read-only: pre-migration the report loads all 114 rows, filters
  them to 0 (all unstamped → set 1) and explains itself; the export was measured over the same 114 rows
  through the same builder; the backfill predicate emulated through PostgREST stamps 110 and leaves 4; the
  `derived->>setId` path select answers on the live table.
- Gate: `npm run typecheck && npm run lint && npm test && npm run build:web`.
