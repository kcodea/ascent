/**
 * WIPE GEOMETRY — the pure maths behind the combat <-> shop curtain's bloom (see Recruit's wipe state machine,
 * `wipeMachine.ts`, and `.wipecurtain` / `.wipefront` in styles.css). DOM-free so it can be unit-tested at any
 * aspect ratio.
 *
 * Round 1 (owner bug 2026-09-24, "not built for 21:9 and stop/pause here"): the glowing ring's size was a fixed
 * 16:9 number, so on ultrawide it stalled mid-screen. Both the clip and the ring now derive from the live viewport.
 *
 * Round 2 (owner 2026-09-24, "make it smoother/wider/cleaner so that there's no jank on an ultrawide"): the bloom
 * is an ELLIPSE stretched by how much wider than 16:9 the screen is (`wipeAspect`), so on 21:9 / 32:9 it reaches
 * the sides together with the top and bottom instead of spending its tail crawling across a thin side strip. On
 * 16:9 (and narrower) the stretch is 1: the same circle as before.
 */

/** Extra pixels past the farthest corner, so antialiasing on the edge can never leave a corner pixel
 *  half-covered on the final frame of the bloom. */
export const WIPE_COVER_PAD_PX = 2;

/** `.wipefront` is a FIXED `WIPE_FRONT_TEXTURE_PX` square scaled up by the compositor (see styles.css). */
export const WIPE_FRONT_TEXTURE_PX = 1000;

/** Round 1's ring line (the 97% stop). Kept as the default for callers that pass no ring line. */
export const WIPE_FRONT_RING_FRAC = 0.97;

/** The reference aspect the wipe was designed on. */
export const WIPE_BASE_ASPECT = 16 / 9;

export interface WipeOrigin {
  /** Bloom centre (the End Turn / End Combat gem), viewport px. */
  cx: number;
  cy: number;
  /** The ellipse's radii at full cover, px. rx = ry on 16:9 or with the stretch off. */
  rx: number;
  ry: number;
  /** max(rx, ry): the FX layer's reach (its motes and inhale spread). */
  r: number;
  /** `.wipefront` scale per axis at full cover: puts the ring's bright line exactly on the seam. */
  frontScaleX: number;
  frontScaleY: number;
}

/** The horizontal stretch: 1 on 16:9 or narrower, (aspect / 16:9) ^ amount on wider screens. `amount` 0 = circle. */
export function wipeAspect(vw: number, vh: number, amount: number): number {
  if (!(vw > 0) || !(vh > 0) || !(amount > 0)) return 1;
  const wider = (vw / vh) / WIPE_BASE_ASPECT;
  return wider <= 1 ? 1 : Math.pow(wider, amount);
}

/** The radius that covers the WHOLE viewport from (cx, cy) with a circle: the farthest corner, rounded up, plus a
 *  small antialiasing pad. Any aspect ratio, any anchor (even one off-screen). */
export function wipeCoverRadius(cx: number, cy: number, vw: number, vh: number): number {
  const dx = Math.max(Math.abs(cx), Math.abs(vw - cx));
  const dy = Math.max(Math.abs(cy), Math.abs(vh - cy));
  return Math.ceil(Math.hypot(dx, dy)) + WIPE_COVER_PAD_PX;
}

/** The ellipse (horizontal radius = `aspect` × vertical) that covers the whole viewport from (cx, cy): squash x by
 *  the aspect, take the circle cover radius in that space, and stretch back. */
export function wipeCoverEllipse(cx: number, cy: number, vw: number, vh: number, aspect: number): { rx: number; ry: number } {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const dx = Math.max(Math.abs(cx), Math.abs(vw - cx)) / a;
  const dy = Math.max(Math.abs(cy), Math.abs(vh - cy));
  const ry = Math.ceil(Math.hypot(dx, dy)) + WIPE_COVER_PAD_PX;
  return { rx: Math.ceil(ry * a) + WIPE_COVER_PAD_PX, ry };
}

/** The `.wipefront` scale whose bright ring line (at `ringLine` of the texture's radius) lands on radius `r`. */
export function wipeFrontScale(r: number, ringLine = WIPE_FRONT_RING_FRAC): number {
  return r / ((WIPE_FRONT_TEXTURE_PX / 2) * ringLine);
}

/** The bloom's origin + full-cover sizes for a viewport. `gem` is the gem's bounding rect (null = not mounted:
 *  fall back to where it sits on the stage). */
export function wipeOriginFor(
  vw: number,
  vh: number,
  gem: { left: number; top: number; width: number; height: number } | null,
  opts: { ellipse?: number; ringLine?: number } = {},
): WipeOrigin {
  const cx = gem ? gem.left + gem.width / 2 : vw * 0.84;
  const cy = gem ? gem.top + gem.height / 2 : vh * 0.62;
  const { rx, ry } = wipeCoverEllipse(cx, cy, vw, vh, wipeAspect(vw, vh, opts.ellipse ?? 0));
  const line = opts.ringLine ?? WIPE_FRONT_RING_FRAC;
  return { cx, cy, rx, ry, r: Math.max(rx, ry), frontScaleX: wipeFrontScale(rx, line), frontScaleY: wipeFrontScale(ry, line) };
}

/** True when the ellipse (rx, ry) at (cx, cy) contains the point (x, y). */
export function ellipseCovers(o: { cx: number; cy: number; rx: number; ry: number }, x: number, y: number): boolean {
  const nx = (x - o.cx) / o.rx, ny = (y - o.cy) / o.ry;
  return nx * nx + ny * ny <= 1;
}

/** Numeric cubic-bezier(x1,y1,x2,y2) easing — the CSS timing function, evaluated in JS so the FX layer's seam can
 *  never drift from the clip's. Newton–Raphson with a bisection fallback. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-4) return sampleY(t);
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1;
    t = x;
    while (hi - lo > 1e-4) {
      if (sampleX(t) < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}
