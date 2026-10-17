/**
 * R-VERSUS-TIMER-FX-01 (owner 2026-10-16: "the versus timer does not play sound effects at all and the glyph animation
 * doesnt play either, the 20s glyph"). A Versus clock, driven by its server deadline, plays the lobby's clock cues at
 * the lobby's seconds and runs the 20 s charge glyph's clock, and a pause (the 30 s disconnect pause and the 3-2-1 back)
 * freezes both without double-firing anything on the way back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const played: string[] = [];
const announced: number[] = [];
vi.mock('../sfx', () => ({
  sfx: {
    turnTick: (n: number) => played.push(`tick${n}`),
    warmTurnTick: () => played.push('warm'),
    turnExplode: () => played.push('explode'),
  },
}));
vi.mock('../announcer', () => ({ observeTurnClock: (s: number) => announced.push(s) }));

import { chargeElapsed, CHARGE_SECONDS, resetTurnClockForTests, turnClock } from '../turnClock';
import { cueForSecond, driveVersusClock, nextObserveMs, resetVersusClockFxForTests, versusClockCues } from './versusClockFx';

/** Step a server clock: one observation per `stepMs`, from `fromMs` remaining down to `toMs`. `t` is local ms. */
function run(o: { key: string; fromMs: number; toMs: number; stepMs?: number; moving?: boolean; explode?: boolean; t0?: number }): number {
  const step = o.stepMs ?? 250;
  let t = o.t0 ?? 0;
  for (let r = o.fromMs; r >= o.toMs; r -= step, t += step) {
    driveVersusClock({ key: o.key, remainingMs: r, moving: o.moving ?? true, explode: o.explode ?? true, announceWave: 3, now: t });
  }
  return t;
}

beforeEach(() => {
  played.length = 0;
  announced.length = 0;
  resetTurnClockForTests();
  resetVersusClockFxForTests();
});

