# 2026-09-26: Lord of the Risen × Ancient of Time, live tally + a Start of Turn beat

Owner report, with a screenshot of the Undying (Time) tooltip ("Last combat: 8 summoned (+24/+16)"): "this hero power is
tallying at resolution, not in real time … this also does not have a start of turn beat, please wire one in and make
sure we bake time for the screen wipe transition. make a note in the oracle that ALL start of turns get their own beat
as well." Ancients are still dev-only, so there is no patch note.

## Live tally (R-ANCRISEN-07, under R-REALTIME-01)

- R-REALTIME-01 already says printed numbers update the moment they happen; the Time text broke it. It read
  `AncientsState.lastSummons`, which only changes at settle, so for the whole fight it printed the PREVIOUS fight.
- The text now takes a live value: `heroPowerText(state, 0, { summons })` → `ancientPowerText(…, { combatSummons })`.
  The power text template gained `{timeWhen}`: "This combat" while a fight is replaying, "Last combat" otherwise.
- The live number is `combatQuestDelta.summonCombat`, the replay's fold of the step-tagged `playerQuestEvents` up to
  the beat on screen (the quest panel's tally). It is bumped at the same summon-entry chokepoint as
  `ancientCountSummons`, so the end-of-replay value equals `playerSummonsMade` (pinned in the test). StatusBar passes it;
  it is null outside a fight and after settle, so the text falls back to the banked count the Start of Turn pays.
- The payout is unchanged: the previous combat only.

## Start of Turn beat (R-SOT-BEAT-01)

- New per-action channel `RunState.sotBeatFx` / `sotBeatFxSeq` (`SotBeatFx`: a source + each recipient's real gain).
  `ancientStartOfTurn` stamps it instead of `captureBuffFx`, whose wave the Shop replayed at once, under the return
  curtain (`resolveCombat` is dispatched at `coveredOut`).
- `packages/ui/src/sotBeats.ts` plans it: nothing until the wipe is `idle` on the recruit phase + a 300 ms pad; per
  beat the source pulses (hero: the power button's `heroPowerBurst` + the hero's power sound), then each gain lands
  70 ms apart with the tendril from the power button; a 420 ms tail before the next beat. The gains are HELD off the
  shown board stats (a delta, applied in a layout effect the moment the batch arrives) and released on each cue, so the
  numbers rise on the beat instead of already being up when the curtain lifts.
- Shared path: the per-action buff wave watcher (`recruitFxSeq`) now also parks while the wipe is up, not only while
  in combat. Every other Start of Turn buff (Gemline Martyr's Start of Turn, the Start-of-Turn runes) used to play
  under the curtain; it now plays when the wipe rests, but as one wave on already-raised stats, without a source pulse.
  Moving those onto `sotBeatFx` is follow-up work (listed in the rule's currentBehaviour).
- No all-Start-of-Turn beat rule existed before (only R-RUNE-18, the Runeforge entrance waiting for the wipe).

## Tests

- `packages/sim/src/risenTimeRealtime.test.ts`: the tally ticks across replay steps and ends on the carry-back; the
  text prints the running count mid-fight and the banked one after; the Start-of-Turn beat's gains and payout; the
  previous-combat-only payout; the channel is per action.
- `packages/ui/src/sotBeats.test.ts`: the wipe gate for every wipe state, the cue plan (pad, pulse before gains, no
  overlap), the stat hold, the end-to-end beat from `resolveCombat`, and source pins of the Shop player.
