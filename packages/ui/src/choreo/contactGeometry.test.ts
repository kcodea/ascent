import { describe, expect, it } from 'vitest';
import { contactGeometry, type RectSize } from './contactGeometry';

const cfg = { bite: 6, targetSpeed: 1600, minStrikeDur: 0.1, maxStrikeDur: 0.28, leadTilt: 7 };
const card = (): RectSize => ({ width: 80, height: 100 });

describe('contactGeometry', () => {
  it('strike stops at the surface (center distance minus both half-extents, plus bite)', () => {
    // straight up: dy = -300, cards 100 tall → travel = 300 - 50 - 50 + 6 = 206
    const g = contactGeometry(0, -300, card(), card(), cfg);
    expect(g.strike.x).toBeCloseTo(0, 5);
    expect(g.strike.y).toBeCloseTo(-206, 5);
  });
  it('scales strike duration with travel, clamped to [min, max]', () => {
    const near = contactGeometry(0, -120, card(), card(), cfg); // travel small → clamps to min
    const far = contactGeometry(0, -3000, card(), card(), cfg);  // travel huge → clamps to max
    expect(near.strikeDur).toBeCloseTo(0.1, 5);
    expect(far.strikeDur).toBeCloseTo(0.28, 5);
    // a mid distance lands strictly between the clamps and equals travel / targetSpeed
    const mid = contactGeometry(0, -450, card(), card(), cfg); // travel = 450-100+6 = 356
    expect(mid.strikeDur).toBeCloseTo(356 / 1600, 4);
    expect(mid.strikeDur).toBeGreaterThan(near.strikeDur);
    expect(mid.strikeDur).toBeLessThan(far.strikeDur);
  });
  it('lead tilt sign follows the horizontal offset', () => {
    expect(contactGeometry(200, -300, card(), card(), cfg).leadTilt).toBe(7);
    expect(contactGeometry(-200, -300, card(), card(), cfg).leadTilt).toBe(-7);
  });
});
