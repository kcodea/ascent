import { describe, expect, it } from 'vitest';
import { contactGeometry, type RectSize } from './contactGeometry';

const cfg = { bite: 6, targetSpeed: 1600, minStrikeDur: 0.1, maxStrikeDur: 0.28, leadTilt: 7, tiltAngleScale: 0 };
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
  it('contact point is the leading corner — it projects past the strike center toward the defender', () => {
    const g = contactGeometry(0, -300, card(), card(), cfg);
    const nx = 0;
    const ny = -1; // straight-up approach axis
    const strikeProj = g.strike.x * nx + g.strike.y * ny;
    const contactProj = g.contact.x * nx + g.contact.y * ny;
    // the tilted leading corner pokes further along the axis than the card center's strike stop
    expect(contactProj).toBeGreaterThan(strikeProj);
    // and it's laterally offset from the center line (a corner, not the face midpoint)
    expect(Math.abs(g.contact.x - g.strike.x)).toBeGreaterThan(0);
  });
});

// The lunge is tuned as functions of the approach VECTOR because there is no stable per-pairing key: the
// board row is centre-justified and re-centres mid-combat as units die. These cover the two vector-driven
// functions and the diagnostics the DEV tuner reads back.
describe('vector-driven behaviour', () => {
  it('reports the clamp bound it hit, so a flattened strike is visible rather than silent', () => {
    expect(contactGeometry(0, -120, card(), card(), cfg).clamped).toBe('min');
    expect(contactGeometry(0, -3000, card(), card(), cfg).clamped).toBe('max');
    expect(contactGeometry(0, -450, card(), card(), cfg).clamped).toBeNull();
  });
  it('reports travel and centre distance', () => {
    const g = contactGeometry(0, -300, card(), card(), cfg);
    expect(g.dist).toBeCloseTo(300, 5);
    expect(g.travel).toBeCloseTo(206, 5); // 300 - 50 - 50 + 6
  });
  it('measures approach slope along the direction of travel, so mirrored swings agree', () => {
    expect(contactGeometry(300, 0, card(), card(), cfg).approachDeg).toBeCloseTo(0, 5);
    // same downward slope whether travelling right or left
    expect(contactGeometry(300, 300, card(), card(), cfg).approachDeg).toBeCloseTo(45, 5);
    expect(contactGeometry(-300, 300, card(), card(), cfg).approachDeg).toBeCloseTo(45, 5);
  });
  it('tiltAngleScale 0 keeps the shipped sign-only tilt; raising it steers the corner by the approach', () => {
    const flat = contactGeometry(300, 0, card(), card(), { ...cfg, tiltAngleScale: 1 });
    const steep = contactGeometry(300, 300, card(), card(), { ...cfg, tiltAngleScale: 1 });
    expect(flat.leadTilt).toBeCloseTo(7, 5);        // no slope → base tilt only, same as scale 0
    expect(steep.leadTilt).toBeCloseTo(7 + 45, 5);  // full slope folded in
    // and at scale 0 a steep diagonal leads with exactly the same corner as a flat swing (the shipped
    // behaviour this dial exists to fix)
    expect(contactGeometry(300, 300, card(), card(), cfg).leadTilt).toBe(7);
  });
});
