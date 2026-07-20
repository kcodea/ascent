/**
 * PERF MONITOR — the frame-time sampler behind the on-screen perf HUD (`PerfHud.tsx`).
 *
 * Exists because "it felt slow" is not actionable: by the time you notice a hitch it's over, and the
 * expensive part is guessing *what* caused it. This records a continuous, exportable timeline of frame
 * health **annotated with what the game was doing** — the phase, the wave, and every FX that fired — so a
 * spike can be attributed instead of theorised about.
 *
 * Design constraints, in priority order:
 *
 * 1. **It must not be the thing that's slow.** Disabled is genuinely zero cost: no rAF loop, no observers,
 *    no allocation, nothing registered. Enabled, the per-frame work is one `performance.now()` and a push
 *    onto a pre-sized ring buffer. Counters are peak-sampled at 20Hz (a few `.length` reads — see
 *    `sampleCounters`); percentiles and DOM/heap reads happen once per 1s bucket, off the frame path.
 * 2. **It must run in the PRODUCTION build.** `CLAUDE.md` is explicit that a slowness report is only
 *    trustworthy against the prod build — dev + StrictMode are far slower than what players run. So this is
 *    NOT `import.meta.env.DEV`-gated like the tuners; it ships, dormant, and is opted into with `?perf=1`
 *    or `localStorage.ascent.perf = '1'`. That is the whole point of it.
 * 3. **The log outlives the hitch.** Buckets accumulate for the length of a run and export as JSON.
 *
 * Sampling model: one rAF loop timestamps every frame. Frames are aggregated into **1-second buckets**
 * holding fps, median/p95/worst frame time, jank counts, the game context at the time, PEAK live FX counts, and
 * the marks that fired. The HUD reads the newest bucket; the log keeps them all (capped).
 *
 * A note on what the numbers mean: `requestAnimationFrame` is capped by the display's refresh rate, so 60
 * (or 120) fps is a CEILING, not a score — a steady 60 means "nothing is dropping frames", not "fast".
 * The signal to watch is **p95 / worst frame time and the jank counts**, which is why they're on the HUD
 * face rather than buried. Backgrounding the tab throttles rAF to near zero; those buckets are flagged
 * `hidden` and excluded from the summary so an alt-tab doesn't masquerade as a stall.
 */

/** A frame slower than this dropped at least one 60fps frame — the "not smooth" threshold. */
const LONG_FRAME_MS = 33;
/** A frame slow enough to read as a visible hitch rather than a stutter. */
const JANK_MS = 50;
/** Bucket width. 1s keeps the log readable over a full run without losing spikes (worst is kept per bucket). */
const BUCKET_MS = 1000;
/** ~40 min of buckets. Ring-buffered, so a long session drops its oldest rather than growing forever. */
const MAX_BUCKETS = 2400;
/** How often counters are sampled for their per-bucket PEAK. See `sampleCounters` for why not per bucket. */
const COUNTER_SAMPLE_MS = 50;
/** Frame timestamps per bucket. 1s at 120fps = 120; the cap only matters if rAF misbehaves. */
const MAX_FRAMES_PER_BUCKET = 256;

export interface PerfBucket {
  /** ms since monitoring started, at the bucket's end. */
  t: number;
  fps: number;
  /** Frame-time percentiles across the bucket, ms. `worst` is the single slowest frame. */
  med: number;
  p95: number;
  worst: number;
  /** Frames over LONG_FRAME_MS / JANK_MS in this bucket. */
  long: number;
  jank: number;
  /** Longest main-thread task in the bucket (PerformanceObserver 'longtask'), ms. 0 if unsupported. */
  task: number;
  /** Game context when the bucket closed — what makes a spike triageable. */
  phase?: string;
  wave?: number;
  /** PEAK live FX counts across the bucket, from whatever registered a counter (pixiFx). Peak, not a
   *  closing sample: short-lived objects (a 330ms weld ring) are invisible to a 1Hz sample. */
  counts: Record<string, number>;
  /** JS heap in MB (Chrome only; 0 elsewhere). */
  heapMb: number;
  /** DOM element count — catches leaks that show up as slow style recalc. */
  nodes: number;
  /** Marks fired during this bucket, `label` → count. Cheap annotation: "this happened here". */
  marks: Record<string, number>;
  /**
   * MEASURED work in this bucket, `label` → how long it actually took. Unlike `marks` (correlation), this
   * is direct attribution — the milliseconds are on the clock for that specific block of code.
   */
  timings: Record<string, { n: number; total: number; max: number }>;
  /** True if the tab was backgrounded (rAF throttled) — excluded from summaries. */
  hidden?: boolean;
}

type CounterFn = () => number;
type ContextFn = () => { phase?: string; wave?: number };

