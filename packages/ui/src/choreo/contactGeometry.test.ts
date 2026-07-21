import { describe, expect, it } from 'vitest';
import { contactGeometry, type RectSize } from './contactGeometry';

const cfg = { targetSpeed: 1600, minStrikeDur: 0.1, maxStrikeDur: 0.28, leadTilt: 7, tiltAngleScale: 0, faceOnRamp: 90 };
const card = (): RectSize => ({ width: 80, height: 100 });

/** Rotate a local point by `deg` (screen coords, clockwise-positive) — mirrors the geometry's corner pose. */
const rot = (x: number, y: number, deg: number): { x: number; y: number } => {
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
};

// Owner spec 2026-07-21: the attacker's FIXED leading corner lands exactly on the defender's dead centre
// (both axes). The corner is picked by direction — right corners when travelling left→right, left when
// right→left; top corners travelling upward (player swings), mirrored to bottom travelling downward (enemy
// swings) — and it strikes as POSED (rotated by the lead tilt), so the tilt can't pull it off the centre.
describe('contactGeometry — fixed corner to dead centre', () => {
  const cases: { name: string; dx: number; dy: number; corner: [number, number]; tilt: number }[] = [
    { name: 'player swing left→right leads TOP-RIGHT', dx: 200, dy: -300, corner: [40, -50], tilt: 7 },
    { name: 'player swing right→left leads TOP-LEFT', dx: -200, dy: -300, corner: [-40, -50], tilt: -7 },
    { name: 'enemy swing left→right mirrors to BOTTOM-RIGHT', dx: 200, dy: 300, corner: [40, 50], tilt: 7 },
    { name: 'enemy swing right→left mirrors to BOTTOM-LEFT', dx: -200, dy: 300, corner: [-40, 50], tilt: -7 },
  ];
  for (const { name, dx, dy, corner, tilt } of cases) {
    it(name, () => {
      const g = contactGeometry(dx, dy, card(), card(), cfg);
      const posed = rot(corner[0], corner[1], tilt);
      // card placed so the POSED corner lands exactly on the defender's centre (dx, dy)…
      expect(g.strike.x + posed.x).toBeCloseTo(dx, 5);
      expect(g.strike.y + posed.y).toBeCloseTo(dy, 5);
      // …and the impact point IS that centre.
      expect(g.contact.x).toBeCloseTo(dx, 5);
      expect(g.contact.y).toBeCloseTo(dy, 5);
      expect(g.leadTilt).toBeCloseTo(tilt, 5);
    });
  }
});

// A defender DIRECTLY AHEAD is the degenerate case of the corner rule (owner note 2026-07-21: the sideways
// shimmy to land a corner looked wrong straight-across). The corner + tilt fade out over `faceOnRamp` px of
// horizontal offset: dead-ahead is a flat frontal slam, leading-edge MIDPOINT to centre.
describe('face-on fade', () => {
  it('a dead-ahead swing slams flat: no tilt, no sideways shift, top-edge midpoint on centre', () => {
    const g = contactGeometry(0, -300, card(), card(), cfg);
    expect(g.leadTilt).toBeCloseTo(0, 9);
    expect(g.strike.x).toBeCloseTo(0, 5);           // drives perfectly straight
    expect(g.strike.y).toBeCloseTo(-250, 5);        // -300 - (top edge midpoint at -50) → edge lands on centre
  });
  it('an enemy dead-ahead swing slams flat downward, bottom-edge midpoint on centre', () => {
    const g = contactGeometry(0, 300, card(), card(), cfg);
    expect(g.leadTilt).toBeCloseTo(0, 9);
    expect(g.strike.x).toBeCloseTo(0, 5);
    expect(g.strike.y).toBeCloseTo(250, 5);
  });
  it('the corner + tilt ramp in linearly with horizontal offset and are fully in past the ramp', () => {
    const half = contactGeometry(45, -300, card(), card(), cfg); // |dx| = ramp/2 → t = 0.5
    expect(half.leadTilt).toBeCloseTo(3.5, 5);                   // half the base tilt
    const posedHalf = rot(20, -50, 3.5);                         // half the corner x, posed at half tilt
    expect(half.strike.x + posedHalf.x).toBeCloseTo(45, 5);      // still lands exactly on centre
    expect(half.strike.y + posedHalf.y).toBeCloseTo(-300, 5);
    const full = contactGeometry(90, -300, card(), card(), cfg); // |dx| = ramp → t = 1, the full corner-strike
    expect(full.leadTilt).toBeCloseTo(7, 5);
    const posedFull = rot(40, -50, 7);
    expect(full.strike.x + posedFull.x).toBeCloseTo(90, 5);
  });
  it('the fade also mutes tiltAngleScale, which would otherwise blow up near ±90° approaches', () => {
    const g = contactGeometry(0, -300, card(), card(), { ...cfg, tiltAngleScale: 1 });
    expect(g.leadTilt).toBeCloseTo(0, 9); // approachDeg is -90 here; unfaded this would be 7 - 90 = -83°
  });
  it('faceOnRamp 0 disables the fade — even a vertical swing takes the full corner', () => {
    const g = contactGeometry(0, -300, card(), card(), { ...cfg, faceOnRamp: 0 });
    expect(g.leadTilt).toBeCloseTo(7, 5);
    const posed = rot(40, -50, 7);
    expect(g.strike.x + posed.x).toBeCloseTo(0, 5);
    expect(g.strike.y + posed.y).toBeCloseTo(-300, 5);
  });
});

