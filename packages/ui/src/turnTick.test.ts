/**
 * THE FINAL COUNTDOWN TICK (owner ask 2026-10-07: "a big clock tick sound happens on each second, essentially
 * signaling FIVE, FOUR, THREE, TWO, ONE (end turn)"; owner picks: the ticks BUILD in intensity, and the existing
 * explosion still owns 0:00).
 *
 * Pins the build (every tick louder and higher than the last, FIVE quietest, ONE loudest) and the wiring (the shop
 * clock's own tick fires it at 5..1 only, never on an infinite clock, so a held clock holds the count with it).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TURN_TICK_BUILD, turnTickClip, turnTickLevel } from './sfx';
import { familyOf } from './audio/clipFamily';
import { CATEGORY_BUS, CATEGORY_GAINS } from './audio/config';

describe('the final countdown builds from FIVE to ONE', () => {
  it('FIVE starts at the bottom of the build and ONE lands on the top', () => {
    expect(turnTickLevel(5)).toEqual({ vol: TURN_TICK_BUILD.volFrom, rate: TURN_TICK_BUILD.rateFrom });
    expect(turnTickLevel(1).vol).toBeCloseTo(TURN_TICK_BUILD.volTo);
    expect(turnTickLevel(1).rate).toBeCloseTo(TURN_TICK_BUILD.rateTo);
  });

  it('every tick is louder than the one before it, and never drops in pitch', () => {
    for (let n = 5; n > 1; n--) {
      expect(turnTickLevel(n - 1).vol, `${n - 1} louder than ${n}`).toBeGreaterThan(turnTickLevel(n).vol);
      expect(turnTickLevel(n - 1).rate, `${n - 1} not lower than ${n}`).toBeGreaterThanOrEqual(turnTickLevel(n).rate);
    }
  });

  it('each second plays its own recorded tick, and every one of them is committed', () => {
    const audioDir = join(dirname(fileURLToPath(import.meta.url)), 'audio');
    for (let n = 5; n >= 1; n--) {
      expect(turnTickClip(n)).toBe(`turntick-${n}`);
      expect(existsSync(join(audioDir, `turntick-${n}.wav`)), `turntick-${n}.wav`).toBe(true);
      expect(familyOf(`turntick-${n}`), 'on the turntick fader').toBe('turntick');
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

  it('the owner-authored burst plays from the timer digits on each of the same five seconds, building like the tick', () => {
    const timer = src.slice(src.indexOf('const ShopTimer = memo('), src.indexOf('const ChargeGlyph = memo('));
    expect(timer).toContain('if (s < 1 || s > 5 || unlimited || goldWaiting) return;');
    expect(timer).toContain("playDef('final-countdown-tick', { source: p, target: p, cursor: p }, { intensity: turnTickLevel(s).vol });");
    expect(timer).toContain('}, [s, unlimited, goldWaiting]);');
    expect(timer, 'the CSS flash it replaced is gone').not.toContain('sc-tickflash');
    const def = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fx/defs/final-countdown-tick.json'), 'utf8'));
    expect(def.id).toBe('final-countdown-tick');
    expect(def.layers.some((l: { primitive: string }) => l.primitive === 'sound'), 'the tick sound comes from code, never doubled by the def').toBe(false);
  });
});
