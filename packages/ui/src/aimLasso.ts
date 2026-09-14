/**
 * AIM LASSO — the motion model behind the Hero Aim targeting line (see `aimFxConfig.ts` / `pixiFx.setAimLine`).
 *
 * The old aim line was a fixed quadratic bow with a clock-based sine wobble: alive, but it never reacted to
 * how you actually moved the cursor. This module makes it a "glowing magic lasso" — a chain of control points
 * strung between the source (pinned) and the cursor (pinned) that LAGS, whips and settles as the cursor moves,
 * with a perpendicular sway whose amplitude grows with cursor speed.
 *
 * It is deliberately PURE and DOM-free so the physics is unit-testable headless (no Pixi, no rAF): the caller
 * (`pixiFx`) owns the Graphics, the clock, and the cursor-velocity sampling, and just asks this for the polyline
 * to stroke each frame.
 *
 * The model, per interior point i at parameter t_i ∈ (0,1):
 *   • REST = a point on the per-aim base bow (a quadratic Bézier from→ctl→to, `ctl` the random arch), plus a
 *     perpendicular SWAY wave enveloped by sin(π·t) so both ends stay pinned. The sway amplitude is
 *     `swayAmp · (1 + speed·motionInfluence)` — idle gives a gentle bob, fast motion a pronounced sway.
 *   • Each point springs TOWARD its rest with inertia (`springStiffness` pulls, `springDamping` bleeds
 *     velocity). Because the rest shifts the instant the cursor (and thus the whole bow) moves, the points lag
 *     behind and overshoot — the organic whip. Under-damping leaves a little bounce; that is the life.
 *
 * Endpoints are never integrated — they are clamped to `from`/`to` every step, so the ribbon always touches the
 * diamond and the cursor exactly.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** The knobs this model reads. A subset of `AimFxConfig`, passed through so the tuner drives it live. */
export interface AimLassoCfg {
  /** Number of segments; the polyline has `segments + 1` points (endpoints included). */
  segments: number;
  /** Base arch as a fraction of the aim's length (the bow's depth before sway/spring). */
  curve: number;
  /** Per-aim randomness on the arch amplitude (0 = the same bow every aim, 1 = ±100%). */
  curveVar: number;
  /** Spring pull toward rest, in 1/s². Higher = snappier, tracks the cursor more tightly. */
  springStiffness: number;
  /** Velocity damping, in 1/s. Lower = more whip/bounce; near `2·√stiffness` is critically damped. */
  springDamping: number;
  /** Perpendicular sway amplitude at rest, in px (before the motion boost). */
  swayAmp: number;
  /** Sway waves along the ribbon's length. */
  swayFreq: number;
  /** Sway cycles per second (the idle bob's tempo). */
  swaySpeed: number;
  /** How much cursor speed (px/s) scales the sway amplitude: `amp · (1 + speed · motionInfluence)`. */
  motionInfluence: number;
}

/** Live state for one aim gesture. Opaque to callers beyond `create`/`step`; carries the per-aim random roll. */
export interface AimLassoState {
  /** Interior point positions, i = 1 … segments-1 (endpoints are not stored — they are `from`/`to`). */
  pos: Vec2[];
  /** Per-point velocity, same indexing as `pos`. */
  vel: Vec2[];
  /** Bow direction for this aim (±1) — which side the base arch bends to. */
  side: number;
  /** Per-aim arch amplitude factor (≈0.5–1.5), so no two aims bow identically. */
  amp: number;
  /** Per-aim phase offset so the sway is not synchronised across successive aims. */
  seed: number;
}

/** dt is clamped to this many seconds so a stalled tab (a huge frame gap) can't explode the springs. */
const MAX_DT = 1 / 30;

/**
 * How much stiffer the CURSOR end is than the source end. A targeting line's business end must track the
 * pointer ~exactly (no visible drag right at the cursor), while the body is free to lag and whip. So the
 * spring stiffness ramps from `1×` at the source (t=0) to `1 + CURSOR_GRIP×` at the cursor (t=1); damping
 * scales by its square root so the tightened end stays critically-ish damped rather than buzzing. Endpoints
 * themselves are always pinned exactly — this governs the interior points NEAR each end.
 */
const CURSOR_GRIP = 14;

const bezier = (a: number, c: number, b: number, t: number): number => {
  const mt = 1 - t;
  return mt * mt * a + 2 * mt * t * c + t * t * b;
};

/** The rest point for parameter `t`, given the aim's geometry and the current sway phase/amplitude. */
function restAt(
  t: number, from: Vec2, to: Vec2, perp: Vec2, ctl: Vec2, timeS: number, swayScale: number,
  cfg: AimLassoCfg, seed: number,
): Vec2 {
  const bx = bezier(from.x, ctl.x, to.x, t);
  const by = bezier(from.y, ctl.y, to.y, t);
  // sin(π·t) pins both ends (t=0 and t=1 → 0), so sway only lives in the middle.
  const env = Math.sin(Math.PI * t);
  const wave = Math.sin(t * cfg.swayFreq * Math.PI * 2 + timeS * cfg.swaySpeed * Math.PI * 2 + seed);
  const w = wave * cfg.swayAmp * swayScale * env;
  return { x: bx + perp.x * w, y: by + perp.y * w };
}

