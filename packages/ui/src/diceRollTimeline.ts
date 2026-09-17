import gsap from 'gsap';
import { makeRng } from '@game/core';

/**
 * The DICE ROLL timeline — the pure, DOM-free half of `DiceRoll.tsx` (owner handoff 2026-09-17).
 *
 * ── the one rule ─────────────────────────────────────────────────────────────────────────────────────
 * This module NEVER rolls. `result` (1–6) comes from the sim — the Gambler's `heroDiceRoll`, the Gamble
 * spell's `gambleRoll.tier` — and the timeline only REVEALS it: the cube's final rotation is the face's exact
 * rest pose, reached through `spinCount` full turns and an overshoot that rocks back. The only randomness here
 * is COSMETIC (the rest yaw, a pixel of burst jitter) and it is seeded off the EVENT (`diceSeed`), so a replay
 * of the same roll is pixel-identical. No `Math.random` anywhere.
 *
 * ── geometry (top-down camera) ───────────────────────────────────────────────────────────────────────
 * The die is a CSS cube viewed dead-on from above (+Z is toward the viewer). Each face element is rotated onto
 * its side and pushed out by half the die (`FACE_TRANSFORM`); the cube is `rotateX(rx) rotateY(ry)`, and
 * `FACE_ROT` is the (rx, ry) that brings each face to +Z — the table the handoff specified:
 *   1 rotateY(0)    → X0   Y0       2 rotateX(-90) → X90  Y0       3 rotateY(90)  → X0  Y-90
 *   4 rotateY(-90)  → X0   Y90      5 rotateX(90)  → X-90 Y0       6 rotateY(180) → X0  Y180
 * `faceUp(rx, ry)` is the INVERSE — it rotates every face normal by the cube's matrix and reports the one
 * pointing at the camera — so the six-face test proves the timeline's final pose geometrically, not by
 * re-reading the table it was built from.
 *
 * ── timeline (normalised 0–1 over tumbleTime) ────────────────────────────────────────────────────────
 * Cube: 0→0.74 to end + overshoot (cubic-bezier .15,.55,.25,1); 0.74→0.88 rock back past end by 35% of the
 * overshoot (ease-in-out); 0.88→1 settle on the exact end. Overshoot = settleBounce·60° on X, 60% of that on Y.
 * Hop (translateZ toward the camera): 0→0.30 rise to hopHeight (ease-out .2,.8,.4,1); 0.30→0.62 fall to 0
 * (ease-in .6,0,.9,.4); at 0.62 — FIRST GROUND CONTACT, `onLand` — scale squashes to 1 + settleBounce·0.25;
 * 0.62→0.80 second hop to hopHeight·settleBounce; 0.80→1 fall to 0, scale back to 1.
 * Yaw: one full rotateZ turn plus the seeded rest angle (±15°), done by 0.80.
 * The shadow is a function of height (`shadowFor`) — the main top-down depth cue.
 *
 * Every tween writes to a plain state object; the component turns that into four transform strings per
 * frame (transform + opacity only — nothing that lays out or paints). The test drives the same timeline to
 * `progress(1)` with no DOM at all.
 */

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6;

/** Cube rotation (deg) that shows each face to the camera. */
export const FACE_ROT: Record<DieFace, { x: number; y: number }> = {
  1: { x: 0, y: 0 }, 2: { x: 90, y: 0 }, 3: { x: 0, y: -90 },
  4: { x: 0, y: 90 }, 5: { x: -90, y: 0 }, 6: { x: 0, y: 180 },
};

/** Each face element's own rotation, before its `translateZ(half)` push. */
export const FACE_TRANSFORM: Record<DieFace, string> = {
  1: 'rotateY(0deg)', 2: 'rotateX(-90deg)', 3: 'rotateY(90deg)',
  4: 'rotateY(-90deg)', 5: 'rotateX(90deg)', 6: 'rotateY(180deg)',
};

