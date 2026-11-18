import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetShopActionPressure } from './actionPressure';
import { STAT_ROLL } from './rapidConfig';
import { heldFor, holdStat, releaseAllStats, subscribeStatHolds } from './statHold';

/**
 * THE SHARED STAT ROLL STEPS AT MOST 60 TIMES A SECOND (R-PERF-APM-02).
 *
 * Every step that moves a printed number re-renders that badge, restarts its pop and re-draws the card under it. The
 * loop ran once per display frame, so on a 240 Hz display a roll made four times the updates a 60 Hz display makes
 * for the same picture. These tests drive the real loop with a hand-cranked `requestAnimationFrame`.
 */
let frames: ((t: number) => void)[] = [];
let clock = 0;
const STEP = STAT_ROLL.stepMs;

/** Run display frames `frameMs` apart until `untilMs`, returning how many frames ran. */
function runFrames(frameMs: number, untilMs: number): number {
  let n = 0;
  while (clock + frameMs <= untilMs + 1e-6) {
    clock += frameMs;
    const due = frames; frames = [];
    for (const f of due) f(clock);
    n++;
  }
  return n;
}

beforeEach(() => {
  frames = []; clock = 1000;
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => { releaseAllStats(); resetShopActionPressure(); STAT_ROLL.stepMs = STEP; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the shared stat roll steps at most 60 times a second (R-PERF-APM-02)', () => {
  it('on a 240 Hz display a 420 ms roll notifies about a quarter as often as it has frames', () => {
    let notified = 0;
    const off = subscribeStatHolds(() => { notified++; });
    holdStat('a', { attack: 3000, health: 3000 }, { origin: 'cue', rollMs: 420 });
    notified = 0; // the placement itself
    const n = runFrames(1000 / 240, 1000 + 420);
    off();
    expect(n).toBeGreaterThanOrEqual(100);
    expect(notified).toBeLessThanOrEqual(28);  // 420 ms at 60 a second is 25 or 26, plus the last step
    expect(notified).toBeGreaterThanOrEqual(22);
  });

  it('on a 60 Hz display every frame still steps: nothing changes there', () => {
    let notified = 0;
    const off = subscribeStatHolds(() => { notified++; });
    holdStat('a', { attack: 3000, health: 3000 }, { origin: 'cue', rollMs: 420 });
    notified = 0;
    const n = runFrames(1000 / 60, 1000 + 400);
    off();
    expect(notified).toBe(n);
  });

  it('the final number is never late: the first frame at or past the end of the roll prints it', () => {
    holdStat('a', { attack: 50, health: 0 }, { origin: 'cue', rollMs: 100 });
    // 240 Hz frames up to just before the end: still rolling.
    runFrames(1000 / 240, 1000 + 99);
    expect(heldFor('a')).not.toBeNull();
    // The very next frame is past the end. It is under 16.7 ms since the last step, and it still delivers.
    runFrames(1000 / 240, clock + 1000 / 240);
    expect(heldFor('a')).toBeNull();
  });

  it('a scheduled hold (a later wave) is delivered on time too', () => {
    holdStat('a', { attack: 8, health: 8 }, { origin: 'cue', startAt: 300, rollMs: 120 });
    runFrames(1000 / 240, 1000 + 290);
    expect(heldFor('a')).toEqual({ attack: 8, health: 8 }); // its wave has not landed
    runFrames(1000 / 240, 1000 + 300 + 120 + 5);
    expect(heldFor('a')).toBeNull();
  });

  it('the loop stops when nothing is held', () => {
    holdStat('a', { attack: 1, health: 0 }, { origin: 'intrinsic', rollMs: 50 });
    runFrames(1000 / 240, 1000 + 80);
    expect(heldFor('a')).toBeNull();
    expect(frames.length).toBe(0);
  });

  it('the dial can put it back to every frame (a bench A/B)', () => {
    STAT_ROLL.stepMs = 0;
    let notified = 0;
    const off = subscribeStatHolds(() => { notified++; });
    holdStat('a', { attack: 3000, health: 3000 }, { origin: 'cue', rollMs: 420 });
    notified = 0;
    const n = runFrames(1000 / 240, 1000 + 400);
    off();
    expect(notified).toBe(n);
  });
});
