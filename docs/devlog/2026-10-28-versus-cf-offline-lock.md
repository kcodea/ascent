# 2026-10-28 — Versus on Cloudflare: a lock sent while disconnected does not count

Owner ruling via the lead ("sure"). R-VERSUS-CF-OFFLINE-LOCK-01. Found by the Cloudflare chaos matrix
(`2026-10-28-versus-cf-stale-socket.md`, "noticed, not changed").

## The bug

A player whose connection drops shortly before 0:00 keeps a running shop on their screen; at their own 0:00 the client
sends its End Turn lock. On Supabase that request fails at once (offline) and nothing lands. On Cloudflare the socket
client queues requests until it reconnects, so the lock landed the moment the player came back: with the other side
already ready, the round closed during the resume 3-2-1 and the player lost the shop time the pause had stopped for
them.

## The fix

The room refuses a NEW lock (`submit` with `final`) from the seat the match is paused on, with `paused` (`roomCore.ts`
1v1, `groupMatch.ts` Group / Duos). The screen takes no End Turn while paused, so such a lock can only be one sent while
gone. A seat already locked before it left stays locked; Ranked Duos never pauses. The store already treats an
unknown refusal as "not locked" (the gem relights), so no client change was needed.

## The guard

- New invariant `pausedClose` (`chaosMatch.ts`, both hosts): a shop never closes while the match is paused on a seat
  that is not on auto.
- New shared scenario `dropAtZero` (1v1, Group 3, Group 4, Duos): the others are ready; one player (never presses End
  Turn) loses a connection the room hears 5 s before 0:00, for 30 s. Before the fix it failed `pausedClose` in all four
  modes, and so did `dropLong`; after, every cell passes and the round closes when the restored shop time runs out.
- `ChaosEvent.beforeDeadlineMs`: fire an event a set time before a round's 0:00.
- `workers/versus/test/roomCore.test.ts`: the refused lock, the restored deadline and a fresh lock after the resume
  (fails without the fix).

## Supabase under the new invariant

`pausedClose` is judged on both hosts. Supabase fails it in hang (1v1, Group 3, Group 4, Duos) and dropRestore (Group 4,
Duos): a hung lock that finally lands, or the lock a client sends the moment it is back, closes the round during the
pause (the SQL accepts a lock from the paused seat). Recorded in `chaosKnown.ts`, not fixed (Supabase is the outgoing
host). dropAtZero passes on Supabase apart from the known slow pause lift in 1v1. Full Supabase matrix: 113/113
against the ledger.
