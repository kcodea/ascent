# 2026-11-18 — APM on an engine board: what "bogged down" is, a bench for it, and the rapid-input presentation

Owner, 2026-11-18: *"the biggest problem to me is when i have a board with cards like Karwind and im playing APM and
the game gets bogged down and nearly impossible to play. this needs to be butter smooth."*

Branch `perf/apm-engine`. Rules `R-PERF-APM-01`, `R-PERF-APM-02`, `R-PERF-APM-03`. This entry is the measurement, the
fix, and a plain list of what is still over budget and who owns it. **It is not butter smooth yet.** On top of the
eight perf PRs this one takes a frame at 7.5 actions a second from 10.2 ms to 5.9 and removes the queue; a quarter of
frames are still over 6.25 ms. Section 6 says what the rest is.

## 1. The bench: `npm run perf:apm`

`scripts/perf-apm-engine.mjs`. A production bench bundle (`VITE_PERF_BENCH=1`) in headless Chrome 150 with a real GPU
(ANGLE D3D11 on the RTX 4080 SUPER, 240 Hz frame clock), its own throwaway profile, every request off 127.0.0.1
blocked.

- **The scene.** A seeded Practice game (no clock, bot seats), Nadja. Through the store, with the game's own actions
  (God Mode's print into the shop, buy, triple, play, tier up): a **gilded Karwind**, **Firebird** (every Shout casts
  Dragonflame, which repeats once per Dragon), **Scalechanter** (every Shop spell: Dragons +2/+2), **Embermouth**,
  **Herzog**, **Transcendence**; five cards held in hand; Tier 6; the **Ancient of Bonds** awake (every Gold spent
  sends two buff trails). After the warm-up the board is 250 to 300 a body and climbing. Karwind is a Set 1 card that
  Set 2 (live) carries, so this is the live pool.
- **The burst, by real input.** CDP mouse events (press, four moves, release; a click on Refresh), never a store
  dispatch: buy a Shout minion (Broodfire Whelp, Scalefeather), play it, cast the Dragonflame it gave, sell it, refresh
  when the shop is empty. `--rate` actions a second (8 by default) for `--secs` (25). The driver is closed-loop, as a
  player is: it reads the run before each action (no layout), reads the one card's rect, and waits for Chrome to take
  each mouse event, so a slower page is driven more slowly. **Accepted actions a second is a result, not a setting.**
- **The tail.** Six seconds with no input, to see what is still playing.
- **Every refresh offers the same six minions** (the game's own refresh rolls, and the bench swaps the offers in the
  same task), so every build plays the same turn.

