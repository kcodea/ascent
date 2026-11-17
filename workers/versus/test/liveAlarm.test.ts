/**
 * THE SESSION'S ALARM SLEEPS (R-SESSION-ALARM-01; usage audit 2026-11-17: the hub's GameSession took ~7.5 requests a
 * second per game, ~13.8M a month against 1M included, and never hibernated). On a fake clock, the live host's alarm
 * (`liveAlarmAt`, fed by `LiveCore` and `SessionCore` exactly as `liveHost.ts` `rearm` feeds it) is driven the way the
 * runtime drives it: each time it fires, the alarm handler's work runs and the next alarm is armed. The round trip in
 * workerd is `test/it/sessionIdle.it.ts`.
 *
 *  - An ENDED session game with every socket gone keeps its session for 30 minutes: its alarm sleeps until the session's
 *    own clock (the forget), never re-armed to "now" (the loop: `LiveCore.idleAt` is already past for an ended game).
 *  - An ended game that still has a socket connected past the 2-minute linger (a refused hello, a watcher on the end
 *    screen) does not loop on the passed linger either.
 *  - A host that may forget itself (the Versus Worker's live game) still forgets at once.
 *  - The backstop: a re-arm from inside the alarm is never sooner than a second.
 */
import { describe, expect, it } from 'vitest';
import { LiveCore, newLiveMeta } from '../src/core/liveCore';
import { LIVE_ALARM_FLOOR_MS, LIVE_END_LINGER_MS, liveAlarmAt, type LiveAlarmInput } from '../src/core/liveAlarm';
import { SESSION_FORGET_MS, SessionCore, newSessionMeta } from '../src/core/sessionCore';
import { VERSUS_CF_STALE_MS } from '../src/protocol';

const T0 = Date.UTC(2026, 10, 17, 20, 0, 0);
const P = '11111111-1111-4111-8111-111111111111';
const info = { name: 'Claudebot1', hero: 'warden', round: 4, phase: 'shop', mode: 'ranked' };

const base = (now: number): LiveAlarmInput => ({
  now, extra: null, grace: null, idle: null, keepsState: false, reporter: null, listing: null, stale: [], endedAt: null, sockets: 0, fromAlarm: false,
});

/** A session game that ended at `T0`: the save cleared, nothing owed, the player's socket gone. */
function endedSessionGame(): { core: LiveCore; session: SessionCore } {
  const core = new LiveCore(newLiveMeta('game-1', '', T0 - 20 * 60_000));
  core.publish(P, T0 - 20 * 60_000);
  core.listing(P, info, T0 - 60_000);
  core.end(P, 3, T0);
  core.gone(P, T0);
  const session = new SessionCore(newSessionMeta('game-1', T0 - 20 * 60_000));
  session.save(P, 'run:game-1', 0, 'd', T0 - 60_000);
  session.clearSave(P, 'run:game-1', 0, T0);
  session.flushed({ writeKeys: [], save: false, clear: session.meta.clear }, { writes: [], save: null, clear: { status: 'ok' }, rating: null }, T0);
  return { core, session };
}

/** The input `rearm` builds for that game at `now`. */
const inputOf = (core: LiveCore, session: SessionCore, now: number, sockets: number, fromAlarm: boolean): LiveAlarmInput => ({
  ...base(now), fromAlarm, sockets,
  extra: session.nextAt(now, core.publisherHere, core.meta.publisherGoneAt ?? null),
  grace: core.graceAt(),
  idle: core.idleAt(sockets),
  keepsState: !session.forgettable(now),
  endedAt: core.meta.end?.at ?? null,
  stale: Array.from({ length: sockets }, () => now + VERSUS_CF_STALE_MS),
});

describe('the game session sleeps (R-SESSION-ALARM-01)', () => {
  it('an ended game with no sockets sleeps until the session forgets itself: a handful of wakes in 30 minutes, not a loop', () => {
    const { core, session } = endedSessionGame();
    expect(core.idleAt(0)).toBe(T0); // the live part's clock is already past: the old rearm armed it again and again
    let now = T0 + 1_000;
    let at = liveAlarmAt(inputOf(core, session, now, 0, false));
    let wakes = 0;
    while (at != null && wakes < 1_000) {
      now = at;
      wakes += 1;
      if (session.forgettable(now)) break; // the alarm handler deletes everything here
      at = liveAlarmAt(inputOf(core, session, now, 0, true));
    }
    expect(wakes).toBeLessThanOrEqual(2);
    expect(now).toBe(T0 + SESSION_FORGET_MS);
  });

  it('the first alarm after the end is the session forget time, not now', () => {
    const { core, session } = endedSessionGame();
    expect(liveAlarmAt(inputOf(core, session, T0 + 5_000, 0, true))).toBe(T0 + SESSION_FORGET_MS);
  });

  it('a socket still open on an ended game past the linger: the next alarm is its stale check, not the passed linger', () => {
    const { core, session } = endedSessionGame();
    const now = T0 + LIVE_END_LINGER_MS + 30_000;
    expect(liveAlarmAt(inputOf(core, session, now, 1, true))).toBe(now + VERSUS_CF_STALE_MS);
    // Before the linger it is the linger (the sockets are let go then).
    expect(liveAlarmAt({ ...inputOf(core, session, T0 + 10_000, 1, false), stale: [T0 + LIVE_END_LINGER_MS + 60_000] })).toBe(T0 + LIVE_END_LINGER_MS);
  });

  it('a host that may forget itself (the Versus live game) still forgets at once', () => {
    expect(liveAlarmAt({ ...base(T0 + 5), idle: T0, endedAt: T0 })).toBe(T0 + 5);
    // ... but the session's host holds its state: the idle clock waits for the host's own.
    expect(liveAlarmAt({ ...base(T0 + 5), idle: T0, endedAt: T0, keepsState: true, extra: T0 + SESSION_FORGET_MS })).toBe(T0 + SESSION_FORGET_MS);
    expect(liveAlarmAt({ ...base(T0 + 5), idle: T0, endedAt: T0, keepsState: true })).toBeNull();
  });

  it('the player gone past the grace still ends the game on time', () => {
    const core = new LiveCore(newLiveMeta('game-2', '', T0));
    core.publish(P, T0);
    core.gone(P, T0 + 10_000);
    const at = liveAlarmAt({ ...base(T0 + 11_000), grace: core.graceAt(), idle: core.idleAt(0), keepsState: true });
    expect(at).toBe(core.graceAt());
  });

  it('backstop: a clock left in the past re-arms at most once a second from inside the alarm', () => {
    expect(liveAlarmAt({ ...base(T0), extra: T0 - 50, fromAlarm: true })).toBe(T0 + LIVE_ALARM_FLOOR_MS);
    expect(liveAlarmAt({ ...base(T0), extra: T0 - 50 })).toBe(T0); // a message's re-arm may still run it now
    expect(liveAlarmAt(base(T0))).toBeNull();
  });
});
