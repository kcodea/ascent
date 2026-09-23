# 2026-09-22 — Balance Report: honest associations

Owner ask (the audit handoff's prompt, verbatim): *"Audit and improve Ascent's player Balance Report using this
blueprint. The existing raw delta arithmetic is correct, but comparing buyers with all nonbuyers systematically
rewards survival and card access. Preserve raw metrics under honest labels, separate coherent balance versions,
expose sample/coverage weaknesses, and add offered-run diagnostics followed by comparable decision-opportunity
analysis where telemetry supports it. Inspect the existing export and current branch because the export includes
newer aggregate sections than the reviewed checkout. Use exact fixtures and synthetic confounding tests; don't
center scores merely to manufacture bad cards. Do not change gameplay balance, delete history, guess missing
context, or merge bot data into player telemetry. Keep planning documents outside the repo. Deliver working changes
with verification and an explicit account of remaining statistical limitations."*

Branch `feat/balance-report-honest-associations`, stacked on round 2 (`2026-09-22-balance-report-round-2.md`).
Oracle rule **R-REPORT-03** (R-REPORT-02 is taken by the unmerged derive-reset branch). Patch note under
2026-09-22 "Balance Report: honest numbers". The handoff document itself stays outside the repo, as asked.

## What was wrong

The subtraction was right; the comparison group was not. `delta` compared a card's buyers with EVERY other
placed run, so a run eliminated on wave 4 counted against a wave-12 card it never saw. Runs that place 1st
acquire twice as many distinct cards as runs that place 8th (62 vs 31 in the audited export), and each of those
cards inherits the good finish. That is why 122 of 139 minions read negative. The labels ("Delta", "Impact",
"overpowered / underpowered", the count-only "actionable / confident" badges) presented a survival statistic
as card power.

Two things the export taught that the handoff did not know:

- **51 of the 110 derived payloads and the flat card arrays carry EARLIER runs of the same browser session in
  front of their own** (the wave number drops back to 1 where the next run began; the fix lives on the unmerged
  `fix/derive-state-reset-between-runs` branch). The flat `offeredCards` / `boughtCards` / `discover*` arrays
  stack the same way and carry no wave, so they cannot be cut. Raw "buyer runs" are therefore inflated: joker 62
  by the flat arrays, 42 by this run's own streams; Black Belt Brian 52 to 34. The raw numbers are preserved for
  audit continuity and the banner and the Evidence view print both counts side by side.
- **`tierByWave` is replay-derived** (the lobby run is re-run without its seats) and disagrees with the live
  `finalWave` on 91 of 110 rows. The Shop Tiers reach table and the shop curve stay under a disclosure; the
  decision table is built from the live upgrade rows instead.

## What shipped

**Sim: `packages/sim/src/reportCohorts.ts`** (pure, no RNG, analytics only):

- `segmentByWave` / `segmentRun`: every derived stream read by its last wave segment (`ledgerSegment` is now an
  alias). `dataQuality` counts stacked payloads, replay disagreement, missing / malformed placements, duplicate
  ids, diverged payloads, missing hero trios and missing revision stamps; `sanitizeRows` drops duplicate ids
  and clears a placement that is not an integer 1 to 8 (it never counts toward a placement finding).
- `exposedDiagnostic(facts, basis)`: buyers against the runs that SAW the card and passed. Two bases: `flat`
  (the handoff's section-2 definition, upload-time arrays, reproducible against the audited export, inherits
  the stacking) and `segmented` (this run's own shop offers and acquisitions; what the panel shows). Coverage
  mismatches (`notExposedBuyers`) are reported, never repaired.
- `shopEpisodesOf` / `adjustedAssociation`: ONE primary observation per run per card, the first shop wave the
  card was on offer and affordable (`gold >= cost` on any copy, or bought) before any prior acquisition of it
  (any source). Buy versus pass inside that wave; a later acquisition is a `crossover`, never a relabel; a
  non-shop grant in the offer wave is ambiguous and excluded; an unaffordable wave is skipped and counted.
  Strata = round band (1 to 4, 5 to 8, 9+) x shop tier; only strata holding both sides count;
  `association = sum(w_s * d_s)` with `w_s` the buyer share; `outsideSupportPct` discloses the buyers the
  number does not speak for; null when no stratum is supported (insufficient comparable data, never zero).
- `welchInterval` / `tQuantile975` (Cornish-Fisher, within 0.01 of the table from df 4): an interval on the
  metric it belongs to, suppressed under `WELCH_MIN_N = 5` runs a side rather than collapsed. `placementImpact`
  keeps its pooled-z `deltaCi` (audit continuity) and adds `deltaWelch`; the adjusted interval is a stratified
  Welch-type one (weighted per-stratum variances, Satterthwaite df), suppressed when any supported stratum has
  a single observation on a side.
- `evidenceLabel`: `EVIDENCE_GATES = { candidate: 10 a side + 3 players, supported: 20 a side + 5 players }`.
  Both group sizes AND the unique players on the smaller side; with no player key it can never read supported.
- `tierDecisions`: took against declined among runs that could afford the tier-up, one primary decision per
  run per tier from the last-segment upgrade rows, stratified on round band x spare Gold after paying (tight 0
  to 1, spare 2 to 4, rich 5+). A "decline" is a run that ended the wave still able to afford it; a run that
  spent its Gold on cards first is in neither group (the legend says so).
- Epochs: `epochsOf`, `defaultEpoch` (the build's own revision when the rows carry it, else the newest),
  `EPOCH_MIN_RUNS = 20`, `scopeReport` (epoch + date window on top of `applyReportFilters`). The epoch is a
  FILTER, never a stratum: 24 revisions over 110 runs would empty every comparison.

**Sim: `playerReport.ts`.** `cardImpactWithCoverage` merges the cohort reads into every card row (raw columns
untouched: the audited export reproduces to rounding, 0 mismatches over 235 cards); `performanceSortValue`
(rows with candidate or supported evidence first, by adjusted association, else exposed; insufficient rows
sink alphabetically); `heroImpact` adds the offered-not-chosen comparison (`offeredDelta`, Welch, players,
evidence; 25 of 110 runs have no recorded trio and enter the raw read only); `runeImpact` adds players and
evidence and discloses that its offers are replay-derived; `goldEconomy` adds `moved` beside `runs` and the
legend now states the denominator precisely and no longer asserts unchanged Gold rules. Export schema version
2: `meta.scope`, `epochs`, `quality`, `fetch` (caps, pages, truncation, derived dropped), `coverage`,
`playerKey` (basis + what a trusted key needs), `excludedProlificRuns`, `thresholds`, per-metric `exclusions`;
`aggregates.tierDecisions`; the readme documents every formula, cohort, limitation and the deferred Stage C,
and `balanceExport.test.ts` asserts every column, nested ones included, is named.

**Fetch (`remoteBoards.ts`).** `fetchRunTelemetry` pages with `.range()` (PostgREST caps a single query at
its max-rows whatever `.limit()` asks) until a short page or `BALANCE_FLAT_CAP = 5000`, and returns
`{ rows, fetched, truncated, cap, pageSize }`. Derived payloads: `DERIVED_CAP = 800` newest in-set rows, with
requested / fetched / dropped on the banner and in the export. A bounded result is labelled, never "all".

**Panel (`BalancePanel.tsx`).** Honest labels everywhere (Raw buyer association, Sample-weighted
association, Relative raw association within tier, Exposed diagnostic, Adjusted association, Offered
association); the evidence banner above every table; the scope row (epoch select with the build's revision
first, date window, the "exclude most prolific player" sensitivity toggle); the "Insufficient current data"
state with the explicit "Include historical" and "Show these N runs anyway" choices; the four card views
(Demand / Performance / Role and timing / Evidence) as one table at a time; hero and rune tables keep
Compact / Detailed with the new columns; the tier decision table under the replay-derived one; the ranked
chart names its metric and says it is the raw read. Tier and tribe chips are labelled card-buyer incidences.
Unique players print as display names with the proxy caveat on hover (n/a when no name). No `title=`, no bare
`cursor: pointer` (the date inputs share `.balpick`'s gauntlet URL cursor), no em dash or double hyphen (the
tripwire scans the file).

## The local audit check (never committed)

A throwaway script over `ascent-balance-set2-2026-09-23.json` (110 runs; the file and every row of it stay
out of the repo) reproduced the handoff's section 2 exactly on the flat basis:

| card | raw | exposed (flat) | buyers / skippers | handoff |
|---|---|---|---|---|
| joker | -2.76 | +0.0018 | 62 / 9 | +0.0018, 62 / 9 |
| b2_moonhowl | -2.24 | -0.9213 | 39 / 29 | -0.9213, 39 / 29 |
| seaurchin | -2.08 | -0.8289 | 47 / 23 (49 raw; 2 without a sighting) | -0.8289, 47 / 23 |
| blackbelt | -1.92 | +1.5077 | 52 / 10 | +1.5077, 52 / 10 |
| d2_blazingkeeper | -1.97 | -0.3436 | 44 / 25 | -0.3436, 44 / 25 |

On this run's own streams (the segmented basis the panel shows): joker +0.21 (25 / 6), moonhowl -1.03
(14 / 17), seaurchin -0.37 (30 / 19), blackbelt +0.41 (32 / 10), warpath -1.05 (20 / 21). Adjusted: joker
+0.50 (19 buy / 7 pass in one stratum), seaurchin -0.12 (21 / 18 over 4 strata), blackbelt +0.41 (23 / 10),
warpath +0.50 (11 / 17); moonhowl 3 / 18. Over the whole set: 198 of 235 cards have an adjusted association,
24 rows read candidate for review, none supported (two display names behind 100 of 110 runs; the supported
gate needs five). **Which suspected outliers survive:** none of the five headline cards keeps its raw reading.
Mysterious Joker and Black Belt Brian reverse sign on every fairer read; Commander Warpath and Sea Urchin fall
to a fraction of the raw delta with intervals that cross zero; Moonhowl Mentor keeps a negative exposed read
but has 3 comparable buyers. The candidate list the adjusted read produces instead (Contract Butcher -1.97,
Imp Overseer -1.14, Bob Blart -1.12, Paymaster Pimm -1.08, Storm Chaser -1.03 with a -3.1 to +1.0 interval)
is a list to LOOK AT, not a finding: every one is under the supported gate.

## Remaining statistical limitations (explicit)

- **Two players.** 100 of 110 runs come from two display names. No evidence label can reach "supported" and
  no interval is a population statement. This is why **Stage C is deferred**: a player-cluster bootstrap and
  false-discovery screening over two clusters would manufacture confidence; the panel and the readme say so.
- **No trusted player key.** Unique players are display names (a name can change and can be shared). A
  scoped pseudonymous key needs a server-side hash of `user_id` with a secret (an owner-created view or RPC),
  read on its own select rung and never exported. Until then the count is a labelled proxy.
- **Offer context is first-sighting, not decision-time.** `OfferEvent` is recorded once when the copy first
  appears; Gold is patched only on a buy. `cost` is the base cost (222 of 6,205 live buys were below it via
  discounts; 5,390 of 30,946 offers read unaffordable at sighting). Affordability is approximate both ways. The
  `frozen` flag is never set on a live row, so a carried-over offer is one row at its first-sighting wave and
  cannot be told from a single pass. Episodes are wave-level. Fields that would make episodes exact (NOT added
  here; the store hot path is untouched): a per-offer sequence / decision index, an expiry reason (bought,
  rolled, wave end), the price actually charged, `frozenAtWaveEnd`, an episode id per roll, the run id on the
  telemetry row, and the rune forge wave with its offered trio inside `derived`.
- **Strata are thin.** Round band x shop tier already leaves most cards with 1 to 4 supported strata; hero,
  Gold beyond affordability, health, board strength, positioning, synergy and player intention are
  uncontrolled and stated so.
- **Stacked streams.** Until the derive-reset fix merges, the flat arrays keep carrying earlier runs; the raw
  table stays inflated by design (audit continuity) and the segmented counts sit beside it.
- **Replay-derived surfaces.** `tierByWave`, `offeredRunes`, `pickedRunes` and the shop curve come from a
  replay that disagrees with the live wave count on 91 of 110 rows. "Reached the forge" is inferred.
- **Hero trios** are missing on 25 of 110 runs; the offered comparison covers the rest and pools revisions on
  the historical read.
- **Tier decisions** count a decline only when the run ended the wave still able to afford the tier-up; with
  live players almost always taking an affordable tier-up, every tier reads insufficient.

## Verification

- New tests: `packages/sim/src/reportCohorts.test.ts` (segments; Welch suppression and the t table; the
  evidence gates; the exposure confounding fixture: raw negative, exposed and adjusted zero; opportunity
  validity: unaffordable, never affordable, crossover, prior acquisition, same-wave grant, carried-over buy;
  one vote per run per card with copy conversion separate; no comparable controls is unavailable not zero;
  uneven support excluded with counts; buyer-share weighting; player concentration; missing outcomes;
  reproducibility; data quality, sanitising and epochs; an empty current epoch scopes to nothing and the
  historical read pools only explicitly; raw columns identical with and without derived streams; rows without
  a payload excluded and counted; heroes offered-not-chosen; tier decisions; the two economy denominators).
  `balanceFetch.test.ts` learns `.range()` (paging until a short page, the cap, a failed page, clamping).
  `balanceExport.test.ts` asserts the schema version, the new meta keys and every nested column name;
  `reportFilters.test.ts` the new counts.
- Live check on the worktree's dev server (5238) against the real backend, read-only: the default epoch read
  "Insufficient current data" (6 of 116 runs on this build's revision) with both choices; the historical read
  showed the banner (116 runs, 8 display names, 120 flat rows fetched, cap 5000, complete; 116 of 116 derived,
  cap 800; 53 stacked; 95 replay tier tables disagree; 25 without a hero trio), the Minions Performance view
  with the candidate rows first and insufficient rows below, the Heroes table with the offered comparison, the
  Shop Tiers disclosure, curve, reach table and decision table. The memo chain over 110 rows costs ~60 ms in
  node (cardImpactWithCoverage ~35 ms), computed once per rows / filter version.
- Gate: `npm run typecheck && npm run lint && npm test && npm run build:web`; `npm run docbot:report -- --check`.
