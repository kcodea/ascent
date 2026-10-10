# 2026-10-09 — Menus + Social performance pass

Owner ask: *"our social tab takes forever to load and is also laggy. we need a massive performance increase across our
menus and social screens. please fix"*. This is perf only: the look and behaviour are unchanged.

## How it was measured

- **A local measurement backend.** It is a tiny Node server, a scratch file outside the repo. It proxies every anon
  GET to live Supabase and stubs auth and every write locally, so no row is ever written. It also synthesizes a
  `run_history` from the top profile's 90 real `run_telemetry` rows, because RLS hides `run_history` from anon reads.
  The dev server and a prod `vite build` point at it through `VITE_SUPABASE_URL`. The real `.env` is never touched.
- **A headless Chrome driven over raw CDP.** It uses its own profile and window size (1600x900), the real GPU (RTX
  4080, ANGLE D3D11) and a 240 Hz rAF cadence. The same scripted walk runs on the prod build (`vite preview`) and the
  dev server, before and after. For each screen it records:
  - the time from click to the shell and to useful rows;
  - idle frame times, and the count of running animations;
  - a scripted scroll (6 px a frame, ~1440 px/s, a fast fling; frames over 20 ms counted);
  - tab switches;
  - CPU profiles, plus a trace for the long frames.
- The thresholds are the ask's own numbers (opens under 100 ms, frames over 20 ms). The 240 Hz budget in
  `docs/performance.md` §0 is stricter, and the scroll p50 below says honestly where we are against it.

## Root causes (Social)

1. **Slow load: one query.** Social lands on the Career page, which waited on `Promise.all([run_history light,
   run_history detail, run_telemetry probe])`. The probe selected `replay->v2->frames->0/-1->>tMs` (plus seed and
   version) over up to 1000 rows. Every listed replay is hundreds of KB to MB of compressed jsonb, so Postgres
   decompressed and parsed each one whole. On live it took 0.6-3.3 s, and often hit the statement timeout (HTTP 500
   at ~3.2 s) and then retried without the clocks. **Cold open: shell at ~60 ms, rows at 3.3-4.4 s.** Recent Games
   (1-3.5 s, also 500s) and the practice lists (0.5-1.4 s) had the same disease.
2. **Lag: 752 running CSS animations.** The Career mounted all 25 match banners at once, which is 175 real `Card`s
   with their keyword FX (Reborn wisps, ward glass, spinning rings, shards), all animating offscreen. **Career idle was
   ~24 ms a frame** (a blank page is 4.2 ms), every scroll frame was over 20 ms, and switching back to Match History
   re-mounted all 175 cards (~55-73 ms). Recent Games: 821 animations and a 25 ms idle. The Hall: 400 animations.
3. Every ladder page cleared its list and refetched on **every** open and sidebar hop. The Hall ran a three-stage
   waterfall each time (~0.9 s).

The other menus measured fine before (Settings, Patch Notes, mode picker, Practice setup, Collection and its tabs,
Leaderboard: all open in 2-15 ms, idle at 4.2 ms, scroll clean). They are unchanged apart from the shared fixes.

## What changed

- **SQL (`supabase/migrations/2026-10-09-replay-facts.sql`, mirrored in `schema.sql`): RUN ON LIVE 2026-10-09 by the
  owner.** It adds STORED generated `tp_*` columns on `run_telemetry` (seed, v2 version, first/last frame clock,
  active ms, final board, record, partial, first wave, lobby/board strength) and on `practice_games` (v2 version,
  match, active ms), plus `(user_id, created_at desc)` indexes. The client asks for the `tp_*` columns first. If they
  error, `remoteBoards.withReplayFacts` falls back to the old JSON-path selects for the rest of the session, so the
  build works with or without the SQL.
- **Progressive Career** (`careerLoad.ts`, `fetchMyRuns({ onHistory })`):
  - the run_history rows paint as soon as they land (~0.25 s);
  - the telemetry join (Watch, run length, the APM line) streams in behind them;
  - one shared request per career key;
  - stale-while-revalidate: the same player's previous answer paints at once, even after a new game bumps
    `careerVersion`;
  - a refresh carries the old Watch handles until its own join lands;
  - the first render of an open reads the cache directly, so there is no loading frame.
