# 2026-10-27 — Phones: coming back to the game never shows an error code (R-PHONE-RESUME-01)

**Owner (2026-10-27, iPhone Safari):** "seems to be an issue with minimizing the game and coming back. it shows an
error. is there a way to fix this or clean it up so you just press continue without an error code there or something?
or the game gets paused?"

## What was reproduced, and what was not

A headless WebKit walk as an iPhone (prod build, offline, bot seats) backgrounded the game on the title, in the Shop,
mid-combat and across a reload: `visibilitychange` hidden, `pagehide`, every WebGL context lost (restored, and once
left lost), audio contexts suspended, and every clock (performance.now, Date.now, rAF) jumped 10 minutes on return.
No error screen appeared, the FX layers rebuilt (R-PHONE-FX-CTX-01 works), and a reload landed on the title's
CONTINUE, which resumed the run. So the offline game survives a background cycle; the error comes from what that walk
cannot do (the network waking up, the live backend). The paths found by reading the code:

1. **The error screen itself.** The only screen in the game that prints an error message is the render-crash
   boundary ("The game hit a snag" plus the raw `error.message`). Any one-off render crash on the way back showed it.
2. **Code-split chunks.** The first requests after iOS wakes a page often fail outright (`TypeError: Load failed`, seen
   in the walk for every blocked request). A `React.lazy` chunk (Patch Notes, God Mode panel) that fails throws into
   the boundary, and React caches the rejected promise, so "Try to continue" threw the same error again. The FX
   primitives' import cached its failure too, leaving every def effect dark for the session.
3. **Cloud save, a lost answer.** iOS freezes the page with the save upload in flight. The server commits it; the page
   never hears back, so the lease keeps the old revision. The next upload, or the tab-return check, finds the row one
   revision ahead and showed "Your game moved. You continued this game on another device." It was this device.
4. **The crash readout.** In a Home Screen app the crash log readout ("Last session crashed after: ...", memory
   numbers) showed by itself on the first load after a crash, for example iOS killing the page as it came back.

## Fixes

- The boundary retries a crash silently first (one remount, nothing drawn). Only a crash that comes straight back
  (within 10 s) shows **Game paused** with one **Continue** and no error text; the detail is under a collapsed
  Details. Continue remounts, or, crashing again right after a remount, saves and reloads to the title's Continue.
  Every crash is still logged (console + a crash-log breadcrumb).
- `retryImport` wraps the production lazy chunks: up to 4 tries, waiting for the page to be visible. The FX
  primitives' import forgets a failure so the next call retries.
- `cloudSave` remembers a write that went unanswered; a row that is exactly that write landing (same run, this
  device, the next revision) is adopted, and the newer local save is sent on top. Another device's write is still
  reported as moved.
- Versus / Duos resync at once on `visibilitychange` visible and `online` (heartbeat, room, match + rounds) instead of
  waiting for the next 4 s beat.
- The crash readout shows only with `?crashlog=1`. Crashes still record and upload (crashReport.ts).

## Turn clocks (not changed, flagged)

The solo Shop clock (lobby and Practice) ticks one second per `setTimeout`, with no wall-time catch-up. iOS freezes
JS while the page is in the background, so on a phone the clock already does not run while the game is minimised.
On desktop a hidden tab keeps counting (timers keep firing). No rule in GAME-RULES.md lets a ranked lobby clock pause
when the page is hidden, so an explicit pause was not added; that is an owner call. Live modes keep their server
deadlines and the existing 30 s disconnect pause (R-VERSUS-PAUSE-01).
