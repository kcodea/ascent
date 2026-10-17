# 2026-10-16 — The 0:00 lock never lands early (lobby + Versus), Versus gets the engine lock, quiet after End Turn

**Owner:** "make sure that everything locks actually like after 0, make sure it doesnt lock early. felt like it was
locking a second early sometimes". Plus two rulings on #2127's flags: the clock goes quiet after an early End Turn, and
Versus takes the lobby's R-TIMER-LOCK-01 lock.

**Investigation.**
- **Versus (the real cause):** `versusStore.onTick` (every 500 ms) called `lockTurn` once the synced time left was
  `<= 400` ms, i.e. 400 to roughly 0 ms BEFORE the deadline, while the face (ceil) still read 0:01. The shop went
  held ("Players ready") a visible beat before 0:00. The early lock existed so the final side reached the server
  before its strict `>= shop_deadline` cut-off. Versus also never dispatched `shopClockExpired`, so the engine lock
  never applied there (hero powers etc. were held only by the "locked" hold).
- **Lobby:** checked and exact already. The clock is whole seconds one full period apart (`startSecond`), the face is
  the integer (= ceil of time left), and `shopClockExpired` fires on the same step that sets 0. A hold keeps the
  sub-second carry. Nothing compares against `<= 1`, floors, or subtracts a buffer. The step is now a named helper
  (`shopClockStep`) under the shared rule, with boundary tests.
- **Skew:** the synced offset can be off by up to half the best round trip. The shop's time left now adds that
  (`ServerClock.uncertaintyMs`, capped 500 ms), so the client's 0:00 is never before the server's.

**The rule (R-VERSUS-CLOCK-LOCK-01):** display `ceil(ms/1000)`, lock only at `ms <= 0`, both from one value
(`shopClockAt`). Versus: at 0:00 `expireVersusShop` dispatches `shopClockExpired` then `lockTurn`; the onTick
fallback uses the same rule. Server: `supabase/migrations/2026-10-16-versus-clock-grace.sql` adds
`versus__shop_grace()` = 250 ms; `versus_submit` accepts until deadline + grace, `versus_reconcile` closes the shop
only after it (bodies copied from 2026-10-13 / 2026-10-14-ready-pause, the effective latest). Covered against PGlite
in `versusBot.db.test.ts`. No versus-resolve change.

**Drag at 0:01:** an action completed before 0:00 counts; a drag in the air at 0:00 that would buy/play/sell is
refused (the card goes back), arranging still lands. In Versus the turn locks with the board as it stood at 0:00.

**Quiet after End Turn:** `useVersusRecruit` exposes `clockQuiet` (the on-screen seat locked while time is left: my
own lock, or the watched seat's `_locked` for a spectator); the driver plays no cues and `ChargeGlyph` gets `quiet`
(unlit, its normal fade + build fade-out). A lock at 0:00 is not quiet, so the 0:00 cues and glyph completion play.
