# 2026-11-18 — APM on an engine board: what "bogged down" is, a bench for it, and the rapid-input presentation

Owner, 2026-11-18: *"the biggest problem to me is when i have a board with cards like Karwind and im playing APM and
the game gets bogged down and nearly impossible to play. this needs to be butter smooth."*

Branch `perf/apm-engine`. Rules `R-PERF-APM-01`, `R-PERF-APM-02`, `R-PERF-APM-03`. This entry is the measurement, the
fix, and an honest list of what is still over budget and who owns it.

## 1. The bench: `npm run perf:apm`

`scripts/perf-apm-engine.mjs`. A production bench bundle (`VITE_PERF_BENCH=1`) in headless Chrome 150 with a real GPU
(ANGLE D3D11 on the RTX 4080 SUPER, 240 Hz frame clock), its own throwaway profile, every request off 127.0.0.1
blocked.

- **The scene.** A seeded Practice game (no clock, bot seats), Nadja. Through the store, with the game's own actions
  (God Mode's print into the shop, buy, triple, play, tier up): a **gilded Karwind**, **Firebird** (every Shout casts
  Dragonflame, which repeats once per Dragon), **Scalechanter** (every Shop spell: Dragons +2/+2), **Embermouth**,
  **Herzog**, **Transcendence**; five cards held in hand; Tier 6; the **Ancient of Bonds** awake (every Gold spent
  sends two buff trails). After the warm-up the board is 250 to 300 Attack and Health a body and climbing.
- **The burst, by real input.** CDP mouse events (press, four moves, release; a click on Refresh), never a store
  dispatch: buy a Shout minion (Broodfire Whelp, Scalefeather), play it, cast the Dragonflame it gave, sell it, refresh
  when the shop is empty. `--rate` actions a second (8 by default) for `--secs` (25). One played Shout is 14 Karwind
  buffs, 7 Broodfire buffs, 8 Dragonflame hits and 7 Scalechanter buffs. The driver is closed-loop, as a player is: it
  reads the run before each action (no layout), reads the one card's rect, and waits for Chrome to take each mouse
  event, so a slower page is driven more slowly. **Accepted actions a second is therefore a result, not a setting.**
- **The tail.** Six seconds with no input, to see what is still playing.
- **Every refresh offers the same six minions** (the game's own refresh rolls, and the bench swaps the offers in the
  same task), so every build plays the same turn.