/** Frame-time stats for one bucket. Pure + exported so the maths is unit-testable — the sampler itself is
 *  rAF- and DOM-bound and can't be exercised headlessly. */
export function aggregateFrames(frameTimes: readonly number[], elapsedMs: number): {
  fps: number; med: number; p95: number; worst: number; long: number; jank: number;
} {
  const n = frameTimes.length;
  if (n === 0) return { fps: 0, med: 0, p95: 0, worst: 0, long: 0, jank: 0 };
  const sorted = [...frameTimes].sort((a, b) => a - b);
  let long = 0;
  let jank = 0;
  for (const f of sorted) {
    if (f > LONG_FRAME_MS) long++;
    if (f > JANK_MS) jank++;
  }
  return {
    fps: +((n / elapsedMs) * 1000).toFixed(1),
    med: +sorted[Math.floor(n / 2)]!.toFixed(2),
    p95: +sorted[Math.min(n - 1, Math.floor(n * 0.95))]!.toFixed(2),
    worst: +sorted[n - 1]!.toFixed(2),
    long, jank,
  };
}

export interface PerfSummary {
  buckets: number; spanSec: number; fpsMed: number; fpsMin: number;
  longFrames: number; jankFrames: number; worstFrame: number;
  worst: PerfBucket[]; markTotals: Record<string, number>; suspects: { mark: string; jank: number }[];
  /** MEASURED work, ranked by the single worst call — real attribution. Read this before `suspects`. */
  hotspots: { label: string; n: number; total: number; max: number }[];
  /** Total measured ms vs the wall clock. A LOW share means the time is going somewhere unmeasured —
   *  rendering, paint, GC — not to any instrumented block. That is a finding, not a gap. */
  measuredMs: number;
}

/**
 * Roll a timeline up into the bits you actually triage. Pure + exported for the same reason as above.
 *
 * Backgrounded buckets are dropped first — rAF is suspended in a hidden tab, so an alt-tab would otherwise
 * show up as a catastrophic stall. (Learned the hard way: the headless preview pane reports
 * `visibilityState: 'hidden'` and produces zero frames.)
 */
export function summarize(all: readonly PerfBucket[]): PerfSummary {
  const live = all.filter((b) => !b.hidden);
  const fps = live.map((b) => b.fps).sort((a, b) => a - b);
  const markTotals: Record<string, number> = {};
  // Jank co-occurrence: for each mark, the janky frames in buckets where it fired. This is CORRELATION —
  // several marks share a bucket and a bucket is a whole second — so it ranks what to look at first, it
  // does not identify a culprit. Named `suspects` for exactly that reason.
  const markJank: Record<string, number> = {};
  const acc = new Map<string, { n: number; total: number; max: number }>();
  for (const b of live) {
    for (const [k, v] of Object.entries(b.marks)) {
      markTotals[k] = (markTotals[k] ?? 0) + v;
      if (b.jank > 0) markJank[k] = (markJank[k] ?? 0) + b.jank;
    }
    for (const [k, v] of Object.entries(b.timings ?? {})) {
      const cur = acc.get(k);
      if (cur) { cur.n += v.n; cur.total += v.total; cur.max = Math.max(cur.max, v.max); }
      else acc.set(k, { n: v.n, total: v.total, max: v.max });
    }
  }
  // Ranked by MAX, not total: a hitch is one slow call, and a cheap thing called 10,000 times can out-total
  // the 58ms stall that actually dropped the frame.
  const hotspots = [...acc.entries()]
    .map(([label, v]) => ({ label, n: v.n, total: +v.total.toFixed(1), max: +v.max.toFixed(1) }))
    .sort((a, b) => b.max - a.max)
    .slice(0, 12);
  return {
    buckets: live.length,
    spanSec: live.length ? Math.round((live[live.length - 1]!.t - live[0]!.t) / 1000) : 0,
    fpsMed: fps.length ? +fps[Math.floor(fps.length / 2)]!.toFixed(1) : 0,
    fpsMin: fps.length ? fps[0]! : 0,
    longFrames: live.reduce((a, b) => a + b.long, 0),
    jankFrames: live.reduce((a, b) => a + b.jank, 0),
    worstFrame: live.reduce((a, b) => Math.max(a, b.worst), 0),
    worst: [...live].sort((a, b) => b.worst - a.worst).slice(0, 10),
    markTotals,
    suspects: Object.entries(markJank).map(([mark, jank]) => ({ mark, jank })).sort((a, b) => b.jank - a.jank).slice(0, 8),
    hotspots,
    measuredMs: +[...acc.values()].reduce((a, v) => a + v.total, 0).toFixed(1),
  };
}

class PerfMonitor {
  private running = false;
  private raf = 0;
  private t0 = 0;
  private lastFrame = 0;
  private bucketStart = 0;
  private hiddenDuringBucket = false;

