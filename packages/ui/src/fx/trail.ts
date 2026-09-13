/**
 * A layer's recent PATH — the head positions the player hands a primitive each frame — and the two things a
 * primitive wants from it: the current heading (so an image can face the direction it is travelling) and an
 * even resampling of the last N px of the path (so a rope can bend along the arc it actually flew). Pure and
 * headless: no Pixi, no DOM. Used by `primitives/custom.ts` (`aimMode: 'travel'`, `bendMode: 'trail'`).
 */

export interface TrailPoint { x: number; y: number }

/** Move `prev` toward `target` by `alpha` (0..1) along the SHORTEST arc, so smoothing never spins the long
 *  way round when the heading crosses ±π. alpha 1 = snap. */
export function smoothAngle(prev: number, target: number, alpha: number): number {
  const a = Math.max(0, Math.min(1, alpha));
  const diff = Math.atan2(Math.sin(target - prev), Math.cos(target - prev));
  return prev + diff * a;
}

export class HeadTrail {
  /** Recorded points, oldest → newest. */
  private readonly pts: TrailPoint[] = [];
  /** Cumulative path length at each point (same indexing as `pts`). */
  private readonly cum: number[] = [];

  /**
   * @param keepLength  how much path (px) to retain — older points are dropped once the tail is further back
   * @param minStep     a new head closer than this to the last recorded point is ignored (kills sub-pixel noise)
   */
  constructor(private readonly keepLength = 4000, private readonly minStep = 0.5) {}

  /** Retained path length (px) — from the oldest KEPT point to the head. `cum` stays measured from the
   *  original origin so trimming never rewrites it; everything here reads it relative to `cum[0]`. */
  get length(): number {
    return this.cum.length === 0 ? 0 : this.cum[this.cum.length - 1] - this.cum[0];
  }

  get count(): number {
    return this.pts.length;
  }

  /** Record this frame's head. */
  push(x: number, y: number): void {
    const n = this.pts.length;
    if (n > 0) {
      const last = this.pts[n - 1];
      const d = Math.hypot(x - last.x, y - last.y);
      if (d < this.minStep) return;
      this.pts.push({ x, y });
      this.cum.push(this.cum[n - 1] + d);
    } else {
      this.pts.push({ x, y });
      this.cum.push(0);
    }
    // Trim the tail once we hold more than keepLength — keep one extra point so the retained span is complete.
    const headCum = this.cum[this.cum.length - 1];
    while (this.pts.length > 2 && headCum - this.cum[1] > this.keepLength) {
      this.pts.shift();
      this.cum.shift();
    }
  }

  /** Direction of travel in radians from the last two distinct points, or `null` before the head has moved. */
  headingRad(): number | null {
    const n = this.pts.length;
    if (n < 2) return null;
    const a = this.pts[n - 2];
    const b = this.pts[n - 1];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  /**
   * Sample `n` points evenly (by arc length) along the last `length` px of the path, ordered TAIL → HEAD and
   * RELATIVE to the head (the head is `(0, 0)`), writing into `out` (reusing its point objects). When the
   * recorded path is shorter than `length` the missing tail is extended STRAIGHT back along the oldest
   * recorded direction (or along -x before any motion), so the sampled span is always the full length and a
   * rope never starts squashed.
   */
  sample(n: number, length: number, out: TrailPoint[]): void {
    const count = Math.max(2, Math.floor(n));
    const span = Math.max(1e-6, length);
    const m = this.pts.length;
    const head = m > 0 ? this.pts[m - 1] : { x: 0, y: 0 };
    const total = this.length;
    // Direction to extend along when the recorded path runs out: the oldest recorded segment, else -x.
    let ex = -1;
    let ey = 0;
    if (m >= 2) {
      const a = this.pts[0];
      const b = this.pts[1];
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      ex = (a.x - b.x) / d;
      ey = (a.y - b.y) / d;
    }
    let seg = m - 2; // walking backwards from the head through recorded segments
    for (let i = 0; i < count; i++) {
      // distance BACK from the head for this sample: i=0 is the tail (span), i=count-1 is the head (0)
      const back = span * (1 - i / (count - 1));
      const p = out[i] ?? (out[i] = { x: 0, y: 0 });
      if (back <= 0 || m === 0) {
        p.x = 0; p.y = 0;
        continue;
      }
      if (back > total) {
        // beyond the recorded path: extend straight from the oldest point
        const over = back - total;
        const tail = this.pts[0];
        p.x = tail.x + ex * over - head.x;
        p.y = tail.y + ey * over - head.y;
        continue;
      }
      // find the segment holding `target` — cumulative distance in `cum`'s own (origin-based) units
      const target = this.cum[0] + total - back;
      while (seg > 0 && this.cum[seg] > target) seg--;
      while (seg < m - 2 && this.cum[seg + 1] < target) seg++;
      const a = this.pts[seg];
      const b = this.pts[seg + 1];
      const segLen = this.cum[seg + 1] - this.cum[seg];
      const t = segLen > 0 ? (target - this.cum[seg]) / segLen : 0;
      p.x = a.x + (b.x - a.x) * t - head.x;
      p.y = a.y + (b.y - a.y) * t - head.y;
    }
  }
}
