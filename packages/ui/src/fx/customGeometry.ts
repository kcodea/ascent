/**
 * The PURE maths behind the `custom` primitive's Phase 2 features — sprite-sheet framing, seeded scatter,
 * plane wobble, rope bending and perspective tilt. No Pixi, no DOM: every function here is a plain
 * transform over numbers so it is unit-testable headless (the primitive itself needs a renderer). Mirrors
 * how `lightningGeometry.ts` keeps the bolt maths out of `primitives/lightning.ts`.
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ─── sprite sheet ─────────────────────────────────────────────────────────────────────────────────────

export interface FrameRect { x: number; y: number; w: number; h: number }

/** The frame rectangles of a `cols × rows` grid over a `texW × texH` sheet, in reading order (row-major).
 *  `count` limits to the first N cells (0 = every cell) — sheets are often padded out to a full grid. */
export function sheetFrameRects(texW: number, texH: number, cols: number, rows: number, count: number): FrameRect[] {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  const total = c * r;
  const n = count > 0 ? Math.min(total, Math.floor(count)) : total;
  const w = texW / c;
  const h = texH / r;
  const out: FrameRect[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: (i % c) * w, y: Math.floor(i / c) * h, w, h });
  }
  return out;
}

export const SHEET_MODES = ['loop', 'once', 'pingpong', 'overLife'] as const;
export type SheetMode = (typeof SHEET_MODES)[number];

/**
 * Which frame to show right now. `clockMs` drives the fps modes; `prog` (0..1 over the layer's life) drives
 * `overLife`, which plays the whole strip exactly once per play whatever the fps. `start` offsets the strip.
 * A single-frame "sheet" is always frame 0, and `fps <= 0` freezes the fps modes on the start frame.
 */
export function sheetFrameIndex(mode: SheetMode, frames: number, fps: number, clockMs: number, prog: number, start: number): number {
  const n = Math.max(1, Math.floor(frames));
  if (n === 1) return 0;
  const s = ((Math.floor(start) % n) + n) % n;
  if (mode === 'overLife') {
    const p = Math.max(0, Math.min(1, prog));
    return Math.min(n - 1, s + Math.floor(p * n)) % n;
  }
  if (fps <= 0) return s;
  const t = Math.floor((Math.max(0, clockMs) / 1000) * fps);
  if (mode === 'loop') return (s + t) % n;
  if (mode === 'once') return Math.min(n - 1, s + t);
  // pingpong: 0 1 2 3 2 1 0 1 … with period 2(n-1)
  const period = 2 * (n - 1);
  const p = (s + t) % period;
  return p < n ? p : period - p;
}

// ─── scatter ──────────────────────────────────────────────────────────────────────────────────────────

export const SCATTER_SHAPES = ['circle', 'square'] as const;
export type ScatterShape = (typeof SCATTER_SHAPES)[number];

/** One copy's roll: a static offset from the anchor, and multipliers/offsets layered onto the shared look. */
export interface ScatterRoll {
  dx: number;
  dy: number;
  /** Extra rotation, radians. */
  rot: number;
  /** Multiplier on the copy's scale (≥ 0.05). */
  scale: number;
  /** Multiplier on the copy's alpha (0..1). */
  alpha: number;
  /** When this copy starts, relative to the layer's clock. */
  delayMs: number;
}

/**
 * Roll `count` copies off a seeded `rng` (`fx/rng.ts`). Consumes the generator in a FIXED order per copy
 * (pos u, pos v, rot, scale, alpha) so the same seed always yields the same field, whatever the knob values
 * — a knob change re-rolls the same numbers into a new shape rather than a new arrangement. Copy `i` starts
 * `i × staggerMs` after the layer, in order. With radius 0 and every jitter 0 each roll is exactly the
 * identity, so a single un-scattered copy is byte-for-byte the Phase 1 look.
 */
