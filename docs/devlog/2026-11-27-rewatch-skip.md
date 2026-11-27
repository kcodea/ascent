# 2026-11-27 — Watch replay can be skipped after the fight was already skipped

Owner ask: "would be nice to be able to skip/fast foward after you click Watch Replay in the round summary menu.
sometimes I accidentally click it but have to wait for the whole combat to finish".

**What was wrong.** Skip already lives on the diamond during a rewatch (`ShopControls` `skipReady = fighting &&
!replayDone && !replayTurboing`), and it worked for a fight that had been watched in full. But `useCombatReplay`
kept its Skip (`turbo`) latched "until the next fight", and the Fight Recap's Watch replay is the same fight seeked
back to 0. So a fight that had been Skipped once reported `turboing: true` for its whole rewatch: `skipReady` was
false, the End Combat gate was closed (`replayDone` false), the diamond sat disabled, and `skipCombat` early-returned
on `r.turboing` anyway. Players who skip fights (most of them) could never skip a rewatch.

**Fix.**
- `useCombatReplay.ts` `seekTo`: a seek that lands on beat 0 is the fight starting over, so it drops the Skip
  (`setTurbo(null)`), like a new fight does. The speed loop's teardown already restores the FX clock and the sound
  for a Skip dropped mid-race. A seek FORWARD keeps the Skip (a spectator catching up to the player's beat mid-Skip).
- `Recruit.tsx` `skipCombat`: a Skip pressed during a rewatch is not tapped to the stands or the replay stream
  (`rewatchingRef`, now declared beside `replayRef`). The fight itself is over; sent on, it could skip a spectator's
  first viewing and write a second Skip into the recording.

**Rule.** `R-SKIP-REWATCH-01` (foundation). Pinned by `skipTurboReplay.test.tsx` (Skip, finish, seek to 0, Skip again
through the real hook; forward seek keeps a racing Skip; the tap guard by source text) and the updated line in
`versus/spectateSkip.test.tsx`.

**Not checked live.** Verified through the hook under fake timers, not by playing a fight in the app.
