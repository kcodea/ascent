# 2026-11-21 — Minion numbers no longer move after a fight is over

**Owner report.** *"I've noticed instances where the number values of minions are bouncing and rolling after combat
ends. This is something that we've dealt with in the past, but it looks like it was never fully solved."*

**Root cause (reproduced headlessly, then fixed).** `useCombatReplay`'s hold installer (the layout effect that withholds
a beat's buff and damage numbers so the effect can deliver them) lists `frame` in its deps. When the replay reports
`done`, `beatStart` moves so the board is rebuilt without the dead. That is a new `frame`, so the installer ran AGAIN
for the last beat, which had already played, and withheld its numbers a second time:

- the last hit's damage was re-held as a `cue` hold, so the survivor's Health jumped back up and counted down again
  (650 ms / speed), right as the End Combat gem appeared;
- a last-beat buff was re-held as an `effect` hold with nothing left to deliver it, so the badge dropped to its
  pre-buff value and the 2 s safety net (TTL) returned it with a pop.

The simplest fight reproduces it: one 6/9 killing a 4/3. It only shows when the last beat changes a SURVIVOR's
numbers, which is why it looked intermittent. A headless scan of 35 random fights hit it in 4.

**The fix, in two parts (R-COMBAT-END-STATS-01).**

1. *Once per arrival.* The installer records the arrival it last placed holds for (`events`, `seekNonce`, `beatIdx`)
   and returns early on any other re-run. A new `frame` is not a new beat.
2. *The settle step.* `settleStats()` in the replay cancels every pending strike timer and roll and calls the hold
   store's new `settleAllStats()`: every withheld number lands at once, QUIETLY. It runs when the final hold ends (in
   the same commit as `done`), on End Combat (the replay now registers with `onCombatHardStop`, which had no
   subscribers), and in the jump `skip()`. After a settle the installer places no holds until a new fight or a seek.

**Quiet delivery.** The badge pops on any change of its printed value, so a plain release still bounces. `settleAllStats`
names the units it delivered (`quietStats`); `useBadgePop` adopts their number with no pop. The mark clears itself
after two animation frames, so it cannot swallow a later real change.

**What part 2 covers that part 1 does not.** A last-beat number whose effect never delivers it (in the headless harness:
a self-buff on the killing blow, with no element to measure) has no next beat to release it, so it waited for the safety
net. Mid-fight the next beat releases it; the last beat had no equivalent until now.

**Not covered.** Numbers changing on the Shop board after the return (candidate 3 in the investigation). Start of Turn
gains roll there on purpose; anything else is untraced. A DEV recorder for that hunt lives on the
`fix/post-combat-stat-roll` branch (`fx/statMotionProbe.ts`, F8 to mark) and is not part of this change.

**Correction to an earlier note in the investigation.** The Skip button does not jump to the final board: it
fast-forwards (R-SKIP-TURBO-01), plays out to `done`, and settles there. Only the `skip()` API jumps.

**Verified.** `combatEndStatSettle.test.tsx` (the real hook on a fully faked clock: failed before, passes after; the
last-hit case passes on part 1 alone, the last-beat buff and End Combat cases need part 2), `fx/statHold.test.ts`,
plus the full gates. Not yet eyeballed in a live game.
