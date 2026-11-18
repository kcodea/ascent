# 2026-11-18 — The combat render path: previews, units, stat rolls, per-beat folds

Owner bar, restated today: this is a 2D HTML card game, no dropped frames, frames at or under 6.25 ms on the prod
build from round 1 to the end. Seven investigators audited the game (`.claude/perf-scope-2026-11-18/`, not in the
repo); three of them independently landed on the same combat findings (S3 F1 / F3 / F4 / F6 / F7, S1 A2, S2 #3 / #4,
S5 #2 / #3). This PR fixes those, with no visual change. Rules: R-PERF-COMBAT-PREVIEW-01, R-PERF-STAT-ROLL-01,
R-PERF-COMBAT-FOLD-01.

## What was wrong

1. **A display-only number re-rendered the whole board.** The replay publishes six "so far this fight" previews (spell
   power, Front to Back's step, spells cast, friendly deaths, Blade Mastery attacks, Squirl Scout / Conductor) so
   printed values tick mid-fight. Each publish was a normal `dispatch`: the reducer deep-cloned the run and ran every
   action-boundary sweep for one scalar. Every `Unit` subscribed to the whole run and built a fresh card view, so each
   publish re-rendered all 14 units and their entire `Card`s. A late fight publishes 11 to 14 friendly deaths alone.
2. **A stat roll re-rendered the whole card every frame.** `Card` owned the stat-hold subscription. A +2 buff shows two
   values; a +3,000 buff shows a new value every frame for 650 ms, per buffed unit, and each of those was a full Card
   render (art, frame, keyword auras, text). Each rolling unit also ran its own `requestAnimationFrame` loop, and each
   loop notified every badge on screen.
3. **Every beat re-read the fight from event 0.** `computeFrame` rebuilt every body from the starting snapshot and
   replayed the whole log, and about a dozen more passes did the same for their own readout (four of them after copying
   the log prefix with `slice`). Then one document-wide `querySelector` per body the fight EVER had (50 to 150 in a
   summon-heavy fight; a fallen body's selector misses and walks the whole document).
4. **Per-beat bridges handed the store a fresh object every beat** whether or not anything in it changed
   (`questDelta`, `triggeredQuests`, `completedQuests`, `combatBuffs`, the hand readouts), plus a `JSON.stringify` of
   the aura map on every Recruit render.

## What changed

**1. Previews take a shallow path** (`packages/sim/src/reducer.ts`, `reduceCombatPreview`). `reduce` handles the six
preview actions before anything else: one new top-level object with the one field set, every nested object shared, an
unchanged value returns the same state. No clone, no per-action scratch reset, no action-boundary sweep (none of them
can have anything to do: a preview changes no gameplay field, and a fight with no previews already skipped them).
The actions still go through the store commit, on purpose: they stay in the action log and the action ring, so the
bug-capsule window replay (`windowReplay.ts`, which checks the state hash BEFORE every recorded action) still lines up.
Moving them to a UI-only store would have needed the state hash to ignore the preview fields; not done here.

**2. Units read what they print** (`Unit.tsx`, `combatRun.ts`). `runSansPreviews(run)` returns an object whose identity
only moves when something OTHER than a preview moved, and which carries no preview at all. A unit subscribes to that
for the ~35 frozen run fields its text reads, and to each preview through its own primitive selector. The card view is
kept by value (`keepIfSame`), so a unit that re-renders only for its wrapper class (a lunge, a hit) no longer
re-renders its Card. The memo comparator now lists EVERY per-instance field the text reads: until today a unit also
re-rendered on every run change, which is what kept `impBank`, `eotTick`, `sellBonus`, `overflowBonus`,
`rallySpreadAtk`, `taughtSpellId`, `chosenOption`, `tribe2`, `linked` and the bleed counter fresh by accident (Ashen
Heir's bank grows on exactly the deaths that re-rendered the board). They are compared for themselves now; the global
attack count only for a card that prints it.

**3. The badge owns the roll** (`Card.tsx` `StatBadge`, `fx/combatBuffRoll.ts`, `fx/statHold.ts` `revealStats`). Each
stat badge is its own small component subscribed to its own stat's withheld remainder; `Card` no longer reads the hold.
Every combat roll in flight is stepped by one shared frame loop that notifies once per frame. A roll's FIRST step still
runs on its own frame request, exactly when it always did; each roll keeps its own clock and live speed read.
**The badge pop is unchanged**: it still restarts on every visible value change (the documented look: the badge rides
slightly enlarged through the roll, then completes one pop as it settles). "Pop once per roll" was not taken, because a
small buff would lose its intermediate bounces. (Side effect: the old snapshot key `attack * 1000 + health` could
collide once stats passed 1,000; the per-stat snapshot cannot.)

**4. The folds are continued** (`useCombatReplay.ts`, `choreo/prefixFold.ts`). `computeFrame` is split into
`newFrameFold` / `stepFrameFold` / `frameOf`. `computeFrame` is still the from-scratch fold; `makeFrameFolder()` keeps
one fold alive and applies only the new events, starting over when the cursor moves backward (seek, rewatch, spectator
resume) or the fight changes. Frames are handed out as shallow copies, so inside the step a body's nested value is
replaced, never edited in place (`recordBuff` and two keyword `push`es became copy-on-write). The two look-ahead scans
(a sprayer's waves, a Rise body that returns later) read a per-fight index built once. The running readouts (enemy
deaths, buffs, previews, the log half of the quest tally) are `PrefixFoldSpec`s continued the same way; the step-keyed
ones (`triggerCounts`, `runeProgress`, completed quests) and the three hand readouts walk a per-fight list of their own
event type instead of the whole log. The rect sweep is one `querySelectorAll` over the units on screen. Every per-beat
readout goes through `useStableValue`, so a beat that changed nothing writes nothing to the store.

**5. Trigger pulses clear together**: one timer and one render per beat's batch of pulsing units, not one each.

## Verification

- `frameFold.test.ts`: the continued frame deep-equals the from-scratch frame at every beat of recorded fights of every
  set, a frame already handed out never changes, and seek / skip / rewatch / a new fight all land on the from-scratch
  frame.
- One-off, not committed: the new `computeFrame` and the continued fold against the PRE-refactor `computeFrame`, 600
  fuzz fights (150 per set), 30,246 frames, 48,503 events, 557 ghost bodies: identical.
- `choreo/prefixFold.test.ts`: continued readouts equal from-scratch at every cursor; the rewritten hand and step-keyed
  readouts equal a plain loop over the log.
- `combatRenderCount.test.tsx` (jsdom, the perf HUD's own counters): 36 preview dispatches on a mounted 7-unit board
  render 0 units and 0 cards (sabotage: with the whole-run subscription back it reads 252 unit renders); a spell-power
  preview still reaches the unit; a +3,000 roll prints its steps with 0 Card renders; a 7-unit roll notifies once.
- `heroPillReadouts.test.ts` (unchanged) still holds the preview contract through the reducer.

## Measured

**The scene.** Headless Chrome (Playwright's own headless shell, hardware GPU, frame-rate limit off so an interval is
the time a frame took to produce), 1920 x 1080, the PRODUCTION bench build (`VITE_PERF_BENCH=1`), live backend
blocked. A hand-built 7v7: Runmaw 2,400/9,000 (gives the board +1,200/+4,500 at Start of Combat, so 6 units roll big
numbers at once), two Crypt Drakes (a board-wide buff every second ally attack), Brood, Pack, Spore, Spell Appraiser,
mirrored on both sides; 355 events, 85 beats, 20 deaths, 205 buff events, combat speed 2x. Baseline = `origin/main`
(5d8f3d972) plus the one-line `card renders` counter. Three alternating pairs (base, candidate, base, ...); medians.
Another agent was measuring on the same machine, so frame-interval numbers carry load noise (a fourth pair run during
a busy stretch is not counted: both builds halved their frame count in it).

| per fight | before | after |
|---|---|---|
| `card renders` (whole `Card`s rendered) | 4,919 (58 a beat) | **337 (4 a beat)** |
| `unit renders` | 669 | 596 |
| store commits (`store:set` calls) | 311 | 122 |
| `store:set` total | 53 ms | 32 ms |
| preview dispatches through the reducer | 10, 1.6 ms | 10, 0.2 ms |
| `choreo:frame` (the board fold), total | 23.2 ms | 5.0 ms |
| `choreo:step` (the per-beat cue effects), total | 313 ms | 274 ms |
| `render:combat` (Recruit render + commit), total | 454 ms | 368 ms |
| frames over 6.25 ms (of about 12,700) | 660 (4.8%) | 556 (4.4%) |
| frames over 8.33 ms | 325 | 266 |
| frame p95 / p99 | 6.1 / 13.2 ms | 6.0 / 12.6 ms |
| long tasks (over 50 ms) | 10 | 6 |

Read honestly: the render counts and the measured spans moved a lot; the frame-interval tail moved a little (the three
candidate runs had 488 to 578 frames over 6.25 ms, the three baseline runs 590 to 709: better, but close to the noise
of a shared machine). In THIS scene the frames over budget are mostly Pixi effects, not React. The
perf monitor's own attribution of self time inside long frames (one candidate run): `fx:render` 3,554 ms,
`fx:def:test-ascent-frame-health` (the looping 5,000+ milestone badge effect on every big stat) 3,294 ms, `fx:sim`
3,108 ms, `tendril-trail-dragon` 1,594 ms, `strike-impact-purple` 1,091 ms, then `render:combat` 396 ms (546 before)
and `choreo:step` 242 ms (329 before). The long tasks are all `fx:render` GL hitches (65 to 200 ms, both builds).
Those belong to the FX findings (S3 F2 / F5 / F10 and the milestone loops), not this PR.

**A long fight (added after the measurement agent's note that short fights show nothing).** The same boards with 4x
Health: 894 events, 204 beats, 96 attacks, 537 buff events, combat speed 3x, two alternating pairs (averages).

| per fight | before | after |
|---|---|---|
| `card renders` | 9,560 | **731** |
| `unit renders` | 1,471 | 1,401 |
| store commits | 664 | 212 |
| `choreo:frame` total / worst single beat | 90.5 ms / 4.4 ms | 16.0 ms / 0.9 ms |
| `choreo:step` total | 947 ms | 878 ms |
| `render:combat` total | 1,331 ms | 1,171 ms |
| frames over 6.25 ms (of about 11,000) | 4,386 and 4,558 | 4,581 and 5,109 |

The board fold alone cost up to 4.4 ms on one beat before (a whole 240 Hz frame) and 0.9 ms after. The frame tail did
NOT improve in this scene: about 40% of frames are over 6.25 ms in both builds, and the two candidate runs are no
better than the two baseline runs. The time in those frames is Pixi (the looping 5,000+ milestone badge effect on 14
big stats, `fx:render`, `fx:sim`, tendrils, strike impacts: 5 to 10 s of self time each per fight) against about 1.2 s
of `render:combat` and 0.9 s of `choreo:step`. This PR removes the React and fold share; it cannot move that tail.

Not measured: the return-to-shop commit. Nothing here changes how cards mount (each Card now mounts two small badge
components more), so no gain is expected there.

**The fold, in isolation** (Node, best of 7, the frame + buffs + previews folds only, fuzz fights):

| fight | rebuilt every beat | continued | the last beat alone, rebuilt |
|---|---|---|---|
| median (54 events, 35 beats) | 2.5 ms | 0.17 ms | 0.08 ms |
| 95th percentile (161 events, 110 beats) | 11.6 ms | 0.40 ms | 0.11 ms |
| longest of 600 (3,404 events, 662 beats) | 822 ms | 4.4 ms | 1.9 ms |

So the old fold was quadratic as the audit said: on the longest fight, three of the dozen per-beat passes cost 1.9 ms on
the last beat alone, against a 4.17 ms frame. Continued, a beat costs the events it adds.

**The roll looks the same** (the second unit's attack badge sampled every frame for 6 s): both builds start at 1,800,
print 25 to 31 intermediate values through the roll, land on 3,006, and carry a running pop animation on the same
share of frames.

Checks: `npm run typecheck`, `npm run lint` (0 errors), `npm test` (1,923 files; three failed in the full run on a
loaded machine, two 5 s / 30 s timeouts in files this PR does not touch and one source-text assertion updated here;
all pass run on their own), `npm run beats:audit`, `npm run build:web`.

## Not in this PR (follow-ups)

- **Extract the combat arena out of `Recruit`** (S3 F6): every per-beat replay state change still re-renders the
  11,000-line component (about one `render:combat` per beat). The largest remaining React cost in a fight.
- `StatusBar` re-renders whole on every damage beat (`combatQuestDelta.friendlyDamage` feeds the hero-power text for
  any hero). Select it only for the pairings that print it, or memo the pill.
- Previews out of the action log (S5 #3): needs the state-hash rail to ignore the preview fields first.
- `bloomFrame` / `pulseWatcher` / `firePulse` still clear with one timer per unit (they start at different moments).
- The perf HUD strip does not show `card renders` yet (the counter is in the buckets and the export).
