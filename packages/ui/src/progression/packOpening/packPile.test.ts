import { describe, expect, it } from 'vitest';
import { newPile, pileAtRest, pileEase, pileScale } from './packPile';

describe('the draw pile under the hand', () => {
  it('lifts and leans under a resting pointer, and comes fully back to rest when it leaves', () => {
    const s = newPile();
    expect(pileAtRest(s)).toBe(true);
    for (let i = 0; i < 60; i++) pileEase(s, true, false, 0.8, -0.5, 1);
    expect(s.lift).toBe(1);
    expect(s.lx).toBeCloseTo(0.8, 2);
    expect(s.ly).toBeCloseTo(-0.5, 2);
    expect(pileScale(s)).toBeGreaterThan(1);
    for (let i = 0; i < 120; i++) pileEase(s, false, false, 0.8, -0.5, 1);
    expect(pileAtRest(s)).toBe(true);
    expect(pileScale(s)).toBe(1);
  });

  it('a press sinks the card below its lifted size, faster than the lift builds', () => {
    const s = newPile();
    for (let i = 0; i < 60; i++) pileEase(s, true, false, 0, 0, 1);
    const lifted = pileScale(s);
    pileEase(s, true, true, 0, 0, 1);
    pileEase(s, true, true, 0, 0, 1);
    expect(s.press).toBeGreaterThan(0.6); // two frames in, most of the way down
    expect(pileScale(s)).toBeLessThan(lifted);
    for (let i = 0; i < 30; i++) pileEase(s, true, true, 0, 0, 1);
    expect(pileScale(s)).toBeLessThan(1);
  });

  it('clamps the pointer place, and a beat kicks then dies away', () => {
    const s = newPile();
    for (let i = 0; i < 80; i++) pileEase(s, true, false, 9, -9, 1);
    expect(s.lx).toBe(1);
    expect(s.ly).toBe(-1);
    s.beat = 1;
    const kicked = pileScale(s);
    for (let i = 0; i < 80; i++) pileEase(s, true, false, 9, -9, 1);
    expect(s.beat).toBe(0);
    expect(pileScale(s)).toBeLessThan(kicked);
  });

  it('is frame-rate tolerant: a long frame never overshoots', () => {
    const s = newPile();
    pileEase(s, true, true, 1, 1, 500);
    expect(s.lift).toBe(1);
    expect(s.press).toBe(1);
    expect(s.lx).toBe(1);
  });
});
