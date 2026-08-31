# Save & Quit gives the turn back with the time you left it on

**Player report 9fceed6b (2026-08-31), priority 1:** *"timer from saving and quitting is not correct, it is
restarting the timer from the beginning of the round."*

Reproduced immediately: quit a recruit turn at **0:08**, press Continue, get **0:20**.

## The save side was never wrong

`flushSave` captures `turnClock.get()` while `showTitle` is still false, and the value lands in
`localStorage` — a quit at 0:08 wrote `turnRemaining: 8`, verified in the live client. The loss happened on
the way back **in**.

`continueRun` hands the value over as `pendingResumeSeconds`, and Recruit's clock-reset layout effect applies
it and clears it — a one-shot. But the effect ran **twice**. The first pass applied 8 and consumed the
one-shot; the second saw `null`, fell into the `else`, and opened the turn at full time.

## Why it started happening

This is a regression from **my own change of 2026-08-30**, and the code said so out loud: the comment above
the effect read *"Recruit stays mounted under the title"*. That stopped being true when the board began
unmounting before a run — so **Continue went from a re-render of a live component to a genuine mount**, and a
mount is exactly where an effect gets invoked twice.

The stale comment is corrected in the same change, because a claim like that is how the next person misreads
the file.

## The fix

The decision moved out of the effect into `turnClockReset`, a pure function, so it can be tested without a
DOM — and the effect now calls it, so the tested logic *is* the shipped logic.

The rule it encodes: remember which **wave** was restored, and refuse to re-open that same turn. Scoped to the
wave on purpose — the moment the wave advances it stops matching, and the next turn opens at full time like
any other. Verified live in both directions: quit 0:13 → resume 0:12, and wave 2 then opened fresh at 0:19.

Six tests pin it, including the two traps: the second-pass case that was the bug, and `resume: 0` being a
real value rather than "absent" — a falsy check there would hand a full turn to someone who quit at 0:00.
