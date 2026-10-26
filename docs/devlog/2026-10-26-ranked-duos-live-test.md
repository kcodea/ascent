# 2026-10-26 — Ranked Duos: first live test (Claudebot1 + 2 live, Claudebot3 spectating)

Phases 1 (#2321) and 2 (#2325) were live. Two short matches on the real backend: three headless Chrome sessions with
persistent Claudebot profiles on a `VITE_PERF_BENCH=1` prod build, driven over CDP, real recorded opponents from the pool.
Oracle R-RANKED-DUOS-LIVE-01.

## Worked

- Seating: three teams of two DIFFERENT players each (e.g. LazerLemon & Orangez, Rooks & LazerLemon, IonLime & Rooks),
  all eight heroes unique, at most two seats per player. Your own runs (and your teammate's) can be seated like anyone's.
- Hero select: the teammate's choices view (#2322) and the clock's picks (never the same hero for both).
- The end-turn gate, every case: nobody ended at 0:00 (shopping refused, the round waits on the 30 s backstop; an End
  Turn then gives the other 5 s, shown on the clock as 0:04...); one ended early (wait to 0:00, then 5 s); both ended
  (at once). No pause; a disconnected teammate goes on auto, counts as ended ("Players ready 2/2"), the portrait shows away.
- Passing (a hand card landed in the teammate's hand), the tag-team fights, the 8-row rail with team names and team
  pools, the damage cap, a reload (the run came back at round 10, auto cleared).
- Knockout to 4th and the TEAM's rating (settled once per match: Bronze I floor, revision 1 then 2); a concede by one
  teammate kept the team playing; both conceding placed the team at once.

## Fixed

- **Placement never committed** (the blocker): `versus_ranked_duos__place_team` / `__record_run` read
  `versus_test_bots.user_id`; the column is `bot_user`. On the live project the round that placed the live team raised,
  `finalize_ranked_duos` answered `resolver_failed`, and the match stuck in `resolving`.
  `2026-10-31-ranked-duos-live-fixes.sql` (applied by the lead); the PGlite suite now builds the REAL table shape and was
  shown to fail without the fix.
- **Spectator crash**: the spectator bar assumed every seat in its order existed; before the recorded table loaded it read a
  missing seat ("The game hit a snag"). The default watched seat could also land on a recorded seat. Both now keep to the
  two live teammates (`SpectatorBar`, `watchableSeat`).
- **Match stats listed only the live pair**, out of 2 seats. They now list all four teams (the recorded ones from
  `withServedSeats`), each on its team pool, the place out of 4.

## Notes (not changed)

- "Connection problem. Try again." came from the test script pressing a gate twice (`room_not_sealed` has no copy, so it
  falls back to the network text). Not seen through the real crystal; pre-existing Versus behaviour.
- When my teammate's board fights first, my hero slot and the teammate portrait both show the teammate (existing Duos).
