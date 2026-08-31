import { describe, expect, it } from 'vitest';
import { turnClockReset } from './turnClock';

/**
 * BUG 9fceed6b — "timer from saving and quitting is not correct, it is restarting the timer from the
 * beginning of the round" (player report, 2026-08-31).
 *
 * Reproduced live before the fix: quit a recruit turn at 0:08, press Continue, and the clock read 0:20. The
 * save side was never wrong — `turnRemaining: 8` was in localStorage — so the loss happened on the way back
 * in, when the reset effect ran a SECOND time, found the one-shot already consumed, and opened the turn at
 * full time.
 */
describe('the turn clock on (re)opening a turn', () => {
  const wave = 4;
  const turnSeconds = 20;

  it('applies a resume and marks it consumed', () => {
    expect(turnClockReset({ resume: 8, resumedWave: null, wave, turnSeconds }))
      .toEqual({ set: 8, consumeResume: true });
  });

  it('THE BUG: a second pass on the resumed wave must not re-open the turn at full time', () => {
    // The first pass consumed the resume, so this one sees `resume: null` — exactly the state that used to
    // fall through to `turnClock.set(turnSeconds)` and hand back a full 0:20.
    expect(turnClockReset({ resume: null, resumedWave: wave, wave, turnSeconds }), 'leave the clock alone')
      .toBeNull();
  });

  it('opens a FRESH turn at full time', () => {
    expect(turnClockReset({ resume: null, resumedWave: null, wave, turnSeconds }))
      .toEqual({ set: turnSeconds, consumeResume: false });
  });

  it('the guard is scoped to the resumed wave — the NEXT turn opens fully', () => {
    // Scoping matters: a guard remembered per RUN would leave every later turn stuck on the resumed clock.
    expect(turnClockReset({ resume: null, resumedWave: wave, wave: wave + 1, turnSeconds }))
      .toEqual({ set: turnSeconds, consumeResume: false });
  });

  it('a resume always wins, even on a wave already restored (a second Save & Quit in the same turn)', () => {
    expect(turnClockReset({ resume: 3, resumedWave: wave, wave, turnSeconds }))
      .toEqual({ set: 3, consumeResume: true });
  });

  it('resume 0 is a real value, not "absent" — a turn quit with the clock expired stays expired', () => {
    // The falsy trap: `resume ? … : …` would hand a full turn back to someone who quit at 0:00.
    expect(turnClockReset({ resume: 0, resumedWave: null, wave, turnSeconds }))
      .toEqual({ set: 0, consumeResume: true });
  });
});
