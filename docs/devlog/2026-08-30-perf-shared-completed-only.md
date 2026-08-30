# The shared perf tab lists completed games only — and says when a share fails

Two changes from one owner message (2026-08-30): *"i also dont want to see abandoned games in that tab, only
completed games"*, asked alongside *"why are his games not showing up?"*

## Completed games only

Auto-share published in two places: on the `gameover`/`victory` transition, and on `visibilitychange` as a
fallback for *"the game you abandon halfway"*. The fallback is now gone.

It was defensible as "capture what we can" and wrong as analytics. An abandoned run's timeline stops
mid-shop, its phase mix is whatever the player happened to be doing when they tabbed out, and it lands in
the list looking exactly like a real game beside rows that can legitimately be compared with one another.

**Nothing replaces it.** A game that is not finished is not a data point, and the honest way to have fewer
bad rows is to stop writing them rather than to write them and filter on read.

Rows the old fallback already wrote cannot be un-uploaded, so the viewer hides them: `isCompletedRow` drops
any row whose note is exactly `'abandoned'`. Exactly — a manual Share reading *"abandoned the run at wave 6
to test the shop"* is kept, which is the case the test pins.

## A failed share is no longer invisible

`uploadRun` was called as `void uploadRun(...)`, so its result was discarded. Every failure mode it takes
care to return — signed out, RLS refusal, table missing, over the size limit — went nowhere.

The effect: a dev client that recorded an entire game and then failed to publish it was **indistinguishable
from one that never recorded at all**. That is exactly the state that produced the owner's question, and
nothing on either machine could answer it.

It now warns to the console, naming the reason, and translating `notReady` into the actionable version
("the perf_runs table does not exist yet — run schema.sql"). A dev tool may fail quietly; it may not fail
invisibly.

## The gates a game must pass to appear (written down because the question will recur)

1. **The client has the code** — merged in #1304 at `2026-08-30T00:15:52Z`.
2. **`import.meta.env.DEV`** — auto-capture is dev-only by design. A prod build (the desktop exe, the itch
   build) ships the monitor dormant and will never record or upload.
3. **`isRealPlayRun`** — Ascent mode only; practice, sandbox, tutorial and rift are excluded.
4. **≥ `MIN_AUTO_SHARE_SECONDS` (45)** of visible recording.
5. **The run reaches `gameover` / `victory`** — as of this change, the only trigger.
6. **Signed in** — the insert needs `auth.uid()` for the `insert own perf_runs` RLS policy.
7. **The reader is signed in too** — `read perf_runs` is `to authenticated`, so a signed-out viewer sees an
   empty tab rather than an error.

Gate 2 is the one that catches people, and gates 6 and 7 are the ones that used to fail in silence.