/** Geometry shared by `create` and `step`: chord length, unit perpendicular, and the bow control point. */
function geometry(from: Vec2, to: Vec2, side: number, amp: number, cfg: AimLassoCfg): { len: number; perp: Vec2; ctl: Vec2 } {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const perp = { x: -dy / len, y: dx / len };
  const bow = len * cfg.curve * 0.5 * side * amp;
  const ctl = { x: (from.x + to.x) / 2 + perp.x * bow, y: (from.y + to.y) / 2 + perp.y * bow };
  return { len, perp, ctl };
}

/** Start a new aim: seed the random arch and settle every interior point ONTO its rest (zero velocity), so the
 *  first frame reads as a clean bow rather than a chain snapping into place from the origin. */
export function createLassoState(from: Vec2, to: Vec2, cfg: AimLassoCfg, rng: () => number = Math.random): AimLassoState {
  const side = rng() < 0.5 ? -1 : 1;
  const amp = 1 + (rng() - 0.5) * 2 * cfg.curveVar; // 1 when curveVar 0; ±curveVar spread otherwise
  const seed = rng() * 1000;
  const { perp, ctl } = geometry(from, to, side, amp, cfg);
  const n = Math.max(1, Math.floor(cfg.segments));
  const pos: Vec2[] = [];
  const vel: Vec2[] = [];
  for (let i = 1; i < n; i++) {
    // Seed at rest with zero sway (swayScale 0) — the bob eases in over the first frames rather than popping.
    const r = restAt(i / n, from, to, perp, ctl, 0, 0, cfg, seed);
    pos.push({ x: r.x, y: r.y });
    vel.push({ x: 0, y: 0 });
  }
  return { pos, vel, side, amp, seed };
}

/**
 * Advance the lasso one frame and return the full polyline to stroke: `[from, …interior, to]`, length
 * `segments + 1`. `speed` is the cursor's current px/s (the caller samples it from successive `to` positions);
 * `timeS` is a monotonic clock in seconds for the idle sway. `dt` is seconds since the last step.
 *
 * If `segments` changed since `create` (the tuner has a live slider), the interior array is resized in place so
 * the count always matches — new points are seeded at rest.
 */
export function stepLasso(
  state: AimLassoState, from: Vec2, to: Vec2, speed: number, dt: number, timeS: number, cfg: AimLassoCfg,
): Vec2[] {
  const n = Math.max(1, Math.floor(cfg.segments));
  resize(state, n, from, to, cfg);
  const h = Math.min(Math.max(dt, 0), MAX_DT);
  const { perp, ctl } = geometry(from, to, state.side, state.amp, cfg);
  const swayScale = 1 + Math.max(0, speed) * cfg.motionInfluence;
  const baseK = cfg.springStiffness;
  const baseC = cfg.springDamping;
  for (let idx = 0; idx < state.pos.length; idx++) {
    const t = (idx + 1) / n;
    const rest = restAt(t, from, to, perp, ctl, timeS, swayScale, cfg, state.seed);
    const p = state.pos[idx]!;
    const v = state.vel[idx]!;
    // Grip: stiffen toward the cursor end (t→1) so the near-cursor ribbon tracks the pointer ~exactly, while
    // the source end / middle keep the base spring and still whip. Damping scales by √grip to stay damped.
    const grip = 1 + CURSOR_GRIP * t * t;
    const k = baseK * grip;
    const c = baseC * Math.sqrt(grip);
    // Semi-implicit Euler: a = k·(rest − p) − c·v ; v += a·h ; p += v·h. Stable for the default k/c at 60fps,
    // and dt is clamped so a long frame can't overshoot into a blow-up.
    const ax = k * (rest.x - p.x) - c * v.x;
    const ay = k * (rest.y - p.y) - c * v.y;
    v.x += ax * h;
    v.y += ay * h;
    p.x += v.x * h;
    p.y += v.y * h;
  }
  const out: Vec2[] = [{ x: from.x, y: from.y }];
  for (const p of state.pos) out.push({ x: p.x, y: p.y });
  out.push({ x: to.x, y: to.y });
  return out;
}

/** Grow/shrink the interior arrays to `n-1` points when the segment count changes live. New points seed at rest. */
function resize(state: AimLassoState, n: number, from: Vec2, to: Vec2, cfg: AimLassoCfg): void {
  const want = Math.max(0, n - 1);
  if (state.pos.length === want) return;
  const { perp, ctl } = geometry(from, to, state.side, state.amp, cfg);
  while (state.pos.length < want) {
    const i = state.pos.length + 1;
    const r = restAt(i / n, from, to, perp, ctl, 0, 0, cfg, state.seed);
    state.pos.push({ x: r.x, y: r.y });
    state.vel.push({ x: 0, y: 0 });
  }
  if (state.pos.length > want) {
    state.pos.length = want;
    state.vel.length = want;
  }
}
