# 2026-10-07 · The Gold Fuse in every lobby

Owner ask (2026-10-07), verbatim: *"we want to make a game-wide change. every rank will have the gold fuse implemented.
it will kick off the timer when 10 gold is spent. this is for all ranks, so we can remove the silver note when
promoted. i want to clarify that the round timer should follow the existing round by round time increase, not the
60/90 secnd timer that is part of the current gold fuse timer for bronze."* Follow-ups: rounds 1-7 *"Yes, early rounds
untimed"*; scope *"All lobbies, Gauntlet unchanged"*. Rule: **R-TIMER-FUSE-01** (supersedes the retired
R-TIMER-BRONZE-01 / -02).

## What changed

- **One schedule** (`packages/ui/src/turnClock.ts` `standardTurnSeconds(wave, mult)`): the per-round turn length
  Recruit used to inline (18 s +4/wave, +6 from round 6, cap 80, +12 from round 12, floor 21, times Practice's
  multiplier). Recruit's plain clock and the fuse's countdown both call it, so they can never drift. A test pins it
  against the old inline formula for waves 1-20 x 1-4.
- **`goldClockOf(run, practiceTimer)`** (`goldClock.ts`): Gauntlet `{30, 60}` (unchanged); every lobby (any medal,
  rated or unrated) and Practice `{10, standardTurnSeconds(wave, mult)}`; Practice on ∞ (`practiceTimer` 0) null, so
  Recruit's infinite clock runs; sandbox / tutorial / legacy modes null. Every caller (Recruit, the store's Thymepiece
  stamp, StatusBar's Discount readout) passes the store's `practiceTimer`.
- **Removed**: the Bronze config (`BRONZE_CLOCK_*`, `isBronzeClockRun`, `bronzeClockSeconds`), the Silver promotion
  notice (`SILVER_CLOCK_NOTICE`, `silverClockNoticeOf`, the `.rankend-notice` render + CSS, the live-region sentence).
  `pinMedalAtStart` / `medalAtStart` / `rankAtStart` stay for telemetry (R-TELEMETRY-RANK-01); the clock no longer
  reads them, so a save made under the Bronze rules resumes on the new fuse.
- **Recruit's reset effect** now also keys on `goldClockSeconds`. Practice's mid-game dropdown is the only thing that
  changes it within a wave, and `turnSeconds` alone could not see it (a fuse turn and ∞ both read 99999), so a running
  fuse switched to ∞ would have kept counting down to a lock. Re-opened, a fuse turn parks and the start effect relights
  it at the new length if its Gold is already spent (the old "new multiplier = full new turn" behaviour).
- Plaque hover reads "Gold Fuse: a countdown begins once you've spent 10 Gold in a single turn." (Gauntlet 30). In
  Practice the hover keeps its multiplier sentence after the fuse line.

## Things worth knowing

- **No card grants shop-clock seconds today.** `bonusTurnSeconds` / `bonusTurnSecondsNextTurn` were retired with the
  Thymepiece rework (2026-09-12) and `deserialize` strips them, so there is nothing to add to a fuse's countdown. The
  only clock-anchored effect is Thymepiece's discount window, which reads a parked fuse as the seconds it will start
  from (`goldClockReading`), Practice multiplier included.
- Rounds 1-7 have 3-9 Gold of income, so they light only when extra Gold (selling, Gold-generating effects) pushes the
  turn's spend to 10. That is "usually untimed", as ruled. Nothing special-cases them (owner clarification: *"i want to
  clarify that the gold fuse will still show and operate during rounds 1-7"*): the 0/10 plaque shows from round 1, and
  a round-3 fuse lit at 10 Gold runs round 3's 26 s.
- Save & Quit needed nothing new: the parked value (99999) is saved and resumed exactly as before.
- No per-frame work: the threshold check is one comparison when `goldSpentThisTurn` changes.
