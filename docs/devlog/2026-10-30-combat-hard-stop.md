# 2026-10-30: End Combat gem hard-stops the fight (R-COMBAT-HARDSTOP-01)

**Owner report (Mike):** sounds from the fight, notably a hero attack, kept playing behind the return-to-shop wipe
after the End Combat / Return to Shop gem was pressed.

**Cause.** On a WIN the gem is ready as soon as the replay ends (`endCombatReady`), while the winner's hero strike
(Classic or any cosmetic style) is still playing. The strike was only cancelled by the `[fighting]` reset effect,
which runs after the wipe has fully covered the screen and `resolveCombat` has flipped the phase. Late combat timers
(delayed sfx, `playDef` cascades) could also still fire into that window, and Web Audio voices already scheduled had
no central way to be cut.

**Fix: one central stop** (`packages/ui/src/combatHardStop.ts`), called by `Recruit.tsx`'s `endCombat` before any
exit path:
- `stopFightNow` cancels the hero strike (voices, DOM, Pixi scene; never lands, `resolveCombat` still settles), drops
  the duel z-classes, and freezes the replay's beat clock (`paused: … || combatHalted`).
- `hardStopSfx` (sfx.ts): every sound reaches its bus through a per-epoch GainNode; the stop fades the epoch to 0 in
  25 ms and opens a fresh one, so everything already playing or scheduled is cut without any call site keeping a
  handle. It also stops a Skip whir and cancels the announcer (the `onStopAllAudio` hooks).
- `retireTransientPlays` (fxBudget.ts) retires every one-shot FX play (loops/followers are left to their owners) and
  the transient particles are cleared.
- **The hold** (`combatHold.ts`): until `releaseCombatHold()`, new sounds on any non-`ui` bus and every `playDef` are
  dropped, so new combat cues are covered by default. The `ui` bus stays open (gem pulse, wipe, end gate, placement
  tone). It is released just before the shop / end screen / room is committed, with a `[fighting]` backstop.
- The gem's relight pulse now starts in a microtask so it always lands after the cut.

Pinned by `packages/ui/src/combatHardStop.test.ts` (fake Web Audio graph + a wiring tripwire on `Recruit.tsx`).
