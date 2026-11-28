/**
 * The pack shop's small motion rules, pure (no Pixi, no DOM) so they are testable: the shake detector, the counter
 * line's rubber band, the price tag's swing, the hand's fan places and when the hidden scene sleeps. State objects are
 * mutated in place so a per-frame or per-event caller allocates nothing. `dt` is in 60 Hz frames.
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

// ---------------------------------------------------------------- the hidden scene

/**
 * Whether the scene may sleep this frame: it is hidden (faded all the way out and meant to stay out, as under the
 * opener) and no Aether is in flight. Then nothing on it can be seen, so the ticker stops (the stage's dust and the
 * shelf's idle light included) until `setVisible(true)` or another call wakes it.
 */
export function hiddenAsleep(fadeAlpha: number, fadeTo: number, aetherInFlight: number): boolean {
  return fadeAlpha <= 0 && fadeTo <= 0 && aetherInFlight <= 0;
}

// ---------------------------------------------------------------- hit tests and the carry's small decisions

/**
 * Whether (px, py) lies inside a `w` x `h` rectangle centred on (cx, cy) and rotated by `rot` radians (as Pixi rotates a
 * view: positive is clockwise on a y-down canvas). The point is turned back into the rectangle's own frame; no
 * allocation.
 */
export function inRotatedRect(px: number, py: number, cx: number, cy: number, w: number, h: number, rot: number): boolean {
  const dx = px - cx, dy = py - cy;
  const c = Math.cos(-rot), s = Math.sin(-rot);
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
}

/**
 * Whether a pack that reaches the pedestal stays parked there: only when it is arriving from a play (`toPedestal`) and
 * the scene was not shown again meanwhile (`shownAgain`: `setVisible(true)` landed during the travel, so the handoff is
 * already over and the shelf must come back).
 */
export function parksOnArrival(phase: string, shownAgain: boolean): boolean {
  return phase === 'toPedestal' && !shownAgain;
}

/**
 * Whether hand place `j` (of `places`) is hidden because a bought pack is on its way into it: the shell has already
 * grown the hand (`n` > `buyN`, the hand's size when the purchase was dropped) while the purchase waits (`buying`) or
 * travels in (`toHand`), so the travelling pack is drawn in its place instead. The bought pack is the fan's last place.
 */
export function arrivingPlaceHidden(phase: string, n: number, buyN: number, j: number, places: number): boolean {
  return (phase === 'buying' || phase === 'toHand') && n > buyN && j === places - 1;
}

// ---------------------------------------------------------------- the carried pack's dive

/** `v` with a dead zone of `dead` taken off its magnitude: 0 inside it, continuous at its edge (no step in the dive). */
export function softDead(v: number, dead: number): number {
  const a = Math.abs(v) - dead;
  return a > 0 ? (v < 0 ? -a : a) : 0;
}

/**
 * THE POINTER'S VELOCITY, measured from the pointer's own samples (coalesced events, with their timestamps), not from
 * how far the pack happened to move between two frames: pointer events land unevenly against frames (two in one
 * frame, none in the next), and a per-frame difference turns that into a shiver in the dive. `vx` / `vy` are px per 60 Hz
 * frame, low-passed with a time constant of `VEL_TAU_MS`.
 */
export interface PointerVel { x: number; y: number; t: number; vx: number; vy: number }
const FRAME_MS = 1000 / 60;
const VEL_TAU_MS = 40;
/** No sample for longer than this and the pointer is taken to be slowing to a stop ... */
const VEL_GRACE_MS = 34;
/** ... over this time constant. */
const VEL_STOP_TAU_MS = 40;

export const newPointerVel = (): PointerVel => ({ x: 0, y: 0, t: 0, vx: 0, vy: 0 });

/** Start measuring from rest at (x, y), time `t` (ms). */
export function resetPointerVel(p: PointerVel, x: number, y: number, t: number): void {
  p.x = x; p.y = y; p.t = t; p.vx = 0; p.vy = 0;
}

/** One pointer sample at (x, y), time `t` (ms). A sample at the same (or an earlier) time only moves the position. */
export function samplePointerVel(p: PointerVel, x: number, y: number, t: number): void {
  const dt = t - p.t;
  if (dt > 0) {
    const a = 1 - Math.exp(-dt / VEL_TAU_MS);
    p.vx += (((x - p.x) / dt) * FRAME_MS - p.vx) * a;
    p.vy += (((y - p.y) / dt) * FRAME_MS - p.vy) * a;
    p.t = t;
  }
  p.x = x; p.y = y;
}

/** What share of the measured velocity still holds at `now` (ms): 1 while samples keep arriving, falling to 0 after. */
export function pointerVelDecay(p: PointerVel, now: number): number {
  const age = now - p.t - VEL_GRACE_MS;
  return age <= 0 ? 1 : Math.exp(-age / VEL_STOP_TAU_MS);
}

// ---------------------------------------------------------------- a returned pack sits down

/** How long a returned pack's settle lasts (60 Hz frames) and how deep it dips (its own heights). */
export const SETTLE_FRAMES = 16;
export const SETTLE_DEPTH = 0.022;

/** The settle's dip at progress `u` (0..1): a smooth bob, 0 with no kink at either end and 1 in the middle. */
export function settleDip(u: number): number {
  if (!(u > 0) || u >= 1) return 0;
  const s = Math.sin(Math.PI * u);
  return s * s;
}

// ---------------------------------------------------------------- the hand's views, keyed by pack

/**
 * Bind the first `count` packs of `hand` (their fan places) to the hand's pool of views, KEYED BY PACK: a pack already
 * on a view keeps it (so it keeps its own motion and glides to its new place), a view whose pack left the fan is freed,
 * and a pack new to the fan takes a free view and is marked in `fresh`. Writes `placeView` (place -> view, -1 past
 * `count`). Allocates nothing. True when any binding changed.
 */
export function bindFan(
  viewId: (string | null)[], placeView: Int32Array, fresh: Uint8Array, hand: readonly { packId: string }[], count: number,
): boolean {
  const views = viewId.length;
  const n = Math.min(count, hand.length, views, placeView.length);
  let used = 0, changed = false;
  placeView.fill(-1);
  for (let j = 0; j < n; j++) {
    const id = hand[j]!.packId;
    for (let v = 0; v < views; v++) if (!(used & (1 << v)) && viewId[v] === id) { placeView[j] = v; used |= 1 << v; break; }
  }
  for (let v = 0; v < views; v++) if (!(used & (1 << v)) && viewId[v] !== null) { viewId[v] = null; changed = true; }
  for (let j = 0; j < n; j++) {
    if (placeView[j] !== -1) continue;
    for (let v = 0; v < views; v++) {
      if (used & (1 << v)) continue;
      viewId[v] = hand[j]!.packId; fresh[v] = 1; used |= 1 << v; placeView[j] = v; changed = true;
      break;
    }
  }
  return changed;
}

/**
 * A hand that grew by more than one pack at once (a box bought): the new packs arrive one after another, `step` apart
 * from `now` (any clock), in hand order. Writes each new pack's arrival into `out` and returns how many were staggered
 * (0 for a single new pack, which simply arrives). Allocates nothing beyond `out`'s entries; call it on a hand change.
 */
export function staggerArrivals(
  prev: ReadonlySet<string>, next: readonly { packId: string }[], now: number, step: number, out: Map<string, number>,
): number {
  let fresh = 0;
  for (const p of next) if (!prev.has(p.packId)) fresh++;
  if (fresh < 2) return 0;
  let k = 0;
  for (const p of next) if (!prev.has(p.packId)) out.set(p.packId, now + step * k++);
  return k;
}
