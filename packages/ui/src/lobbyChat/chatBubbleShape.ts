/**
 * THE HAND-DRAWN BUBBLE (owner 2026-11-09: "how can we make the bubbles look more organic and less rigid?", with a comic
 * speech bubble for reference; "the tail should still be on the side"). Pure: given the bubble's box, returns SVG path
 * strings for an inked outline that wobbles a little, uneven corners, a curvy tail on the speaker's side, and a few
 * loose sketch strokes outside it. Seeded, so one message always draws the same shape (it never shimmers), and two
 * messages never quite match.
 *
 * Built once per bubble when it opens or its words land; nothing here runs per frame.
 */

export interface BubbleShapeOpts {
  w: number;
  h: number;
  /** Which side the tail is on (the speaker's side). */
  tail: 'left' | 'right';
  seed: number;
  /** How far the outline drifts in and out, px. */
  wobble: number;
  /** The base corner radius, px (each corner varies around it). */
  radius: number;
  /** How far the tail reaches out from the edge, px. */
  tailLen: number;
  /** The sketch strokes: 0 = none. How far outside the outline they sit, px. */
  accents: number;
  accentGap: number;
  /** How far the corners lean, px (0 = square to the screen). */
  askew: number;
  /**
   * A LONG MESSAGE'S LATER BUBBLE (owner 2026-11-09, with a mock-up: "a specific tail for when a long message is sent, so
   * it looks like it comes from the same spot"): the tail's tip, in this bubble's own coordinates, at the first bubble's
   * tip. The tail leaves the upper part of the side and sweeps up to it in a long curve, thinning to the point.
   */
  reach?: { x: number; y: number };
  /** How wide that reaching tail is where it leaves the bubble, px (it thins to its point). */
  reachWidth?: number;
}

export interface BubbleShape {
  /** The bubble and its tail, one closed path. */
  body: string;
  /** The loose sketch strokes (open paths). */
  accents: string;
  /** Where the tail's tip landed, in the bubble's coordinates (a later bubble of the same message reaches for it). */
  tip: { x: number; y: number } | null;
}

/** `pin`: a point the lean never moves (a reaching tail's tip must land exactly where it was aimed). */
type P = { x: number; y: number; sharp?: boolean; pin?: boolean; tip?: boolean };

