# 2026-09-20 — Career page v2 (three-column rebuild, server runs, Heroes tab) + replay-viewer follow-ups

Owner spec 2026-09-19/20: rebuild the Career page after the Battlegrounds-style mockup, "chunky and fully
readable". The WIP from 2026-09-19 (branch `feat/career-page-v2`, paused mid-tests) was finished, restructured
and gated. Everything is in `packages/ui/src/` — `Career.tsx`, `careerData.ts` (pure), `remoteBoards.ts`
(`fetchMyRuns`), the `cv2-` block in `styles.css`, plus the replay viewer items below.

## Layout

Three columns on the `.lbpage` backdrop, each a **header row + content** (`.cv2-col > .cv2-colhead`), so the
left panel, the first match banner and the Seasonal Ranked card start at the SAME top edge (owner report:
they didn't — the centre's "Match History" caption pushed its list down). Verified with
`getBoundingClientRect` at 1600×900 and 2560×1440: all three at `top: 144`.

- **LEFT** — the most-played hero in the in-run circular frame (the StatusBar's `.hero > .f > .heroimg`
  markup, re-seated without the tray transforms), name plate, player name, four tiles: 1st Place Wins ·
  Top 4 Finish · Avg Placement · Favorite Tribe.
- **CENTRE** — two tabs in the header (MATCH HISTORY | HEROES; the choice is persisted in
  `localStorage['ascent.career.tab']`, try/caught). Only this column's list scrolls; the side columns stay put
  (`.cv2-body { overflow: hidden }`, `.cv2-cols` fills the page, `.cv2-list { overflow-y: auto }`).
- **RIGHT** — Seasonal Ranked (the MMR as a bare number, no delta, no divisions) and Performance Trends
  (Avg Placement · Fight Win Rate · Avg APM as static inline-SVG polylines, 7/30/90-day toggle).

### The match banner (owner: "nothing cramped")

The WIP's side-by-side row (hero | 7 tiles | outcome) left ~80 px per tile at 1600 wide. Each match is now a
STACKED banner that reads top to bottom:

1. **head** — hero portrait (76 px frame) + name (22 px) + `9 W – 4 L` (18 px) on the left; the outcome block
   on the right: "MATCH OUTCOME" label, `VICTORY` (green, 30 px) / the placement ordinal (top-4 cream, 5th–8th
   red), then three labelled cells PLAYED · LENGTH · GOLD SPENT (13 px labels, 16 px values).
