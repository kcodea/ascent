# 2026-10-23 — Career Heroes: click a hero to see its games; Net MMR + sort

Owner ask: "the mouseover tooltip here is pretty ugly and redundant info. would it be possible to show the games of
that hero if i clicked on the hero so i could go rewatch them or something?", then "also add a way to sort by average
games played/average placement/net mmr. show net mmr on the hero card instead of # of 1sts". Rule:
R-CAREER-HERO-GAMES-01 (`packages/rules/src/registry/approved/foundation.ts`).

**What changed** (`packages/ui/src/Career.tsx`, `careerData.ts`, `remoteBoards.ts`, `styles.css`)

- The hero hover/focus panel (`.cv2-herotip`, portalled, layout read per show) is deleted, along with its CSS and its
  tooltip-registry entry. The panel's other lines (W-L, 1st wins, best placement, last played) are not on the card:
  the record is the Top 4 % already shown, and "last played" didn't earn a fourth stat cell.
- `HeroTile` is a memoised `role="button"` (gauntlet cursor from the global rule; Enter / Space; hover lift kept,
  a one-shot press on `:active`). A click calls the page's stable `onPickHero`: Match History tab, `heroFilter` set.
- Match History with a filter lists `runsOfHero(runs, hero, 50)` from the rows ALREADY loaded (up to 1000 light rows),
  so no list fetch. Rows older than the newest 50 overall were fetched light (no board): `fetchRunDetails` reads their
  detailed `run_history` rows ONCE per hero pick (`withRunDetails` takes only board / runes / match, so the telemetry
  join's Replay handle survives). Replay never waits on it.
- Filter chrome: "Showing [Brackus ✕]" in the practice pill style (`.cv2-ppill` + `pressable`) and a `cv2-btn-sm`
  "Back to Heroes". Leaving Match History, or opening another player's career, drops the filter. A Recent Games
  focus is ignored while filtered (it indexes the unfiltered list). Empty filtered list: a designed empty state.
- Hero card's third stat is now **Net MMR**: `ratingDeltaOf(run)` counts `ratingDelta` only when the row carries the
  `settle_rank` stamp (`run.rank`, from `entry.rank.before`), which `settle_rank` writes together with
  `ratingDelta = v_applied`. Rows with a `ratingDelta` but no `rank` (pre-medal Elo deltas, a settlement that missed
  the row) are left out rather than guessed; a hero with no counted game prints "-".
- Sort: the Performance Trends segmented control (`.cv2-seg`) over the grid: Games played (default, the old order),
  Avg placement (lowest first), Net MMR (highest first), unknowns last; `ascent.career.heroSort` in localStorage.

Recent Games (the public feed) got no hero filter: it is not one player's history, and the Career's Match History rows
already carry the same Replay.
