/**
 * THE LOCATION REVEAL's clock: every moment and every curve, as pure numbers (no DOM, no GL), from the owner-approved
 * prototype (2026-11-24). Seconds are SIM seconds; `realOf` / `simOf` map them to the wall clock, which leans for an
 * instant on the landing and nowhere else (owner: "a bit too stop and go feeling" removed every freeze).
 *
 * The order: the crystal strains, shatters, and its heart sweeps ahead like a comet with pieces of the place pouring off
 * it (`T0`); it lands as the last piece does, and the wave welds the place and wakes its lights (`L`); the painting has
 * the stage to itself; the name and the announcer (`NAME`); the parchments drop open one after another (`POST`); a hold
 * to read them; then it fades onto hero select.
 */
export const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v));
export const seg = (t: number, a: number, b: number): number => clamp((t - a) / (b - a));
export const mix = (a: number, b: number, u: number): number => a + (b - a) * u;
export const outCubic = (u: number): number => 1 - (1 - u) ** 3;
export const inCubic = (u: number): number => u ** 3;
export const inOut = (u: number): number => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);
export const smoother = (u: number): number => u * u * u * (u * (u * 6 - 15) + 10);
/** A shove: nothing, a smooth peak of 1 at 1/k seconds, and away. */
export const kick = (x: number, k: number): number => (x <= 0 ? 0 : x * k * Math.exp(1 - x * k));

/** The stage's aspect (scene units: its height is 1). */
export const A = 16 / 9;
/** Where the gate holds its crystal (row 434 of 941, rankedGateTiming) and its size, in stage heights. */
export const GEM_Y = (434 - 470.5) / 941;
export const GEM_SIZE = 236 / 941;

/** The sim second the press starts on: the crystal is already formed and lit, so it strains for only a moment. */
export const START = 0.24;
/** The crystal shatters. */
export const T0 = 0.56;
/** The heart lands. */
export const L = 2.42;
/** The name rises and the announcer speaks. */
export const NAME = L + 1.05;
/** The first parchment drops; each next one `POST_GAP` later, open in `POST_IN`. */
export const POST = NAME + 2.0;
export const POST_GAP = 0.24;
export const POST_IN = 0.52;
/** How long every parchment is open before the fade. */
export const HOLD = 2.6;
export const postDone = (n: number): number => POST + Math.max(0, n - 1) * POST_GAP + POST_IN;
/**
 * LEAVING (owner 2026-11-24: "improve the transition into hero select ... make it fit the vibe and style"): the parchments
 * roll back up one after another, the name lifts away, and a wave from the landing point washes the world into hero select.
 */
export const outroAt = (n: number): number => postDone(n) + HOLD;
export const ROLL_STEP = 0.06;
export const ROLL = 0.36;
export const washAt = (n: number): number => outroAt(n) + 0.5;
export const WASH = 1.05;
export const simEnd = (n: number): number => washAt(n) + WASH + 0.05;
/** How far the leaving wave has spread, `far` being its furthest corner: past every corner when it is over. */
export const washR = (s: number, n: number, far: number): number => {
  const x = seg(s, washAt(n), washAt(n) + WASH);
  return x <= 0 ? -1 : (far + 0.4) * x * (0.55 + 0.45 * x * (2 - x)) ;
};
/** Seconds into the wash when its front reaches distance `r`. */
export const washReach = (r: number, n: number, far: number): number => {
  let lo = 0;
  let hi = WASH;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (washR(washAt(n) + m, n, far) < r) lo = m; else hi = m; }
  return hi;
};

/** The wave: where it is `u` seconds after the landing, and when it reaches distance `r`. Mirrored in the shaders. */
export const WR = 2.9;
export const WK = 1.45;
export const waveR = (u: number): number => (u <= 0 ? 0 : WR * (1 - Math.exp(-u * WK)));
export const waveAt = (r: number): number => -Math.log(Math.max(1 - r / WR, 0.02)) / WK;

// Sim time and wall time.
const DS = 1 / 2000;
const SMAX = 16;
const rateAt = (s: number): number => 1 - 0.38 * Math.exp(-(((s - L - 0.03) / 0.036) ** 2));
let table: Float64Array | null = null;
function realTable(): Float64Array {
  if (table) return table;
  const t = new Float64Array(Math.round(SMAX / DS) + 1);
  for (let i = 1; i < t.length; i++) t[i] = t[i - 1]! + DS / rateAt((i - 0.5) * DS);
  table = t;
  return t;
}
/** Wall seconds at sim second `s` (both from sim 0). */
export function realOf(s: number): number {
  const t = realTable();
  const x = clamp(s / DS, 0, t.length - 2);
  const i = Math.floor(x);
  return t[i]! + (t[i + 1]! - t[i]!) * (x - i);
}
/** The sim second at wall second `r`. */
export function simOf(r: number): number {
  const t = realTable();
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t[m]! <= r) lo = m; else hi = m;
  }
  return (lo + clamp((r - t[lo]!) / (t[hi]! - t[lo]!))) * DS;
}
/** The whole reveal, press to gone, in wall seconds. */
export const revealSeconds = (n: number): number => realOf(simEnd(n)) - realOf(START);

