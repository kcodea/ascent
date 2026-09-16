import { FLAG_WARM, type FrameRing, type PerfBucket } from './perfMonitor';
import type { FrameThresholds } from './refreshRate';

/**
 * PERF LIVE — the pure half of the live monitor (owner ask 2026-09-15: *"a LIVE MONITORING screen … we're
 * seeing very poor performance and are currently BLIND to what's causing it"*).
 *
 * Everything the HUD draws is computed here from two inputs the monitor already keeps — the frame ring (the
 * last few thousand frames at frame resolution) and the 1 s buckets — so it can be unit-tested without a
 * browser, and so the HUD itself stays a thin drawing loop with no reasoning in it.
 *
 * ── The one ranking that matters: TOP OFFENDERS ─────────────────────────────────────────────────────────
 *
 * `hotspots` (the old HUD) ranks labels by their single worst call. That finds a one-off stall and misses
 * the thing the owner is actually feeling: a per-frame cost that is over budget EVERY frame. `topOffenders`
 * ranks by **self time inside frames that dropped** — `bucket.longAttrib`, which the monitor fills by
 * charging each long frame to the labels that ran inside it (self time, so a wrapper is not charged for
 * what it wraps). "fx:sim owned 71% of the long frames at 3.2 ms each" is the sentence that ends blindness.
 */

export interface RollingStats {
  frames: number;
  /** Frames in the window that were diverted by a warm-up (drawn shaded; excluded from the numbers below). */
  warm: number;
  worst: number;
  p95: number;
  long: number;
  jank: number;
  /** Frames over the per-frame budget (one refresh interval) — the strictest count, per §0. */
  overBudget: number;
}

/** Iterate the ring newest → oldest, stopping at `sinceT`. Shared by the stats and the columns. */
function* recent(ring: FrameRing, sinceT: number): Generator<number> {
  const size = ring.dt.length;
  if (size === 0) return;
  for (let k = 0; k < ring.n; k++) {
    const i = (ring.head - 1 - k + size * 2) % size;
    if (ring.t[i]! < sinceT) return;
    yield i;
  }
}

/** Frame stats over the frames presented since `sinceT` (ms on the monitor's clock). */
export function rollingStats(ring: FrameRing, sinceT: number, th: FrameThresholds): RollingStats {
  const dts: number[] = [];
  let warm = 0;
  for (const i of recent(ring, sinceT)) {
    if (ring.flag[i]! & FLAG_WARM) { warm++; continue; }
    dts.push(ring.dt[i]!);
  }
  const n = dts.length;
  if (n === 0) return { frames: 0, warm, worst: 0, p95: 0, long: 0, jank: 0, overBudget: 0 };
  dts.sort((a, b) => a - b);
  let long = 0;
  let jank = 0;
  let over = 0;
  for (const d of dts) {
    if (d > th.frameMs) over++;
    if (d > th.longFrameMs) long++;
    if (d > th.jankMs) jank++;
  }
  return {
    frames: n, warm,
    worst: dts[n - 1]!,
    p95: dts[Math.min(n - 1, Math.floor(n * 0.95))]!,
    long, jank, overBudget: over,
  };
}

/** One pixel column of the rolling graph. */
export interface GraphColumns {
  /** Worst frame that ENDED in the column's time slice, ms; 0 for an empty column. */
  max: Float32Array;
  /** 1 when any frame in the column was a warm-up frame. */
  warm: Uint8Array;
  /** The phase code of the newest frame in the column (0 = none). */
  phase: Uint8Array;
  /** 1 when any frame in the column was over the long threshold — the long-frame marker row. */
  long: Uint8Array;
}

/**
 * Fold the ring into `cols` time slices covering `[untilT - windowMs, untilT]`, newest on the right. A
 * frame lands in the column its END time falls in; a column keeps the worst frame it saw, so a single
 * dropped frame is never averaged away by its neighbours (the §0 rule, at pixel scale).
 */
