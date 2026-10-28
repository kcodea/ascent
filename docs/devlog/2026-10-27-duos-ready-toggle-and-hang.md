# 2026-10-27 - Live games: a Ready toggle gem, Ranked Duos waits for both at 0:00, End Turn starts at the close

Owner feedback on Duos (Versus Duos and Ranked Duos), branch `fix/duos-ready-toggle-and-hang`:

- "there are still some bugs with things like the end turn button feeling stuck or hanging. going back to shop from
  combat is very quick, but going into combat from shop seems to hang?"
- "when a player hits their end turn gem, they should be able to un-ready it. maybe we modify the end turn gem for
  'live' games where it is a 'ready' status that the player can toggle on/off."
- "in duos, don't do the 5s timer when a player readies at 0 seconds. make it so both players must ready up to progress it."
- "versus modes still need the opponent force progress so the game doesn't wait for opponents for too long."

Oracle: R-RANKED-DUOS-GATE-02, R-VERSUS-READY-02, R-VERSUS-EARLY-EOT-01 (R-RANKED-DUOS-GATE-01 amended).

## 1. Un-ready, end to end (verified, no change needed)

#2331's un-ready path was traced through: the gem's second press (`EndTurnButton` -> `useVersusRecruit.intercept` ->
`unreadyTurn`) cancels pending re-locks, drops `lockedRound`, sends `versus_unready` / `versus_group_unready` in press
order (`inOrder`), and restores the ready state if the server refuses (`stale_round` / `deadline_passed`). The live
server has both functions (checked: they answer `permission denied` to the anon role, not "no such function"). PGlite
coverage stays `versusReady.db.test.ts`. Un-ready is still refused from 0:00 in every mode (unchanged).

## 2. The gem reads as a Ready toggle in live games (R-VERSUS-READY-02)

- `EndTurnButton` takes `label` (the shop-phase hover label) and `readyOn`. While ready above 0:00 the gem stays LIT
  (`.pressed.readyon` shows the lit gem, not the crack) under `.etb-readyglow`: a green copy of the gem with a static
  tint + halo, faded in on opacity and breathing on opacity only (`etbreadybreathe`). `aria-pressed` while ready.
- The crack now means one thing: the round has closed and the fight is coming.
- `versusTurn`'s `shop` kind carries how many others are ready; `versusReadyLabel` -> "Ready up" / "Ready up. 1/4 ready"
  / "Press again to cancel". `versusTurnNote(t, s, { cancellable, overtime })` -> "Ready 1/4. Press again to cancel"
  above 0:00; past 0:00 in Ranked Duos "Waiting for Lemon" / "Lemon is ready".
- Bug found on the way: `useVersusTurn` rebuilt the turn from a `|`-joined key that dropped `mate`, so the Ranked Duos
  "Waiting for <teammate>" fight pill never reached the screen. The key is now the whole turn as JSON.
- Solo lobby End Turn: untouched (no `label` / `readyOn` outside `mode === 'versus'`).

## 3. Ranked Duos waits for both at 0:00 (R-RANKED-DUOS-GATE-02)

`rankedDuosCloseAt` and `versus_ranked_duos__close_at` (`supabase/migrations/2026-11-02-ranked-duos-both-ready.sql`):
both ready = at once; otherwise past 0:00 it waits, up to the existing 30 s AFK backstop. The 5 s window after the first
End Turn is gone, and so is the clock face's 5 s countdown (it stays at 0:00). The disconnect path exists and is
unchanged: a teammate whose 12 s lease lapses goes on auto in `versus_ranked_duos_reconcile`, and an auto or left seat
counts as ready (db test: "no pause: a lapsed teammate goes on auto and counts as ended"). Versus Duos / Group / 1v1
never had the 5 s rule: they close at 0:00 for everyone (the opponent force-progress), untouched.

Judgement call: the 30 s backstop past 0:00 now also bounds "one ready, the other connected but never presses". The
owner's line was "both players must ready up"; without the backstop a connected idle teammate could hold the round
forever. Remove the backstop only on an owner ruling.

## 4. The shop -> combat hang (R-VERSUS-EARLY-EOT-01)

Where the time went (the #2331 timeline, `versusFlowTimings()`): close seen -> resolver asked ~2 ms; the resolver call
1.7-2.7 s; its answer -> fight row ~110-180 ms; then the real End Turn started, so the End of Turn beats (plus their
500 ms pad) ran AFTER the resolver, on top of it.

Change: the real End Turn starts the moment the round closes (`driveRun`: `resolving` for my wave sets `endTurnWave`).
The beats play during the resolver wait; the commit that lands the fight (`versusLand`) is held until the fight is in
(`holdUntilVersusFight` in `versusHooks.ts`, checked in `dispatch`, `commitPresentationAction`, and the End of Turn
completion in `Recruit.tsx` so the projections stay up), released by `driveRun` when the round arrives. Nothing reaches
the combat screen without this round's fight. A spectator's held End of Turn now waits up to 12 s (was 4 s).

Expected effect: on a turn with End of Turn content the wait shrinks by the beats' length plus the 500 ms pad (capped
by the resolver time); on a turn with none, unchanged. Ranked Duos at 0:00 also loses the 5 s wait (section 3).

Not done: a resolver prewarm (`health` measured 41-178 ms from here, no sign of cold starts outside the duplicate-call
outliers #2331 already removed), and the resolver's own ~2 s.

Live measurement: started (Versus Duos, an anonymous bench host "Claudebot11" + three in-tab test bots, `origin/main`
bench build) and STOPPED after round 1 at the lead's request (real players were seeing connection issues). The one
round measured had a 10 s resolver call, consistent with the backend trouble, so it is not a baseline. Before/after
timings are owed for a calm backend.

## Deploy

1. Apply `supabase/migrations/2026-11-02-ranked-duos-both-ready.sql` (after `2026-11-01-versus-ready-signal.sql`). An
   old client on the new server shows the 30 s backstop as its "grace" countdown past 0:00; ship the web build with it.
2. versus-resolve: no redeploy needed (it does not read `rankedDuosCloseAt`; content revision unchanged).
