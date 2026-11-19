# 2026-11-19 — The Shop's per-action commit: three compositor fixes, measured per action

Branch `perf/commit-floor-ui` (from `perf/commit-floor`, measured on top of the nine open perf PRs: #2780, #2781,
#2784, #2786, #2788, #2789, #2790, #2791 and #2794). Rules `R-PERF-ROW-SLIDE-01`, `R-PERF-BADGE-POP-01`,
`R-PERF-HOVER-SUBJECT-01`. The bench flag that produced the per-action split, `perf:apm --per-action-trace`, is its
own PR on top of #2794 (`perf/apm-per-action-trace`).

The brief: with all nine perf PRs, at 7.5 actions a second a quarter of frames were still over 6.25 ms, and one
action still cost about 100 ms of main thread with the effects off. Cut that per-action cost with nothing on screen
changing. The owner's scenario is fast play (4 to 8 actions a second) on an engine board (Karwind) where every play
buffs the whole board.

## 1. What one action costs, split (before this PR)

`npm run perf:apm -- --per-action --per-action-trace`: before the burst, one action every 1.2 s, each one's 250 ms
under a timeline trace; main-thread SELF time by category, less the median idle 250 ms. Prod bench build, Chrome 150
headless on the real GPU, every request off 127.0.0.1 blocked, the machine shared with other builders.

| action | n | main ms | script | style | layout | paint | elements restyled | Recruit renders | card renders |
|---|---|---|---|---|---|---|---|---|---|
| sell | 18 | 129.8 | 53.9 | 27.2 | 0.6 | 44.7 | 1180 | 1 | 53 |
| cast | 9 | 145.5 | 55.0 | 26.1 | 5.1 | 50.3 | 1785 | 1 | 44 |
| refresh | 3 | 70.1 | 37.4 | 12.3 | 2.2 | 17.0 | 1054 | 1 | 9 |
| buy | 18 | 124.4 | 39.1 | 30.5 | 2.7 | 48.2 | 1726 | 1 | 48 |
| play | 18 | 173.4 | 65.7 | 27.8 | 7.5 | 68.7 | 1474 | 2 | 49 |

The slices an action adds, all kinds together: script (`FunctionCall`) 47 ms, **`Layerize` 36 ms**, style
(`UpdateLayoutTree`) 27 ms, then PrePaint, Commit, Paint and Layout at 4 to 5 ms each.

What that says, against the brief's four levers:

- **React is not the floor.** `Recruit` renders once per action (twice for a play); `render:recruit` is 1 to 10 ms
  of it. The zones are already memoised components with narrow props (`TavernRow`, `WarbandRow`, `HandRow`,
  `ShopControls`). The ~50 card renders per action are the stat roll stepping at 60 a second on the buffed badges at
  this slow pace (R-PERF-STAT-ROLL-01 keeps those to the badge). Splitting `Recruit` further buys a few ms at most,
  so this PR does not do it.
- **The biggest single cost is the layer list.** `Layerize` (Blink's `PaintArtifactCompositor::Update`) runs on
  every frame that changes a layer in a way the compositor cannot do alone. Two things did that on every action:
  the rows' slide (a GSAP tween writing `transform` each frame) and the stat badges' pop (an additive Web Animation,
  which never runs on the compositor).
- **Style** is 25 to 30 ms an action. Part of it was a hover rule shape that restyles every card the pointer crosses.

## 2. What changed (nothing on screen)

1. **The row slide is a compositor animation** (`rowSlide.ts`, R-PERF-ROW-SLIDE-01). When a row changes, the
   survivors slide over `commitMs` (200 ms) from their old spot. `slideHome` animates the `translate` property as one
   Web Animation per moved card: GSAP's `power2.out` as a 48-point `linear()` easing (under 0.1 px off on a 300 px
   slide; a cubic-bezier of the same curve where `linear()` is not parsed), the same duration, the same death hold
   (`fill: backwards`). `translate` composes with the card's own `transform` (drag shift, hover lift, the buy slide)
   the way GSAP's `x` did. A second slide on a card cancels the first. The row FLIP no longer reads a computed
   transform or kills the card's `transition`.
2. **A stat badge's number pop runs on the compositor when it is alone** (`Card.tsx`, `fx/popStack.ts`,
   R-PERF-BADGE-POP-01). Same keyframes, easing and duration, in the replace mode. It stays additive while a `react`
   layer pop (a Ruby gem's) is playing OR built and waiting to land on that badge (`popsOn`: the react layer notes
   its paused pops when it builds them), so the two scales still multiply exactly as before.
