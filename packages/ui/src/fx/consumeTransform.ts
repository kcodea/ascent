export interface Pt { x: number; y: number }

/** Bottom-led stretch amount: rises fast, peaks early (~t=0.32), relaxes back to 0 by ~t=0.7 as the pull
 *  takes over — so the elongation happens FIRST, then the ghost is drawn in. */
function stretch01(t: number): number {
  const c = Math.max(0, Math.min(1, t / 0.7));
  return Math.sin(Math.PI * c);
}
/** Collapse: full size until ~0.75, then shrink to ~0 by t=1 (the ghost vanishes into the eater). */
function collapse(t: number): number { return t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25; }
/** Smoothstep ease for the trailing pull. */
function smooth(x: number): number { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); }

/**
 * The deterministic "pulled from the bottom" taffy transform at progress `t`.
 *
 * Applied by the caller with `transform-origin` at the **TOP center**: `scaleY > 1` elongates the ghost
 * DOWNWARD while the top stays anchored, and only later does the whole ghost `translate` toward the eater —
 * so the bottom pulls first and the top follows last, like taffy pulled from the bottom.
 *
 * The whole card also **tilts** so its downward stretch axis AIMS at the eater — its bottom edge leads
 * toward the consumer rather than straight down (owner ask 2026-08-18). `rotDeg = atan2(-dx, dy)`: 0 when the
 * eater is straight below, swinging the bottom left/right toward an off-axis eater. It eases IN over the first
 * ~30% (alongside the shake→stretch) so the card doesn't snap-tilt the instant it spawns upright over its
 * slot, then holds aimed through the pull. Shake (a small random jitter) is layered on by the caller so this
 * stays pure/testable.
 *
 * `pullDist` (0..1) = fraction of the ghost→eater vector the ghost finally travels; `lag` (0..~0.9) = how long
 * the top waits (as a fraction of the whole eat) before it starts to follow.
 */
export function consumeTransform(
  from: Pt, to: Pt, t: number,
  cfg: { stretch: number; thin: number; pullDist: number; lag: number },
): { tx: number; ty: number; rotDeg: number; scaleX: number; scaleY: number } {
  const dx = to.x - from.x, dy = to.y - from.y;
  const s = stretch01(t);
  const col = collapse(t);
  // The trailing edge (top / whole card) only starts moving after `lag`, so the bottom leads it in.
  const denom = Math.max(1e-6, 1 - cfg.lag);
  const pull = smooth((t - cfg.lag) / denom);
  // Aim the (top-anchored) downward axis at the eater; ease the tilt in over the first ~30%.
  const aimDeg = Math.atan2(-dx, dy) * 180 / Math.PI;
  const rotDeg = aimDeg * smooth(Math.min(1, t / 0.3));
  return {
    tx: dx * cfg.pullDist * pull,
    ty: dy * cfg.pullDist * pull,
    rotDeg,
    scaleY: (1 + cfg.stretch * s) * col,   // elongate DOWN (origin = top): the bottom leads
    scaleX: (1 - cfg.thin * s) * col,      // thin across while stretched
  };
}