export function graphColumns(ring: FrameRing, untilT: number, windowMs: number, cols: number, th: FrameThresholds): GraphColumns {
  const out: GraphColumns = { max: new Float32Array(cols), warm: new Uint8Array(cols), phase: new Uint8Array(cols), long: new Uint8Array(cols) };
  if (cols <= 0 || windowMs <= 0) return out;
  const sinceT = untilT - windowMs;
  const perCol = windowMs / cols;
  for (const i of recent(ring, sinceT)) {
    // Column c holds the frames that END in (sinceT + c·perCol, sinceT + (c+1)·perCol].
    const c = Math.min(cols - 1, Math.max(0, Math.ceil((ring.t[i]! - sinceT) / perCol) - 1));
    const dt = ring.dt[i]!;
    const flag = ring.flag[i]!;
    if (dt > out.max[c]!) out.max[c] = dt;
    if (flag & FLAG_WARM) out.warm[c] = 1;
    if (out.phase[c] === 0) out.phase[c] = flag >> 1; // newest first, so the first write wins
    if (dt > th.longFrameMs) out.long[c] = 1;
  }
  return out;
}

export interface Offender {
  label: string;
  /** Self time inside long frames, ms — the ranking key. */
  ms: number;
  /** Long frames this label ran in. */
  frames: number;
  /** `frames` as a share of every long frame in the window. */
  share: number;
  /** Self time per long frame it appeared in. */
  avgMs: number;
  /** The label's single worst call in the window (from `timings`), for the stall case. */
  maxMs: number;
  /** Calls in the window. */
  n: number;
}

/**
 * Labels ranked by how much of the dropped frames they own. `buckets` is whichever window the caller wants
 * — the last ten seconds or the whole capture; hidden buckets are skipped. Returns `[]` when nothing in
 * the window was over the long threshold, which the HUD prints as exactly that.
 */
export function topOffenders(buckets: readonly PerfBucket[], limit = 8): Offender[] {
  const acc = new Map<string, { ms: number; frames: number; maxMs: number; n: number }>();
  let longFrames = 0;
  for (const b of buckets) {
    if (b.hidden) continue;
    longFrames += b.long;
    for (const [label, v] of Object.entries(b.longAttrib ?? {})) {
      const cur = acc.get(label);
      if (cur) { cur.ms += v.ms; cur.frames += v.frames; }
      else acc.set(label, { ms: v.ms, frames: v.frames, maxMs: 0, n: 0 });
    }
  }
  if (acc.size === 0) return [];
  // The single-worst-call and call counts come from `timings`, which every bucket has.
  for (const b of buckets) {
    if (b.hidden) continue;
    for (const [label, t] of Object.entries(b.timings ?? {})) {
      const cur = acc.get(label);
      if (!cur) continue;
      cur.n += t.n;
      if (t.max > cur.maxMs) cur.maxMs = t.max;
    }
  }
  return [...acc.entries()]
    .map(([label, v]) => ({
      label,
      ms: +v.ms.toFixed(2),
      frames: v.frames,
      share: longFrames > 0 ? Math.min(1, v.frames / longFrames) : 0,
      avgMs: v.frames > 0 ? +(v.ms / v.frames).toFixed(2) : 0,
      maxMs: v.maxMs,
      n: v.n,
    }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit);
}

export interface CaptureStats { seconds: number; worst: number; p95: number; long: number; jank: number }

/** Whole-capture headline numbers, cheap enough to recompute once a second. `p95` is the median of the
 *  per-second p95s (the same reading `phaseBreakdown` gives), so one bad second does not define it. */
export function captureStats(buckets: readonly PerfBucket[]): CaptureStats {
  let worst = 0;
  let long = 0;
  let jank = 0;
  const p95s: number[] = [];
  let seconds = 0;
  for (const b of buckets) {
    if (b.hidden) continue;
    seconds++;
    if (b.worst > worst) worst = b.worst;
    long += b.long;
    jank += b.jank;
    p95s.push(b.p95);
  }
  p95s.sort((a, b) => a - b);
  return { seconds, worst, p95: p95s.length ? p95s[Math.floor(p95s.length / 2)]! : 0, long, jank };
}

/**
 * The peak of a counter across a window of buckets, and the phase it peaked in — "fx:particles peaked at
 * 2,340 during combat". Counters are per-bucket PEAKS already (see `sampleCounters`), so this is a max.
 */
export function counterPeak(buckets: readonly PerfBucket[], name: string): { peak: number; phase?: string } {
  let peak = 0;
  let phase: string | undefined;
  for (const b of buckets) {
    if (b.hidden) continue;
    const v = b.counts?.[name] ?? 0;
    if (v > peak) { peak = v; phase = b.phase; }
  }
  return { peak, phase };
}