3. **Menu boards are "pointed at" by an attribute** (`pointedBoard.ts`, R-PERF-HOVER-SUBJECT-01). Three rules read
   `.lb-row:not(:hover) .lb-team *` (and the same for `.gc` and `.rgp-board`) to keep menu boards' card loops still
   until hovered. Blink keeps one invalidation set per pseudo-class for the whole stylesheet, so that universal
   subject made every hover change on any element restyle its whole subtree: every card the pointer entered or left
   in a game. A delegated `mouseover` stamps `data-pointed` on the menu board under the mouse; the rules read
   `:not([data-pointed])` inside `(hover: hover)`, where the build's hover guard used to put them. In a game nothing
   matches and nothing is written. `hoverSubjects.test.ts` fails on the old shape anywhere in the UI's CSS.

Checked by trace that the animations really run on the compositor: a `blink.animations` trace of a 4-a-second burst
shows every row slide, badge pop and card pop with `compositeFailed: 0`.

## 3. Numbers

### Per action (one action every 1.2 s, same sitting, before then after)

| action | build | n | main ms | script | style | layout | paint | elements restyled |
|---|---|---|---|---|---|---|---|---|
| sell | before | 18 | 129.8 | 53.9 | 27.2 | 0.6 | 44.7 | 1180 |
| sell | after | 18 | **98.0** | 59.3 | 16.6 | 0.6 | 17.5 | 1133 |
| buy | before | 18 | 124.4 | 39.1 | 30.5 | 2.7 | 48.2 | 1726 |
| buy | after | 18 | **90.4** | 33.7 | 23.0 | 2.5 | 27.1 | 1769 |
| cast | before | 9 | 145.5 | 55.0 | 26.1 | 5.1 | 50.3 | 1785 |
| cast | after | 9 | **129.2** | 53.9 | 24.7 | 4.3 | 37.6 | 1770 |
| refresh | before | 3 | 70.1 | 37.4 | 12.3 | 2.2 | 17.0 | 1054 |
| refresh | after | 3 | **61.7** | 34.9 | 9.5 | 2.2 | 13.8 | 1063 |
| play | before | 18 | 173.4 | 65.7 | 27.8 | 7.5 | 68.7 | 1474 |
| play | after | 18 | 185.2 | 78.9 | 23.3 | 7.3 | 71.1 | 1397 |

Renders are unchanged (Recruit 1, 2 for a play; cards 9 to 53). Slices added per action, before to after: `Layerize` 36 to 23 ms,
style 27 to 21 ms, script unchanged (47 / 48). A play is unchanged within the noise: its extra cost is the buff wave's
script and the paint of the rolling numbers, not the slide. An earlier sitting (the WIP build, the same three fixes
without the scheduled-pop guard) gave the same picture: sell 185 to 134, buy 134 to 113, cast 190 to 175, play 195 to 204.

### The burst (`npm run perf:apm`, round-robin, 20 s bursts, the machine 43 to 80% busy)

Two rounds of each build, alternating. At a target of 8 actions a second:

| build | runs | actions/s | mean frame ms | p95 | p99 | % frames over 6.25 ms | release to frame p50 / p95 ms | main-thread ms per action | script | style | layout | machine busy % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nine perf PRs | 2 | 7.5 (7.4-7.5) | 6.2 (5.9-6.6) | 14.6 (12.5-16.7) | 27.1 (25-29.2) | 27.3 (24.7-29.8) | 23.9 (21.5-26.3) / 33.6 (31.8-35.3) | 116.3 (114-118.6) | 40.6 | 33.8 | 1.2 | 55 |
| + this PR | 2 | 7.6 (7.5-7.6) | 5.9 (5.8-6.1) | 16.7 (16.6-16.7) | 25.1 (25-25.1) | **22.3 (20.7-23.8)** | 23.3 (22.6-24) / 32 (29.3-34.7) | **103.8 (102-105.6)** | 42.8 | **23.7** | 1.3 | 66 (59-74) |

