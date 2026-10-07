/**
 * R-TIMER-SYNC-01: THE END-OF-TURN CHARGE (glyph fill, motes, pulse AND the charge-build sound) STOPS WHENEVER THE
 * SHOP CLOCK STOPS, AND RESUMES EXACTLY WHERE THE CLOCK IS (owner 2026-10-07: "when the game is paused mid round
 * after the countdown timer has started, the audio and the pixi visiaul of the timer rune building doesnt stop as
 * well ... we just need to make sure it stops when the game is stopped in any way").
 *
 * The bug: the 21 s `turncharge` clip was fired once when the glyph lit and then ran on its own clock, and the glyph
 * paused off a private copy of the clock's gate that had drifted (no Ancients offer, intro, wipe or Gold Fuse wait),
 * while its motes never paused at all. The fix makes the clock publish whether it is moving and where it is inside
 * its second; everything else reads that. Pins: the clock's hold / resume semantics, the one elapsed-time function
 * both the fill and the sound use, and the wiring (no private pause list; the countdown holds on teardown).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargeElapsed, resetTurnClockForTests, turnClock } from './turnClock';

const WINDOW = 20;

describe('R-TIMER-SYNC-01: the shop clock publishes running / held, and a hold keeps the partial second', () => {
  beforeEach(() => resetTurnClockForTests());
  afterEach(() => resetTurnClockForTests());

  it('a hold freezes the second where it stopped, and the resume waits only for the rest of it', () => {
    turnClock.set(12);
    expect(turnClock.startSecond(1000, 0)).toBe(1000);
    expect(turnClock.isRunning()).toBe(true);
    expect(turnClock.secondProgress(400)).toBeCloseTo(0.4);

    turnClock.hold(400);
    expect(turnClock.isRunning(), 'held: not running').toBe(false);
    // However long the hold lasts, the clock reads the same.
    expect(turnClock.secondProgress(400)).toBeCloseTo(0.4);
    expect(turnClock.secondProgress(60_000)).toBeCloseTo(0.4);

    // Resume 10 s later: only the remaining 600 ms of the second are left, and progress continues from 0.4.
    expect(turnClock.startSecond(1000, 10_400)).toBeCloseTo(600);
    expect(turnClock.secondProgress(10_400)).toBeCloseTo(0.4);
    expect(turnClock.secondProgress(10_700)).toBeCloseTo(0.7);
  });

  it('a value written from outside the tick (a new turn, a resume) starts its second fresh', () => {
    turnClock.set(12);
    turnClock.startSecond(1000, 0);
    turnClock.hold(500);
    turnClock.set(21); // new turn
    expect(turnClock.startSecond(1000, 9000)).toBe(1000);
    expect(turnClock.secondProgress(9000)).toBe(0);
  });

  it('halt at 0 stops the clock with nothing to resume', () => {
    turnClock.set(1);
    turnClock.startSecond(1000, 0);
    turnClock.set(0);
    turnClock.halt();
    expect(turnClock.isRunning()).toBe(false);
    expect(turnClock.secondProgress(5000)).toBe(0);
  });

  it('subscribers hear the running flag flip (the glyph re-renders on a hold and a resume)', () => {
    let calls = 0;
    const off = turnClock.subscribe(() => { calls += 1; });
    turnClock.set(10);
    const afterSet = calls;
    turnClock.startSecond(1000, 0);
    expect(calls).toBe(afterSet + 1);
    turnClock.startSecond(1000, 1000); // already running: no extra emit
    expect(calls).toBe(afterSet + 1);
    turnClock.hold(1200);
    expect(calls).toBe(afterSet + 2);
    off();
  });
});

describe('R-TIMER-SYNC-01: the fill and the sound share one elapsed-time reading of the clock', () => {
  beforeEach(() => resetTurnClockForTests());
  afterEach(() => resetTurnClockForTests());

  it('is 0 as the window opens, the window at 0:00, and moves with the sub-second while running', () => {
    turnClock.set(20);
    turnClock.startSecond(1000, 0);
    expect(chargeElapsed(WINDOW, 0)).toBeCloseTo(0);
    expect(chargeElapsed(WINDOW, 250)).toBeCloseTo(0.25);
    turnClock.set(8);
    turnClock.startSecond(1000, 1000);
    expect(chargeElapsed(WINDOW, 1500)).toBeCloseTo(12.5);
    turnClock.set(0);
    turnClock.halt();
    expect(chargeElapsed(WINDOW, 99_999)).toBe(WINDOW);
  });

  it('does not advance while held, and resumes from the same reading (the sound restarts at the frozen spot)', () => {
    turnClock.set(8);
    turnClock.startSecond(1000, 0);
    turnClock.hold(300);
    const frozen = chargeElapsed(WINDOW, 300);
    expect(frozen).toBeCloseTo(12.3);
    expect(chargeElapsed(WINDOW, 30_000), 'a 30 s pause moves nothing').toBeCloseTo(frozen);
    turnClock.startSecond(1000, 30_000);
    expect(chargeElapsed(WINDOW, 30_000), 'resume picks up exactly').toBeCloseTo(frozen);
    expect(chargeElapsed(WINDOW, 30_200)).toBeCloseTo(12.5);
  });

  it('a light mid-window (Save & Continue, a covering screen closing) reads the time already gone, not 0', () => {
    turnClock.set(5);
    turnClock.startSecond(1000, 0);
    expect(chargeElapsed(WINDOW, 0)).toBeCloseTo(15);
  });
});

describe('R-TIMER-SYNC-01: wiring', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const recruit = readFileSync(join(here, 'Recruit.tsx'), 'utf8');
  const glyph = recruit.slice(recruit.indexOf('const ChargeGlyph = memo('), recruit.indexOf('/** Cards that reference another card'));

  it('the glyph has no pause list of its own: it follows the clock', () => {
    expect(glyph).toContain('useTurnClockRunning()');
    expect(glyph, 'no private paused prop').not.toMatch(/\bpaused\b\s*[:,}]/);
    expect(recruit, 'the call site passes no paused prop').not.toMatch(/<ChargeGlyph[^>]*paused=/s);
  });

  it('the sound starts at the clock-matched offset and stops on a hold', () => {
    expect(glyph).toContain('sfx.turnCharge(chargeElapsed(chargeWindow, performance.now()))');
    expect(glyph).toMatch(/if \(held\) stopTurnCharge\(CHARGE_HOLD_FADE_MS\)/);
  });

  it('the motes and the pulse freeze while held', () => {
    expect(glyph).toMatch(/if \(!heldRef\.current\) engine\.frame\(/);
    expect(glyph).toContain("${held ? ' held' : ''}");
    const css = readFileSync(join(here, 'styles.css'), 'utf8');
    expect(css).toMatch(/\.chargeglyph\.held \.charge-fill \{ animation-play-state: paused; \}/);
  });

  it('the countdown holds the clock whenever its effect tears down, for any reason', () => {
    expect(recruit).toContain('return () => { window.clearTimeout(id); turnClock.hold(performance.now()); };');
    expect(recruit).toContain('id = window.setTimeout(tick, turnClock.startSecond(tickMs(), performance.now()));');
  });

  it('every input of the countdown gate is also a dependency, so each one holds and resumes it (the scouting reveal was missing)', () => {
    const at = recruit.indexOf('if (!turnClockMayTick({');
    const deps = recruit.slice(recruit.indexOf('}, [run.phase,', at), recruit.indexOf(']);', recruit.indexOf('}, [run.phase,', at)));
    for (const dep of ['run.discover', 'run.questOffer', 'run.powerOffer', 'run.runeforgeOffer', 'run.pendingTarget', 'run.chooseOne',
      'run.scoutedNextOpponent', 'run.ancients?.offer', 'heroSelecting', 'overlayOpen', 'settingsOpen', 'introPlaying', 'wipe', 'goldClockWaits']) {
      expect(deps, dep).toContain(dep);
    }
  });
});
