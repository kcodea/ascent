# 2026-09-22 — Balance Report round 2: heroes, runes, shop tiers, the Gold economy

Owner ask (verbatim): *"the update to minion/spells on the balance report is gorgeous. can you apply the same
updates to heroes, runes, shop tiers? and can you help clean up and improve the overall economy table? i want
to use that as a means of seeing what the average gold a player has/spends per round and get better
understandings of the curve there. remove the card demand one cause it seems redundant with the new minion
table."*

Branch `feat/balance-report-heroes-runes-tiers-economy`, extending the round-1 rework
(`2026-09-22-balance-report-active-set.md`). Oracle rule **R-REPORT-01** extended (one delta implementation;
the export mirrors the screen). Patch note under 2026-09-22 "Balance Report round 2".

## One delta implementation

`cardImpact`'s inline math (group mean, baseline by subtraction from the pool, pooled-variance 95% interval,
Wilson on top-4, the delta shrunk by n / (n + 20)) became **`placementImpact(places, pool)`** in
`packages/sim/src/playerReport.ts`. `places` = the placements of the group's placed runs; `pool` = the
placements of every run the group is compared with, the group INCLUDED (the baseline is the pool minus the
group). It returns the shared `PlacementStats` (placedN, avgPlace, firstRate, top4Rate, lastRate, top4Ci,
baselineN, baselineAvgPlace, delta, deltaCi, impact). `cardImpact` spreads it; the existing hand-checked
numbers in `cardImpact.test.ts` did not move. `sortByImpact` and the generic `groupImpact` (the roll-up behind
the tier / tribe / forge chips) are shared the same way.

How each section feeds it:

- **Heroes** (`heroImpact`): group = the runs that picked the hero; pool = every placed run. Every run has one
  hero, so the delta is the hero against the rest of the field and the n-weighted deltas balance out across
  the roster. There is no tier-style adjustment to make; the legend says so and leans on the 95% range. The
  offer / pick / round-wins figures of the old flat table are carried over. The table reads the whole set slice:
  the hero picker is disabled on the Heroes section (slicing the hero table to one row against nobody answers
  nothing).
- **Runes** (`runeImpact`): group = the runs that took the rune; **pool = the placed runs that were OFFERED it**
  (`offeredRunes` ∪ `pickedRunes`), so the baseline is the runs that were offered the rune and skipped it. A
  rune is only offered to a run that survived to its forge (turn 6 Basic, turn 9 Epic), and against the whole
  field every rune reads green; the controlled baseline is the fair read and is the `Delta` column. The
  uncontrolled read is carried as `Vs Field` (+ its 95% range in Detailed). Runes have no rarity or tier field
  (schema: `epic`, `cost`, optional `tribes`), so the strip is **Forge** (Basic / Epic, from `epic`), `Cost` is
  a sortable column and `Tribe` shows the gate in Detailed. Offers and picks are per run (the telemetry sets
  are deduplicated).
- **Shop tiers** (`tierImpact`, T2 to T7): for each tier, `waveReached` = the first wave `tierByWave` is at or
  above it. `Reached` / `Reach %` / `Avg Wave` describe who got there and when. The **cut wave** = the average
  rounded; the **early runs** reached the tier on or before it; group = the placed early runs, pool = every
  placed run, so `Delta` = early vs later-or-never, the early-vs-late question. `Vs Never` (reached at all vs
  never) is carried but reads green for every tier, because never-reached is the early eliminations; the hover
  says so. T7 (reachable via `tier7Access`) gets its usually-empty row. `ShopCurve` is untouched (its
  `avgWaveToTier` still stops at 6; the tier table computes its own).
- **Cards**: unchanged in meaning; `Vs Tier` stays card-only.

`ImpactSection` in `BalancePanel.tsx` is now generic over any row carrying `PlacementStats`: the legend, the
strips (which filter), Table / Chart, Compact / Detailed, the sortable table with a hover per header AND a
plain-words hover per row name (`tipOf`), and the ranked diverging bar chart. Heroes, runes and tiers get the
chart too. The shared placement columns are one factory (`placementCols(group, baseline)`) worded per section.

## The Gold economy, rebuilt

`goldEconomy(rows)` in `playerReport.ts` takes the flat rows (a `DerivedRun` carries no placement; the
buckets need `row.placement`) and folds each derived Gold ledger into rounds with `runLedger`:

