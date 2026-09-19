/**
 * REPLAY V2 — FREE-CURSOR capture (2026-09-19).
 *
 * The drag trace (`dragTrace.ts`) records the hand only while it holds a card. This records where the pointer
 * is the REST of the time on the recruit screen — hovering the shop, hesitating over the sell line, drifting
 * to End Turn — so the replay viewer can show a gauntlet moving the way the recorded player's did.
 *
 *   Recruit's pointermove (any, no capture)  → `sampleCursor(x, y, tMs)`   (throttled to ≤20 Hz internally)
 *   a round closes                            → `closeCursorWave()`          (simplify the open segment ONCE)
 *   run end                                   → `takeCursorTrail()`          (everything, thinned to the cap)
 *   a new run                                 → `resetCursorTrail(restored)` (fresh, or the resumed draft's)
 *
 * Perf: the hot path is one timestamp compare + one array push per pointermove — no layout reads, no
 * allocation beyond the sample tuple. Simplification (RDP over x/y, timestamps kept on the survivors) runs once
 * per ROUND on that round's samples, never per move, so memory stays bounded by a round's worth of raw samples
 * plus the simplified history. Identical consecutive positions (the pointer resting) collapse to the first and
 * the last of the rest, so a still hand costs two samples however long it rests.
 *
 * Samples are `[tMs, xFraction, yFraction]` on the replay clock (the caller supplies `tMs` — the clock lives in
 * the store with the frames' clock, so the two timelines are one timeline).
 */
import { CURSOR_SAMPLE_MS, CURSOR_TRAIL_MAX, thinCursorTrail, type CursorSample } from '@game/sim';
import { toFrac } from './dragTrace';

/** RDP perpendicular-distance epsilon in viewport-fraction units (~3 px at 1080p) — a hair tighter than the
 *  drag trace's, because a free hover has no drop point to anchor its meaning and reads worse when cut coarse. */
export const CURSOR_SIMPLIFY_EPS = 0.003;

type Pt = [number, number];

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.sqrt(len2);
}

/**
 * Simplify a sampled trail: Ramer–Douglas–Peucker over the x/y of each sample (near-collinear samples dropped
 * below `eps`), survivors keep their timestamps so playback interpolates between them on the clock. Endpoints
 * always kept. A rest (identical consecutive positions) is kept as its first and last sample only — RDP would
 * otherwise cut the rest's END, making playback drift off early. Pure — tested.
 */
export function simplifyCursorTrail(samples: readonly CursorSample[], eps = CURSOR_SIMPLIFY_EPS): CursorSample[] {
  if (samples.length <= 2) return samples.slice();
  // Pass 1 — collapse rests to their endpoints.
  const rested: CursorSample[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const prev = rested[rested.length - 1];
    const prev2 = rested[rested.length - 2];
    if (prev && prev2 && prev[1] === s[1] && prev[2] === s[2] && prev2[1] === s[1] && prev2[2] === s[2]) {
      rested[rested.length - 1] = s; // extend the rest's end
      continue;
    }
    rested.push(s);
  }
  if (rested.length <= 2) return rested;
  // Pass 2 — RDP over position, iterative (a long round can be thousands of samples).
  const keep = new Array<boolean>(rested.length).fill(false);
  keep[0] = true;
  keep[rested.length - 1] = true;
  const pt = (s: CursorSample): Pt => [s[1], s[2]];
  const stack: [number, number][] = [[0, rested.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    let maxD = -1;
    let maxI = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDist(pt(rested[i]!), pt(rested[lo]!), pt(rested[hi]!));
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > eps && maxI > 0) {
      keep[maxI] = true;
      stack.push([lo, maxI], [maxI, hi]);
    }
  }
  // Rest endpoints survive RDP by construction? Not necessarily — a rest's two samples are collinear with their
  // neighbours when the hand paused mid-line. Pin them explicitly: a pause is the one thing worth keeping.
  for (let i = 1; i < rested.length; i++) {
    const a = rested[i - 1]!, b = rested[i]!;
    if (a[1] === b[1] && a[2] === b[2]) { keep[i - 1] = true; keep[i] = true; }
  }
  return rested.filter((_, i) => keep[i]);
}

// ── Module state ──────────────────────────────────────────────────────────────────────────────────────────
/** Simplified samples of every CLOSED round, in clock order. */
let history: CursorSample[] = [];
/** Raw samples of the round in progress. */
let open: CursorSample[] = [];
let lastSampleAt = -Infinity;

const vw = (): number => (typeof window !== 'undefined' && window.innerWidth) || 1;
const vh = (): number => (typeof window !== 'undefined' && window.innerHeight) || 1;

/** Start (or restart) the trail: empty for a new run, or seeded with a resumed draft's restored samples. */
export function resetCursorTrail(restored: readonly CursorSample[] = []): void {
  history = restored.slice();
  open = [];
  lastSampleAt = -Infinity;
}

/** Record one pointer position at `tMs` on the replay clock — throttled to `CURSOR_SAMPLE_MS` internally, so
 *  it is safe to call from every pointermove. `x`/`y` are client pixels; stored as viewport fractions. */
export function sampleCursor(x: number, y: number, tMs: number): void {
  if (tMs - lastSampleAt < CURSOR_SAMPLE_MS) return;
  lastSampleAt = tMs;
  open.push([Math.round(tMs), toFrac(x, vw()), toFrac(y, vh())]);
}

/** A round closed: simplify its raw samples ONCE and fold them into the history. */
export function closeCursorWave(): void {
  if (open.length === 0) return;
  history.push(...simplifyCursorTrail(open));
  open = [];
}

/** The whole trail so far (closed rounds simplified + the open round as-is), thinned to the run cap. Does not
 *  clear — the run-end assembly reads it synchronously, and the next run's `resetCursorTrail` clears. */
export function takeCursorTrail(max = CURSOR_TRAIL_MAX): CursorSample[] {
  const all = open.length ? [...history, ...simplifyCursorTrail(open)] : history;
  return thinCursorTrail(all, max);
}

/** Shift every recorded sample along the clock (a resume splices the restored history in front). */
export function shiftCursorTrail(offsetMs: number): void {
  if (!offsetMs) return;
  history = history.map((s) => [s[0] + offsetMs, s[1], s[2]]);
  open = open.map((s) => [s[0] + offsetMs, s[1], s[2]]);
  lastSampleAt += offsetMs;
}

/** Test hook: the raw sample count of the round in progress. */
export function openCursorSampleCount(): number {
  return open.length;
}

// DEV convenience (mirrors `__startReplay`): read the live run's cursor trail from the console to hand-build a
// ReplayV2 for the viewer. Stripped from production builds.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __cursorTrail?: typeof takeCursorTrail }).__cursorTrail = takeCursorTrail;
}
