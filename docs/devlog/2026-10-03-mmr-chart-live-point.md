# 2026-10-03: the Career MMR chart ends on the live rating

Owner decision (verbatim): "Should the MMR chart end on your live rating? yes".

## The bug

Career's Performance Trends MMR chart plotted `run_history.entry.ratingAfter` (the server's settle stamp) per run,
and its headline was the last stamped value. The Seasonal Ranked crest beside it reads the live `profiles.rating`.
Any settlement that moved the rating without writing a stamped career row (the abandon settle, switched off in
#1920, among others) left the two disagreeing: the chart said 250 while the crest said 210.

## Fix (UI only)

- `trendSeries(runs, window, nowMs, liveRating)` (packages/ui/src/careerData.ts) takes the live rating. `endOnLive`
  then makes the MMR headline the live rating whenever one is given, and APPENDS a closing "now" point
  (`{ atMs: nowMs, y: live, now: true }`) when the last stamped point differs. Chosen over replacing the last value
  because the historical points are what each run really settled at; rewriting the newest one would misstate that
  run. When the stamp already matches, nothing is added. An empty window keeps the empty chart but headlines the
  live rating.
- `Career.tsx` passes the crest's own number: the rank scalar when a rank exists, otherwise the bare rating
  (own profile or the viewed player's hand-over). While a viewed player's rank is still loading it passes null, so
  the chart shows the stamped series rather than a number about to change. The `rank` / `rankPending` derivations
  moved above the memo so the crest and the chart share one source.
- `TrendChart`'s footer counts runs only, so the "now" point never reads as an extra game.

## Verification

- careerData.test.ts: stale stamp gets a now point and the live headline; in-step adds nothing; empty window
  headlines live; null live is the old series; the rate lines are untouched.
- Career.test.tsx: a stale stamp (1250 vs crest 1234) headlines 1234, draws a line, footer "1 run"; the existing
  empty-window case now headlines the crest's 1234 instead of a dash.
- Oracle R-CAREER-02 (persistence); R-CAREER-01's statement now points at it for the headline.
