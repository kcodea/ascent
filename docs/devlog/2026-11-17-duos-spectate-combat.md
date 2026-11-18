# Spectating a Duos fight: seat switches and mid-fight passes (2026-11-17)

Owner report (Kevin, spectating a Duos game): "switching views in combat restarts combat" and "the cards granted in
combat and/or passed in combat dont happen or show the animation until AFTER combat resolves". Rules
R-SPECTATE-DUOS-SWITCH-01 and R-SPECTATE-DUOS-LIVE-01. All in `packages/ui/src/versus/spectate.ts`; no Worker change.

## 1. A seat switch restarted the fight

`watchSeat` already continues a fight from the beat on screen when the new seat is in the SAME fight (`resumeAt`,
R-VERSUS-PERSPECTIVE-01), and starts it fresh otherwise. `sameFightAt` read "same fight" off the round row's fight list.
A Duos round row has ONE fight that names only each team's FIRST board (`a_seat` / `b_seat`), so the reserves (the
teammates) matched nothing: every switch to or from a teammate counted as a different fight, the pin was dropped and the
replay restarted at beat 0 until a keyframe seek caught it up. Now a Duos fight row counts all four seats as in it.

A second cause showed in the live check (four headless players + a spectator on `wrangler dev`): even with the resume
set, the new seat's fight object went through Recruit's fight ENTRY (stage back to `closing`, then an 800 ms settle
before `fighting`), so the opening boards showed for 0.3-0.8 s before the resume seek landed. Two paths did that: the new `lastCombat`
reset the stage to `closing` in place, and a switch to a seat with ANOTHER hero remounted Recruit outright (Game keys it on
seed + hero). Recruit now keeps the stage at `fighting` when a seat-switch resume is pending for the wave
(`spectatorResumePending`), and Game holds Recruit's key while the watch screen is in a fight (as it already does for the
teammate view, R-DUOS-VIEW-NOREMOUNT-01); a remount still owed happens at the shop, under the exit curtain.

The genuinely different fight (a Versus Group round's other pairing) no longer starts at beat 0 either when anything
better is known: each seat's latest reported beat (`cb` on its keyframes) is kept per seat (`seatBeats`) and the switch
resumes there, then the keyframe the switch asks for seeks on to where the player is now.

## 2. Mid-fight passes and gifts showed only after the fight

The watch screen PINS a fight's view so the player's settle (Health drop) waits for this screen's own strike
(R-SPECTATE-STRIKE-01). The pin held the FIRST combat frame received, which in Versus is the one from before the fight
landed (`deferFight`: the run sits in combat with no result yet). Everything the player's run did inside the fight was
held with it until the strike: a teammate's pass or gift landing in the watched hand (the arrival stream plays off the
frame-to-frame diff, `watchedPasses`), and the fight's own held gifts (outbox entries with `combatIdx`, queued when the
fight lands, which `duosCombat.tsx` streams on their `teamSend` beats; with the pre-landing frame pinned there were none).
The pin now follows the player's UNSETTLED frames of the same fight and holds back only the settled one. The fight object
comes from the round row, so the replay never restarts on those frames.

Combat-time `toHand` grants of the watched board were already beat-driven on the watch screen (the same
`grantsShownThrough` the player's screen uses), so they needed no change.

## Not changed, noticed

`duosMateRunNow()` (the Duos fighter view's teammate hand, R-DUOS-FIGHTER-VIEW-01) passes no round to
`spectatorRunOf`, which returns null for a view in combat with no fight, so in a live match the hand row keeps showing
your own hand while your teammate's board fights. Only the Scene Builder's placeholder teammate shows theirs. Left for
its own fix.
