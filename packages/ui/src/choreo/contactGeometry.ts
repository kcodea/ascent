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
}

export interface Contact {
  /** Strike target offset from the attacker's rest center (its leading corner meets the surface). */
  strike: { x: number; y: number };
  /** Strike duration (s), derived from travel distance and clamped. */
  strikeDur: number;
  /** Signed lead-tilt (deg) — the attacker rotates this much to present a corner. */
  leadTilt: number;
}

/**
 * Corner-clack contact geometry (choreographer, corner-clack contact). Given the attacker→defender vector
 * and both cards' sizes, compute where the strike lands (their surfaces meet, plus a small `bite`), how long
 * the strike takes (constant px/s via `targetSpeed`, clamped), and the signed lead-tilt. Pure — no DOM/GSAP.
 */
export function contactGeometry(dx: number, dy: number, atk: RectSize, def: RectSize, c: ContactCfg): Contact {
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;
  // Half-extent of a card projected onto the approach axis (a box's support width along a direction).
  const projHalf = (r: RectSize): number => (Math.abs(nx) * r.width) / 2 + (Math.abs(ny) * r.height) / 2;
  const travel = Math.max(0, dist - projHalf(def) - projHalf(atk) + c.bite);
  const strikeDur = Math.min(c.maxStrikeDur, Math.max(c.minStrikeDur, travel / c.targetSpeed));
  const leadTilt = (dx >= 0 ? 1 : -1) * c.leadTilt;
  return { strike: { x: nx * travel, y: ny * travel }, strikeDur, leadTilt };
}
