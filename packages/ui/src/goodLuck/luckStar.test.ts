import { describe, expect, it } from 'vitest';
import { divePath, luckPath, luckSpan, passAt, writeEnd, type LuckScene } from './luckStar';

/** THE LUCKY STAR's path (R-GOODLUCK-STAR-01): off the hero, past every letter as it lights, under them, and into the crystal. */
const times = { write: 0.46, burst: 1.32, gather: 1.88, dive: 2.2, land: 2.56 };
const letters = Array.from({ length: 8 }, (_, i) => ({ x: 600 + i * 100, y: 500 }));
const s: LuckScene = { from: { x: 175, y: 840 }, to: { x: 1700, y: 470 }, letters, burst: { x: 950, y: 590 }, times, grown: 1.03, glyphs: new Float32Array(0) };
const H = 1080;

describe('the lucky star', () => {
  it('leaves from the hero and ends in the middle of the line under the words', () => {
    expect(luckPath(s, 0, H)).toEqual(s.from);
    const end = luckPath(s, times.burst, H);
    expect(Math.hypot(end.x - 950, end.y - 590)).toBeLessThan(1);
  });
  it('is at each letter at the moment that letter lights', () => {
    letters.forEach((l) => {
      const p = luckPath(s, passAt(s, l.x), H);
      expect(Math.abs(p.x - l.x)).toBeLessThan(2);
      expect(Math.abs(p.y - l.y)).toBeLessThan(30);
    });
    expect(passAt(s, 1300)).toBeLessThan(writeEnd(times));
  });
  it('never jumps (no step over a tenth of the screen in a 240 Hz frame)', () => {
    for (let t = 0; t < times.burst; t += 1 / 240) {
      const a = luckPath(s, t, H);
      const b = luckPath(s, Math.min(times.burst, t + 1 / 240), H);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(H / 10);
    }
  });
  it('dives off the end of the words into the crystal', () => {
    expect(divePath(s, 0, H)).toEqual(luckSpan(s).end);
    const end = divePath(s, 1, H);
    expect(Math.hypot(end.x - s.to.x, end.y - s.to.y)).toBeLessThan(1);
  });
});
