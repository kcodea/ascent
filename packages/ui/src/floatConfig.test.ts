import { describe, expect, it } from 'vitest';
import { floatDurations, getFloatConfig } from './floatConfig';
import { getChoreoConfig } from './choreo/choreoConfig';

// The float's React cleanup timers divide by combatSpeed (`floatMs` / `deathFloatMs` in useCombatReplay), but
// the CSS animation durations used to be FIXED. Since `floatup` holds opacity 1 until 80%, any speed above
// ~1.07x removed the number from the DOM while it was still fully bright — it popped out instead of fading.
// These lock the invariant: the animation must always finish before the cleanup fires.
describe('float durations scale with combatSpeed', () => {
  const speeds = [0.5, 1, 1.6, 2, 3, 5]; // the store clamps combatSpeed to 0.5–5

  it('the fade always completes before the cleanup timer removes the node', () => {
    const { floatMs, deathFloatMs } = getChoreoConfig();
    for (const sp of speeds) {
      const { floatDur, deathFloatDur } = floatDurations(sp);
      expect(floatDur, `float @${sp}x`).toBeLessThanOrEqual(floatMs / sp);
      expect(deathFloatDur, `deathFloat @${sp}x`).toBeLessThanOrEqual(deathFloatMs / sp);
    }
  });

  it('is a no-op at 1x (matches the shipped CSS fallbacks)', () => {
    expect(floatDurations(1)).toEqual({ floatDur: getFloatConfig().durMs, deathFloatDur: 900 });
  });

  it('halves at 2x and guards a non-positive speed', () => {
    expect(floatDurations(2).floatDur).toBe(Math.round(getFloatConfig().durMs / 2));
    expect(floatDurations(0)).toEqual(floatDurations(1));
  });
});