export function rollScatter(
  rng: () => number,
  count: number,
  radius: number,
  shape: ScatterShape,
  jitterRotDeg: number,
  jitterScale: number,
  jitterAlpha: number,
  staggerMs: number,
): ScatterRoll[] {
  const n = Math.max(1, Math.floor(count));
  const out: ScatterRoll[] = [];
  for (let i = 0; i < n; i++) {
    const u = rng();
    const v = rng();
    const ur = rng();
    const us = rng();
    const ua = rng();
    let dx: number;
    let dy: number;
    if (shape === 'square') {
      dx = radius * (2 * u - 1);
      dy = radius * (2 * v - 1);
    } else {
      const r = radius * Math.sqrt(u); // sqrt → uniform over the disc, not bunched at the centre
      const a = v * TAU;
      dx = r * Math.cos(a);
      dy = r * Math.sin(a);
    }
    out.push({
      dx,
      dy,
      rot: (2 * ur - 1) * jitterRotDeg * DEG,
      scale: Math.max(0.05, 1 + (2 * us - 1) * jitterScale),
      alpha: Math.max(0, Math.min(1, 1 - ua * jitterAlpha)),
      delayMs: i * Math.max(0, staggerMs),
    });
  }
  return out;
}

// ─── plane wobble ─────────────────────────────────────────────────────────────────────────────────────

export const WOBBLE_AXES = ['y', 'x', 'both'] as const;
export type WobbleAxis = (typeof WOBBLE_AXES)[number];

/**
 * Displace a plane's BASE vertex positions (interleaved x,y over a `w × h` image) by a travelling sine:
 * `freq` cycles across the image, `phase` in radians (advance it with time to make it flow), `amp` in px.
 * Axis `y` ripples vertically along x (a flag), `x` ripples horizontally along y (a curtain), `both` does
 * both. Writes into `out` (same length as `base`); amp 0 copies base through untouched.
 */
export function wobblePositions(
  base: Float32Array,
  out: Float32Array,
  w: number,
  h: number,
  amp: number,
  freq: number,
  phase: number,
  axis: WobbleAxis,
): void {
  const iw = w > 0 ? 1 / w : 0;
  const ih = h > 0 ? 1 / h : 0;
  for (let i = 0; i + 1 < base.length; i += 2) {
    const x = base[i];
    const y = base[i + 1];
    let dx = 0;
    let dy = 0;
    if (amp !== 0) {
      if (axis !== 'x') dy = amp * Math.sin(x * iw * freq * TAU + phase);
      if (axis !== 'y') dx = amp * Math.sin(y * ih * freq * TAU + phase);
    }
    out[i] = x + dx;
    out[i + 1] = y + dy;
  }
}

// ─── rope bend ────────────────────────────────────────────────────────────────────────────────────────

/**
 * `n` points spanning an image of width `w`, centred on the origin, along an arc of sagitta `bend` px
 * (0 at both ends, `bend` at the middle — positive bows downward in screen space) plus a sine `wave` of
 * `waveAmp` px over `cycles` cycles at `phase`. Writes into `out` (length ≥ n), reusing the point objects
 * so a rope's `points` array can be mutated in place each frame.
 */
export function ropePoints(
  n: number,
  w: number,
  bend: number,
  waveAmp: number,
  cycles: number,
  phase: number,
  out: { x: number; y: number }[],
): void {
  const count = Math.max(2, Math.floor(n));
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const s = 2 * t - 1; // -1..1
    const y = bend * (1 - s * s) + (waveAmp !== 0 ? waveAmp * Math.sin(t * cycles * TAU + phase) : 0);
    const p = out[i] ?? (out[i] = { x: 0, y: 0 });
    p.x = (t - 0.5) * w;
    p.y = y;
  }
}

// ─── perspective tilt ─────────────────────────────────────────────────────────────────────────────────

/**
 * The four corners (TL, TR, BR, BL, as `[x0,y0,x1,y1,x2,y2,x3,y3]`) of a `w × h` quad in 0..w / 0..h
 * space after rotating it `tiltX` degrees about the horizontal axis and `tiltY` about the vertical, seen
 * through a pinhole at focal length `depth` px (bigger = flatter, less foreshortening). Both tilts 0 return
 * the plain rectangle exactly. Clamped so a corner can never swing behind the camera.
 */
export function tiltCorners(w: number, h: number, tiltXDeg: number, tiltYDeg: number, depth: number): number[] {
  const ax = tiltXDeg * DEG;
  const ay = tiltYDeg * DEG;
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  const f = Math.max(1, depth);
  const hw = w / 2;
  const hh = h / 2;
  const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const out: number[] = [];
  for (const [x, y] of corners) {
    // rotate about X (y,z), then about Y (x,z); z grows toward the viewer as it comes forward
    const y1 = y * cx;
    const z1 = -y * sx;
    const x2 = x * cy + z1 * sy;
    const z2 = -x * sy + z1 * cy;
    const s = f / Math.max(1, f - z2);
    out.push(x2 * s + hw, y1 * s + hh);
  }
  return out;
}
