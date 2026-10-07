/**
 * THE FINAL COUNTDOWN TICK (owner ask 2026-10-07: "a big clock tick sound happens on each second, essentially
 * signaling FIVE, FOUR, THREE, TWO, ONE (end turn)"; owner picks: the ticks BUILD in intensity, and the existing
 * explosion still owns 0:00).
 *
 * Pins the build (every tick louder and higher than the last, FIVE quietest, ONE loudest) and the wiring (the shop
 * clock's own tick fires it at 5..1 only, never on an infinite clock, so a held clock holds the count with it).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TURN_TICK_BUILD, turnTickLevel } from './sfx';
import { CATEGORY_BUS, CATEGORY_GAINS } from './audio/config';

describe('the final countdown builds from FIVE to ONE', () => {
  it('FIVE starts at the bottom of the build and ONE lands on the top', () => {
    expect(turnTickLevel(5)).toEqual({ vol: TURN_TICK_BUILD.volFrom, rate: TURN_TICK_BUILD.rateFrom });
    expect(turnTickLevel(1).vol).toBeCloseTo(TURN_TICK_BUILD.volTo);
    expect(turnTickLevel(1).rate).toBeCloseTo(TURN_TICK_BUILD.rateTo);
  });

  it('every tick is louder and higher than the one before it', () => {
    for (let n = 5; n > 1; n--) {
      expect(turnTickLevel(n - 1).vol, `${n - 1} louder than ${n}`).toBeGreaterThan(turnTickLevel(n).vol);
      expect(turnTickLevel(n - 1).rate, `${n - 1} higher than ${n}`).toBeGreaterThan(turnTickLevel(n).rate);
    }
  });

  it('has its own desk fader', () => {
    expect(CATEGORY_GAINS.turntick).toBeGreaterThan(0);
    expect(CATEGORY_BUS.turntick).toBe('ui');
  });
});

describe('the shop clock fires the count', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Recruit.tsx'), 'utf8');
  const tick = src.slice(src.indexOf('const tick = (): void => {'), src.indexOf('id = window.setTimeout(tick, turnClock.startSecond('));

  it('ticks on 5..1 from inside the countdown tick, on a real clock only, and leaves 0 to the explosion', () => {
    expect(tick).toContain('if (next >= 1 && next <= 5) sfx.turnTick(next);');
    expect(tick.indexOf('sfx.turnTick(next)'), 'inside the real-clock guard').toBeGreaterThan(tick.indexOf('if (!infiniteClockRef.current) {'));
    expect(tick).toContain('sfx.turnExplode();');
  });
});
