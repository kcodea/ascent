/** Just the size fields of a DOM rect — all contactGeometry needs (kept minimal so tests can stub it). */
export interface RectSize {
  width: number;
  height: number;
}

/** The subset of LungeConfig the geometry reads. */
export interface ContactCfg {
  targetSpeed: number;
  minStrikeDur: number;
  maxStrikeDur: number;
  leadTilt: number;
  tiltAngleScale: number;
  faceOnRamp: number;
}

export interface Contact {
  /** Strike target offset from the attacker's rest center — positioned so its LEADING CORNER lands exactly
   *  on the defender's centre. */
  strike: { x: number; y: number };
  /** Strike duration (s) — derived from the surface-to-surface gap (see `travel`) and clamped. Deliberately
   *  NOT from the full corner-to-centre drive: the gap is what the duration derived from in the
   *  surface-clack era, so the beat timing (contact moment, holds, damage landing) is unchanged — the extra
   *  depth to centre is absorbed into speed, a hotter final drive within the same clock. */
  strikeDur: number;
  /** Signed lead-tilt (deg) — the attacker rotates this much to present a corner. */
  leadTilt: number;
  /** The impact point — the DEFENDER'S CENTRE (owner ruling 2026-07-21: the leading corner always strikes
   *  dead centre, both axes). Offset from the attacker's rest centre; the impact FX originate here. */
  contact: { x: number; y: number };
  // --- Derived diagnostics. Nothing in the animation reads these; the DEV tuner does, so the distance→
  // duration and angle→tilt FUNCTIONS can be inspected across the vectors combat actually produces
  // (there is no stable per-slot key to inspect instead — see the header note in lungeConfig.ts).
  /** Centre-to-centre distance (px). */
  dist: number;
  /** Surface-to-surface gap (px) — what the strike duration + ease band derive from. */
  travel: number;
  /** Which duration clamp this vector hit, if any — i.e. this strike is NOT running at `targetSpeed`.
   *  `min` = travel too short, forced to take longer → moves SLOWER than `targetSpeed`.
   *  `max` = travel too long, forced to take less time → moves FASTER than `targetSpeed`.
   *  (Clamped strikes share a DURATION, not a speed — a 500px and a 900px max-clamped strike both take
   *  `maxStrikeDur` and so look markedly different from each other.) */
  clamped: 'min' | 'max' | null;
  /** Signed approach angle off horizontal (deg): 0 = straight across the board, ± = diagonal. */
  approachDeg: number;
}

/**
 * Corner-to-centre contact geometry (choreographer). Given the attacker→defender vector and both cards'
 * sizes, compute the strike offset that drives the attacker's FIXED leading corner onto the defender's
 * dead centre, how long the strike takes, and the signed lead-tilt. Pure — no DOM/GSAP.
 *
 * The leading corner is fixed by DIRECTION, not picked by projection (owner spec 2026-07-21):
 *   - horizontal: the RIGHT corners lead when travelling left→right (dx ≥ 0), the LEFT when right→left;
 *   - vertical:   the TOP corners lead when travelling upward (a player attack, dy ≤ 0), MIRRORED to the
 *                 BOTTOM corners when travelling downward (an enemy attack) — the forward corner either way.
 * So a player card attacking left→right strikes with its top-right corner; the enemy card coming back
 * right→left strikes with its bottom-left. The corner is rotated by the lead-tilt before placement, so what
 * lands on the centre is the corner as posed, not as at rest. A defender DIRECTLY AHEAD is the degenerate
 * case: the corner + tilt fade out over `faceOnRamp` px of horizontal offset, so a straight-across attack is
 * a flat frontal slam — leading-edge midpoint to centre — instead of a sideways shimmy to land a corner.
 *
 * This is the whole reason per-pairing lunge config isn't a thing: the vector is the only stable coordinate
 * (rows re-centre as units die), so everything the lunge needs is a function of it, resolved per swing.
 */
export function contactGeometry(dx: number, dy: number, atk: RectSize, def: RectSize, c: ContactCfg): Contact {
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;
  // Half-extent of a card projected onto the approach axis (a box's support width along a direction).
  const projHalf = (r: RectSize): number => (Math.abs(nx) * r.width) / 2 + (Math.abs(ny) * r.height) / 2;
  // The surface-to-surface gap still drives DURATION (and the ease band) so the contact beat lands exactly
  // when it always has; see the `strikeDur` doc above for why it is not the corner-to-centre distance.
  const travel = Math.max(0, dist - projHalf(def) - projHalf(atk));
  const rawDur = travel / c.targetSpeed;
  const strikeDur = Math.min(c.maxStrikeDur, Math.max(c.minStrikeDur, rawDur));
  const clamped = rawDur > c.maxStrikeDur ? 'max' : rawDur < c.minStrikeDur ? 'min' : null;
  // Approach slope off horizontal, measured along the direction of travel (hence |dx|), so a rightward-down
  // and a leftward-down swing both report the slope of the line the card actually rides.
  const approachDeg = (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI;
  // FACE-ON fade (owner note 2026-07-21: straight-across attacks looked wrong): a defender directly ahead
  // (dx ≈ 0) must be hit with a straight frontal drive — leading-EDGE-MIDPOINT to centre, no tilt — not a
  // sideways shimmy to land a corner. `t` ramps the corner + tilt in over `faceOnRamp` px of horizontal
  // offset, so dead-ahead is a flat slam, a slight offset a slight lean, and past the ramp the full
  // corner-strike. A blend, not a threshold — adjacent pairings can't pop between two looks.
  const t = c.faceOnRamp > 0 ? Math.min(1, Math.abs(dx) / c.faceOnRamp) : 1;
  // The lead tilt has two halves: a fixed base that just picks the tilt direction (sign of dx — the shipped
  // behaviour), plus an optional angle term that rotates the card toward the line it travels along, so a
  // steep diagonal doesn't pose identically to a flat sideways swing. `tiltAngleScale: 0` keeps the
  // base-only behaviour exactly. Both halves ride the face-on fade — near-vertical, `approachDeg` tends to
  // ±90°, so an unfaded angle term would slam the card sideways exactly where it should be flattest.
  const leadTilt = t * ((dx >= 0 ? 1 : -1) * c.leadTilt + c.tiltAngleScale * approachDeg);
  // The leading STRIKE POINT in the attacker's local frame (screen coords: -y is up, so TOP = -hh): the
  // fixed corner faded toward the leading edge's midpoint as the approach goes vertical.
  const cxo = t * (dx >= 0 ? 1 : -1) * (atk.width / 2);
  const cyo = (dy > 0 ? 1 : -1) * (atk.height / 2);
  // Rotate it by the lead-tilt — the corner strikes as POSED, so the tilt can't pull it off the centre.
  const rad = (leadTilt * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = cxo * cos - cyo * sin;
  const ry = cxo * sin + cyo * cos;
  // Place the card so that rotated corner lands EXACTLY on the defender's centre (dx, dy).
  const strike = { x: dx - rx, y: dy - ry };
  const contact = { x: dx, y: dy };
  return { strike, strikeDur, leadTilt, contact, dist, travel, clamped, approachDeg };
}
