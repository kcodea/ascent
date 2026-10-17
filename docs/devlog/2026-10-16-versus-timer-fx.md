# 2026-10-16 — Versus clock sounds + the 20 s charge glyph

**Owner report:** "the versus timer does not play sound effects at all and the glyph animation doesnt play either, the 20s glyph".

**Root cause.** A lobby's clock cues (warm-up 10..6, FIVE..ONE ticks, the 0:00 explosion, the announcer's clock
reading) are played by Recruit's local countdown loop, and that loop is also the only thing that marks `turnClock` as
*running* (`startSecond` / `hold`). Versus skips the loop (the server owns the deadline) and only ever called
`turnClock.set(seconds)`, so no cue fired, and `isRunning()` stayed false all turn. The charge glyph reads that flag
(R-TIMER-SYNC-01), so it sat "held": frozen fill, no motes, and its build sound faded instead of starting.

**Fix.** `turnClock.follow(remainingMs, now, moving)` sets the seconds *and* the running state with the sub-second
anchor from the server deadline. `versus/versusClockFx.ts` (`driveVersusClock`) feeds it and plays the lobby's cues
at the lobby's seconds, only on a real one-or-two-second step down while the clock moves: first sight (reconnect,
remount, spectator seat switch), a pause (`paused_at`, set through the 30 s grace and the 3-2-1) and a deadline pushed
back up all stay silent, so nothing doubles. The shop (`useVersusRecruit`) and Hero Select (`VersusHeroTimer`, ticks
only, no explosion) both use it; observations land just past each second edge instead of a 250 ms poll. Spectators
already mirror the clock through `useVersusRecruit`, so no spectate file changed. Rule: R-VERSUS-TIMER-FX-01.

**Not changed (flag):** Versus still does not dispatch `shopClockExpired` at 0:00 (the lobby's engine lock,
R-TIMER-LOCK-01); the server ends the round on its deadline. The cues keep playing while a player who ended the turn
early waits on the other (the round's clock is still running).
