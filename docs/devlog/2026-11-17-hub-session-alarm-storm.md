# 2026-11-17: the game session's alarm loop (R-SESSION-ALARM-01)

Branch `fix/hub-gamesession-request-storm`. A usage audit read Cloudflare's GraphQL analytics and found the hub's
`GameSession` Durable Object taking about 27,000 requests an hour per live game (about 7.5 a second). It never
hibernated. That came to about 13.8M Durable Object requests in 30 days, against 1M included.

## Root cause

It was an alarm loop on the server. The client was not sending too much. `LiveGameHost.rearm` (`liveHost.ts`)
armed the earliest of every clock. Two of those clocks are already in the past once a game has ended:

- `LiveCore.nextAt`, once every socket is gone, returns `activeAt` for an ended game. That means "forget me now".
- `end.at + 2 min` (let go of the sockets still connected) was armed whether or not a socket was connected, and
  even after it had passed.

On the Versus Worker's live object that is harmless, because the alarm forgets the object at once. A `GameSession`
keeps its state for `SESSION_FORGET_MS` (30 minutes) after its last flush (`keepsState`), so the idle path never
ran. `rearm` then armed `max(now, past)`, which is now, again. The object woke in a tight loop for up to 30 minutes
after every game, and every wake is a billed request.

## Measured locally (`npm run hub:dev` on 8788; the real client headless on a private Vite on 5199; dev auth; every request outside localhost was blocked)

| | before | after |
|---|---|---|
| in play, nobody watching, 30 s | 2 alarms; the client sent 11 frames (keep-alive pings every ~5 s, which the runtime auto-answers, plus the 15 s listing) | 1 alarm, same client traffic |
| in play, one watcher, 30 s | (the object was evicted mid-phase: it hibernates) | 2 alarms |
| ended, every socket gone, 10 s | **644 alarms** (64 a second) | **0** (the object sleeps until its 30-minute forget) |

The client side was clean: no per-frame traffic. The game sends nothing to the session except pings, the listing,
the per-shop save and the stream while someone watches. No client change was needed.

## The fix

`core/liveAlarm.ts` `liveAlarmAt` is a pure function, and `rearm` feeds it. The live part's idle clock
(`LiveCore.idleAt`, split from `graceAt`) counts only when the host may forget itself. The linger counts only while a
socket is connected and the linger is still ahead. As a backstop, a re-arm from inside the alarm is never sooner than
1 s. A DEV-only alarm counter (kept in storage, so that an evicted object still reads true) is exposed on
`/session/<game>/metrics` under `live.alarms`.

Tests: `workers/versus/test/liveAlarm.test.ts` (fake clock: an ended game wakes at most twice in 30 minutes) and
`workers/versus/test/it/sessionIdle.it.ts` (workerd; this one failed before the fix with 166 alarms in 5 s).

## Deploy

This is a server-only change: deploy the hub (`npm run hub:deploy`). The hub protocol and the client contract are
unchanged, so old exes and builds need nothing. The Versus Worker's live object shares `liveHost.ts`, so it picks the
change up on its next pack deploy, but it never looped.

## Noticed, not fixed

A player who goes to the title mid-game ends their live listing (`livePublisher` `stop('abandon')`). If they then
press Continue, the same game id is refused at hello (`game_ended`), so the rest of that game cannot be watched. The
publisher retries with backoff of up to 60 s. That costs a few requests a minute. It is not a loop.