  /** Pre-allocated so the per-frame path never grows an array. */
  private readonly frames = new Float32Array(MAX_FRAMES_PER_BUCKET);
  private nFrames = 0;
  private longestTask = 0;

  private readonly pendingMarks = new Map<string, number>();
  private readonly pendingTimings = new Map<string, { n: number; total: number; max: number }>();
  private readonly counters = new Map<string, CounterFn>();
  /** PEAK of each counter since the bucket opened — see `sampleCounters`. */
  private readonly counterPeak = new Map<string, number>();
  /** Per-bucket occurrence tallies from `count()` — rates, folded into `counts` when the bucket closes. */
  private readonly tallies = new Map<string, number>();
  private lastCounterSample = 0;
  private context: ContextFn = () => ({});
  private readonly buckets: PerfBucket[] = [];
  private observer: PerformanceObserver | null = null;
  private readonly listeners = new Set<(b: PerfBucket) => void>();

  /** Opted in via `?perf=1` (sticky — it writes the flag) or `localStorage.ascent.perf`. Checked once. */
  static enabledByFlag(): boolean {
    try {
      const q = new URLSearchParams(window.location.search).get('perf');
      if (q === '1') { localStorage.setItem('ascent.perf', '1'); return true; }
      if (q === '0') { localStorage.removeItem('ascent.perf'); return false; }
      return localStorage.getItem('ascent.perf') === '1';
    } catch { return false; }
  }

  get isRunning(): boolean { return this.running; }

  /** Register a live-count source, e.g. pixiFx's particle count. Read once per bucket, never per frame. */
  registerCounter(name: string, fn: CounterFn): void { this.counters.set(name, fn); }

  /**
   * Count an occurrence of `name` this bucket — for RATES rather than levels (React commits, input events).
   *
   * The gap this closes: every counter was a Pixi level and every measured span was sim work, so the whole
   * RENDERER was invisible. Two of the worst frames in the 2026-07-19 full-run capture had a long task and
   * no hotspot at all, because the cost was React — which nothing instrumented. A component re-rendering at
   * pointer rate now shows up as a number instead of requiring a code read.
   *
   * No-op when the monitor is off, so call sites need no guard.
   */
  count(name: string, n = 1): void {
    if (!this.running) return;
    this.tallies.set(name, (this.tallies.get(name) ?? 0) + n);
  }

  /** Register the game-context provider (phase / wave), so buckets carry what was happening. */
  registerContext(fn: ContextFn): void { this.context = fn; }

  /** Annotate the timeline: `perfMonitor.mark('weld')` when an FX fires. No-op when not running, so call
   *  sites don't need to guard. This is what turns "a spike at t=412s" into "a spike on 7 batched welds". */
  mark(label: string): void {
    if (!this.running) return;
    this.pendingMarks.set(label, (this.pendingMarks.get(label) ?? 0) + 1);
  }

