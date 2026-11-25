/**
 * The pack shop's small motion rules, pure (no Pixi, no DOM) so they are testable: the shake detector, the counter
 * line's rubber band, the price tag's swing, the hand's fan places and the resting breath. State objects are mutated in
 * place so a per-frame or per-event caller allocates nothing. `dt` is in 60 Hz frames.
 */
import { handPile } from './shopLayout';

// ---------------------------------------------------------------- shake to listen

/** A shake is this many direction changes ... */
export const SHAKE_CHANGES = 3;
/** ... within this long. */
export const SHAKE_WINDOW_MS = 400;
/** A move shorter than this (canvas px, per pointer event) has no direction: jitter never counts. */
export const SHAKE_MIN_STEP = 4;

export interface ShakeState { sx: number; sy: number; times: Float64Array; head: number; n: number }

export const newShake = (): ShakeState => ({ sx: 0, sy: 0, times: new Float64Array(SHAKE_CHANGES), head: 0, n: 0 });

export function resetShake(s: ShakeState): void {
  s.sx = 0; s.sy = 0; s.head = 0; s.n = 0;
}

/**
 * One pointer move of (`dx`, `dy`) at `nowMs`. A reversal on either axis is a direction change; true when the last
 * `SHAKE_CHANGES` changes all fall within `SHAKE_WINDOW_MS` (the history then starts over, so one shake fires once).
 */
export function stepShake(s: ShakeState, dx: number, dy: number, nowMs: number): boolean {
  let changed = false;
  if (Math.abs(dx) >= SHAKE_MIN_STEP) {
    const g = Math.sign(dx);
    if (s.sx !== 0 && g !== s.sx) changed = true;
    s.sx = g;
  }
  if (Math.abs(dy) >= SHAKE_MIN_STEP) {
    const g = Math.sign(dy);
    if (s.sy !== 0 && g !== s.sy) changed = true;
    s.sy = g;
  }
  if (!changed) return false;
  s.times[s.head] = nowMs;
  s.head = (s.head + 1) % SHAKE_CHANGES;
  if (s.n < SHAKE_CHANGES) s.n++;
  if (s.n < SHAKE_CHANGES) return false;
  const oldest = s.times[s.head]!; // the ring is full: the next write slot holds the oldest change
  if (nowMs - oldest > SHAKE_WINDOW_MS) return false;
  s.head = 0; s.n = 0;
  return true;
}

// ---------------------------------------------------------------- the counter line's rubber band

/** `y` below `lineY` pulled back toward the line: a soft limit that never goes more than `reach` past it. */
export function rubberY(y: number, lineY: number, reach: number): number {
  if (y <= lineY) return y;
  if (!(reach > 0)) return lineY;
  return lineY + reach * (1 - Math.exp(-(y - lineY) / reach));
}

// ---------------------------------------------------------------- the price tag's swing

/** The tag's spring (per frame^2), its damping (per frame), how hard the pack's acceleration pushes it, its limit. */
const SWING_K = 0.025;
const SWING_C = 0.14;
const SWING_PUSH = 0.9;
const SWING_MAX = 0.9;
const SWING_SETTLE = 1e-4;

/** The tag's angle (radians; positive = clockwise, its bottom swung left) and angular velocity. */
export interface Swing { a: number; v: number }

export const newSwing = (): Swing => ({ a: 0, v: 0 });

/**
 * Step the hanging tag by `dt` frames. `accel` is the pack's horizontal acceleration in pack heights per frame^2: the
 * tag's bottom lags behind it, then the damped spring settles it. False once it rests (snapped to exactly 0).
 */
export function stepSwing(s: Swing, accel: number, dt: number): boolean {
  const steps = Math.max(1, Math.ceil(dt));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.v += (-SWING_K * s.a - SWING_C * s.v + SWING_PUSH * accel) * h;
    s.a += s.v * h;
    if (s.a > SWING_MAX) { s.a = SWING_MAX; s.v = Math.min(0, s.v); }
    if (s.a < -SWING_MAX) { s.a = -SWING_MAX; s.v = Math.max(0, s.v); }
  }
  if (accel === 0 && Math.abs(s.a) < SWING_SETTLE && Math.abs(s.v) < SWING_SETTLE) { s.a = 0; s.v = 0; return false; }
  return true;
}

// ---------------------------------------------------------------- the hand

export interface HandFan { places: number; shown: number; piled: number }

/**
 * The hand's fan for `n` owned packs plus `reserve` places held for packs on their way in (a purchase): the fanned
 * packs, the piled ones and the number of places (`shopLayout.ts` `handPoseInto`'s `shown`, which counts the pile).
 * Allocates (via `handPile`): call it when the hand changes, not per frame.
 */
export function handFanInto(out: HandFan, n: number, reserve: number): HandFan {
  const p = handPile(Math.max(0, n) + Math.max(0, reserve));
  out.shown = p.shown;
  out.piled = p.piled;
  out.places = p.shown + (p.piled > 0 ? 1 : 0);
  return out;
}

// ---------------------------------------------------------------- the resting breath

/** A pack at rest grows and shrinks by this share of its size. */
export const BREATH_AMP = 0.01;
/** Radians per frame (about 3.3 s a breath) and the phase between neighbours. */
const BREATH_RATE = 0.032;
const BREATH_PHASE = 1.9;

/** The scale of a resting pack at offer `index`, `time` frames in. */
export function breathScale(time: number, index: number): number {
  return 1 + BREATH_AMP * Math.sin(time * BREATH_RATE + index * BREATH_PHASE);
}