It reports four things separately: frames; input (press to handler, release to store, release to the first frame
after it, and actions the game did not accept); backlog (stat badges behind the run's real number, live effects, live
timers, paced steps waiting, and how long each takes to go back to idle after the last input); and main-thread cost
(CDP, the in-game monitor's labelled spans, `--profile`, `--trace`, `--trace-style`). `--toggle` switches one cost
class off, `--rapid` / `--roll-step` set the dials of this PR's presentation on one bundle, `--guard` is the
regression check, `--screencast` saves frames to look at.

**The machine was shared with other builders the whole time** (the bench prints the whole machine's CPU share per
run). So the final table below was run **round-robin**: one run of every build, then the next round, so a busy minute
hits every build alike. Values are medians of three runs with the range.

## 2. What "bogged down" is

On `origin/main` (58c8a5256), at a target of 8 actions a second:

MAIN_FINDINGS

So it is **frames and input-to-picture time, not lost input**:

- **No input is blocked or dropped.** Every one of the attempted actions was accepted, in every run of every build.
  The only guards on a card's pointerdown are combat, End Turn's own animation, a replay, the turn timer at zero and
  a locked card; no effect, roll or beat holds input, and Start of Turn beats do not either.
- **The main thread is saturated.** MAIN_TASKS ms of tasks per second. A frame takes MAIN_MEAN ms on average and the
  frame an action lands in takes 35 to 50. The time from letting go of a card to the first frame that shows it is
  MAIN_TOFRAME ms at the median. At that speed the page takes MAIN_APS actions a second however fast the hand is.
- **The numbers on the board are behind the run.** Every buffed badge withholds its gain and rolls it in over 420 ms,
  and a later wave's badge waits for its wave. The next action restarts every roll. Badges were behind the real
  number in MAIN_STALE% of samples, MAIN_BEHIND badges at a time, for up to MAIN_LONGEST seconds in a row. Faster
  builds are WORSE here, not better: with the reverb fix the page takes more actions a second and a badge stayed
  behind for 12 to 21 seconds.
- **Presentation piles up, but it is bounded.** MAIN_PLAYS effects alive on average and MAIN_PLAYSPEAK at peak (0 at
  rest), MAIN_TIMEOUTS timers pending, 40% more in the last third of the burst than in the first, and 1.8 to 2.9 s to
  drain after the last input. It does not grow without limit; it settles at "about six actions' worth".

Where the main thread's time goes on main (CPU profile and trace of the burst):

- 45% is the browser itself (style, layout, paint, compositing), not JavaScript.
- **Each action's commit is one style recalculation of 200 to 370 elements** (a bought or played card is 100 to 150
  new elements), forced early by the first rect read of the commit (`RowFlip`'s tavern sweep). With the layout behind
  it that is 10 to 15 ms per action. It is the largest single per-action cost and it is structural: see section 6.
- Pixi effects: `fx:sim` 110 ms/s and `fx:render` 72 ms/s. Dragonflame's column alone was 49 ms/s of updates.
- React: `render:recruit` 34 ms/s. The Shop screen rendered 256 times for 164 actions: one extra render per played
  Shout (Karwind's medallion pulse) and one per sale (its Gold float's removal).
- The release handler read two rects after taking `body.dragging` off, forcing a second whole-page restyle inside
  pointerup on every play and every sale: 90 ms and 101 ms in the profile, 4 to 5 ms each.
- The GPU main thread is busy too (raster flush + deserialise about 540 ms/s): the card raster finding of the scope
  measurement (E1), which `perf/card-raster` owns.

## 3. What this PR changes

### The rapid-input presentation (R-PERF-APM-01)

`fx/actionPressure.ts` counts accepted Shop actions (the store notes each one before React renders it). **Rapid** is
three or more inside one second; it stays rapid until fewer than two are inside a second, and End Turn ends it at
once. At up to two actions a second nothing below applies. While input is rapid:

1. **Numbers are true at once.** A stat change is printed with the badge's one pop instead of being withheld for a
   roll, and whatever an earlier action was still rolling in is printed with it (`fx/statHold.ts`: `holdStat` does
   not hold, `deliverAllStats`).
2. **Earlier actions' paced steps that have not started are dropped** (`fx/shopFxQueue.ts`). The Shop's later buff
   waves, Shout chain links and waiting buffers are scheduled through `shopFxLater`, stamped with their action.
   Effects already playing finish. So the authored pacing still plays for as long as the player lets it.
3. **One live copy of an effect per recipient** (`fx/rapidPlay.ts`, in `playDef`): a one-shot play with no key of
   its own is keyed by who it lands on, and `fxBudget.admit`'s existing key rule does the rest (inside 250 ms: the
   same moment, nothing spawns; later: it replaces the copy it finds).
4. **Effects keep pace**: playback speed `actions a second / 3` up to 1.6, particles `3 / actions a second` down to
   60%. At three actions a second they are exactly as authored.

Never touched: a play its caller sequences on (`onDone`), a loop, a follow, a play with its own `dedupeKey`, and
everything after End Turn. It is presentation only: nothing the reducer, a replay or a snapshot reads.

The dials are in `fx/rapidConfig.ts` (`RAPID_FX`), and on a bench build they are writable, so one bundle measures
with and without each part.

### The stat roll steps at most 60 times a second (R-PERF-APM-02)