// The strike DURATION still derives from the surface-to-surface gap (not the deeper corner-to-centre drive):
// that is what it derived from in the surface-clack era, so the contact beat — and every hold welded to it —
// lands exactly when it always has. The extra depth is absorbed into speed.
describe('strike duration — unchanged timing', () => {
  it('derives from the surface gap at constant px/s, clamped to [min, max]', () => {
    const near = contactGeometry(0, -120, card(), card(), cfg); // gap 20 → clamps to min
    const far = contactGeometry(0, -3000, card(), card(), cfg); // gap 2900 → clamps to max
    expect(near.strikeDur).toBeCloseTo(0.1, 5);
    expect(far.strikeDur).toBeCloseTo(0.28, 5);
    const mid = contactGeometry(0, -450, card(), card(), cfg); // gap = 450 - 50 - 50 = 350
    expect(mid.strikeDur).toBeCloseTo(350 / 1600, 4);
    expect(mid.strikeDur).toBeGreaterThan(near.strikeDur);
    expect(mid.strikeDur).toBeLessThan(far.strikeDur);
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
  it('reports the surface gap and centre distance', () => {
    const g = contactGeometry(0, -300, card(), card(), cfg);
    expect(g.dist).toBeCloseTo(300, 5);
    expect(g.travel).toBeCloseTo(200, 5); // 300 - 50 - 50
  });
  it('measures approach slope along the direction of travel, so mirrored swings agree', () => {
    expect(contactGeometry(300, 0, card(), card(), cfg).approachDeg).toBeCloseTo(0, 5);
    // same downward slope whether travelling right or left
    expect(contactGeometry(300, 300, card(), card(), cfg).approachDeg).toBeCloseTo(45, 5);
    expect(contactGeometry(-300, 300, card(), card(), cfg).approachDeg).toBeCloseTo(45, 5);
  });
  it('tiltAngleScale 0 keeps the shipped sign-only tilt; raising it steers the pose by the approach', () => {
    const flat = contactGeometry(300, 0, card(), card(), { ...cfg, tiltAngleScale: 1 });
    const steep = contactGeometry(300, 300, card(), card(), { ...cfg, tiltAngleScale: 1 });
    expect(flat.leadTilt).toBeCloseTo(7, 5);        // no slope → base tilt only, same as scale 0
    expect(steep.leadTilt).toBeCloseTo(7 + 45, 5);  // full slope folded in
    // and at scale 0 a steep diagonal poses exactly like a flat swing (the shipped behaviour this dial
    // exists to change)
    expect(contactGeometry(300, 300, card(), card(), cfg).leadTilt).toBe(7);
    // whatever the tilt, the posed corner still lands on the centre — the two dials can't fight
    const g = contactGeometry(300, 300, card(), card(), { ...cfg, tiltAngleScale: 1 });
    const posed = rot(40, 50, g.leadTilt);
    expect(g.strike.x + posed.x).toBeCloseTo(300, 5);
    expect(g.strike.y + posed.y).toBeCloseTo(300, 5);
  });
});