2. **team** — 7 slots holding the REAL `Card` at the leaderboard's sizing rule: `--cw` set directly from the
   row width via container units, capped at 150 px (`min(150px, (100cqw − 6·14px)/7)`), so 113 px tiles at
   1600 and 150 px at 2560. The card's typography is fixed-px, so a 2-digit stat reads at either. The compact
   card's arch is ~square, so the slot is `--tw` wide × (0.85·`--tw` + 22 px) tall with the card centred —
   its ±8 px stat badges overhang into the slot's own margin, never the neighbour's. **No "Final Team" label**
   (owner: it collided with the first tile's crown / tier stars); the row keeps 10 px of headroom for those
   overhangs, and the head's stats sit 23 px clear of the tier stars.
3. **foot** — the run's rune picks as emblems (48 px disc with the real `runeArt`, epic runes ringed ice-blue)
   + name (15 px); hover floats the rune's text in a portalled fixed panel (never a native `title`);
   "No runes recorded" when the run has none. On the right, ONE button: WATCH REPLAY (gold, gauntlet cursor
   from the global button rule; disabled when no telemetry replay exists).

The banner's left edge carries the outcome colour (green / gold / red) so a scan down the list reads results
at a glance. Match History shows the last **25** server runs (owner, up from 10).

### Readability floor

Every label ≥ 13 px, every value ≥ 15 px (measured with `getComputedStyle` over every `cv2-` text node at
1600×900: min label 13, min value 15; MMR 48, verdict 30, stat tiles 26, hero name 22). The right column fits
900 px tall without scrolling (charts 92 px; 120 px on ≥1000 px tall screens).

### States

Loading / signed-out / offline / no-backend are one designed panel (`PageState`: icon disc + 22 px headline +
15 px help + at most one action); the loading one spins its icon (transform-only). The empty list keeps the
three columns (the MMR is real) and designs the centre ("No runs yet" / "No heroes yet").

## Where the numbers come from

- **Rows** — `run_history` (light JSON-path select for up to 1000 rows: hero, wave, W–L–D, placement, Gold,
  APT, rating delta, seed, end time, dominant tribe; the newest `CAREER_DETAIL_ROWS = 25` also with the full
  `entry`, i.e. the final board). Never the Hall-of-Champions `runs` table.
- **Runes** — `entry.board.runes`: `snapshotOf` stamps the run's `ownedRunes` onto the final-board snapshot,
  so the rune ids ride inside the board jsonb already stored per run. No new column. `CareerRun.runes`.
- **Replay availability + run length** — a light probe of `run_telemetry` (id, seed, `replay->v2->>version`,
  first/last frame `tMs`), joined by SEED; length = last − first frame clock. Falls back to a clock-less probe
  on an older PostgREST.
- **Gold spent** — `entry.goldSpent` (stamped at run end). **APM** — `apt × wave` decisions over the
  recording's clock.
- **MMR** — `profile.rating`, the local mirror of the `profiles` row that `syncProfileFromServer` re-reads on
  open (the same number the leaderboard prints); another player's career prints the `rating` handed in from
  the leaderboard row.
- **Heroes tab** — `heroCareers(runs)` folds EVERY fetched run (not just the 25 banners): runs, 1st-place
  wins, summed fight W–L + win rate, avg / best placement, last played; sorted by runs desc, then win rate.

## Replay viewer follow-ups (same branch)

- **Power column removed** from the round rail (`RoundRail.tsx`, `roundInfoOf`): owner, "this stat is not
  great right now". `boardPowerOf` stays in the sim for the balance tools.
- **Drag the rail from anywhere** (owner: "literally anywhere should drag it"). The pointer handlers moved
  from the ⋮⋮ grip to the wrapper: pointerdown ARMS a drag (no preventDefault, no capture); it becomes one
  after `DRAG_THRESHOLD_PX = 4` of travel (then pointer capture + `.dragging`); a release under the threshold
  is a plain click that reaches the cell / toggle; a release after a drag swallows the click that follows
  (`onClickCapture`). Same perf shape: one rect read at pointerdown, CSS vars per move, no React render until
  release; placement + clamp unchanged. The grip stays as the affordance.
- **Card hover previews during replays.** A replayed GHOST drag (`drag.ghost`) sets the same `drag.active`
  slice a live drag does, and every `Card` read it as "the viewer is dragging" — which disables `onMouseEnter`
  and force-hides an open popup. With recorded drags every few seconds, the related-card + keyword-pill
  previews never survived playback. The three row selectors in `Recruit.tsx` now expose `viewerDrag` (active
  AND not a ghost) and that is what `Card` gets as `dragging`. Verified on a live replay: the popup stayed up
  through 6 s of playback with recorded drags in flight. Drags / clicks stay inert (`onCardPointerDown`
  still refuses them while `replaying`).

## Tests

`careerData.test.ts` (25: row shaping incl. runes, probe join, replay summary, aggregates, trends, polyline,
`heroCareers`), `careerFetch.test.ts` (6: the query shape against a mocked Supabase client, rune passthrough),
`Career.test.tsx` (20, jsdom: the header row, banners over 3 fixture runs incl. a 7-minion gilded team + two
runes, a run with no board / no replay, a light run with no telemetry; rune hover panel; outcome block; ONE
button; MMR alone; trends + toggle; loading / signed-out / offline / empty; Heroes tab + persistence; another
player's career), `RoundRail.test.tsx` (9: the four data columns, drag from the grip / a cell / the title / the
collapsed handle, click-vs-drag threshold), `replayViewer.test.ts` (13), `replayHoverPreview.test.ts` (3).

## Not done / judgement calls

- The old Career's insight grid / Share Team / board-power stat are gone by spec.
- 4-digit stats overflow the compact card's badge (visible on late-game boards); that is `Card`'s badge, shared
  with the leaderboard, and out of this page's scope.
