/** Just the size fields of a DOM rect — all contactGeometry needs (kept minimal so tests can stub it). */
export interface RectSize {
  width: number;
  height: number;
}

/** The subset of LungeConfig the geometry reads. */
export interface ContactCfg {
  bite: number;
  targetSpeed: number;
  minStrikeDur: number;
  maxStrikeDur: number;
  leadTilt: number;
  tiltAngleScale: number;
}

export interface Contact {
  /** Strike target offset from the attacker's rest center (its leading corner meets the surface). */
  strike: { x: number; y: number };
  /** Strike duration (s), derived from travel distance and clamped. */
  strikeDur: number;
  /** Signed lead-tilt (deg) — the attacker rotates this much to present a corner. */
  leadTilt: number;
  /** The impact point — offset from the attacker's rest center to its LEADING CORNER at the contact pose
   *  (the strike offset plus the tilted corner that pokes furthest toward the defender). This is where the
   *  two cards actually clack, so the impact FX originates here rather than at the defender's center. */
  contact: { x: number; y: number };
  // --- Derived diagnostics. Nothing in the animation reads these; the DEV tuner does, so the distance→
  // duration and angle→tilt FUNCTIONS can be inspected across the vectors combat actually produces
  // (there is no stable per-slot key to inspect instead — see the header note in lungeConfig.ts).
  /** Centre-to-centre distance (px). */
  dist: number;
  /** Surface-to-surface travel (px) — what the strike duration is actually derived from. */
  travel: number;
  /** Which duration clamp this vector hit, if any. A `max` here means the strike ran SLOWER than
   *  `targetSpeed` and reads identically to every other clamped strike — the usual cause of long
   *  cross-board lunges feeling wrong. */
  clamped: 'min' | 'max' | null;
  /** Signed approach angle off horizontal (deg): 0 = straight across the board, ± = diagonal. */
  approachDeg: number;
}

/**
 * Corner-clack contact geometry (choreographer, corner-clack contact). Given the attacker→defender vector
 * and both cards' sizes, compute where the strike lands (their surfaces meet, plus a small `bite`), how long
 * the strike takes (constant px/s via `targetSpeed`, clamped), and the signed lead-tilt. Pure — no DOM/GSAP.
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
  const travel = Math.max(0, dist - projHalf(def) - projHalf(atk) + c.bite);
  const rawDur = travel / c.targetSpeed;
  const strikeDur = Math.min(c.maxStrikeDur, Math.max(c.minStrikeDur, rawDur));
  const clamped = rawDur > c.maxStrikeDur ? 'max' : rawDur < c.minStrikeDur ? 'min' : null;
  // Approach slope off horizontal, measured along the direction of travel (hence |dx|), so a rightward-down
  // and a leftward-down swing both report the slope of the line the card actually rides.
  const approachDeg = (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI;
  // The lead tilt has two halves: a fixed base that just picks WHICH corner leads (sign of dx — the shipped
  // behaviour), plus an optional angle term that rotates the card toward the line it travels along, so a
  // steep diagonal doesn't lead with the same corner as a flat sideways swing. `tiltAngleScale: 0` keeps the
  // base-only behaviour exactly.
  const leadTilt = (dx >= 0 ? 1 : -1) * c.leadTilt + c.tiltAngleScale * approachDeg;
  const strike = { x: nx * travel, y: ny * travel };
  // The impact point is the attacker's LEADING CORNER at the contact pose: rotate the four card corners by
  // leadTilt and pick the one that projects furthest along the approach axis (the one that pokes into the
  // defender). Offset from the attacker's rest center = strike + that rotated corner.
  const rad = (leadTilt * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = atk.width / 2;
  const hh = atk.height / 2;
  let best = -Infinity;
  let cxo = 0;
  let cyo = 0;
  for (const [sx, sy] of [[hw, hh], [hw, -hh], [-hw, hh], [-hw, -hh]] as const) {
    const rx = sx * cos - sy * sin;
    const ry = sx * sin + sy * cos;
    const proj = rx * nx + ry * ny;
    if (proj > best) {
      best = proj;
      cxo = rx;
      cyo = ry;
    }
  }
  const contact = { x: strike.x + cxo, y: strike.y + cyo };
  return { strike, strikeDur, leadTilt, contact, dist, travel, clamped, approachDeg };
}
