# 2026-10-27 · Versus client reliability (fix/versus-client-reliability)

Owner: Versus 1v1, Group, Versus Duos and Ranked Duos "need to be spotless experiences" after End of Turn freezes
("completely locking us out") and reconnects where "it would simply pause when someone returned". A read-only audit
listed client causes A-F; this is the client half (a server builder is on fix/versus-server-reliability).

| | Before | After | Rule |
|---|---|---|---|
| A Realtime | One topic per room. Nothing watched the join status, so a channel the server closed stayed dead (heartbeat + polls only). | Topic per match (`versus:<room>:<match>`), a same-topic re-open waits for any channel still on it, error/timeout/close re-opens with backoff (1 s..30 s), a re-join re-reads room/match/rounds. | R-VERSUS-RELIABLE-01 |
| B Resolver | Every client that saw `resolving` on its own answer called versus-resolve (all of them at 0:00). | `closed_by_me` decides; without it seat p1 / the table's first live seat asks; others wait 4 s + up to 1.5 s jitter; one call in flight per client. | R-VERSUS-RELIABLE-02 |
| C Waking tab | No visibility/online handling; a throttled or frozen tab could reconcile with a stale heartbeat and pause on itself. | Wake (visible / online / pageshow / a late tick) sends the heartbeat first and holds reconciles; reconciles also need a heartbeat answered in the last 9 s. | R-VERSUS-RELIABLE-03 |
| D Pause UX | Others saw "X is back. Waiting for them to unpause" forever; nothing on screen for a Hero Select pause. | After the grace others get Unpause; the same veil over Hero Select; a precise reconcile at the 3-2-1's end. | R-VERSUS-RELIABLE-04 |
| E Stalls | No fetch timeout; lost combatReady never resent; End Turn marked fired even if it never started; a fight during a card animation waited for the next heartbeat; resolver errors silent; a lost ready answer guessed. | 8 s RPC abort (20 s resolver); End Combat resent with backoff; End Turn watchdog (1.5 s); deferred drive on animation end; ready state re-read from the server; "The fight is on its way" after 3 resolver failures. | R-VERSUS-RELIABLE-05 |
| F Duos dock | `#stage` is `display: contents` when unscaled, so its rect was all zeros and the dock never got a geometry on full-size windows. | `stageBox`: a stage with no box is the viewport. | R-VERSUS-RELIABLE-06 |

Notes for the next session:
- A's exact audit mechanism (realtime-js handing back the leaving channel) did NOT reproduce against realtime-js 2.108.2
  in the fake-socket test: @supabase/phoenix 0.4.4's `leave()` closes the channel locally at once. The real gap was the
  unwatched join status. The per-match topic stays: it keeps late leave/close traffic for an old join off the new channel.
- Mixed builds in one room (old client on `versus:<room>`, new on `versus:<room>:<match>`) do not see each other's
  broadcasts (emotes, spectator frames) until both update; row changes are unaffected.
- `closed_by_me` is read as an optional field; it works before and after the server half lands. Without it the client
  does NOT keep the old every-client kick (the server contract's suggestion): one deterministic asker (p1 / first live
  seat) plus the jittered backstop. `resolve_retry` going up triggers one more ask; `end_reason: 'void'` is in the unions.