- The ledger stamps every event with the wave the ACTION happened on, so the per-turn refill, which happens
  inside the action that advances the wave, is the LAST event of the wave it closes: an `income` whose
  `goldAfter` is the next round's opening Gold. Wave 1 opens on `CONFIG.startEmbers` (3) with no event.
- **Start** = `goldAfter - amount` of the round's first event (the Gold before anything moved), or the carried
  refill when the round has no event at all (nothing bought or sold, and the refill changed nothing).
- **Income** = positive non-sell, non-refill events (card payouts, hero effects). **Sold** = sell events.
  **Spent** = every negative event, split into minion / spell / upgrade / refresh / rune / heroPower / other
  (other = the ledger's ruby, henchman and other, which no live run has used).
- **Unspent** = `refill.goldAfter - refill.amount` (the Gold on the table when the round closed), or the last
  event's `goldAfter` on the final round. It is lost: the reducer SETS `embers` to the new cap, it does not add
  the leftover. For every run, Start + Income + Sold = Spent + Unspent (asserted in the test).
- A diverged ledger is skipped; a row without one is skipped. `runs` = the runs in each bucket; `skipped` =
  the ledgers left out.

Two things the LIVE ledgers taught the builder (read-only probe of the 114 rows, 2026-09-22):

- **53 of 114 ledgers carry earlier runs of the same session in front of their own.** The wave number drops
  back to 1 where the next run began (row 119's `gold` holds three wave-1..13, 1..14, 1..16 segments; row
  118, played just before it, holds the first two). `boards[]` and `offers[]` stack the same way; `combats[]`
  does not; the last segment's final wave matches `finalWave` on 52 of the 53. So the live derive state is
  not reset between runs in a session and the uploaded run is the LAST segment. `ledgerSegment` keeps the
  events after the last wave drop. The capture bug itself is out of this feature's scope (`store.ts` /
  `runDerive` live path) and is flagged separately; `upgradeShape` still pools the stacked upgrades.
- **Seven ledgers open on 999 Gold** (a dev build's cheat Gold; four are the unstamped set-3 rows the round-1
  devlog lists, three are stamped set 2). Before the guard they alone lifted the wave-1 Start average to 30.
  A ledger whose wave-1 opening is not `CONFIG.startEmbers` is skipped and counted (`skipped`), and the
  economy legend says how many.

One row per round, per bucket: `all` (every run with a ledger), `first`, `top4` (1 to 4), `bottom4` (5 to 8).
The screen shows ONE table at a time with a bucket switch above it, Compact (Runs, Start, Spent, Spent %,
Unspent, Minions, Spells, Tier Ups, Rolls) / Detailed (+ Income, Sold, Runes, Hero Pwr, Other), every column
explained on hover and the wave's row in plain words on its name. The Chart view is a static SVG line chart:
Gold available (all runs, gray), Gold spent (all runs, amber), Gold spent (1st place, green), direct-labelled
at the line end with a legend beneath. The old `goldCurve` (whose Income column was really the next wave's
opening Gold) is deleted with its test.

## Card Demand removed

The dropdown entry, `DemandTable`, the `demand` export key and its readme prose are gone. Nothing else used
`cardDemand` / `CardDemand`, so both left `runDerive.ts` with their four tests in `runDerive.test.ts`. The
export's `aggregates` are now `report, impact, byTier, byTribe, heroImpact, runeImpact, byForge, tierImpact,
economy, upgrades`, each with its readme prose naming every column (the export test asserts it for every
table, nested keys included).

## Verification

- New tests: `packages/sim/src/reportImpact.test.ts` (the helper on a hand-checked pool; heroes: offer / pick /
  delta / interval / shrinkage / sort; runes: the offered-and-skipped baseline vs the field delta, per-forge
  roll-up; tiers: `waveReached`, reach, cut wave, early group, vs never, an unreached tier; economy: the ledger
  fold on the live event shape including a no-event round and the last round, the identity, the bucket
  averages, diverged and missing ledgers skipped). `balanceExport.test.ts` asserts the new aggregates equal the
  functions over the same rows, the readme names every column of every table, and `demand` is gone; its
  fixture ledger now has the live shape (the buy, then the refill that closes the wave).
- Live check on the worktree's dev server (5228) against the real backend, read-only: the Heroes, Runes and
  Shop Tiers sections, the economy table and chart, the dropdown without Card Demand, and the export parsed.
- Gate: `npm run typecheck && npm run lint && npm test && npm run build:web`.