describe('R-VERSUS-TIMER-FX-01: the Versus clock plays the lobby clock cues', () => {
  it('uses the lobby thresholds: warm 10..6, tick 5..1, explode at 0 (shop only)', () => {
    expect(cueForSecond(11, true)).toBeNull();
    for (let n = 10; n >= 6; n--) expect(cueForSecond(n, true)).toEqual({ kind: 'warm' });
    for (let n = 5; n >= 1; n--) expect(cueForSecond(n, true)).toEqual({ kind: 'tick', n });
    expect(cueForSecond(0, true)).toEqual({ kind: 'explode' });
    expect(cueForSecond(0, false), 'Hero Select has no shop to lock').toBeNull();
  });

  it('a shop deadline counting down fires each cue once, on its second', () => {
    run({ key: 'm|shop|3', fromMs: 22_000, toMs: 0 });
    expect(played).toEqual(['warm', 'warm', 'warm', 'warm', 'warm', 'tick5', 'tick4', 'tick3', 'tick2', 'tick1', 'explode']);
    // The announcer hears every whole-second step (its "Low on time" reads the 15 s one), never a repeat.
    expect(announced).toEqual(Array.from({ length: 22 }, (_, i) => 21 - i));
  });

  it('Hero Select plays the ticks but no explosion', () => {
    run({ key: 'm|hero', fromMs: 7_000, toMs: -250, explode: false });
    expect(played).toEqual(['warm', 'tick5', 'tick4', 'tick3', 'tick2', 'tick1']);
  });

  it('runs the 20 s glyph clock: running while it counts, the charge fill tracks the deadline', () => {
    driveVersusClock({ key: 'k', remainingMs: 25_000, moving: true, explode: true, announceWave: null, now: 0 });
    expect(turnClock.isRunning(), 'before this fix the clock always read HELD in Versus').toBe(true);
    expect(turnClock.get()).toBe(25);
    expect(chargeElapsed(CHARGE_SECONDS, 0)).toBe(0); // the glyph is not lit above 20 s
    driveVersusClock({ key: 'k', remainingMs: 12_500, moving: true, explode: true, announceWave: null, now: 1000 });
    expect(turnClock.get()).toBe(13);
    // 7.5 s of the 20 s window gone, read live between observations (the rAF interpolates off the anchor).
    expect(chargeElapsed(CHARGE_SECONDS, 1000)).toBeCloseTo(7.5);
    expect(chargeElapsed(CHARGE_SECONDS, 1250)).toBeCloseTo(7.75);
    driveVersusClock({ key: 'k', remainingMs: -40, moving: true, explode: true, announceWave: null, now: 2000 });
    expect(turnClock.get()).toBe(0);
    expect(turnClock.isRunning(), 'at 0:00 the clock is finished').toBe(false);
  });

  it('a pause freezes the clock and its cues, and the resume (deadline shifted by the pause) picks up with no repeat', () => {
    let t = run({ key: 'm|shop|3', fromMs: 9_000, toMs: 4_100 });
    expect(played).toEqual(['warm', 'warm', 'warm', 'tick5']); // 8, 7, 6 warm, then 5
    played.length = 0;
    // Disconnect: `paused_at` is set. Remaining is frozen at deadline - paused_at for the 30 s grace and the 3-2-1.
    const frozenAt = 4_100;
    for (let i = 0; i < 160; i++, t += 250) driveVersusClock({ key: 'm|shop|3', remainingMs: frozenAt, moving: false, explode: true, announceWave: 3, now: t });
    expect(played, 'nothing fires during a pause').toEqual([]);
    expect(turnClock.isRunning(), 'the glyph holds (and its build fades) through the pause').toBe(false);
    expect(turnClock.get()).toBe(5);
    const held = chargeElapsed(CHARGE_SECONDS, t);
    expect(chargeElapsed(CHARGE_SECONDS, t + 30_000), 'a pause moves nothing').toBeCloseTo(held);
    // Resume: the server shifted the deadline by the whole pause, so remaining continues from the frozen value.
    run({ key: 'm|shop|3', fromMs: frozenAt, toMs: -250, t0: t });
    expect(played, 'tick5 is not replayed on the resume').toEqual(['tick4', 'tick3', 'tick2', 'tick1', 'explode']);
    expect(turnClock.isRunning()).toBe(false);
  });

  it('a reconnect, remount or seat switch onto a running clock fires nothing for the second it lands on', () => {
    run({ key: 'm|shop|3', fromMs: 4_500, toMs: 3_600 }); // first sight at 5: silent, then 4
    expect(played).toEqual(['tick4']);
    // A second observer of the same clock (the screen remounting) does not replay it.
    driveVersusClock({ key: 'm|shop|3', remainingMs: 3_500, moving: true, explode: true, announceWave: 3, now: 0 });
    expect(played).toEqual(['tick4']);
    // A NEW clock (the next round) seen first mid-countdown is silent too.
    driveVersusClock({ key: 'm|shop|4', remainingMs: 2_500, moving: true, explode: true, announceWave: 4, now: 0 });
    expect(played).toEqual(['tick4']);
  });

  it('a long jump (a tab waking up) or a clock pushed back up plays nothing', () => {
    expect(versusClockCues({ key: 'k', second: 9 }, 'k', 3, true, true).cue).toBeNull();
    expect(versusClockCues({ key: 'k', second: 3 }, 'k', 5, true, true).cue).toBeNull();
    expect(versusClockCues({ key: 'k', second: 4 }, 'k', 2, true, true).cue, 'one missed poll still ticks').toEqual({ kind: 'tick', n: 2 });
  });

  it('observes just past each whole-second edge, at most 250 ms apart', () => {
    expect(nextObserveMs(5_100)).toBe(105);
    expect(nextObserveMs(5_900)).toBe(250);
    expect(nextObserveMs(5_000)).toBe(250);
    expect(nextObserveMs(0)).toBe(250);
  });
});
