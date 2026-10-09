/**
 * ACTIVE PLAY TIME (owner bug 2026-10-09, R-MATCH-LENGTH-01): "it should not count time outside of the game, it
 * should only count time while a player is actually in a game." A Recent Games row read "246 min" for a 16-round
 * game because the length was the recording's wall-clock span. Pins:
 *  - hidden / away / off-screen time is never counted;
 *  - no single step counts for more than the gap cap (sleep, suspend, a frozen tab);
 *  - a resume continues from the saved total and never counts the time the app was closed;
 *  - an old record (no active time) shows its span only when plausible for the rounds played, else "—";
 *  - the clock is presentation-only: it never touches run state, so simulation determinism is unaffected.
 */
import { describe, expect, it } from 'vitest';
import { createLobbyRun, reduce, serialize, DEFAULT_BOT, type RunState } from '@game/sim';
import { ACTIVE_GAP_CAP_MS, ACTIVE_HEARTBEAT_MS, LEGACY_MAX_MS_PER_ROUND, createActivePlayClock, matchLengthMs } from './activePlayClock';

const MIN = 60_000;

describe('createActivePlayClock — counts only time in the game', () => {
  it('counts live time and skips hidden / away time', () => {
    const c = createActivePlayClock();
    c.reset(0, true);
    c.tick(10_000, true);                // 10 s live
    c.tick(20_000, false);               // 10 s live, then the tab hides
    c.tick(3 * 60 * MIN, false);         // three hours hidden: nothing
    c.tick(3 * 60 * MIN + 1, true);      // back
    c.tick(3 * 60 * MIN + 5_001, true);  // 5 s live
    expect(c.read(3 * 60 * MIN + 5_001)).toBe(25_000);
  });

  it('a new run starts paused until it is on screen, at zero', () => {
    const c = createActivePlayClock();
    c.reset(0, false);
    c.tick(30_000, true); // the run appears at 30 s: the picker time before it never counts
    expect(c.read(40_000)).toBe(10_000);
  });

  it('caps a single step: a machine asleep for an hour with the game open adds at most the cap', () => {
    const c = createActivePlayClock();
    c.reset(0, true);
    c.tick(60 * MIN, true); // no heartbeat for an hour = the process was suspended
    expect(c.read(60 * MIN)).toBe(ACTIVE_GAP_CAP_MS);
    expect(ACTIVE_HEARTBEAT_MS * 2, 'a live heartbeat gap must never be clipped').toBeLessThanOrEqual(ACTIVE_GAP_CAP_MS);
  });

  it('read() is capped too, and never mutates', () => {
    const c = createActivePlayClock();
    c.reset(0, true);
    expect(c.read(10 * MIN)).toBe(ACTIVE_GAP_CAP_MS);
    expect(c.read(5_000)).toBe(5_000);
  });

  it('a resume continues from the saved total and never counts the time the app was closed', () => {
    const c = createActivePlayClock();
    c.restore(12 * MIN);              // the save said 12 minutes
    expect(c.read(999 * MIN)).toBe(12 * MIN); // paused until sampled: the closed hours are never observed
    c.tick(999 * MIN, true);          // Continue pressed, the run is on screen
    c.tick(999 * MIN + 30_000, true);
    expect(c.read(999 * MIN + 30_000)).toBe(12 * MIN + 30_000);
  });

  it('a save from before the clock is UNKNOWN (null), never a misleading partial number', () => {
    const c = createActivePlayClock();
    c.restore(undefined);
    c.tick(0, true);
    c.tick(30_000, true);
    expect(c.read(30_000)).toBeNull();
    expect(c.freeze(30_000)).toBeNull();
    c.restore(-5);
    expect(c.read(0)).toBeNull();
  });

  it('freeze() closes the run: the end screen adds nothing afterwards, and a reset starts the next run at zero', () => {
    const c = createActivePlayClock();
    c.reset(0, true);
    expect(c.freeze(20_000)).toBe(20_000);
    c.tick(50_000, true);
    expect(c.read(55_000)).toBe(20_000);
    c.reset(60_000, true);
    expect(c.read(61_000)).toBe(1_000);
  });
});

describe('matchLengthMs — what every "Length" prints', () => {
  it('the recorded active time wins', () => {
    expect(matchLengthMs({ activeMs: 31 * MIN, spanMs: 246 * MIN, rounds: 16 })).toBe(31 * MIN);
    expect(matchLengthMs({ activeMs: 0, spanMs: 5 * MIN, rounds: 3 })).toBe(0);
  });
  it('a legacy record shows its span only while plausible for the rounds played', () => {
    expect(matchLengthMs({ spanMs: 31 * MIN, rounds: 16 })).toBe(31 * MIN);
    expect(matchLengthMs({ spanMs: 246 * MIN, rounds: 16 }), "the owner's 246-minute 16-round game").toBeNull();
    expect(matchLengthMs({ spanMs: 16 * LEGACY_MAX_MS_PER_ROUND, rounds: 16 })).toBe(16 * LEGACY_MAX_MS_PER_ROUND);
    expect(matchLengthMs({ spanMs: 16 * LEGACY_MAX_MS_PER_ROUND + 1, rounds: 16 })).toBeNull();
  });
  it('nothing usable → null ("—")', () => {
    expect(matchLengthMs({ spanMs: 10 * MIN, rounds: null })).toBeNull();
    expect(matchLengthMs({ spanMs: null, rounds: 9 })).toBeNull();
    expect(matchLengthMs({ activeMs: Number.NaN, spanMs: -1, rounds: 9 })).toBeNull();
    expect(matchLengthMs({})).toBeNull();
  });
});

describe('determinism is unaffected', () => {
  it('the clock lives outside run state: the same seed + actions serialize identically, with no wall-clock field', () => {
    const play = (): RunState => {
      let run: RunState = { ...createLobbyRun(4242, 'brackus'), phase: 'recruit' };
      for (let i = 0; i < 30 && run.phase === 'recruit'; i++) {
        const next = reduce(run, DEFAULT_BOT.act(run));
        if (next === run) break;
        run = next;
      }
      return run;
    };
    const c = createActivePlayClock();
    c.reset(0, true);
    const a = serialize(play());
    c.tick(45_000, true); // the clock moving between the two plays changes nothing
    const b = serialize(play());
    expect(a).toBe(b);
    expect(a).not.toContain('activeMs');
  });
});