At 4 a second:

| build | runs | actions/s | mean frame ms | p95 | p99 | % frames over 6.25 ms | release to frame p50 / p95 ms | main-thread ms per action | script | style | layout | machine busy % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nine perf PRs | 2 | 3.9 | 5.3 (5.2-5.5) | 12.6 | 25.0 | 13.1 (11.9-14.2) | 21.9 / 34.6 (32.8-36.4) | 180.1 (174.7-185.4) | 68.7 | 40.0 | 1.4 | 68 |
| + this PR | 2 | 3.9 | 5.2 (4.9-5.6) | 12.5 (8.4-16.6) | 24.9 (20.7-29.1) | **11.8 (9.1-14.4)** | 22.4 / 31.5 (26.8-36.2) | **160.4 (144-176.8)** | 65.8 | **32.8** | 1.4 | 62 (43-80) |

An earlier sitting with every core busy (100%) and the WIP build: at 8 a second, frames over 6.25 ms 57 to 45%, a mean
frame 9.4 to 8.4 ms, 131 to 124 ms of main thread per action, style 36 to 29; at 4 a second 206 to 190 ms, style 46 to 38.

Read it as: style per action down a quarter at both rates, main thread per action down 11% at both rates,
frames over 6.25 ms down 5 points at 8 a second. p95 / p99 sit on the 240 Hz frame grid (12.5 / 16.7 / 25 ms), so a
0.1 ms shift moves them a whole step; read the share over 6.25 ms instead. **This does not reach the 240 fps bar**:
a fifth of frames at 8 a second are still over budget, and section 5 is what holds them there.

## 4. What looks different

Nothing, by construction: the same curves, durations, holds and keyframes, and the menu boards pause and play on
the same pointer. The one behavioural nuance: during a row slide the card's own `transform` transition is no longer
switched off (nothing writes `transform` any more), so a hover lift that starts mid-slide eases as it does at rest
instead of snapping. The `linear()` slide curve is within a tenth of a pixel of GSAP's.

## 5. What is left (biggest first)

- **Script, 35 to 80 ms an action**, most of it the Pixi effects (`fx:sim`, `fx:render`, the Dragonflame and trail
  defs) and the buff waves: `perf/pixi-fx`.
- **`Layerize` is still 23 ms an action.** What remains is layers changing for real: animations starting and
  stopping (each start promotes a layer, each end drops it), the hand card leaving, the new card mounting. Promoting
  the badges permanently would remove the start/stop churn, but badge layers measured slower on every scene before (performance.md, card raster) and can change text
  rasterisation, so it needs a capture for the owner first.
- **Style, 10 to 25 ms an action, 1,000 to 1,800 elements.** At rest a board already restyles 770 elements every
  250 ms for its loops (Ward glass, the End Turn / Refresh sheens, the hero power glow, the lobby rail foe ring):
  `perf/keyword-loops`. Per action, `body.dragging` and the hand's `.handpad` rules restyle the hand on every pick-up
  and drop.
- **Keeping one card element from shop to hand to board** (the brief's lever 2) is not done: the rows are separate
  React parents, so it needs a single positioned card layer. A play is the costliest action (185 ms) and the mount
  is part of it, but the trace puts the play's extra cost in script and paint from the buff wave, not the mount.
- Hand-card layers, refresh cost and frame image sizes: `perf/card-raster-2`.

## 6. Checks

On `perf/commit-floor` (this branch plus the nine stacked perf PRs), 2026-11-19: `npm run typecheck`, `npm run lint`, `npm run build:web` pass; `npm test` 1,942 files passed, 1 skipped (26,532 tests). The main-based PR branch applies the same commits cleanly; CI `verify` covers it on its own.