/** Pip layout per face on a 3×3 grid (row-major cells 0–8). Standard die: opposite faces sum to 7. */
export const FACE_PIPS: Record<DieFace, readonly number[]> = {
  1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

const DEG = Math.PI / 180;

/** The face whose outward normal points at the camera (+Z) under the cube transform `rotateX(rx) rotateY(ry)`.
 *  A geometric resolve: each face normal (the +Z axis under that face's own element rotation) is pushed through
 *  the cube's matrix and the largest Z wins. Works for ANY angles, not only multiples of 90. */
export function faceUp(rx: number, ry: number): DieFace {
  // Face normals in cube space = FACE_TRANSFORM applied to (0,0,1).
  const NORMALS: Record<DieFace, [number, number, number]> = {
    1: [0, 0, 1], 2: [0, 1, 0], 3: [1, 0, 0], 4: [-1, 0, 0], 5: [0, -1, 0], 6: [0, 0, -1],
  };
  const cx = Math.cos(rx * DEG), sx = Math.sin(rx * DEG);
  const cy = Math.cos(ry * DEG), sy = Math.sin(ry * DEG);
  let best: DieFace = 1;
  let bestZ = -Infinity;
  for (const f of [1, 2, 3, 4, 5, 6] as DieFace[]) {
    const [x, y, z] = NORMALS[f];
    // rotateY first (rightmost in the CSS transform list), then rotateX.
    const x1 = cy * x + sy * z, y1 = y, z1 = -sy * x + cy * z;
    const z2 = sx * y1 + cx * z1;
    if (z2 > bestZ) { bestZ = z2; best = f; }
  }
  return best;
}

/** A CSS `cubic-bezier(x1,y1,x2,y2)` as a GSAP ease function (Newton + bisection on the x-curve). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  return (p: number): number => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) {
      const x = sampleX(t) - p;
      if (Math.abs(x) < 1e-6) return sampleY(t);
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= x / d;
    }
    let lo = 0, hi = 1;
    t = p;
    while (hi - lo > 1e-6) {
      t = (lo + hi) / 2;
      if (sampleX(t) < p) lo = t; else hi = t;
    }
    return sampleY(t);
  };
}

/** The seed for one roll's cosmetics, keyed off the EVENT so a replay repeats it: the Gambler's roll is
 *  (wave, roll); the spell's is its bump `seq`. Two callers never collide because the variant salts it. */
export function diceSeed(variant: 'power' | 'spell', a: number, b = 0): number {
  const salt = variant === 'power' ? 0x9e37 : 0x7f4a;
  return ((Math.imul(a + 1, 0x85ebca6b) ^ Math.imul(b + 1, 0xc2b2ae35) ^ salt) >>> 0) | 0;
}

export interface DiceCosmetics {
  /** Rest yaw in ±15°. */
  restAngle: number;
  /** A pixel of landing-burst jitter, ±2 px each axis. */
  jitter: { x: number; y: number };
}

/** Every cosmetic choice for a roll, from the seeded stream — the ONLY randomness in the overlay. */
export function diceCosmetics(seed: number): DiceCosmetics {
  const rng = makeRng(seed);
  const restAngle = Math.round((rng.next() * 30 - 15) * 10) / 10;
  const jitter = { x: Math.round((rng.next() * 4 - 2) * 10) / 10, y: Math.round((rng.next() * 4 - 2) * 10) / 10 };
  return { restAngle, jitter };
}

/** The tweened state one frame of the roll is drawn from. */
export interface DiceState {
  rx: number; ry: number;   // cube rotation (deg)
  z: number;                // hop height toward the camera (px)
  scale: number;            // landing squash
  yaw: number;              // rotateZ (deg)
}

/** Shadow from height — opacity, offset and size all follow z, the top-down depth cue. */
export function shadowFor(z: number): { opacity: number; tx: number; ty: number; scale: number } {
  return { opacity: Math.max(0, 0.5 - (z / 150) * 0.32), tx: 4 + z * 0.35, ty: 6 + z * 0.5, scale: 1 + z / 400 };
}

export interface DiceTimelineOptions {
  result: DieFace;
  /** The pose the die is resting in NOW (the previous roll's bare target), so this roll starts with no jump. */
  from: { rx: number; ry: number };
  tumbleTime: number;   // ms
  hopHeight: number;    // px
  spinCount: number;
  settleBounce: number; // 0..0.5
  restAngle: number;    // deg, seeded
  /** `prefers-reduced-motion`: 250 ms, no hop, no spins, no rock-back — the face just appears. */
  reducedMotion?: boolean;
  onUpdate?: (s: DiceState) => void;
  /** First ground contact (t = 0.62) — the landing burst, the prize reveal, the (future) sound hook. */
  onLand?: () => void;
  /** Settled (t = 1). */
  onComplete?: () => void;
}

export interface DiceTimeline {
  tl: gsap.core.Timeline;
  state: DiceState;
  /** The bare rest pose (mod 360) to hand the NEXT roll as `from`. */
  rest: { rx: number; ry: number };
  /** Total length in ms. */
  durationMs: number;
}

const EASE_TUMBLE = cubicBezier(0.15, 0.55, 0.25, 1);
const EASE_RISE = cubicBezier(0.2, 0.8, 0.4, 1);
const EASE_FALL = cubicBezier(0.6, 0, 0.9, 0.4);

const mod360 = (d: number): number => ((d % 360) + 360) % 360;

/** Build the (paused) roll timeline. Play it, or seek it — `tl.progress(1)` lands it synchronously. */
export function buildDiceTimeline(o: DiceTimelineOptions): DiceTimeline {
  const target = FACE_ROT[o.result];
  const from = { rx: mod360(o.from.rx), ry: mod360(o.from.ry) };
  const state: DiceState = { rx: from.rx, ry: from.ry, z: 0, scale: 1, yaw: 0 };
  const emit = (): void => { o.onUpdate?.(state); };
  const tl = gsap.timeline({ paused: true, onUpdate: emit, onComplete: () => { o.onComplete?.(); } });
  const rest = { rx: mod360(target.x), ry: mod360(target.y) };

  if (o.reducedMotion) {
    const T = 0.25;
    // No spins: the shortest turn onto the face, and the face is simply there.
    state.rx = rest.rx; state.ry = rest.ry;
    tl.fromTo(state, { scale: 0.9 }, { scale: 1, duration: T, ease: 'power1.out', immediateRender: false }, 0);
    tl.call(() => { o.onLand?.(); }, [], 0.62 * T);
    return { tl, state, rest, durationMs: T * 1000 };
  }

  const T = Math.max(0.05, o.tumbleTime / 1000);
  const spins = Math.max(1, Math.round(o.spinCount));
  // At least `spins` full turns AHEAD of the current pose — never a partial turn because the last roll left
  // the die past this face's angle.
  const endX = rest.rx + 360 * spins + (from.rx > rest.rx ? 360 : 0);
  const endY = rest.ry + 360 * (spins + 1) + (from.ry > rest.ry ? 360 : 0);
  const overX = o.settleBounce * 60;
  const overY = overX * 0.6;
  const hop = Math.max(0, o.hopHeight);

  // CUBE — tumble past the end, rock back, settle.
  tl.to(state, { rx: endX + overX, ry: endY + overY, duration: 0.74 * T, ease: EASE_TUMBLE }, 0);
  tl.to(state, { rx: endX - 0.35 * overX, ry: endY - 0.35 * overY, duration: 0.14 * T, ease: 'power1.inOut' }, 0.74 * T);
  tl.to(state, { rx: endX, ry: endY, duration: 0.12 * T, ease: 'power1.out' }, 0.88 * T);
  // HOP — rise, fall, contact squash, second hop, settle.
  tl.to(state, { z: hop, duration: 0.30 * T, ease: EASE_RISE }, 0);
  tl.to(state, { z: 0, duration: 0.32 * T, ease: EASE_FALL }, 0.30 * T);
  tl.fromTo(state, { scale: 1 + o.settleBounce * 0.25 }, { scale: 1, duration: 0.38 * T, ease: 'power1.out', immediateRender: false }, 0.62 * T);
  tl.to(state, { z: hop * o.settleBounce, duration: 0.18 * T, ease: 'power1.out' }, 0.62 * T);
  tl.to(state, { z: 0, duration: 0.20 * T, ease: 'power1.in' }, 0.80 * T);
  // YAW — one full turn plus the seeded rest angle, done by 0.80.
  tl.to(state, { yaw: 360 + o.restAngle, duration: 0.80 * T, ease: 'power2.out' }, 0);
  // LAND — first ground contact.
  tl.call(() => { o.onLand?.(); }, [], 0.62 * T);

  return { tl, state, rest, durationMs: T * 1000 };
}
