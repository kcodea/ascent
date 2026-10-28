# 2026-10-28 — Versus on Cloudflare: silent drops pause at ~15 s (per-socket stale deadline)

Follow-up to the Cloudflare chaos matrix (`2026-10-28-versus-chaos-cf.md`), the last item before flipping every mode.

## The bug

Presence on Cloudflare is the socket. A lost network sends no close, so the room only learns from the keep-alive going
stale (15 s after the last ping). `room.ts` armed the stale sweep for `now + 15 s`, and only for a 1v1 match:
- 1v1: a silent drop was found 15-30 s after the last ping, so the match paused ~22 s after the player left;
- Group / Duos / Ranked Duos: no sweep was armed at all. A stale socket was found only when another alarm happened to run
  (a deadline), ~25 s in the matrix and up to a whole shop in general.
(The #2379 harness mirror had armed the sweep for group matches too, so its group numbers were a little kinder than the
real shell; the mirror now matches the shell line for line.)

## The fix

`room.ts`: `staleAt(ws)` = the socket's last auto-response stamp (or its open) + 15 s. While any match runs, `rearm()`
pushes each live socket's own `staleAt`, and the alarm closes a socket at or past it. The alarm still fires about every
10-15 s per room while a match runs (each ping moves the deadline forward; pings never wake the object), the same cost
as before. With the 3 s grace a silent drop now pauses ~13-18 s after the player left (Supabase: ~14.7 s in the same
scenario). R-VERSUS-CF-STALE-01.

## The guard

- New invariant `latePause` (`chaosMatch.ts`, both hosts): a player gone longer than 21 s must have paused the match
  within 20 s of leaving (not Ranked Duos, which never pauses; not a seat that is out or on auto).
- `dropLong` (a silent 45 s drop in a shop) moved into the shared matrix, so both hosts are judged by it. With the old
  shell mirrored exactly, dropLong failed latePause in duel / group3 / group4 / duos; with the fix all pass, and
  Supabase passes it too. `dropLong/group4` is in the Cloudflare CI smoke.
- `close` no longer judges a shop that closes WHILE PAUSED against its pre-pause deadline (it closed on everyone's
  locks with the clock stopped).

## Noticed, not changed (product call)

A player whose network drops across their own 0:00 locks locally; on Cloudflare that lock waits in the socket's request
queue and lands when they reconnect, so with the other player already ready the round closes during the resume 3-2-1
(dropLong, every pausing mode). On Supabase the offline lock fails at once and the player gets their paused shop time
back after the resume. Either reading is defensible (the player saw 0:00); the room also accepts a lock while paused.
