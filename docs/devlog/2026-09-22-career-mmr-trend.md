# 2026-09-22 — Career: the MMR trend line + the All time window

Owner ask (2026-09-22, with a screenshot of the Career page's Performance Trends panel): *"add to the
performance trends an 'MMR' line graph that tracks mmr over time. also add an 'All time' tab so there is
7/30/90 days and all time."* Branch `feat/career-mmr-trend`. Everything is in `packages/ui/src/`
(`careerData.ts`, `Career.tsx`, `remoteBoards.ts` + the three Career tests); no server change.

## The MMR series

- **Where the number comes from.** `CareerRun.ratingAfter` — the MMR after the run settled, the rank scalar
  (100 × division index + points) that the Seasonal Ranked crest already prints as "N MMR". It is the stamp
  `settle_rank` writes onto the `run_history` row (`entry.ratingAfter`; see
  `2026-09-20-medal-rank-rules-server.md`). Since #1594 the client never writes it, so the server's value is the
  only one on any row. Read off the detailed entry, else the new light alias `rating_after:entry->>ratingAfter`
  in `CAREER_LIGHT_SELECT` (the same `->>` shape as its neighbours; a row the stamp never reached projects
  NULL, never an error, so a pre-migration row can't break the select). `num()` parses the text, so `"0"` is a
  real 0 and a missing key is `null`.
- **Raw, not smoothed.** `trendSeries` gains `mmr`: one point per run in the window with `ratingAfter !== null`,
  oldest first, `y` = the actual rating (rounded to a whole number). It deliberately bypasses `runningSeries`
  — a rating is a STATE (the ladder position the player held), not a rate; a running mean would draw a number
  no player ever held and would smooth a season reset into a slope. The `TrendSeries` doc says so beside the
  smoothing note, and `careerData.test.ts` pins the raw values, so the next session does not "fix" it back.
- **Headline** = the latest point's MMR in the window (`avg` keeps its field name so `TrendChart` needed no
  change; the doc reads "for MMR: the latest point"). On a 7d window with no rated run this week the chart is
  EMPTY ("No rated runs in this window") while the crest above still prints the current scalar — correct: the
  chart is what happened in the window, the crest is where you stand.
- **Skips, never zeros.** `!== null`, never truthiness: the live Bronze I floor rows (5th / 7th / 8th at 0 → 0,
  delta 0) plot as three real points; practice, unrated and unstamped runs contribute nothing. A season reset
  inside the window (everyone back to 0 on 2026-09-20/21) draws as the cliff it is.
- **Axis** (`mmrAxisOf`, pure + tested): the window's ratings snapped OUT to whole 100-point divisions — from
  the division floor strictly below the lowest rating (clamped at 0) to the division ceiling strictly above the
  highest, always at least one division tall. Chosen over the 0-based APM shape because a rating is a ladder
  position and the divisions are its natural grid: a Diamond player's 1,200s read within 1100–1300 (with the
  middle grid line on a promotion gate) instead of as a flat line at the top of a 0–1300 box. Chosen over bare
  min..max because the floor rows (0 → 0 → 0) would degenerate and a 40 → 46 wobble would inflate to full
  height; snapped, they sit low in a 0–100 box. A rating exactly on a gate never lands on a box edge; a reset
  widens the box down to 0. Examples: `[86, 100, 110]` → 0–200, `[1201, 1234]` → 1200–1300, `[1234, 0, 16]` →
  0–1300, empty → 0–100.
- **Order:** MMR is the FIRST chart. It sits directly under the Seasonal Ranked card whose caption prints the
  same scalar; with the newest run in the window its headline is that same number, so the eye reads crest →
  number → line, and the three rates that explain it follow. The existing three charts are untouched
  (placement inverted 1–8, win rate 0–100 %, APM 0–`apmAxisMax`).
- Static inline SVG only, the same `TrendChart`; nothing animates, nothing reads layout, the series is built
  once per `[runs, window]` in the existing memo.

## The All time window

- `TrendWindow = 7 | 30 | 90 | 'all'`, `TREND_WINDOWS = [7, 30, 90, 'all']`, `trendWindowLabel()` → "7d" /
  "30d" / "90d" / "All time". `'all'` is handled BY NAME in `trendSeries` (`since = null`, no `>=` test at
  all) — never a magic day count. The NaN guard still keeps undated runs out of every window, and the
  `nowMs + 60 s` upper bound still applies. Default stays 30d.
- Honest bound: All time sees the runs the page hands in — the newest `FETCH_LIMIT` (1000) light rows. That is
  every run any account has today by a wide margin; the doc comments on both constants say so rather than
  promising more.
- The viewed-player path reads the same light select (`fetchMyRuns(…, { userId })`, RLS `to authenticated`),
  so their Career shows the MMR chart and the All time tab too.

## Tests

- `careerData.test.ts`: `ratingAfter` on both row shapes ("0" is a real 0, a missing key / explicit null is
  null, the entry wins over the alias); the mmr series raw + oldest first per window, the headline = the
  latest point, a season reset drawn as a drop, the floor's zeros as points, no rated run → empty; All time
  with no lower bound (a 120-day-old and 100 / 400 / 3000-day-old runs join; the undated and a future-dated
  run stay out) while the 7 / 30 / 90 cases keep their exact numbers; `TREND_WINDOWS` + labels; `mmrAxisOf`.
- `Career.test.tsx`: four charts with MMR first (and after the ranked card in the DOM), the four tab labels
  and their `aria-pressed`, the foot counts and headlines per window (an unstamped row skipped, never a 0),
  the snapped axis labels, 3 polylines + 1 dot on 7d, no SMIL / canvas / `title`; a dedicated All time case (a
  400-day-old run joins) and the empty MMR chart beside a crest that keeps its number.
- `careerFetch.test.ts`: the light select carries `rating_after:entry->>ratingAfter`; assembly maps it from a
  detailed twin, a light row and a row without one (null).
- Oracle: `R-CAREER-01` (approved; refs the three tests). `docs/docbot2/final-report.md` totals moved
  168 / 82 → 169 / 83.

## Verified

- `npm run typecheck` green (pkgs + web); `npm run lint` 0 errors (46 pre-existing warnings, none in these
  files); `npm test` 751 files / 10641 tests passed, 2 skipped, no timeouts (476 s); `npm run build:web` green.
- Live, on a worktree vite (port 5222) against the live backend, signed in: the own Career (an account with no
  runs) shows the MMR chart first with "No rated runs in this window", axis 100 / 0, "0 runs", and the tabs
  7d · 30d · 90d · All time. A viewed Career (the Leaderboard's #1, 12 lobby runs, Bronze II 10/100 = 110 MMR)
  shows the crest's "110 MMR" and, directly under it, the MMR chart with headline 110, axis 200 / 0 and the
  line climbing from the floor's three 0s through 16 → 56 → 40 → 46 → 86 → 100 → 110 — raw, dips included —
  then Avg Placement 4.5 · Win Rate 50% · Avg APM 16.8, each "12 runs", on 30d and on All time (every run is
  from this week, so the two agree). The right column scrolls to the fourth chart at 1600×900 as it already
  did (`.cv2-right { overflow-y: auto }`). No console errors.

## Follow-ups

- A hover crosshair / tooltip on the trend lines (the dataviz default) was deliberately NOT added: the panel
  is static paint by contract and none of the three existing charts has one; if the owner wants per-point
  readouts it is a panel-wide change.
- If the settle stamp ever races the history insert (offline-queued uploads), the run simply has no MMR point;
  `rank_results` (own rows readable) could backfill it, as the medal-rank devlog already notes.
