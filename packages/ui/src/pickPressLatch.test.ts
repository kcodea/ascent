import { describe, expect, it } from 'vitest';
import { createPickPressLatch, PICK_PRESS_WINDOW_MS } from './pickPressLatch';

const clock = (): { now: () => number; advance: (ms: number) => void } => {
  let t = 1000;
  return { now: () => t, advance: (ms) => { t += ms; } };
};

describe('the pick-press latch', () => {
  it('a pick with no press first plays its cue (a tap, a key, a replay)', () => {
    const c = clock();
    expect(createPickPressLatch(c.now).consume()).toBe(false);
  });

  it('a press silences the pick it leads to — once', () => {
    const c = clock();
    const latch = createPickPressLatch(c.now);
    latch.arm();
    c.advance(120);                                   // a normal click: press, then release
    expect(latch.consume()).toBe(true);               // the press already played it
    expect(latch.consume()).toBe(false);              // the NEXT pick plays normally
  });

  it('a press that did not become a pick stops speaking after the window', () => {
    const c = clock();
    const latch = createPickPressLatch(c.now);
    latch.arm();
    c.advance(PICK_PRESS_WINDOW_MS);
    expect(latch.consume()).toBe(false);
  });
});
