# 2026-10-23 — The opponent's hand keeps its mid-fight grants (R-OPP-HAND-02)

**Owner report.** "this player had 2 cards in hand, then added more in combat, and after combat it went back to 2. can
you fix that" (round 10, the Summary button up, the face-down hand from #2259 back to 2 cards).

**Root cause.** `Recruit.tsx` mounted `<OpponentHand live={inCombat && !run.combatSettled} />`, and `OpponentHand`
folds the fight's enemy `toHand` grants (and the copy-summon greys) only while `live`, else at cursor 0. The run settles
at the END of the replay (and at once on a Skip), still in the combat phase, so the end frame, the Summary and a skipped
fight all showed the bare recorded starting hand. Every surface that mounts Recruit's combat (own fight, spectating,
Versus, replays) had it.

**Fix.** `live` is now the whole combat phase (`inCombat`), so the fold follows `processedEnd` (the beat on screen) to the
end: a Skip lands the final count, a replay seek back drops later grants and a seek forward restores them. Out of the
combat phase (the return curtain), `OpponentHand` holds its last fold instead of refolding the old log at cursor 0; a
DEV duel preview still shows the bare starting hand.

**Player's own hand (checked).** No count revert: in-combat grants land in `run.hand` at `settleCombat`, which runs while
the phase is still `combat`, and the preview list switches to the real cards in the same commit. One related difference
left alone: the player's copy-summon GREY (`combatHandSummoned`) is still gated on `!combatSettled`, so the player's
greyed hand cards un-grey at the settle; grants that landed get fresh run uids at the settle, so keeping their grey would
need a combat-uid to run-uid map the reducer does not expose. Flagged, not changed.
