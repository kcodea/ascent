/**
 * R-VERSUS-CLOCK-LOCK-01 (owner 2026-10-16: "make sure that everything locks actually like after 0, make sure it doesnt
 * lock early. felt like it was locking a second early sometimes"). ONE rule for the lobby and Versus: the clock face
 * and the lock read the same time-left value; the face shows ceil(ms / 1000) and the lock lands only at ms <= 0. So at
 * 1 ms left the face reads 0:01 and an action goes through; at 0 ms it reads 0:00 and the Shop is locked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sfx', () => ({ sfx: { turnTick: () => undefined, warmTurnTick: () => undefined, turnExplode: () => undefined } }));
vi.mock('../announcer', () => ({ observeTurnClock: () => undefined }));

import { blockedByShopClock, type Action } from '@game/sim';
import { resetTurnClockForTests, shopClockStep, turnClock } from '../turnClock';
import { ServerClock, shopClockAt } from './versusClock';
import { driveVersusClock, resetVersusClockFxForTests } from './versusClockFx';

const BUY_LIKE: Action[] = [{ type: 'roll' }, { type: 'heroPower' }, { type: 'upgrade' } as Action];
const allowed = (expired: boolean): boolean => BUY_LIKE.every((a) => !blockedByShopClock({ phase: 'recruit', shopClockExpired: expired || undefined }, a));
const locked = (expired: boolean): boolean => BUY_LIKE.every((a) => blockedByShopClock({ phase: 'recruit', shopClockExpired: expired || undefined }, a));

beforeEach(() => {
  resetTurnClockForTests();
  resetVersusClockFxForTests();
});

describe('R-VERSUS-CLOCK-LOCK-01: the exact 0:00 boundary', () => {
  it('the rule: display ceil(ms / 1000), lock only at ms <= 0', () => {
    expect(shopClockAt(1)).toEqual({ display: 1, locked: false });
    expect(shopClockAt(0)).toEqual({ display: 0, locked: true });
    expect(shopClockAt(-30)).toEqual({ display: 0, locked: true });
    expect(shopClockAt(999)).toEqual({ display: 1, locked: false });
    expect(shopClockAt(1000)).toEqual({ display: 1, locked: false });
    expect(shopClockAt(1001)).toEqual({ display: 2, locked: false });
    expect(shopClockAt(null), 'a clock that has not started is not locked').toEqual({ display: 0, locked: false });
  });

  it('LOBBY: the lock fires on the step that shows 0:00, never on the one that shows 0:01', () => {
    const steps: { shows: number; expire: boolean }[] = [];
    for (let cur = 3; cur > 0; cur--) { const s = shopClockStep(cur); steps.push({ shows: s.next, expire: s.expire }); }
    expect(steps).toEqual([{ shows: 2, expire: false }, { shows: 1, expire: false }, { shows: 0, expire: true }]);
    expect(shopClockStep(0), 'a finished clock never re-locks').toEqual({ next: 0, expire: false });
  });

  it('LOBBY: the face reads 0:01 for a whole second; at 1 ms left actions still go through, at 0 they lock', () => {
    turnClock.set(1);
    // The step to 0 is scheduled one full period after the clock lands on 1 (less nothing: no hold carry).
    const untilLock = turnClock.startSecond(1000, 0);
    expect(untilLock).toBe(1000);
    // 999 ms in (1 ms left): the tick has not fired, the face reads 1, the engine has no expiry.
    expect(turnClock.get()).toBe(1);
    expect(allowed(false)).toBe(true);
    // The tick fires at 1000 ms (0 ms left): the step that shows 0 is the one that expires.
    const s = shopClockStep(turnClock.get());
    turnClock.set(s.next);
    expect(turnClock.get()).toBe(0);
    expect(s.expire).toBe(true);
    expect(locked(true)).toBe(true);
  });

  it('LOBBY: a hold at 0:01 resumes the remainder, so a pause never brings the lock forward', () => {
    turnClock.set(1);
    turnClock.startSecond(1000, 0);
    turnClock.hold(600); // the Esc menu opens with 400 ms left
    expect(turnClock.startSecond(1000, 50_000), 'resume: exactly the 400 ms left').toBeCloseTo(400);
  });

  it('VERSUS: walking a server deadline down, the face and the lock never disagree', () => {
    for (let ms = 2_000; ms >= -500; ms -= 1) {
      driveVersusClock({ key: 'm|shop|1', remainingMs: ms, moving: true, explode: true, announceWave: null, now: 0 });
      const rule = shopClockAt(ms);
      expect(turnClock.get(), `face at ${ms} ms`).toBe(rule.display);
      if (turnClock.get() >= 1) expect(rule.locked, `0:0${turnClock.get()} is never locked (${ms} ms)`).toBe(false);
      if (rule.locked) expect(turnClock.get()).toBe(0);
    }
    expect(shopClockAt(1).locked).toBe(false);
    expect(shopClockAt(0).locked).toBe(true);
  });

  it('VERSUS: the synced clock adds its own uncertainty, so the client 0:00 is at or after the server deadline', () => {
    // One sample with a 200 ms round trip, sent at local 0 and received at local 200. The server stamped its "now"
    // somewhere inside that trip; whatever the truth, a lock taken when (estimate + uncertainty) <= 0 is never early.
    const deadlineServer = 10_000;
    for (const stampedAt of [0, 50, 100, 150, 200]) { // local ms at which the server really read its clock
      const trueOffset = 5_000; // server = local + 5 s
      const c = new ServerClock();
      c.sample(0, 200, new Date(stampedAt + trueOffset).toISOString());
      expect(c.uncertaintyMs()).toBe(100);
      // The first local instant the client locks.
      let lockLocal = 0;
      for (let local = 0; local < 20_000; local++) {
        const estRemaining = deadlineServer - c.now(local) + c.uncertaintyMs();
        if (shopClockAt(estRemaining).locked) { lockLocal = local; break; }
      }
      const trueServerAtLock = lockLocal + trueOffset;
      expect(trueServerAtLock, `stamped at ${stampedAt}: the lock is at or after the true deadline`).toBeGreaterThanOrEqual(deadlineServer);
      // …and no later than a full round trip after it (well inside the server's 250 ms grace for this trip).
      expect(trueServerAtLock - deadlineServer).toBeLessThanOrEqual(200);
    }
  });

  it('VERSUS: after an early End Turn the clock keeps counting but its cues stay quiet', () => {
    driveVersusClock({ key: 'k', remainingMs: 6_000, moving: true, explode: true, announceWave: null, now: 0 });
    const cue = driveVersusClock({ key: 'k', remainingMs: 4_900, moving: true, explode: true, quiet: true, announceWave: null, now: 0 });
    expect(cue).toBeNull();
    expect(turnClock.get(), 'the face still reads the round clock').toBe(5);
    expect(turnClock.isRunning()).toBe(true);
    // Not quiet: the same step would have ticked.
    resetVersusClockFxForTests();
    driveVersusClock({ key: 'k', remainingMs: 6_000, moving: true, explode: true, announceWave: null, now: 0 });
    expect(driveVersusClock({ key: 'k', remainingMs: 4_900, moving: true, explode: true, announceWave: null, now: 0 })).toEqual({ kind: 'tick', n: 5 });
  });
});
