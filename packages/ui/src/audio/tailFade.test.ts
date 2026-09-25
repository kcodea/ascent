import { describe, expect, it } from 'vitest';
import { scheduleSkipFade, scheduleTailFade, SKIP_FADE_S, type ParamLike } from './tailFade';
import { GLI_DEFAULTS, GLI_RANGES, goodLuckTail } from '../goodLuck/goodLuckIntroConfig';

/** Records every automation call, in order, as [method, value, time]. */
function recorder(value = 1): ParamLike & { calls: [string, number, number][] } {
  const calls: [string, number, number][] = [];
  return {
    value,
    calls,
    setValueAtTime: (v, t) => calls.push(['set', v, t]),
    linearRampToValueAtTime: (v, t) => calls.push(['linear', v, t]),
    exponentialRampToValueAtTime: (v, t) => calls.push(['exp', v, t]),
    cancelScheduledValues: (t) => calls.push(['cancel', 0, t]),
  };
}

/**
 * THE GOOD LUCK SOUNDS' SOFT TAIL (owner 2026-09-24: "the good luck sfx ends abruptly"). The sparkle is a window
 * cut out of a longer clip that ends while the sparkle is still loud; the fix fades each clip over its last few
 * hundred ms and lets a skip fade quickly instead of cutting. These pin the gain automation both paths schedule.
 */
describe('the natural-end fade', () => {
  it('holds full level, then ramps to silence landing exactly on the clip end', () => {
    const p = recorder();
    const end = scheduleTailFade(p, 2, 0.9, 0.35); // the spark: 0.9 s window queued at t = 2
    expect(end).toBeCloseTo(2.9);
    expect(p.calls[0]).toEqual(['set', 1, expect.closeTo(2.55, 6)]);
    expect(p.calls[1][0]).toBe('exp');
    expect(p.calls[1][1]).toBeLessThanOrEqual(0.001);
    expect(p.calls[1][2]).toBeCloseTo(2.9);
    expect(p.calls[2]).toEqual(['set', 0, expect.closeTo(2.9, 6)]);
  });

  it('clamps a fade longer than the clip to the whole clip', () => {
    const p = recorder();
    scheduleTailFade(p, 0, 0.2, 0.5);
    expect(p.calls[0]).toEqual(['set', 1, 0]);
  });

  it('a 0 ms fade schedules nothing (the clip keeps its own end)', () => {
    const p = recorder();
    expect(scheduleTailFade(p, 1, 1.75, 0)).toBeCloseTo(2.75);
    expect(p.calls).toEqual([]);
  });
});

describe('the skip fade', () => {
  it('drops the scheduled tail, holds the current level and ramps to 0 over ~120 ms', () => {
    const p = recorder(0.6);
    const land = scheduleSkipFade(p, 5);
    expect(SKIP_FADE_S).toBeCloseTo(0.12);
    expect(land).toBeCloseTo(5 + SKIP_FADE_S);
    expect(p.calls).toEqual([
      ['cancel', 0, 5],
      ['set', 0.6, 5],
      ['linear', 0, expect.closeTo(5 + SKIP_FADE_S, 6)],
    ]);
  });
});

describe('the Good Luck tail dials', () => {
  it('ship a short fade on each sound and a subtle reverb, inside the tuner ranges', () => {
    expect(GLI_DEFAULTS.shineFadeOutMs).toBeGreaterThanOrEqual(250);
    expect(GLI_DEFAULTS.shineFadeOutMs).toBeLessThanOrEqual(400);
    expect(GLI_DEFAULTS.sparkFadeOutMs).toBeGreaterThanOrEqual(250);
    expect(GLI_DEFAULTS.sparkFadeOutMs).toBeLessThanOrEqual(400);
    expect(GLI_DEFAULTS.reverbMix).toBeGreaterThanOrEqual(0.15);
    expect(GLI_DEFAULTS.reverbMix).toBeLessThanOrEqual(0.25);
    for (const k of ['shineFadeOutMs', 'sparkFadeOutMs', 'reverbMix', 'reverbSec'] as const) {
      const [min, max] = GLI_RANGES[k];
      expect(GLI_DEFAULTS[k]).toBeGreaterThanOrEqual(min);
      expect(GLI_DEFAULTS[k]).toBeLessThanOrEqual(max);
    }
  });

  it('each sound gets its own fade and the shared reverb', () => {
    expect(goodLuckTail(GLI_DEFAULTS, 'shine')).toEqual({ fadeOutMs: GLI_DEFAULTS.shineFadeOutMs, reverbMix: GLI_DEFAULTS.reverbMix, reverbSec: GLI_DEFAULTS.reverbSec });
    expect(goodLuckTail(GLI_DEFAULTS, 'spark').fadeOutMs).toBe(GLI_DEFAULTS.sparkFadeOutMs);
  });
});