It reports four things separately: frames; input (press to handler, release to store, release to the first frame
after it, and actions the game did not accept); backlog (stat badges behind the run's real number, live effects, live
timers, paced steps waiting, and how long each takes to go back to idle after the last input); and main-thread cost
(CDP, the in-game monitor's labelled spans, `--profile`, `--trace`, `--trace-style`, `--per-action`). `--toggle`
switches one cost class off, `--rapid` / `--roll-step` set this PR's dials on one bundle, `--guard` is the regression
check, `--screencast` saves frames to look at.

**The machine was shared the whole day, and for the final runs all sixteen threads were busy with other builders'
tests and builds.** Two things follow. The bench raises its own Chrome and driver to High priority (without that a
run drove 55 actions in 25 s instead of 130). And the final tables were run **round-robin**: one run of every build,
then the next round, so a busy minute hits every build alike. Values are medians with the range. Frame times on a
quiet machine are lower for every build (section 4 has one such pair); the order between builds is the same.

Known limit of the scene: the held hand cards overlap, and a press meant for the bought card sometimes takes a held
one, which is then played and sold. The hand thins to one or two held cards over a run, the same on every build.

## 2. What "bogged down" is

On `origin/main` (58c8a5256), at a target of 8 actions a second: 5.2 accepted actions a second, a mean frame of
18.6 ms (p95 41.7, p99 54.2), 94% of frames over 6.25 ms, 839 ms of main-thread tasks per second.

It is **frames and input-to-picture time, not lost input**:

- **No input is blocked or dropped.** Every attempted action was accepted, in every run of every build (over 10,000
  actions across the day's runs). The only guards on a card's pointerdown are combat, End Turn's own animation, a replay, the turn timer at
  zero and a locked card. No effect, roll or beat holds input.
- **The main thread is saturated.** The frame an action lands in takes 35 to 50 ms. From letting go of a card to the
  first frame that shows it: 41 ms at the median, 55 at p95 (about 265 interactions slower than 16 ms in 25 s, 200 of them
  over 50 ms). The page takes 5.2 actions a second however fast the hand is.
- **The numbers on the board are behind the run.** Every buffed badge withholds its gain and rolls it in over 420 ms,
  a later wave's badge waits for its wave, and the next action restarts every roll. Badges were behind the real number
  in 97% of samples, four or five badges at a time, for up to 8.3 s in a row (6.2 to 11.3). At four actions a second:
  84% of the time, up to 1.3 s.
- **Presentation piles up, but it is bounded.** 22 effects alive on average and 33 at peak (0 at rest), 39 timers
  pending, about 40% more in the last third of the burst than the first, 1.8 to 2.9 s to drain after the last input.
  It settles at about six actions' worth; it does not grow without limit.

Where the time goes on main (CPU profile, traces, the in-game monitor's spans):

- 45% of the main thread is the browser itself (style, layout, paint, compositing), not JavaScript.
- **Each action's commit is one style recalculation of 200 to 370 elements**, forced by the first rect read of the
  commit (`RowFlip`'s tavern sweep): 8 to 15 ms per action with its layout. The largest single per-action cost.
- **One action costs 80 to 180 ms of main-thread time in the quarter second after it**, played alone at normal speed
  (`--per-action`, less an idle quarter second): play 182, cast 144, sell 128, buy 96, refresh 77. The page cannot do
  that eight times a second on any build.
- Pixi effects: `fx:sim` 99 to 110 ms/s and `fx:render` 69 to 72 ms/s. Dragonflame's column alone was 49 ms/s.
- React: `render:recruit` 37 ms/s, 211 renders of the Shop screen for 132 actions.
- The release handler read two rects after taking `body.dragging` off, a second whole-page restyle inside pointerup
  on every play and every sale (90 ms and 101 ms in the profile, 4 to 5 ms each).
- The GPU main thread is as busy as the renderer's (raster flush + deserialise about 520 ms/s): the card raster
  finding of the scope measurement (E1), owned by `perf/card-raster`.

## 3. What this PR changes

### The rapid-input presentation (R-PERF-APM-01)

`fx/actionPressure.ts` counts accepted Shop actions (the store notes each one before React renders it). **Rapid** is
three or more inside one second; it stays rapid until fewer than two are inside a second; End Turn ends it at once.
At up to two actions a second nothing below applies. While input is rapid:

1. **Numbers are true at once.** A stat change is printed with the badge's one pop instead of being withheld for a
   roll, and whatever an earlier action was still rolling in is printed with it (`fx/statHold.ts`).
2. **Earlier actions' paced steps that have not started are dropped** (`fx/shopFxQueue.ts`). The Shop's later buff
   waves, Shout chain links and waiting buffers are scheduled through `shopFxLater`, stamped with their action.
   Effects already playing finish, so the authored pacing still plays for as long as the player lets it.
3. **One live copy of an effect per recipient** (`fx/rapidPlay.ts`, in `playDef`): a one-shot play with no key of its
   own is keyed by who it lands on, and `fxBudget.admit`'s existing key rule does the rest (inside 250 ms: the same
   moment, nothing spawns; later: it replaces the copy it finds).
4. **Effects keep pace**: playback speed `actions a second / 3` up to 1.6, particles `3 / actions a second` down to
   60%. At three actions a second they are exactly as authored.
5. **The hand card's canvas effects are skipped**: a card granted to hand arrives at once instead of being hidden
   until its plate has re-formed, and a played card's backplate does not dissolve. (Each drew on a 2D canvas every
   frame: `drawImage` was 3.8% of the profile.)

Never touched: a play its caller sequences on (`onDone`), a loop, a follow, a play with its own `dedupeKey`, and
everything after End Turn. Presentation only: nothing the reducer, a replay or a snapshot reads. The dials are in
`fx/rapidConfig.ts` (`RAPID_FX`), writable on a bench build, so one bundle measures with and without each part.

### The stat roll steps at most 60 times a second (R-PERF-APM-02)

The shared roll loop ran once per display frame. On a 240 Hz display a 420 ms roll on 14 badges was about 1,400 badge
updates (each a render, a restarted pop and a re-draw of the card under it); a 60 Hz display, showing the same roll,
makes 350. It now steps at most every 16.7 ms on every display, and a roll that is over still prints its final number
on the next frame. This one holds at every speed.

### One layout pass and fewer renders per action (R-PERF-APM-03)

- The release handler reads the played card's plate and the Gold pill with its row snapshot, BEFORE `body.dragging`
  comes off (`dropRectsRef`). `input:pointerup` self time fell from 16.7 to 6.2 ms/s.
- A played Shout writes the medallion-pulse state only when a card takes the pulse; Karwind's pulse keeps its set
  when the same buffer pulses again; a sale's Gold float leaves in the next sale's own commit, with one sweep after
  the last sale. Renders of the Shop screen per action: 1.6 to 1.3. (What is left is Karwind's pulse turning on and
  off when Shouts are more than 760 ms apart; moving it out of `Recruit` is a follow-up.)

## 4. Numbers

Target 8 actions a second, three round-robin rounds, the machine fully busy:

| build | runs | actions/s | mean frame ms | p95 | p99 | % frames over 6.25 ms | release to frame p50 / p95 ms | main-thread ms per action | script ms per action | effects alive, mean / peak | badges behind, % of time | longest behind, s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| main | 3 | 5.2 (5.1-5.2) | 18.6 (18.4-19.2) | 41.7 (40.6-41.7) | 54.2 (49.5-54.2) | 94 (89-94) | 41 (40-42) / 55 (53-56) | 163 (162-164) | 70 (70-72) | 22 (21-22) / 33 (33-34) | 97 (94-98) | 8.3 (6.2-11.3) |
| perf/combat-render #2781 | 3 | 5.1 (5.1-5.3) | 18.2 (18.1-19.0) | 41.7 (40.0-41.7) | 50.0 (48.0-50.0) | 94 (87-96) | 41 (39-41) / 52 (52-54) | 162 (160-162) | 67 (67-69) | 22 (22-22) / 31 (31-32) | 95 (95-98) | 5.4 (4.6-12.8) |
| perf/sim-worker #2780 | 3 | 5.1 (5.1-5.3) | 18.8 (18.1-19.2) | 41.7 (40.0-41.7) | 50.0 (47.1-54.1) | 95 (88-96) | 41 (40-41) / 54 (54-56) | 163 (163-168) | 73 (70-74) | 21 (21-22) / 33 (31-37) | 94 | 5.7 (5.3-6.0) |
| perf/always-on #2786 | 3 | 5.1 (5.1-5.3) | 19.1 (17.9-19.2) | 41.7 (40.1-41.8) | 54.1 (46.4-54.1) | 94 (88-95) | 40 (39-40) / 54 (52-56) | 163 (161-167) | 70 (68-73) | 22 (22-22) / 34 (33-36) | 95 (94-97) | 8.6 (4.9-9.6) |
| perf/shared-reverb-static-shadows #2784 | 3 | 5.2 (5.2-5.3) | 18.7 (18.7-18.8) | 41.7 (41.1-41.7) | 50.0 (49.8-50.1) | 94 (90-94) | 41 (39-41) / 55 (52-56) | 162 (158-163) | 69 (68-70) | 22 (22-22) / 35 (32-36) | 96 (96-98) | 11.7 (10.1-12.1) |
| those four merged | 3 | 5.3 (5.3-5.4) | 18.4 (17.8-18.6) | 41.6 (39.3-41.7) | 50.0 (49.9-50.1) | 94 (86-95) | 39 (38-40) / 53 (52-53) | 155 (153-157) | 67 (64-68) | 22 (22-22) / 34 (34-36) | 96 (96-97) | 8.4 (6.7-9.2) |
| this PR, rapid form switched off | 3 | 5.3 (5.1-5.4) | 17.9 (17.6-19.1) | 40.0 (39.7-41.8) | 47.0 (46.0-50.0) | 91 (88-95) | 39 (39-42) / 55 (50-55) | 163 (162-166) | 70 (70-76) | 22 (21-22) / 33 (31-36) | 96 (96-98) | 11.9 (8.1-12.9) |
| this PR (before the hand-card skip) | 3 | 5.6 (5.6-6.0) | 15.4 (14.7-15.9) | 39.6 (39.1-41.6) | 46.6 (45.5-50.0) | 76 (67-82) | 39 (36-39) / 53 (49-54) | 142 (131-145) | 56 (54-58) | 14 (14-14) / 19 | 0 | 0.0 |
| the four + this PR | 3 | 5.9 (5.7-6.2) | 14.3 (14.0-15.4) | 37.5 (34.0-39.2) | 47.0 (44.4-50.0) | 72 (67-78) | 34 (33-38) / 47 (46-50) | 132 (131-140) | 55 (52-58) | 14 (14-14) / 19 (19-20) | 0 | 0.0 |

Read it as: **each pushed perf branch alone moves nothing in this scenario** (they fix other things: fights, the sim,
the fuse, the reverb). The four merged take 5% off the per-action cost (163 to 155 ms), mostly the reverb. **This PR
takes 13% off** (163 to 142), frames go from 18.6 to 15.4 ms, effects alive from 22 to 14, and the badge lag is gone.
All together: 19% (163 to 132), 14.3 ms a frame, 5.9 actions a second, release to picture 41 to 34 ms. With this PR's
rapid form switched off (the 60 a second step, the drop reads and the render fixes only) the whole-turn numbers are
inside the noise of main: those are small, clean wins, not what moves this scenario.

The final build (the hand-card canvas skip added) and the same table again, taken afterwards:

| build | runs | actions/s | mean frame ms | p95 | p99 | % frames over 6.25 ms | release to frame p50 / p95 ms | main-thread ms per action | script ms per action | effects alive, mean / peak | badges behind, % of time | longest behind, s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| main | 3 | 6.0 (5.4-6.2) | 14.5 (13.5-16.7) | 33.4 (33.3-37.5) | 37.6 (37.6-45.8) | 83 (80-90) | 33 (30-38) / 44 (41-49) | 138 (135-158) | 61 (60-68) | 24 (23-24) / 37 (36-38) | 99 (96-99) | 16.2 (6.6-25.2) |
| those four merged | 3 | 5.9 (5.9-6.4) | 14.9 (13.1-14.9) | 33.4 (29.2-33.4) | 41.7 (35.9-41.7) | 85 (81-85) | 31 (29-32) / 45 (39-46) | 134 (126-137) | 55 (52-57) | 24 (24-25) / 39 (36-40) | 99 (98-99) | 24.8 (13.0-24.9) |
| this PR (before the hand-card skip) | 3 | 6.1 (6.1-7.1) | 12.4 (8.9-13.0) | 33.3 (25.0-33.4) | 41.6 (33.3-41.7) | 69 (52-73) | 31 (22-33) / 42 (33-42) | 129 (108-131) | 53 (45-53) | 15 (15-15) / 19 (19-24) | 0 (0-0) | 0.0 |
| this PR | 3 | 6.5 (6.0-7.0) | 10.6 (8.1-12.7) | 29.3 (25.0-33.4) | 37.6 (33.4-41.7) | 58 (41-73) | 30 (22-35) / 38 (35-44) | 122 (107-134) | 46 (40-49) | 14 (14-15) / 19 (19-20) | 0 | 0.0 |
| the four + this PR | 3 | 7.3 (7.1-7.3) | 8.0 (7.3-8.6) | 24.9 (20.8-25.0) | 33.3 (29.1-33.4) | 41 (35-44) | 22 (20-24) / 31 (29-35) | 105 (101-108) | 38 (35-40) | 15 (15-15) / 22 (21-23) | 0 | 0.0 |

And at 4 actions a second in that same sitting:

| build | runs | actions/s | mean frame ms | p95 | p99 | % frames over 6.25 ms | release to frame p50 / p95 ms | main-thread ms per action | script ms per action | effects alive, mean / peak | badges behind, % of time | longest behind, s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| main | 2 | 3.9 | 10.8 (8.8-12.7) | 29.2 (25.0-33.4) | 39.6 (33.4-45.8) | 60 (50-70) | 30 (26-34) / 42 (38-45) | 179 (175-184) | 73 (71-75) | 20 (19-20) / 32 | 85 (84-86) | 1.4 (1.1-1.8) |
| this PR | 2 | 3.8 (3.8-3.9) | 7.3 (5.6-9.0) | 22.9 (16.6-29.2) | 33.4 (25.0-41.7) | 32 (16-47) | 20 (12-27) / 33 (23-44) | 147 (131-164) | 57 (49-65) | 14 (14-14) / 19 | 1 (0-1) | 0.0 (0.0-0.1) |
| the four + this PR | 2 | 3.9 | 7.7 (6.1-9.3) | 25.0 (16.7-33.3) | 35.5 (29.2-41.7) | 34 (21-47) | 23 (15-31) / 34 (28-40) | 150 (134-167) | 56 (49-63) | 14 (14-14) / 20 (19-20) | 1 | 0.1 (0.1-0.1) |

**On top of all eight perf PRs** (2026-11-19, after the restart: the local `perf/integration-bench` at f2c495441,
which merges #2780, #2781, #2784, #2786, #2788, #2789, #2790 and #2791, with and without this branch; two round-robin
rounds, 20 s bursts, the machine 40 to 90% busy). This branch merges onto it with one conflict, the patch notes list.
At a target of 8 a second, then 4:

| build | runs | actions/s | mean frame ms | p95 | p99 | % frames over 6.25 ms | release to frame p50 / p95 ms | main-thread ms per action | script ms per action | effects alive, mean / peak | badges behind, % of time | longest behind, s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| all eight perf PRs | 2 | 6.9 (6.3-7.5) | 10.2 (8.1-12.3) | 22.9 (16.7-29.1) | 31.3 (25.1-37.5) | 70 (58-82) | 27 (22-31) / 39 (31-48) | 136 (121-150) | 59 (52-66) | 26 (25-27) / 40 (40-41) | 99 | 20.0 (20.0-20.0) |
| all eight + this PR | 2 | 7.5 | 5.9 (5.7-6.1) | 12.6 (12.5-12.6) | 25.0 | 24 (21-27) | 21 (20-22) / 31 (31-32) | 112 (111-113) | 40 (39-40) | 15 (15-15) / 22 (21-22) | 0 | 0.0 |

| build | runs | actions/s | mean frame ms | p95 | p99 | % frames over 6.25 ms | release to frame p50 / p95 ms | main-thread ms per action | script ms per action | effects alive, mean / peak | badges behind, % of time | longest behind, s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| all eight perf PRs | 2 | 3.8 (3.8-3.9) | 5.9 (5.5-6.3) | 14.6 (12.5-16.6) | 22.9 (20.8-25.0) | 25 (20-29) | 22 (18-25) / 27 (24-31) | 191 (186-197) | 75 (74-76) | 19 (19-20) / 32 (32-33) | 85 (85-86) | 1.1 (1.1-1.1) |
| all eight + this PR | 2 | 3.8 (3.8-3.9) | 5.0 (4.7-5.2) | 10.4 (8.4-12.5) | 20.8 (16.7-24.9) | 10 (8-12) | 13 (4-22) / 27 (24-31) | 160 (146-175) | 62 (56-68) | 14 (14-14) / 19 | 1 | 0.1 (0.1-0.1) |

Target 4 actions a second, which every build holds, so frames compare directly (two rounds):

| build | runs | actions/s | mean frame ms | p95 | p99 | % frames over 6.25 ms | release to frame p50 / p95 ms | main-thread ms per action | script ms per action | effects alive, mean / peak | badges behind, % of time | longest behind, s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| main | 2 | 3.9 | 14.8 (14.8-14.9) | 37.5 (36.6-38.5) | 45.9 (45.7-46.0) | 72 (70-73) | 37 (37-37) / 48 (48-49) | 196 (195-196) | 83 (83-83) | 19 (19-20) / 32 (31-32) | 84 (84-85) | 1.3 (1.1-1.6) |
| those four merged | 2 | 3.9 | 12.2 (10.8-13.7) | 30.9 (27.7-34.0) | 37.9 (34.6-41.2) | 60 (52-68) | 29 (26-32) / 42 (38-46) | 189 (184-194) | 80 (77-83) | 20 (20-20) / 32 (32-33) | 85 (84-86) | 1.7 (1.5-1.8) |
| this PR (before the hand-card skip) | 2 | 3.8 (3.8-3.9) | 11.1 (10.2-12.1) | 30.9 (28.2-33.6) | 39.7 (38.7-40.6) | 49 (42-55) | 27 (25-29) / 41 (40-43) | 166 (163-170) | 71 (70-72) | 14 (14-14) / 19 | 1 | 0.1 (0.1-0.1) |
| the four + this PR | 2 | 3.9 | 12.0 (11.8-12.2) | 33.5 (33.2-33.9) | 40.8 (40.5-41.1) | 54 (53-54) | 31 (31-31) / 44 (43-45) | 172 (169-175) | 72 (70-74) | 14 (14-14) / 19 | 1 | 0.1 (0.1-0.1) |

1.5 actions a second, normal play (one run each): **nothing changes**, as intended.

| build | runs | actions/s | mean frame ms | p95 | p99 | % frames over 6.25 ms | release to frame p50 / p95 ms | main-thread ms per action | script ms per action | effects alive, mean / peak | badges behind, % of time | longest behind, s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| main | 1 | 1.5 | 7.8 | 17.2 | 34.0 | 24 | 33 / 48 | 409 | 181 | 11 / 20 | 35 | 0.3 |
| this PR | 1 | 1.5 | 7.6 | 17.0 | 33.5 | 22 | 31 / 47 | 401 | 173 | 11 / 18 | 35 | 0.3 |

One action at a time, 1.2 s apart (`--per-action`): the same on both builds (play 182 / 176 ms of main thread in the
quarter second after it, cast 144 / 150, sell 128 / 126, buy 96 / 96, refresh 77 / 77).

On a quieter hour earlier in the day (not round-robin; an earlier build of this PR, three runs each):

| build | runs | actions/s | mean frame ms | p95 | p99 | % frames over 6.25 ms | release to frame p50 / p95 ms | main-thread ms per action | script ms per action | effects alive, mean / peak | badges behind, % of time | longest behind, s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| main | 3 | 5.1 (4.3-5.4) | 16.1 (15.6-16.6) | 37.5 (33.5-37.6) | 45.9 (45.8-50.0) | 88 (86-89) | 39 (34-40) / 51 (48-54) | 170 (158-201) | 71 (69-87) | 22 (19-23) / 34 (32-34) | 94 (82-94) | 4.3 (1.9-7.2) |
| this PR (an earlier build) | 3 | 6.7 (6.3-6.7) | 10.6 (10.6-11.1) | 29.2 (29.2-29.3) | 37.5 | 62 (61-62) | 27 (27-30) / 41 (39-42) | 118 (117-124) | 49 (46-53) | 15 (15-15) / 20 (19-20) | 0 (0-0) | 0.0 |

## 5. What changes on screen, for the owner to approve

Only while three or more actions land inside a second:

- A buffed badge shows its new number at once and pops once. It does not roll. (At normal speed it rolls as before.)
- A buff wave that had not started when the next action landed does not play. A Dragonflame's hits are 150 ms apart,
  so at six actions a second its first one or two play and the rest are skipped; the stats they stand for are already
  on the badges.
- A minion wears one copy of a trail or burst at a time. A second one inside a quarter second is skipped.
- Effects run up to 1.6 times faster with down to 60% of their particles, from five actions a second.
- A card added to your hand appears at once (no materialise), and a played card's backplate does not dissolve.

Captures of five seconds of the burst at a target of 8 actions a second (an animated WebP and an eight-frame sheet
each), on the owner's machine in `.claude/perf-scope-2026-11-18/apm-captures/` under the primary checkout:
`main-8aps`, `eight-PRs-8aps` (the authored presentation on the fast build) and `eight-PRs-plus-apm-8aps` (the
rapid form).

And at every speed: a rolling number changes its digits 60 times a second instead of 240 on a 240 Hz display. I could
not see a difference; it is listed because it changes how an authored roll is drawn.

Dials, if any of it reads wrong: `RAPID_FX` in `packages/ui/src/fx/rapidConfig.ts` (each part has its own switch;
`maxSpeed: 1` and `minIntensity: 1` turn the pacing off), `RAPID_ACTIONS` in `fx/actionPressure.ts`.

## 6. What is left, and who owns it

The same run with one cost class switched off (`--toggle`, on this PR's build, two runs each). These are upper bounds
on what fixing each class can buy here, not fixes:

| build | runs | actions/s | mean frame ms | p95 | p99 | % frames over 6.25 ms | release to frame p50 / p95 ms | main-thread ms per action | script ms per action | effects alive, mean / peak | badges behind, % of time | longest behind, s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| this PR | 3 | 5.6 (5.6-6.0) | 15.4 (14.7-15.9) | 39.6 (39.1-41.6) | 46.6 (45.5-50.0) | 76 (67-82) | 39 (36-39) / 53 (49-54) | 142 (131-145) | 56 (54-58) | 14 (14-14) / 19 | 0 | 0.0 |
| no Pixi effects | 2 | 6.8 (6.7-6.9) | 10.8 (10.4-11.1) | 28.7 (28.2-29.2) | 38.8 (37.6-40.0) | 51 (48-54) | 26 (26-27) / 37 (37-37) | 106 (105-108) | 31 (30-31) | 0 / 0 | 0 | 0.0 |
| no CSS filter or shadow | 2 | 6.5 | 11.3 (11.0-11.6) | 29.4 (29.3-29.4) | 41.1 (40.6-41.6) | 67 (60-74) | 36 (35-37) / 49 (48-51) | 146 (145-146) | 61 (60-62) | 15 (15-15) / 20 | 0 | 0.0 |
| no CSS animation or transition | 2 | 6.0 (5.9-6.1) | 13.2 (12.7-13.7) | 34.0 (33.4-34.6) | 43.7 (41.7-45.6) | 67 (63-71) | 32 (30-33) / 44 (41-46) | 126 (125-128) | 58 (58-59) | 14 / 19 | 0 | 0.0 |
| all three off | 2 | 7.7 (7.6-7.7) | 6.8 (5.7-7.9) | 15.3 (12.6-18.0) | 24.7 (20.9-28.5) | 22 (20-24) | 21 (19-23) / 31 (28-35) | 98 (96-100) | 33 (31-34) | 0 / 0 | 0 | 0.0 |

- **Pixi effects** (`perf/pixi-fx`): the largest presentation cost left. Without them a frame is 10.8 ms and an action
  106 ms of main thread instead of 142. Even at one copy per recipient, 14 effects are alive and `fx:render` is
  0.7 ms on every frame they are.
- **CSS filters and shadows** (`perf/card-raster`): 15.4 to 11.3 ms a frame with no change in main-thread time. It is
  GPU raster, and the GPU main thread is still at about 815 ms/s busy on this PR.
- **CSS animations and transitions** (`perf/keyword-loops`, the parked frame loops): a board at rest already spends
  60 to 85 ms/s restyling for its loops (Karwind's and Transcendence's Ward); without them an action is 126 ms.
- **With all three off a frame is still 6.8 ms and an action still 98 ms of main thread.** That is the action's own
  commit, and nobody owns it yet: React (`Recruit`'s body, `StatusBar`), a 200 to 370 element style recalculation,
  layout and paint, for every buy, play and sale. Candidates, biggest first: (1) a played or bought card is a fresh
  mount of 100 to 150 elements in another row, so keep one card element and move it, or make the card cheaper to
  style (the selector statistics show dozens of `:is(...)` rules tried against every restyled element: 13,000 tries
  each in 12 s for 0 to 300 hits); (2) split `Recruit`'s 7,500-line render (the scope audit's B1) so a dispatch
  renders the row that changed; (3) take the Karwind pulse and the other per-action state out of `Recruit`.
- Audio: 22 to 25 sounds start per second of the burst on every build (this PR does not cap them), and the reverb
  thread is half a core in the trace. `perf/shared-reverb-static-shadows` owns it.
- Not measurable here because nothing is pushed: `perf/card-raster`, `perf/keyword-loops`, `perf/pixi-fx`,
  `perf/phase-decode`.

## 7. The regression guard

- `packages/ui/src/fx/shopFxQueue.test.ts`: under 8 actions a second for 30 s the queue of paced steps never holds
  more than three actions' worth and does not grow; it is empty one action after the input stops; at one and two
  actions a second every paced step plays. Plus `actionPressure.test.ts`, `rapidPlay.test.ts`, `statRollStep.test.ts`
  (the real loop on a hand-cranked frame clock) and `dropReadsBeforeRestyle.test.ts` (a source contract).
- `npm run perf:apm -- --guard` is the same check on the real game: exit 3 when fewer than 97% of actions were
  accepted, when a stat badge stayed behind the real number for more than 1.5 s, when a backlog counter is not back at
  idle 3.5 s after the last input, or when one grew by more than 60% across the burst. On this PR, and on the eight
  PRs plus this one: `GUARD OK`. On main: `GUARD FAILED: a stat badge stayed behind the real number for 9496 ms`.

## 8. Checks

`npm run typecheck`, `npm run lint` (0 errors), `npm run build:web` pass (run again after taking main on 2026-11-19).
`npm test` (run on 2026-11-18, before the hand-card skip and the merge of main): 1,922 of 1,926 files passed on
a machine with every thread busy; three files timed out (`guides/guidesReport.test.tsx`,
`partyHome/pages/phInfoPages.test.tsx`, `workers/versus/test/dm.db.test.ts`, none touched here) and all three pass
when run on their own. The new tests and the source-contract tests on `Recruit.tsx` were run again after the last
edit. `eslint.config` now ignores `.perf-apm/` (the bench's builds made `eslint .` run out of memory).

## 9. Method notes worth keeping

- **A closed-loop driver saturates the page it measures.** At a target of 8 actions a second every build ran its main
  thread at 78 to 86%. A faster build shows up as more actions a second and less time per action, not as an idle main
  thread. Read `ms per accepted action` and `accepted actions a second` first; compare frames at a rate every build
  holds.
- **On a shared machine, raise the bench's priority and run round-robin.** Without the first the run measures the
  scheduler; without the second it measures which build ran during somebody's compile.
- **Hiding a canvas is not "no effects".** `canvas { display: none }` plus stopping the Pixi ticker changed nothing: a
  mounted play wakes the ticker and the effects still simulate and render. `--toggle nofx` detaches the overlay.
- **A trace with selector statistics makes style about 50 times slower.** Use it for who forced and who dirtied
  style, never for how long.
- **Count renders per action.** `render:recruit` calls against accepted actions gave 1.6, and each extra one was a
  setter handed a fresh `Set` with the same contents or a timer unmounting something already invisible.
- A screen the script does not expect fails the run with a screenshot (`failed-*.png`) instead of hanging: Practice
  with every hero offered shows the hero grid, which has no `.herocard.big`.