/** A small seeded generator (mulberry32): the same message draws the same bubble. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const f = (v: number): string => v.toFixed(1);

/** A smooth closed (or open) curve through `pts` (Catmull-Rom as cubic Béziers); a `sharp` point keeps its corner. */
function smooth(pts: P[], closed: boolean): string {
  const n = pts.length;
  const at = (i: number): P => (closed ? pts[(i + n) % n]! : pts[Math.max(0, Math.min(n - 1, i))]!);
  let d = `M${f(pts[0]!.x)},${f(pts[0]!.y)}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const k1 = p1.sharp ? 0 : 1 / 6, k2 = p2.sharp ? 0 : 1 / 6;
    d += `C${f(p1.x + (p2.x - p0.x) * k1)},${f(p1.y + (p2.y - p0.y) * k1)} ${f(p2.x - (p3.x - p1.x) * k2)},${f(p2.y - (p3.y - p1.y) * k2)} ${f(p2.x)},${f(p2.y)}`;
  }
  return closed ? `${d}Z` : d;
}

/** The rounded rectangle's outline, clockwise from the top-left, as evenly spaced points (each corner its own radius). */
function outline(w: number, h: number, radii: [number, number, number, number], step: number): P[] {
  const [tl, tr, br, bl] = radii;
  const pts: P[] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) pts.push({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n });
  };
  const arc = (cx: number, cy: number, r: number, a0: number): void => {
    for (let i = 0; i < 4; i++) { const a = a0 + (Math.PI / 2) * (i / 4); pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
  };
  edge(tl, 0, w - tr, 0);
  arc(w - tr, tr, tr, -Math.PI / 2);
  edge(w, tr, w, h - br);
  arc(w - br, h - br, br, 0);
  edge(w - br, h, bl, h);
  arc(bl, h - bl, bl, Math.PI / 2);
  edge(0, h - bl, 0, tl);
  arc(tl, tl, tl, Math.PI);
  return pts;
}

/** Push each point out along its normal by a smooth, seeded wobble. */
function wobbleOut(pts: P[], amount: number, rand: () => number): P[] {
  const n = pts.length;
  const a = rand() * 6.28, b = rand() * 6.28, c = rand() * 6.28;
  return pts.map((p, i) => {
    const prev = pts[(i - 1 + n) % n]!, next = pts[(i + 1) % n]!;
    const tx = next.x - prev.x, ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    const nx = ty / len, ny = -tx / len; // outward for a clockwise loop
    const u = (i / n) * Math.PI * 2;
    const o = amount * (0.55 * Math.sin(u * 3 + a) + 0.3 * Math.sin(u * 5 + b) + 0.15 * Math.sin(u * 9 + c));
    return { x: p.x + nx * o, y: p.y + ny * o };
  });
}

/** Where a sketch stroke can sit, named from the tail: "far" is the side away from the speaker, "near" the tail's side. */
type Spot = 'farTop' | 'farBottom' | 'nearTop' | 'top' | 'bottom' | 'tailDash';

/**
 * THE VARIANTS (owner 2026-11-09: "make a bunch of subtle variations in shapes and then randomize which one is used on
 * each chat"). Each message picks one by its seed, then gets its own small jitter on top. A variant sets:
 *  - `corners`: each corner's roundness as a share of the base, [near top, far top, far bottom, near bottom];
 *  - `tail`: its length (share of the base), `curl` (where the tip points: + down, - up, as a share of its length),
 *    `bow` (how much its edges bulge, px);
 *  - `sketch`: where its loose strokes go, in order (the panel's "Sketch strokes" count takes the first N).
 */
/** `skew`: how each screen corner [top-left, top-right, bottom-right, bottom-left] is nudged, as [dx, dy] shares of the
 *  panel's "Askew" amount: the box leans a little like a card set down by hand, while its lines stay clean. */
type Skew = readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
export const BUBBLE_VARIANTS: readonly { corners: readonly [number, number, number, number]; tail: { len: number; curl: number; bow: number }; skew: Skew; sketch: readonly Spot[] }[] = [
  { corners: [1.2, 0.8, 1.1, 0.9], tail: { len: 1, curl: 0.3, bow: 2 }, skew: [[0, 0.6], [0.3, -0.5], [-0.2, 0.4], [0.4, -0.3]], sketch: ['farTop', 'farBottom', 'tailDash'] },
  { corners: [0.7, 1.3, 0.8, 1.2], tail: { len: 1.1, curl: 0.1, bow: 1 }, skew: [[0.4, -0.5], [0, 0.7], [0.3, -0.2], [-0.3, 0.5]], sketch: ['top', 'farBottom', 'farTop'] },
  { corners: [1, 1, 0.6, 1.3], tail: { len: 0.9, curl: 0.45, bow: 3 }, skew: [[-0.3, 0.2], [0.5, 0.4], [0, -0.6], [0.2, 0.3]], sketch: ['farTop', 'tailDash', 'bottom'] },
  { corners: [1.3, 0.7, 1.3, 0.7], tail: { len: 1.15, curl: -0.15, bow: 1 }, skew: [[0.2, -0.7], [-0.3, 0.1], [0.4, 0.5], [0, -0.4]], sketch: ['nearTop', 'farBottom', 'bottom'] },
  { corners: [0.9, 1.1, 1.4, 0.8], tail: { len: 1, curl: 0.25, bow: 4 }, skew: [[0, 0.3], [0.2, -0.6], [-0.4, -0.2], [0.3, 0.6]], sketch: ['farTop', 'top', 'tailDash'] },
  { corners: [1.1, 1.2, 0.9, 1], tail: { len: 1.2, curl: 0.05, bow: 0 }, skew: [[0.5, 0.1], [-0.2, 0.5], [0.1, 0.6], [-0.4, -0.2]], sketch: ['farBottom', 'tailDash', 'farTop'] },
  { corners: [0.8, 0.9, 1.2, 1.3], tail: { len: 0.95, curl: 0.35, bow: 2 }, skew: [[-0.2, -0.4], [0.4, 0.3], [-0.3, 0.2], [0.1, -0.6]], sketch: ['top', 'farTop', 'farBottom'] },
  { corners: [1.25, 1, 1, 0.75], tail: { len: 1.05, curl: -0.05, bow: 3 }, skew: [[0.3, 0.5], [0, -0.4], [0.5, 0], [-0.2, 0.4]], sketch: ['farBottom', 'nearTop', 'top'] },
];

/** Lean the box: each point moves by its corners' nudges, blended by where it sits (straight lines stay straight). */
function askew(pts: P[], w: number, h: number, skew: Skew, amount: number, jitter: () => number): P[] {
  if (amount <= 0) return pts;
  const k = skew.map(([dx, dy]) => [dx * amount * (0.8 + jitter() * 0.4), dy * amount * (0.8 + jitter() * 0.4)] as const);
  const [tl, tr, br, bl] = k as [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
  return pts.map((p) => {
    if (p.pin) return p;
    const u = p.x / w, v = p.y / h;
    const dx = (1 - u) * (1 - v) * tl[0] + u * (1 - v) * tr[0] + u * v * br[0] + (1 - u) * v * bl[0];
    const dy = (1 - u) * (1 - v) * tl[1] + u * (1 - v) * tr[1] + u * v * br[1] + (1 - u) * v * bl[1];
    return { ...p, x: p.x + dx, y: p.y + dy };
  });
}

/** Outward normals of a clockwise loop's points. */
function normals(pts: P[]): P[] {
  const n = pts.length;
  return pts.map((_, i) => {
    const prev = pts[(i - 1 + n) % n]!, next = pts[(i + 1) % n]!;
    const tx = next.x - prev.x, ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    return { x: ty / len, y: -tx / len };
  });
}

export function bubbleShape(o: BubbleShapeOpts): BubbleShape {
  const rand = rng(o.seed);
  const v = BUBBLE_VARIANTS[o.seed % BUBBLE_VARIANTS.length]!;
  const { w, h } = o;
  const left = o.tail === 'left';
  const maxR = Math.min(w, h) / 2;
  const r = (share: number): number => Math.max(4, Math.min(maxR, o.radius * share * (0.9 + rand() * 0.2)));
  const [nearTop, farTop, farBottom, nearBottom] = v.corners.map(r) as [number, number, number, number];
  // [top-left, top-right, bottom-right, bottom-left] on screen: the variant is written from the tail's side.
  const radii: [number, number, number, number] = left ? [nearTop, farTop, farBottom, nearBottom] : [farTop, nearTop, nearBottom, farBottom];
  const pts = wobbleOut(outline(w, h, radii, 14), o.wobble, rand);

  // THE TAIL, on the speaker's side at the middle: the outline there is replaced by a point reaching outward. A
  // reaching tail (a long message's later bubble) leaves the upper part of the side instead, and is a little thinner.
  const reach = o.reach && (left ? o.reach.x < 0 : o.reach.x > w) ? o.reach : null;
  const nearTopR = left ? radii[0] : radii[1];
  const half = reach ? Math.max(4, Math.min((o.reachWidth ?? 22) / 2, h / 2 - 5)) : Math.max(5, Math.min(11, h / 2 - 5));
  const cy = reach ? Math.min(h / 2, Math.max(nearTopR + half + 2, 20)) : h / 2;
  const sideR = left ? Math.min(radii[0], radii[3]) : Math.min(radii[1], radii[2]);
  const onSide = (p: P): boolean => (left ? p.x < sideR + 2 : p.x > w - sideR - 2);
  const inBase = (p: P): boolean => onSide(p) && Math.abs(p.y - cy) < half + 3;
  const first = pts.findIndex(inBase);
  let body: P[] = pts;
  const s = left ? -1 : 1;
  const edgeX = left ? 0 : w;
  const len = o.tailLen * v.tail.len * (0.92 + rand() * 0.16);
  // A CLEAN TAIL (owner 2026-11-09, with an example): two straight edges to a sharp tip that dips slightly; the variant
  // only nudges how far it dips.
  const drop = len * (0.12 + v.tail.curl * 0.25);
  const bow = v.tail.bow;
  if (first >= 0 && (len > 0 || reach)) {
    const top: P = { x: edgeX - s, y: cy - half, sharp: true };
    const bottom: P = { x: edgeX - s, y: cy + half, sharp: true };
    let hook: P[];
    if (reach) {
      // The sweep: one smooth centre line leaves the side level, then curves up into the tip; both edges sit an even,
      // steadily shrinking distance either side of it (owner 2026-11-09: "make it more consistent"), so it reads as one
      // clean tapering horn. Its points are pinned: the box's lean never bends it.
      const tip: P = { x: reach.x, y: reach.y, sharp: true, pin: true, tip: true };
      const dx = reach.x - edgeX;
      const cx = edgeX + dx * 0.9;
      const along = (t: number): P => ({ x: (1 - t) ** 2 * edgeX + 2 * (1 - t) * t * cx + t * t * reach.x, y: (1 - t) ** 2 * cy + 2 * (1 - t) * t * cy + t * t * reach.y });
      const sideA: P[] = [], sideB: P[] = [];
      const steps = 6;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const p = along(t);
        const tx = 2 * (1 - t) * (cx - edgeX) + 2 * t * (reach.x - cx), ty = 2 * t * (reach.y - cy);
        const l = Math.hypot(tx, ty) || 1;
        const nx = -ty / l, ny = tx / l;
        const wd = half * (1 - t) ** 0.85;
        sideA.push({ x: p.x + nx * wd, y: p.y + ny * wd, pin: true });
        sideB.push({ x: p.x - nx * wd, y: p.y - ny * wd, pin: true });
      }
      // Leaving the side level, the normal points down for a tail going right and up for one going left.
      const [upper, lower] = dx > 0 ? [sideB, sideA] : [sideA, sideB];
      hook = left ? [bottom, ...lower, tip, ...[...upper].reverse(), top] : [top, ...upper, tip, ...[...lower].reverse(), bottom];
    } else {
      const tip: P = { x: edgeX + s * len, y: cy + drop, sharp: true, tip: true };
      // Walking clockwise, the left side runs upward (bottom first) and the right side downward (top first).
      hook = left ? [bottom, tip, top] : [top, tip, bottom];
    }
    body = [...pts.slice(0, first).filter((p) => !inBase(p)), ...hook, ...pts.slice(first).filter((p) => !inBase(p))];
  }

  // THE SKETCH STROKES: short loose arcs outside the outline, drifting a little nearer and further (never parallel), and,
  // for a "tailDash", a short dash under the tail.
  const accentPaths: string[] = [];
  const count = Math.max(0, Math.min(3, Math.round(o.accents)));
  if (count > 0) {
    const base = outline(w, h, radii, 9);
    const nrm = normals(base);
    const n = base.length;
    const farX = left ? w : 0, nearX = left ? 0 : w;
    const nearest = (x: number, y: number): number => {
      let best = 0, bd = Infinity;
      base.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = i; } });
      return best;
    };
    const arcAt = (x: number, y: number, span: number): string => {
      const c = nearest(x, y);
      const g0 = o.wobble + o.accentGap * (0.7 + rand() * 0.3), g1 = o.wobble + o.accentGap * (1.05 + rand() * 0.35);
      const run: P[] = [];
      const lo = -Math.floor(span / 2), hi = Math.ceil(span / 2);
      for (let i = lo; i <= hi; i++) {
        const k = (i - lo) / (hi - lo || 1);
        const j = (c + i + n) % n;
        const g = g0 + (g1 - g0) * k;
        run.push({ x: base[j]!.x + nrm[j]!.x * g, y: base[j]!.y + nrm[j]!.y * g });
      }
      return smooth(run, false);
    };
    for (const spot of v.sketch.slice(0, count)) {
      if (spot === 'farTop') accentPaths.push(arcAt(farX, 0, 6));
      else if (spot === 'farBottom') accentPaths.push(arcAt(farX, h, 5));
      else if (spot === 'nearTop') accentPaths.push(arcAt(nearX, 0, 4));
      else if (spot === 'top') accentPaths.push(arcAt(left ? w * 0.65 : w * 0.35, 0, 4));
      else if (spot === 'bottom') accentPaths.push(arcAt(w / 2, h, 4));
      else if (len > 0) {
        // Under the tail: a short dash following its lower edge, a gap below it.
        const g = o.accentGap * 0.8;
        const a: P = { x: edgeX + s * len * 0.15, y: cy + half + g * 0.9 };
        const m: P = { x: edgeX + s * len * 0.45, y: cy + half * 0.6 + drop * 0.6 + bow + g };
        const b: P = { x: edgeX + s * len * 0.75, y: cy + drop * 0.85 + g * 0.9 };
        accentPaths.push(smooth([a, m, b], false));
      }
    }
  }

  const leaned = askew(body, w, h, v.skew, o.askew, rand);
  const tipAt = leaned.find((p) => p.tip);
  return { body: smooth(leaned, true), accents: accentPaths.join(' '), tip: tipAt ? { x: tipAt.x, y: tipAt.y } : null };
}
