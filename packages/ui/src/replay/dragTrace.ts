/**
 * REPLAY V2 — drag-path capture (owner ask 2026-08-19: "1:1 hands").
 *
 * Records the pointer path of a REAL card drag (shop→board buy, hand→board play, board reorder, board→sell,
 * shop/hand reorder) so the replay viewer can play a ghost of the card travelling the same path over the
 * same duration. The lifecycle mirrors the drag itself:
 *
 *   pointerdown  → `beginDragTrace(cardId, x, y)`       (resets any previous trace)
 *   pointermove  → `sampleDragTrace(x, y)`              (throttled to ~30 Hz internally — call freely)
 *   pointerup    → `endDragTrace(x, y)`                 (drop point appended; path simplified + parked)
 *   a click / cancelled spell → `cancelDragTrace()`
 *
 * The parked path is then consumed by the store's frame capture (`takeDragTrace`, take-and-clear) when the
 * drop's action commits — within the same tick for every drop path, and ~260 ms later for the magnetic-merge
 * slide. A path older than `DRAG_TRACE_STALE_MS` is discarded on take, so an aborted drag (snap-back, spell
 * miss) can never mislabel a later unrelated action of the same type.
 *
 * Perf: capture is the product (DEV and prod alike), so it must be invisible on the drag hot path — one
 * timestamp compare + at most one array push per pointermove, no layout reads, no allocation beyond the
 * point tuples. Simplification runs ONCE, at pointerup.
 *
 * Points are stored as VIEWPORT FRACTIONS ([0..1] of window width/height, 3-decimal precision) so a replay
 * watched at another resolution still tracks the fullscreen anchored layout.
 */
import type { DragPath } from '@game/sim';

/** Minimum ms between recorded move samples (~30 Hz). */
export const DRAG_SAMPLE_MS = 33;
/** RDP perpendicular-distance epsilon, in viewport-fraction units (~4 px at 1080p). */
export const DRAG_SIMPLIFY_EPS = 0.004;
/** Hard cap on points per recorded path (a long meandering drag downsamples, endpoints kept). */
export const DRAG_MAX_PTS = 120;
/** A parked path older than this on take is an aborted drag — discarded, never attached. */
export const DRAG_TRACE_STALE_MS = 300;

/** The action types a drop dispatches — the only causes a DragPath may attach to. */
export const DRAG_CAUSES: ReadonlySet<string> = new Set([
  'buy', 'play', 'sell', 'reposition', 'reorderShop', 'reorderHand',
]);

type Pt = [number, number];

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const vw = (): number => (typeof window !== 'undefined' && window.innerWidth) || 1;
const vh = (): number => (typeof window !== 'undefined' && window.innerHeight) || 1;

/** Round to the stored 3-decimal precision, clamped into [0,1] (a drag can leave the window edge). */
export const toFrac = (v: number, span: number): number =>
  Math.round(Math.max(0, Math.min(1, span ? v / span : 0)) * 1000) / 1000;

/** Perpendicular distance from `p` to the segment a→b (falls back to point distance when a === b). */
function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  // The standard RDP metric: distance to the line through the endpoints.
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.sqrt(len2);
}

/**
 * Simplify a sampled path: Ramer–Douglas–Peucker (near-collinear points dropped below `eps` perpendicular
 * distance), then a uniform downsample to `cap` points if still over. Endpoints (grab + drop) always kept.
 * Pure — tested.
 */
export function simplifyDragPath(pts: readonly Pt[], eps = DRAG_SIMPLIFY_EPS, cap = DRAG_MAX_PTS): Pt[] {
  if (pts.length <= 2) return pts.slice();
  // Iterative RDP (explicit stack — a 30 Hz drag can be thousands of points on a long think).
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    let maxD = -1;
    let maxI = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDist(pts[i]!, pts[lo]!, pts[hi]!);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > eps && maxI > 0) {
      keep[maxI] = true;
      stack.push([lo, maxI], [maxI, hi]);
    }
  }
  let out = pts.filter((_, i) => keep[i]);
  if (out.length > cap) {
    // Uniform downsample, endpoints pinned.
    const sampled: Pt[] = [];
    for (let i = 0; i < cap; i++) sampled.push(out[Math.round((i * (out.length - 1)) / (cap - 1))]!);
    out = sampled;
  }
  return out;
}

// ── Module state: one trace at a time (a drag is singular by construction) ────────────────────────────────
let tracing = false;
let traceCardId = '';
let traceStartAt = 0;
let lastSampleAt = 0;
let tracePts: Pt[] = [];
/** The finished, simplified path parked for the drop's action commit to take. */
let pending: { path: DragPath; at: number } | null = null;

/** Start tracing a drag: the grab point is the path's first sample. Resets any previous trace/parked path. */
export function beginDragTrace(cardId: string, x: number, y: number): void {
  tracing = true;
  traceCardId = cardId;
  traceStartAt = now();
  lastSampleAt = traceStartAt;
  tracePts = [[toFrac(x, vw()), toFrac(y, vh())]];
  pending = null;
}

/** Record one pointer position, throttled to ~30 Hz internally — safe to call per pointermove event. */
export function sampleDragTrace(x: number, y: number): void {
  if (!tracing) return;
  const t = now();
  if (t - lastSampleAt < DRAG_SAMPLE_MS) return;
  lastSampleAt = t;
  tracePts.push([toFrac(x, vw()), toFrac(y, vh())]);
}

/** Abort the trace (a plain click, a cancelled spell aim) — nothing is parked. */
export function cancelDragTrace(): void {
  tracing = false;
  tracePts = [];
  pending = null;
}

/**
 * Finish the trace at the drop point: simplify + park the path for the action commit to take. Returns the
 * parked path (or null when nothing was being traced / the path is degenerate).
 */
export function endDragTrace(x: number, y: number): DragPath | null {
  if (!tracing) return null;
  tracing = false;
  tracePts.push([toFrac(x, vw()), toFrac(y, vh())]);
  const pts = simplifyDragPath(tracePts);
  tracePts = [];
  if (pts.length < 2) return null; // a malformed/degenerate path never attaches (playback also skips these)
  const path: DragPath = { cardId: traceCardId, durMs: Math.max(0, Math.round(now() - traceStartAt)), pts };
  pending = { path, at: now() };
  return path;
}

/**
 * Take-and-clear the parked path — the frame-capture side. Returns null (and clears) when the park is older
 * than `DRAG_TRACE_STALE_MS`: the drop's dispatch lands within the same tick (or ~260 ms for the magnetic-
 * merge slide), so anything older is an aborted drag that must never label a later action. `atMs` is
 * injectable for tests.
 */
export function takeDragTrace(atMs = now()): DragPath | null {
  const p = pending;
  pending = null;
  if (!p) return null;
  return atMs - p.at <= DRAG_TRACE_STALE_MS ? p.path : null;
}
