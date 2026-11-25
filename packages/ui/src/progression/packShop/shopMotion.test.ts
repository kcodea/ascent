import { describe, expect, it } from 'vitest';
import { BREATH_AMP, breathScale, handFanInto, newShake, newSwing, rubberY, stepShake, stepSwing } from './shopMotion';

describe('stepShake', () => {
  it('fires on three direction changes within 400 ms', () => {
    const s = newShake();
    expect(stepShake(s, 10, 0, 0)).toBe(false);
    expect(stepShake(s, -10, 0, 80)).toBe(false); // change 1
    expect(stepShake(s, 10, 0, 160)).toBe(false); // change 2
    expect(stepShake(s, -10, 0, 240)).toBe(true); // change 3
  });

  it('does not fire when the three changes take longer than 400 ms', () => {
    const s = newShake();
    stepShake(s, 10, 0, 0);
    stepShake(s, -10, 0, 100);
    stepShake(s, 10, 0, 300);
    expect(stepShake(s, -10, 0, 520)).toBe(false); // 100 -> 520 is 420 ms
    expect(stepShake(s, 10, 0, 600)).toBe(true); // 300, 520, 600: within the window
  });

  it('ignores tiny moves and a steady drag', () => {
    const s = newShake();
    for (let t = 0; t < 400; t += 16) expect(stepShake(s, 12, 3, t)).toBe(false);
    stepShake(s, 12, 0, 500);
    expect(stepShake(s, -1, 0, 510)).toBe(false);
    expect(stepShake(s, 1, 0, 520)).toBe(false);
    expect(stepShake(s, -1, 0, 530)).toBe(false);
  });

  it('counts vertical shakes too, and starts over after firing', () => {
    const s = newShake();
    stepShake(s, 0, 10, 0);
    stepShake(s, 0, -10, 50);
    stepShake(s, 0, 10, 100);
    expect(stepShake(s, 0, -10, 150)).toBe(true);
    expect(stepShake(s, 0, 10, 200)).toBe(false); // the history was cleared
  });
});

describe('rubberY', () => {
  it('leaves a point above the line alone', () => {
    expect(rubberY(100, 300, 40)).toBe(100);
    expect(rubberY(300, 300, 40)).toBe(300);
  });

  it('pulls a point below the line back, never further than `reach` past it, and keeps the order', () => {
    const a = rubberY(320, 300, 40), b = rubberY(400, 300, 40), c = rubberY(2000, 300, 40);
    expect(a).toBeGreaterThan(300);
    expect(a).toBeLessThan(320);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThanOrEqual(340);
  });
});

describe('stepSwing', () => {
  it('a tag swings back against the pack\'s acceleration, then settles to rest', () => {
    const s = newSwing();
    stepSwing(s, 0.5, 1);
    expect(s.a).toBeGreaterThan(0); // pack accelerates right: the tag's bottom lags left (clockwise)
    let moving = true;
    for (let i = 0; i < 2000 && moving; i++) moving = stepSwing(s, 0, 1);
    expect(moving).toBe(false);
    expect(s.a).toBe(0);
    expect(s.v).toBe(0);
  });

  it('stays bounded under a long hard shove', () => {
    const s = newSwing();
    for (let i = 0; i < 100; i++) stepSwing(s, 50, 3);
    expect(Math.abs(s.a)).toBeLessThanOrEqual(0.9);
  });
});

describe('handFanInto', () => {
  const out = { places: 0, shown: 0, piled: 0 };

  it('a small hand fans every pack; a reserved place adds one', () => {
    expect(handFanInto(out, 3, 0)).toEqual({ places: 3, shown: 3, piled: 0 });
    expect(handFanInto(out, 3, 1)).toEqual({ places: 4, shown: 4, piled: 0 });
    expect(handFanInto(out, 0, 0)).toEqual({ places: 0, shown: 0, piled: 0 });
  });

  it('a large hand counts the pile as a place', () => {
    expect(handFanInto(out, 7, 0)).toEqual({ places: 7, shown: 7, piled: 0 });
    expect(handFanInto(out, 7, 1)).toEqual({ places: 7, shown: 6, piled: 2 });
    expect(handFanInto(out, 18, 0)).toEqual({ places: 7, shown: 6, piled: 12 });
  });
});

describe('breathScale', () => {
  it('wobbles about 1%, out of phase per index', () => {
    let lo = 2, hi = 0;
    for (let t = 0; t < 600; t++) { const b = breathScale(t, 0); lo = Math.min(lo, b); hi = Math.max(hi, b); }
    expect(hi).toBeLessThanOrEqual(1 + BREATH_AMP + 1e-9);
    expect(lo).toBeGreaterThanOrEqual(1 - BREATH_AMP - 1e-9);
    expect(hi - lo).toBeGreaterThan(BREATH_AMP);
    expect(BREATH_AMP).toBeLessThanOrEqual(0.012);
    expect(breathScale(10, 0)).not.toBe(breathScale(10, 1));
  });
});
