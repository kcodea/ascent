# The live derive state now starts fresh for every new run

**Date:** 2026-09-22 · **Branch:** `fix/derive-state-reset-between-runs` · **Owner report (verbatim):** "The live
derived telemetry (derived jsonb on run_telemetry, built by the live path of packages/sim/src/runDerive.ts:
beginDerive / observeAction / finishDerive, driven from packages/ui/src/store.ts) accumulates across runs in one
browser session. A read-only probe of the 114 live rows on 2026-09-22 found that 53 payloads' gold[], boards[] and
offers[] contain earlier runs' events in front of the uploaded run's own."

## What was wrong

The store holds two per-run observers: `telemetryLog` (the flat offered / bought streams) and `deriveState` (the
Balance Report's `derived` payload). Both are folded forward on every dispatch. They were reset only by `clearRun`
and the two Scene Builder rigs. The doors a player actually walks through, the hero picker (`pickHero`, which
creates every lobby, Ascent and Practice run), `newRun` and `startTutorial`, installed a new `run` and kept the
previous run's observers, so `beginDerive` never ran for the new run and its events were appended behind the old
run's. One browser session that played three runs uploaded the third with all three inside (`wave` dropping back
to 1 twice). `combats[]` did not stack because it is keyed per wave from the run itself, which is why the last
segment's final wave still matched `finalWave` on 52 of 53 rows.

## The fix

`freshObservers(run)` in `store.ts` returns `{ telemetryLog: emptyTelemetryLog(), deriveState: beginDerive(run) }`
and is spread into the three run doors beside `RANK_SLICE_RESET` (which had exactly the same "a new run resets the
previous run's slice" job and the same three call sites). `continueRun` never comes through here: a resumed run
keeps the observers its save carries. The read side is untouched: `playerReport.ts` `ledgerSegment` keeps the
last wave-monotone segment so the 53 stacked rows already banked still read as one run each.

## Pinned by

`packages/ui/src/deriveResetBetweenRuns.test.ts` plays two lobby runs back to back through the real store (the
first spends Gold on a refresh) and asserts the second upload's `derived` holds no refresh, exactly the second
run's opening offers, and no wave drop across `gold` / `offers` / `boards`; a second case covers `newRun` and
`startTutorial` from the store state. Both fail on the unfixed store. Oracle rule `R-REPORT-02`.

No patch note: a telemetry data fix, nothing a player sees.