  /**
   * Time a synchronous block and attribute its milliseconds to `label`. Returns whatever `fn` returns, so
   * it wraps an existing call without restructuring: `const next = perfMonitor.measure('reduce', () => …)`.
   *
   * This is the difference between knowing something happened and knowing what it cost. `mark()` only gives
   * correlation — and the first two real captures both put their worst frame in a bucket with NO marks at
   * all, because the only instrumented code was the FX layer, which kept turning out to be innocent.
   * Measured spans put the milliseconds directly on a named piece of code.
   *
   * When the monitor is off this is a bare passthrough (no clock reads), so hot paths can call it freely.
   */
  measure<T>(label: string, fn: () => T): T {
    if (!this.running) return fn();
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      const dt = performance.now() - t0;
      const prev = this.pendingTimings.get(label);
      if (prev) {
        prev.n++;
        prev.total += dt;
        if (dt > prev.max) prev.max = dt;
      } else {
        this.pendingTimings.set(label, { n: 1, total: dt, max: dt });
      }
    }
  }

  subscribe(fn: (b: PerfBucket) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(): void {
    if (this.running || typeof window === 'undefined') return;
    this.running = true;
    this.t0 = performance.now();
    this.lastFrame = this.t0;
    this.bucketStart = this.t0;
    // Long tasks are the strongest single signal for "the main thread blocked" — and they're attributed by
    // the browser, not inferred from frame gaps. Optional: not every engine implements the entry type.
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) this.longestTask = Math.max(this.longestTask, e.duration);
      });
      this.observer.observe({ entryTypes: ['longtask'] });
    } catch { this.observer = null; }
    document.addEventListener('visibilitychange', this.onVisibility);
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private readonly onVisibility = (): void => { if (document.hidden) this.hiddenDuringBucket = true; };

  /** Per-frame work: one clock read and one store, plus a counter sample at most every COUNTER_SAMPLE_MS. */
  private readonly tick = (now: number): void => {
    if (!this.running) return;
    if (this.nFrames < MAX_FRAMES_PER_BUCKET) this.frames[this.nFrames++] = now - this.lastFrame;
    this.lastFrame = now;
    if (now - this.lastCounterSample >= COUNTER_SAMPLE_MS) {
      this.lastCounterSample = now;
      this.sampleCounters();
    }
    if (now - this.bucketStart >= BUCKET_MS) this.closeBucket(now);
    this.raf = requestAnimationFrame(this.tick);
  };

  /**
   * Record each counter's PEAK across the bucket rather than its value at bucket close.
   *
   * Sampling once per second was worse than useless for anything short-lived: a weld ring lives 330ms, so
   * a 1Hz sample almost always lands between rings and reports 0. The first real capture showed
   * `weld rings: 0` in all 116 buckets — including ones where the weld FX fired six times — which reads as
   * "the effect never ran" when it ran constantly. A counter that confidently reports zero is worse than
   * no counter at all.
   *
   * 50ms gives ~20 samples/sec: enough to catch a 330ms effect several times over, while keeping this off
   * the true per-frame path (at 240Hz it runs on roughly 1 frame in 12). Counters are cheap `.length`
   * reads, so the cost is a rounding error either way — the sub-rate is about honesty, not expense.
   */
  private sampleCounters(): void {
    for (const [name, fn] of this.counters) {
      try {
        const v = fn();
        const prev = this.counterPeak.get(name);
        if (prev === undefined || v > prev) this.counterPeak.set(name, v);
      } catch { /* a counter must never break sampling */ }
    }
  }

  private closeBucket(now: number): void {
    const n = this.nFrames;
    const elapsed = now - this.bucketStart;
    this.bucketStart = now;
    this.nFrames = 0;
    const longestTask = this.longestTask;
    this.longestTask = 0;
    const hidden = this.hiddenDuringBucket || document.hidden;
    this.hiddenDuringBucket = false;

    const marks: Record<string, number> = {};
    for (const [k, v] of this.pendingMarks) marks[k] = v;
    this.pendingMarks.clear();
    const timings: Record<string, { n: number; total: number; max: number }> = {};
    for (const [k, v] of this.pendingTimings) {
      timings[k] = { n: v.n, total: +v.total.toFixed(2), max: +v.max.toFixed(2) };
    }
    this.pendingTimings.clear();

    if (n === 0) return; // no frames at all (fully throttled) — nothing meaningful to record

    // Percentiles over n <= 256 samples, once per second: negligible, and off the frame path.
    const stats = aggregateFrames(Array.from(this.frames.subarray(0, n)), elapsed);
    // PEAK across the bucket, not the value at close — see `sampleCounters`.
    this.sampleCounters(); // one final sample so a bucket is never empty
    const counts: Record<string, number> = {};
    for (const [name, v] of this.counterPeak) counts[name] = v;
    this.counterPeak.clear();
    for (const [name, v] of this.tallies) counts[name] = v; // rates (per bucket), alongside the peak levels
    this.tallies.clear();
    const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory;
    const ctx = this.context();

    const bucket: PerfBucket = {
      t: Math.round(now - this.t0),
      ...stats,
      task: +longestTask.toFixed(1),
      ...(ctx.phase !== undefined ? { phase: ctx.phase } : {}),
      ...(ctx.wave !== undefined ? { wave: ctx.wave } : {}),
      counts,
      heapMb: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : 0,
      nodes: document.getElementsByTagName('*').length,
      marks,
      timings,
      ...(hidden ? { hidden: true } : {}),
    };

    this.buckets.push(bucket);
    if (this.buckets.length > MAX_BUCKETS) this.buckets.shift();
    for (const fn of this.listeners) fn(bucket);
  }

  latest(): PerfBucket | null { return this.buckets[this.buckets.length - 1] ?? null; }
  history(): readonly PerfBucket[] { return this.buckets; }
  clear(): void { this.buckets.length = 0; }

  /** The rolled-up view of the whole timeline — see `summarize`. */
  summary(): PerfSummary { return summarize(this.buckets); }

  /** Download the whole timeline + summary as JSON, for triage after the fact. */
  exportLog(): void {
    const blob = new Blob(
      [JSON.stringify({
        exportedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        dpr: window.devicePixelRatio,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        thresholds: { longFrameMs: LONG_FRAME_MS, jankMs: JANK_MS, bucketMs: BUCKET_MS },
        summary: this.summary(),
        buckets: this.buckets,
      }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ascent-perf-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export const perfMonitor = new PerfMonitor();
export const perfEnabledByFlag = (): boolean => PerfMonitor.enabledByFlag();
export { LONG_FRAME_MS, JANK_MS };