The shared roll loop ran once per display frame. On a 240 Hz display a 420 ms roll on 14 badges was about 1,400 badge
updates (each one a render, a restarted pop and a re-draw of the card under it) where a 60 Hz display, showing the
same roll, makes 350. It now steps at most every 16.7 ms on every display; a roll that is over still prints its final
number on the next frame. This one holds at every speed.

### One layout pass and one render per action (R-PERF-APM-03)

- The release handler reads the played card's plate and the Gold pill with its row snapshot, BEFORE `body.dragging`
  comes off (`dropRectsRef`). The two forced restyles inside pointerup are gone.
- A played Shout writes the medallion-pulse state only when a card takes the pulse, and Karwind's pulse keeps its
  set when the same buffer pulses again. A sale's Gold float leaves in the next sale's own commit, with one sweep
  after the last sale. The Shop screen now renders once per action.

## 4. Numbers

RESULT_TABLES

## 5. What changes on screen, for the owner to approve

Only while three or more actions land inside a second:

- A buffed badge shows its new number at once and pops once. It does not roll. (At normal speed it rolls as before.)
- A buff wave that had not started when the next action landed does not play. A Dragonflame's eight hits are 150 ms
  apart, so at six actions a second its first two play and the rest are skipped; the stats they stand for are already
  on the badges.
- A minion wears one copy of a trail or burst at a time. A second one inside a quarter second is skipped.
- Effects run up to 1.6 times faster and with down to 60% of their particles, from five actions a second.

Captures: CAPTURES

And at every speed: a rolling number changes its digits 60 times a second instead of 240 on a 240 Hz display. I could
not see the difference in a capture; it is listed because it is a change to how an authored roll is drawn.

Dials, if any of it reads wrong: `RAPID_FX` in `packages/ui/src/fx/rapidConfig.ts` (each part has its own switch,
`maxSpeed: 1` and `minIntensity: 1` turn the pacing off), `RAPID_ACTIONS` in `fx/actionPressure.ts`.

## 6. What is left, and who owns it

REMAINING

## 7. The regression guard

- `packages/ui/src/fx/shopFxQueue.test.ts`: under 8 actions a second for 30 s the queue of paced steps never holds
  more than three actions' worth and does not grow; it is empty one action after the input stops; at one and two
  actions a second every paced step plays. `actionPressure.test.ts`, `rapidPlay.test.ts`, `statRollStep.test.ts`
  (driven through the real loop with a hand-cranked frame clock), `dropReadsBeforeRestyle.test.ts` (source contract).
- `npm run perf:apm -- --guard` is the same check on the real game: it exits 3 when fewer than 97% of actions were
  accepted, when a stat badge stayed behind the real number for more than 1.5 s, when a backlog counter is not back
  at idle 3.5 s after the last input, or when one grew by more than 60% across the burst. GUARD_RESULT

## 8. Method notes worth keeping

- **A closed-loop driver saturates the page it measures.** At a target of 8 actions a second every build ran its
  main thread at 78 to 86%. A faster build shows up as more actions a second and less time per action, not as an idle
  main thread. Read `ms per accepted action` and `accepted actions a second` first; the fixed 4 actions a second runs
  are the ones where frames can be compared directly.
- **Hiding a canvas is not "no effects".** `canvas { display: none }` plus stopping the Pixi ticker changed nothing:
  a mounted play wakes the ticker and the effects still simulate and render. The bench's `--toggle nofx` detaches the
  overlay, so no effect can start.
- **A trace with selector statistics makes style 50 times slower.** Use it for WHO forced and WHO dirtied, never for
  how long.
- **`AudioScheduledSourceNode.prototype.start` is not where a buffer source starts**: `AudioBufferSourceNode` has its
  own. The first runs counted 0 sounds for that reason.
- A screen the script does not expect now fails the run with a screenshot (`failed-*.png`) instead of hanging:
  Practice with every hero offered shows the hero grid, which has no `.herocard.big`.
