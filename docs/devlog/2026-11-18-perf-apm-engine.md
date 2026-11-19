# 2026-11-18 — APM on an engine board: what "bogged down" is, a bench for it, and the rapid-input presentation

Owner, 2026-11-18: *"the biggest problem to me is when i have a board with cards like Karwind and im playing APM and
the game gets bogged down and nearly impossible to play. this needs to be butter smooth."*

Branch `perf/apm-engine`. Rules `R-PERF-APM-01`, `R-PERF-APM-02`, `R-PERF-APM-03`. This entry is the measurement, the
fix, and a plain list of what is still over budget and who owns it. **It is not butter smooth yet**: this PR removes
the queue and about a fifth of the per-action cost. Section 6 says what the rest is.

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

TABLE8

Read it as: **each pushed perf branch alone moves nothing in this scenario** (they fix other things: fights, the sim,
the fuse, the reverb). The four merged take 5% off the per-action cost (163 to 155 ms), mostly the reverb. **This PR
takes 13% off** (163 to 142), frames go from 18.6 to 15.4 ms, effects alive from 22 to 14, and the badge lag is gone.
All together: 19% (163 to 132), 14.3 ms a frame, 5.9 actions a second, release to picture 41 to 34 ms. With this PR's
rapid form switched off (the 60 a second step, the drop reads and the render fixes only) the whole-turn numbers are
inside the noise of main: those are small, clean wins, not what moves this scenario.

The final build (the hand-card canvas skip added) and the same table again, taken afterwards:

TABLEG

Target 4 actions a second, which every build holds, so frames compare directly (two rounds):

TABLE4

1.5 actions a second, normal play (one run each): **nothing changes**, as intended.

TABLE15

One action at a time, 1.2 s apart (`--per-action`): the same on both builds (play 182 / 176 ms of main thread in the
quarter second after it, cast 144 / 150, sell 128 / 126, buy 96 / 96, refresh 77 / 77).

On a quieter hour earlier in the day (not round-robin; an earlier build of this PR, three runs each):

TABLEQ

## 5. What changes on screen, for the owner to approve

Only while three or more actions land inside a second:

- A buffed badge shows its new number at once and pops once. It does not roll. (At normal speed it rolls as before.)
- A buff wave that had not started when the next action landed does not play. A Dragonflame's hits are 150 ms apart,
  so at six actions a second its first one or two play and the rest are skipped; the stats they stand for are already
  on the badges.
- A minion wears one copy of a trail or burst at a time. A second one inside a quarter second is skipped.
- Effects run up to 1.6 times faster with down to 60% of their particles, from five actions a second.
- A card added to your hand appears at once (no materialise), and a played card's backplate does not dissolve.

Captures of five seconds of the burst, main and this PR (animated WebP and an eight-frame sheet each), on the owner's
machine: `C:\Users\kevin\the ascent\.claude\perf-scope-2026-11-18\apm-captures\`.

And at every speed: a rolling number changes its digits 60 times a second instead of 240 on a 240 Hz display. I could
not see a difference; it is listed because it changes how an authored roll is drawn.

Dials, if any of it reads wrong: `RAPID_FX` in `packages/ui/src/fx/rapidConfig.ts` (each part has its own switch;
`maxSpeed: 1` and `minIntensity: 1` turn the pacing off), `RAPID_ACTIONS` in `fx/actionPressure.ts`.

## 6. What is left, and who owns it

The same run with one cost class switched off (`--toggle`, on this PR's build, two runs each). These are upper bounds
on what fixing each class can buy here, not fixes:

TABLETOG

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
  idle 3.5 s after the last input, or when one grew by more than 60% across the burst. On this PR: `GUARD OK`. On
  main: `GUARD FAILED: a stat badge stayed behind the real number for 9496 ms`.

## 8. Checks

`npm run typecheck`, `npm run lint` (0 errors), `npm run build:web` pass. `npm test`: 1,922 of 1,926 files passed on
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