- **Social cache** (`socialCache.ts`): a tiny stale-while-revalidate cache for the Leaderboard, the Hall and Recent
  Games:
  - shared in-flight requests;
  - a 60 s freshness window;
  - an empty answer (the fetchers' failure shape) never blanks a list;
  - the Hall publishes its records first and its facts after.
- **Idle prefetch** (`socialPrefetch.ts`, from the title):
  - warms your career, the Leaderboard and the Hall;
  - warms Recent Games only once the `tp_*` columns are known to exist, so the heavy pre-SQL query is never run
    speculatively.
- **Lazy + paused rows** (`lazyRows.tsx`, one IntersectionObserver per list):
  - Career, Practice, Recent Games and Hall rows mount as they near the view (3-4 eager, one mount per frame);
  - a mounted row far away gets `.is-far`, which pauses its looping animations;
  - no containment, so tooltips and glows are untouched.
  - `content-visibility: hidden` was tried for far rows first. It idled cheaper, but every row coming back cost a
    measured ~290 ms frame on the Hall, so it was dropped.
- **Memoised match banners.** `MatchRow` is `memo`'d with a stable `onWatch(run)`, and the skins context value is
  memoised, so a trend-window click or a Watch press no longer re-renders 175 cards.
- **The covered title is skipped.** Once a full-screen menu page has faded in (300 ms), the title underneath gets
  `.titlescreen.covered` (`content-visibility: hidden`). Back un-skips it: measured max 6-9 ms over the next 60 frames.
- **No forced style in the lazy root.** `getComputedStyle` right after the page mounted forced a full recalc (25-46 ms
  of the open). It now reads after the first paint, when it is free.
- **The first menu click no longer queues ~400 SFX samples inside the gesture.** `prefetchSamples` moved to the next
  task, which saves ~10 ms of the first click's frame.

## Numbers

### Prod build (`vite preview`)

| | before | after |
|---|---|---|
| Social cold open (clicked as soon as the title is up), rows | 1.36-1.53 s (mock) / **3.3-4.4 s** (live probe) | **0.41-0.42 s** (`tp_*` live) |
| Social open after the title settles (prefetched), rows | 3.25-4.14 s | **63-79 ms** (no request but the profile sync) |
| Social reopen | 54-67 ms + a 3 s refetch, frame up to 513 ms | **8 ms**, no refetch inside 60 s |
| Career idle frame p50 | 24.5-33.5 ms (752 animations) | **4.2 ms** (106) |
| Career scroll, 1st pass (fast fling) | p50 33 ms, **87/87 frames > 20 ms** | p50 9.5-10 ms, 18-19 of ~250 > 20 ms (row mounts) |
| Career scroll, 2nd pass | p50 31 ms, 95/95 > 20 ms | p50 8.3-9.2 ms, 5-7 of ~300 |
| Tab switch back to Match History | 53-73 ms | **8-12 ms** |
| Recent Games open, rows | 3.0-3.6 s | **23 ms** (prefetched) |
| Recent Games idle p50 / scroll > 20 ms | 25.7 ms / 112 of 114 | 6-12 ms / 10-14 of ~240 |
| Hall open, rows | 0.30-0.42 s, refetched every open | **14-17 ms** (cached) |
| Sidebar hops (warm) | 14-74 ms, refetch each time | 4-24 ms, none |
| Leaderboard open | 210-273 ms | **4 ms** |

### Dev server

| | before | after |
|---|---|---|
| Social open (prefetched), rows | 3.30 s | **80-82 ms** |
| Social cold open (immediate) | n/a | **0.42 s** |
| Career idle p50 | 23.5 ms | **4.2 ms** |
| Career scroll 1st / 2nd, frames > 20 ms | 86/86, 99/99 | 18-23 / 4-8 |
| Match History tab switch | 90-120 ms | 15-18 ms |
| Recent Games open | 4.8 s (500 then fallback) | **44 ms** |

### Social network waterfall (live, anon, `tp_*` vs JSON paths)

| read | before (JSON paths) | after (`tp_*`) |
|---|---|---|
| Career telemetry probe, 90 runs | 1.35-5.4 s, often HTTP 500 + a no-clock retry | **0.12-0.22 s** |
| Recent Games, 20 rows | 0.9-3.9 s, sometimes 500 | **0.25-0.36 s** |
| Practice list, 20 rows | 0.95-1.42 s | 0.33-0.54 s (208 KB, the match subtree) |
| run_history light + detail (unchanged) | ~0.25 s, in parallel | same, now the only thing the page waits on |

- **Before (cold Social):** profile, the two `run_history` reads and the probe all fired at once. The page waited for
  all of them, then on a 500 the probe re-ran without the clocks. Rows appeared at 3.3-4.4 s.
- **After (cold Social):** the same four reads fire at once, plus the profile sync. Rows appear when `run_history`
  lands (~0.27 s), and the probe (~0.15 s) joins in the background. On the title, the prefetch makes the same reads
  plus the Leaderboard (1), the Hall (3 stages + boards) and Recent Games (1), so the first Social open asks nothing.

## Known leftovers (not fixed here)

- **The visible cards' looping FX** still cost the main thread several ms a frame on the Hall and Recent Games.
  Pausing every card animation in a test brings the Hall idle from ~9.5 to 4.2 ms. That is the card look itself
  (combat pays it too), so it is not touched here.
- **A fast fling's first pass** still drops some frames as rows mount and first raster on the GPU (traced: GPU raster
  flushes up to ~85 ms; no long JS).
- **A Social click within ~0.3 s of the title appearing** can share a 450-670 ms frame with the boot's own work (Pixi
  shader compiles, GPU uploads). It is not seen once the title has settled.
- **`board_results` is still read in full at boot** (4 x 1000-row pages, ~250 ms each). It is boot work, not a menu.
- **`lazyRows.tsx` duplicates the idea of the Compendium's `bookLazy.tsx`** (#2009). It adds the far pause and a
  scroll-parent root. They could be merged into one module later.

## Verification

typecheck, lint, the ui tests (new: `socialCache.test.ts`, `careerLoad.test.ts`; `careerFetch.test.ts` covers the
`tp_*` path, the fallback and the progressive hand-over) and `build:web` are all green. Screenshots of the Career, the
Hall, Recent Games and the title-after-Back were compared before and after on the prod build, and they match.