// Travel.
export const vel = (s: number): number => clamp(smoother(seg(s, T0 - 0.04, T0 + 0.65)) - smoother(seg(s, L - 0.06, L + 0.75)));
let dist: Float64Array | null = null;
/** How far the current has carried you by `s`. */
export function distAt(s: number): number {
  if (!dist) {
    dist = new Float64Array(1601);
    for (let i = 1; i < dist.length; i++) dist[i] = dist[i - 1]! + (0.07 + 3.3 * vel(i / 100)) * 0.01;
  }
  const x = clamp(s * 100, 0, dist.length - 2);
  const i = Math.floor(x);
  return dist[i]! + (dist[i + 1]! - dist[i]!) * (x - i);
}

export type Vec3 = [number, number, number];
/** The comet: the crystal's heart, from the gate to where it lands (scene units; mirrored in the shaders' `comet`). */
export function heartAt(s: number, vcx: number, vcy: number): Vec3 {
  const u = clamp((s - T0) / (L - T0));
  const e = u - (0.07 * Math.sin(Math.PI * 2 * u)) / Math.PI;
  const v = 1 - e;
  const a = v * v * v;
  const b = 3 * v * v * e;
  const c = 3 * v * e * e;
  const d = e * e * e;
  return [
    b * -0.46 + c * (vcx * 0.55 - 0.05) + d * vcx,
    a * GEM_Y + b * 0.24 + c * (vcy * 0.55 - 0.34) + d * vcy,
    -0.02 + Math.max(0, Math.sin(Math.PI * u)) ** 0.9,
  ];
}

// Parchments.
/** A parchment's size in stage heights. */
export const POSTER_W = 0.328;
export const POSTER_H = 0.445;
const POSTER_STEP = 0.345;
const POSTER_Y = 0.035;

export interface PosterRest {
  x: number;
  y: number;
  angle: number;
  scale: number;
  /** When it drops (sim seconds). */
  at: number;
}
/** Where parchment `i` of `n` hangs once it is still, and when it drops. The NAMES sit here and never move (owner
 *  2026-11-24: "in the full build dont have the tribe names move cause it looks janky"). */
export function posterRest(i: number, n: number): PosterRest {
  const k = i - (n - 1) / 2;
  return { x: k * POSTER_STEP, y: POSTER_Y + Math.abs(k) ** 1.6 * 0.016, angle: k * 0.03, scale: Math.abs(k) < 0.01 ? 1.05 : 1, at: POST + i * POST_GAP };
}
export interface PosterPose extends PosterRest {
  /** 0..1: the roll fades in, how far it has unrolled, the curl of its foot, its swing (signed), and its leaving. */
  enter: number;
  open: number;
  curl: number;
  sway: number;
  out: number;
}
export function posterPose(i: number, n: number, s: number): PosterPose {
  const r = posterRest(i, n);
  // It rolls back up, then the roll lifts away.
  const leave = outroAt(n) + i * ROLL_STEP;
  const shut = smoother(seg(s, leave, leave + ROLL));
  const out = smoother(seg(s, leave + ROLL * 0.72, leave + ROLL + 0.2));
  const u = seg(s, r.at, r.at + POST_IN);
  const enter = smoother(seg(s, r.at - 0.2, r.at + 0.02));
  const since = Math.max(0, s - r.at - POST_IN);
  const w = s - r.at - POST_IN * 0.55;
  const wind = (Math.sin(s * 1.05 + i * 0.8) * 0.01 + Math.sin(s * 0.47 + i * 1.9) * 0.006) * u;
  const swing = w > 0 ? (i % 2 ? -1 : 1) * 0.05 * Math.exp(-w * 1.9) * Math.sin(w * 5.4) : 0;
  return {
    ...r,
    y: r.y + Math.sin(s * 1.25 + i * 1.7) * 0.0028 * u - 0.07 * inCubic(out) - 0.03 * (1 - enter),
    angle: r.angle + Math.sin(s * 0.7 + i * 2.1) * 0.0035 * u,
    enter,
    out,
    open: u * u * (3 - 2 * u) * (1 - shut),
    curl: u <= 0.6 ? 0 : 0.02 * seg(u, 0.6, 1) * Math.exp(-since * 2.6) * (0.72 + 0.28 * Math.cos(since * 8)),
    sway: wind + swing,
  };
}
/** Parchment `i`'s name: in once it is open, away as it starts to roll up. 0..1. */
export function posterName(i: number, n: number, s: number): number {
  const at = posterRest(i, n).at;
  const leave = outroAt(n) + i * ROLL_STEP;
  return smoother(seg(s, at + POST_IN * 0.8, at + POST_IN + 0.34)) * (1 - smoother(seg(s, leave - 0.08, leave + 0.12)));
}

/** How much the words and parchments shrink so all of them fit a window showing only `w` x `h` stage heights (1 at 16:9;
 *  a wide window crops the stage's top and bottom, a narrow one its sides). */
export const fitOf = (w: number, h: number): number => Math.min(1, w / A, h);
