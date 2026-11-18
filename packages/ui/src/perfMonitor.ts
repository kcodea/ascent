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
 *
 * **`long` / `jank` are DERIVED from the measured display refresh**, not fixed milliseconds. They used to be
 * 33 ms and 50 ms, which are 60 Hz numbers in disguise: on the owner's 360 Hz display a frame drops at
 * ~2.8 ms, so `long` only counted after ~8 dropped frames and the HUD read clean while the game dropped
 * frames continuously. `refreshRate.ts` estimates the panel from the rAF cadence and
 * `thresholdsFor()` turns it into 2-frames / 3-frames (at 60 Hz that is exactly the old 33/50, so historic
 * logs stay comparable). Every bucket records the `hz` in force when it closed, because a `long` count is
 * uninterpretable without it. The target budget is in `docs/performance.md`.
 */

import {
  DEFAULT_REFRESH_HZ, estimateRefreshHz, initialRefreshState, nextRefreshState, thresholdsFor,
  type FrameThresholds, type RefreshState,
} from './refreshRate';
import { EVENT_RING_TYPES, EventRing, SpanRing, attributeLongTask, type EventAttribution } from './perfEventRing';

/** Bucket width. 1s keeps the log readable over a full run without losing spikes (worst is kept per bucket). */
const BUCKET_MS = 1000;
/** ~40 min of buckets. Ring-buffered, so a long session drops its oldest rather than growing forever. */
const MAX_BUCKETS = 2400;
/** How often counters are sampled for their per-bucket PEAK. See `sampleCounters` for why not per bucket. */
const COUNTER_SAMPLE_MS = 50;
/**
 * Frame intervals kept per bucket. Was 256 — another 60 Hz assumption: on a 360 Hz display a 1s bucket has
 * 360 frames, so the cap truncated the tail and `fps` topped out at 256 on hardware doing 360. 1024 covers
 * the whole plausible band (`MAX_REFRESH_HZ`) and costs 4 kB, allocated once — in `start()`, so the
 * disabled path pays nothing for it.
 */
const MAX_FRAMES_PER_BUCKET = 1024;
/**
 * DUTY-CYCLED SAMPLING (R-PERF-MONITOR-DUTY-01, perf pass 2026-11-18).
 *
 * The sampler used to hold a `requestAnimationFrame` loop for the whole session, in every build. Its own work per
 * frame is tiny; what it COST was not: a pending rAF makes the browser produce a main frame on every display frame,
 * and on each one every running CSS animation is updated on the main thread (`docs/performance.md` 3o: 200 to 345 ms
 * of main-thread work a second on an idle shop, against 13 to 38 with the loops parked). So the game paid for every
 * keyword aura on the board, every frame, just so the monitor could time frames in which nothing happened.
 *
 * Now the frame loop runs only while there is something to measure:
 *   - for `ACTIVE_HOLD_MS` after any input event, mark, measured span or recorded render (so every action, drag,
 *     hover, FX and store commit is sampled, starting with the frame the work itself lands in);
 *   - through every fight (the phase is `combat`) and every warm-up;
 *   - for `HEARTBEAT_MS` every `HEARTBEAT_EVERY_MS` of an otherwise idle screen, so idle frame health still gets a
 *     sample (about one second in ten);
 *   - always, while something asked for it (`setContinuous`: the HUD, the phone perf log, `?perf=1`).
 * Parked, it holds one timer a second (bucket bookkeeping, counter peaks) and its observers: `longtask` and
 * `long-animation-frame` entries cost nothing until a hitch happens, and a hitch is still recorded while parked.
 *
 * WHAT CHANGES IN THE DATA. A bucket is written only for a second in which frames were sampled, so an idle stretch
 * leaves a gap in `t` (still wall-clock ms) instead of a row per second. Marks, timings and long tasks from a second
 * with no sampled frames are carried into the next bucket, never dropped. A bucket the sampler was parked for part of
 * carries `sampledMs`, and its `fps` is frames over that span (not over the whole second), so a half-sampled second
 * does not read as half the frame rate. `nodes` / `nodesBy` are refreshed on idle time (see `NODE_COUNT_EVERY_MS`)
 * and repeated in between. Every field keeps its name and meaning.
 */
/** How long the frame loop keeps running after the last sign of activity. */
export const ACTIVE_HOLD_MS = 2000;
/** An idle screen is sampled for `HEARTBEAT_MS` every `HEARTBEAT_EVERY_MS`. */
export const HEARTBEAT_EVERY_MS = 10_000;
export const HEARTBEAT_MS = 1000;
/**
 * The DOM census (`nodes`, `nodesBy`: a full-document element count plus a `querySelectorAll` and a descendant count
 * per container) ran at every bucket close, once a second. It now runs on idle time, when the phase or wave changes
 * and otherwise at most this often; buckets in between repeat the last count. A leak still shows as a climb, at this
 * grain instead of per second.
 */
export const NODE_COUNT_EVERY_MS = 15_000;
/** Should the frame loop be running? Pure, exported for its test. `nowMs` and `activeUntilMs` share a clock. */
export function shouldSampleFrames(a: { continuous: boolean; warming: boolean; inCombat: boolean; nowMs: number; activeUntilMs: number }): boolean {
  return a.continuous || a.warming || a.inCombat || a.nowMs < a.activeUntilMs;
}

/** Frames a single warm-up can hold. A warm-up ends after `frames` presented frames once its `ms` has also
 *  elapsed; 4096 covers a 10 s warm-up at 360 Hz, which is far past anything worth configuring. */
const MAX_WARMUP_FRAMES = 4096;

/**
 * WARM-UP (owner report 2026-09-15: *"Performance always spikes when a game starts, which destroys the graph
 * — delay the capture slightly so the initial spike doesn't wreck it."*)
 *
 * After any PHASE START (monitor start, run start, shop open, combat start, Runeforge open — see
 * `perfWarmup.ts`) frames are diverted into a separate STARTUP record until BOTH limits have passed: at
 * least `ms` of wall clock AND at least `frames` presented frames. Two limits because either alone misreads a
 * common case: a frame count alone ends early on a fast panel (120 frames is half a second at 240 Hz) and a
 * time limit alone can expire while the tab is throttled and no frames have been presented at all. The
 * default is "the later of 2 s or 120 frames" (owner spec).
 *
 * The spike is RECORDED, not dropped — `startups()` keeps every warm-up's own worst / p95 / long / jank and
 * measured timings, and the export carries them — it is just excluded from the buckets that drive the graph
 * and the verdict, so a capture answers "how does the game PLAY" rather than "how does the shop open".
 */
export interface WarmupConfig { ms: number; frames: number }
export const DEFAULT_WARMUP: WarmupConfig = { ms: 2000, frames: 120 };
const WARMUP_KEY = 'ascent.perf.warmup';

/** One phase start's diverted spike — the "startup" bucket, kept apart from the main timeline. */
export interface PerfStartup {
  /** ms since monitoring started, when the warm-up began. */
  t: number;
  /** What started it — `run`, `shop`, `combat`, `runeforge`, `start` (the monitor itself). */
  reason: string;
  phase?: string;
  wave?: number;
  /** Frames diverted and the wall clock they spanned. */
  frames: number;
  ms: number;
  worst: number;
  p95: number;
  long: number;
  jank: number;
  hz: number;
  /** Measured spans that landed inside the warm-up — the shader link, the first `layout:flip`, … */
  timings: Record<string, { n: number; total: number; max: number }>;
  /** Wall clock the tab spent HIDDEN inside this warm-up (2026-09-30). rAF does not run in a background tab, so
   *  the first frame back used to carry the whole absence as one "frame" (the 18,280 ms `start` spike in the
   *  owner's 33-minute capture); those intervals are left out of `worst` / `p95` and reported here instead. */
  hiddenMs?: number;
}

/** The live warm-up state, for the HUD. `remainingMs` / `framesLeft` are what still has to elapse. */
export interface WarmupState { active: boolean; reason: string; remainingMs: number; framesLeft: number }

/**
 * THE FRAME RING — the last `RING_FRAMES` presented frames at FRAME resolution, for the live monitor's
 * rolling graph. The 1 s buckets are the right grain for a 40-minute log and the wrong one for "what just
 * happened": a 10 s window of per-second worst bars is ten bars. 4096 frames is 11 s at 360 Hz, 17 s at 240,
 * and costs 52 kB, allocated once in `start()`. Per frame it is three typed-array stores.
 *
 * Read in place by the HUD (no copy): `head` is the NEXT slot to write, so the newest frame is `head - 1`.
 * `flag` carries whether the frame was diverted by a warm-up (bit 0) and the phase it was presented in
 * (`PHASE_CODES`, bits 1+), so the graph can shade warm-ups and draw the phase strip without a lookup.
 */
export const RING_FRAMES = 4096;
export const FLAG_WARM = 1;
/** Phase → small code for `FrameRing.flag`. Unknown is 0. */
export const PHASE_CODES: Record<string, number> = { recruit: 1, combat: 2, runeforge: 3, gameover: 4, victory: 4 };
export interface FrameRing {
  dt: Float32Array;
  t: Float64Array;
  flag: Uint8Array;
  head: number;
  /** Frames written so far, capped at the ring size. */
  n: number;
}

/** The thresholds in force. Re-derived when the refresh estimate moves; read once per bucket close, never
 *  per frame. Exposed through `perfThresholds()` so consumers (the HUD) can't cache a stale copy. */
let thresholds: FrameThresholds = thresholdsFor(DEFAULT_REFRESH_HZ);
/** The derived frame thresholds currently in force, and the refresh they came from. */
export const perfThresholds = (): FrameThresholds => thresholds;

/** One label's measured work in a bucket. `self` excludes nested spans (see `measure`); older logs lack it. */
export interface PerfSpan { n: number; total: number; max: number; self?: number }

export interface PerfBucket {
  /** ms since monitoring started, at the bucket's end. */
  t: number;
  fps: number;
  /** Frame-time percentiles across the bucket, ms. `worst` is the single slowest frame. */
  med: number;
  p95: number;
  worst: number;
  /** Frames over the derived long / jank thresholds in this bucket — see `hz`. */
  long: number;
  jank: number;
  /** The display refresh (Hz) detected when this bucket closed, and therefore the calibration its `long`
   *  and `jank` counts were measured against. Without it those counts cannot be read back. */
  hz: number;
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
  timings: Record<string, PerfSpan>;
  /**
   * WHO OWNED THE LONG FRAMES. For every frame over the long threshold, each label's SELF time inside that
   * frame and the number of long frames it appeared in — the attribution behind the live monitor's
   * top-offenders list. Self time (a span minus the spans it nested) is what makes a `store:set` that wraps
   * a `reduce:…` not double-count. Absent on logs from before it existed.
   */
  longAttrib?: Record<string, { ms: number; frames: number }>;
  /** True if the tab was backgrounded (rAF throttled) — excluded from summaries. */
  hidden?: boolean;
  /** Present when the frame sampler was PARKED for part of this second (R-PERF-MONITOR-DUTY-01): the ms of it that
   *  were sampled. `fps` is then frames over this span, and the frame stats describe only it. */
  sampledMs?: number;
  /** Frames this second that were DIVERTED to a startup record by the warm-up (see `WarmupConfig`). The
   *  bucket's own stats cover only the frames that counted; this says how much of the second was warming up. */
  warmup?: number;
  /**
   * THE LONG TASKS THEMSELVES (the worst few this second), each with the labels that ran inside it — or, when
   * NO label was open, the last DOM event dispatched before it (see `perfEventRing.ts`). `task` above is the
   * longest one's duration; this is what it was. Absent on logs from before it existed.
   */
  longTasks?: PerfLongTask[];
  /** DOM element count INSIDE each registered container (`setDomContainers`) plus `other`, so a climbing
   *  `nodes` can be laid at a row's door rather than at the whole document's. Absent on older logs. */
  nodesBy?: Record<string, number>;
}

/** One attributed long task — see `PerfBucket.longTasks`. */
export interface PerfLongTask {
  /** ms since monitoring started, at the task's START. */
  t: number;
  ms: number;
  /** Measured labels whose spans overlapped the task, most recent last. Empty = UNLABELLED. */
  labels: string[];
  /** Set only when `labels` is empty: the newest input event at or before the task's end. */
  lastEvent?: EventAttribution;
}

/** Long tasks kept per bucket — the worst few, by duration. */
const MAX_LONG_TASKS_PER_BUCKET = 3;
/** Labels charged for what `layout:read-in-move` counts: a layout read that happens while one of these
 *  spans is open is a read inside a pointer-move path. `drag:flushMove` is the drag's rAF-coalesced move
 *  handler and predates the `input:` family; it counts the same way. */
const isInputLabel = (label: string): boolean => label.startsWith('input:') || label === 'drag:flushMove';

type CounterFn = () => number;
/** `overlay` names a phase-like state that is not a `RunState.phase` — the Runeforge — for the phase strip. */
type ContextFn = () => { phase?: string; wave?: number; overlay?: string };

/** Frame-time stats for one bucket. Pure + exported so the maths is unit-testable — the sampler itself is
 *  rAF- and DOM-bound and can't be exercised headlessly. `th` defaults to the 60 Hz calibration so the
 *  function stays total for callers that have no display context (tests, replaying an old log). */
export function aggregateFrames(
  frameTimes: readonly number[],
  elapsedMs: number,
  th: FrameThresholds = thresholdsFor(DEFAULT_REFRESH_HZ),
): {
  fps: number; med: number; p95: number; worst: number; long: number; jank: number;
} {
  const n = frameTimes.length;
  if (n === 0) return { fps: 0, med: 0, p95: 0, worst: 0, long: 0, jank: 0 };
  const sorted = [...frameTimes].sort((a, b) => a - b);
  let long = 0;
  let jank = 0;
  for (const f of sorted) {
    if (f > th.longFrameMs) long++;
    if (f > th.jankMs) jank++;
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

  // ── Duty cycle (R-PERF-MONITOR-DUTY-01; see `ACTIVE_HOLD_MS`) ──────────────────────────────────────────────
  /** Something asked for every frame (the HUD, the phone perf log, `?perf=1`). */
  private continuousAsks = 0;
  /** The rAF loop is live. False = parked on `parkTimer`. */
  private sampling = false;
  private parkTimer: ReturnType<typeof setTimeout> | null = null;
  /** Sample until this time (`performance.now()` clock). */
  private activeUntil = 0;
  /** Activity was noted since the last tick: the tick turns it into `activeUntil` (no clock read at the call site). */
  private activity = false;
  private lastHeartbeat = 0;
  /** The next tick is the first after a wake: its interval started at the wake, not at a display frame. */
  private wakeFrame = false;
  /** The sampler was parked for part of the open bucket, and the ms of it that frames covered. */
  private bucketPartial = false;
  private bucketSampledMs = 0;
  /** The last DOM census, repeated on buckets until the next one (see `NODE_COUNT_EVERY_MS`). */
  private nodeCount = 0;
  private nodeCountBy: Record<string, number> | undefined;
  private nodeCountAt = -Infinity;
  private nodeCountKey = '';
  private nodeCountPending = false;

  /** Pre-allocated on `start()` so the per-frame path never grows an array — and so the DISABLED path
   *  allocates nothing at all. (It used to be a field initializer, so the buffer was built at module load
   *  whether or not anyone opted in; at the new 1024 capacity that would be 4 kB for nothing.) */
  private frames = new Float32Array(0);
  private nFrames = 0;
  private longestTask = 0;

  private readonly pendingMarks = new Map<string, number>();
  private readonly pendingTimings = new Map<string, { n: number; total: number; max: number; self: number }>();
  /** The open-span stack behind `begin` / `end` / `measure`: label, start time, and the CHILD time each open
   *  span has accumulated so far (what makes self time possible). Three parallel arrays, no per-span object. */
  private readonly spanLabel: string[] = [];
  private readonly spanT0: number[] = [];
  private readonly childMs: number[] = [];
  /** Self time per label since the LAST rAF tick — folded into `longAttrib` when that frame turns out long. */
  private readonly frameSelf = new Map<string, number>();
  /**
   * LONG-TASK ATTRIBUTION. A `longtask` entry is delivered AFTER the task ends, when the span stack is empty
   * again — so "snapshot the stack" has to be "remember what closed recently": a ring of closed spans (label,
   * start, end) that a task's `[startTime, startTime + duration]` is intersected against. When nothing
   * overlaps, the task ran with no instrumented code in it, and the event ring names the handler family
   * that was dispatching (the 2026-09-17 "Mode B" blind spot).
   */
  private readonly spans = new SpanRing(256);
  private readonly events = new EventRing(32);
  private readonly pendingLongTasks: PerfLongTask[] = [];
  /** Open `input:` spans (see `isInputLabel`) — while > 0, a layout read counts as `layout:read-in-move`. */
  private inputDepth = 0;
  /** Named containers whose node counts are taken at bucket close — see `perfDomContainers.ts`. */
  private domContainers: Readonly<Record<string, string>> = {};
  private readonly pendingLongAttrib = new Map<string, { ms: number; frames: number }>();
  private readonly counters = new Map<string, CounterFn>();
  /** PEAK of each counter since the bucket opened — see `sampleCounters`. */
  private readonly counterPeak = new Map<string, number>();
  /** Per-bucket occurrence tallies from `count()` — rates, folded into `counts` when the bucket closes. */
  private readonly tallies = new Map<string, number>();
  private lastCounterSample = 0;
  private context: ContextFn = () => ({});
  private readonly buckets: PerfBucket[] = [];
  private observer: PerformanceObserver | null = null;
  private loafObserver: PerformanceObserver | null = null;
  private readonly listeners = new Set<(b: PerfBucket) => void>();
  /** Running display-refresh estimate. Fed one window per bucket close — never per frame. */
  private refresh: RefreshState = initialRefreshState();

  // ── Warm-up (see `WarmupConfig`) ───────────────────────────────────────────────────────────────────────
  private warmupCfg: WarmupConfig = DEFAULT_WARMUP;
  /** The warm-up in progress, or null. Its frames live in `warmFrames` (pre-sized like `frames`). */
  private warm: {
    reason: string; startedAt: number; until: number; framesLeft: number;
    phase?: string; wave?: number;
    timings: Map<string, { n: number; total: number; max: number }>;
    /** Intervals that spanned a hidden tab — excluded from the frames, summed here. */
    hiddenMs: number;
  } | null = null;
  private warmFrames = new Float32Array(0);
  private nWarmFrames = 0;
  /** Frames diverted during the CURRENT bucket — stamped on the bucket as `warmup`. */
  private warmThisBucket = 0;
  private readonly startupList: PerfStartup[] = [];

  // ── The frame ring (see `FrameRing`) ───────────────────────────────────────────────────────────────────
  private ring: FrameRing = { dt: new Float32Array(0), t: new Float64Array(0), flag: new Uint8Array(0), head: 0, n: 0 };
  /** The phase code stamped on each frame — refreshed at bucket close and at every phase start, never per frame. */
  private phaseCode = 0;

  /**
   * Should the monitor be running?
   *
   * `?perf=1` (sticky — it writes the flag) or `localStorage.ascent.perf`, and since 2026-08-29 **on by
   * default in DEV clients** (owner ask: *"set it up so that the perf hud runs automatically in dev
   * clients"*).
   *
   * Auto-start is scoped to `import.meta.env.DEV` and nothing else. The production build still ships this
   * dormant, which is the guarantee this file opens with: recording is cheap but not free, and a diagnostic
   * that runs unasked is a cost every player pays for a tool only we use. A dev client is already paying
   * StrictMode and an unminified bundle — the sampler is noise beside that, and always-on is what makes a
   * regression turn up on its own instead of only when someone thought to look.
   *
   * `?perf=0` / removing the flag still wins in dev: the explicit OFF is honoured, so a dev measuring
   * something else can silence it. That is why the flag is read as a tri-state rather than a boolean.
   */
  static enabledByFlag(): boolean {
    try {
      const q = new URLSearchParams(window.location.search).get('perf');
      if (q === '1') { localStorage.setItem('ascent.perf', '1'); return true; }
      if (q === '0') { localStorage.setItem('ascent.perf', '0'); return false; }
      const flag = localStorage.getItem('ascent.perf');
      if (flag === '1') return true;
      if (flag === '0') return false;          // an explicit OFF beats the dev default
      return !!import.meta.env.DEV;            // no opinion stored → on in dev, off in prod
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

  private refreshPhaseCode(ctx: ReturnType<ContextFn>): void {
    this.phaseCode = PHASE_CODES[ctx.overlay ?? ctx.phase ?? ''] ?? 0;
  }

  /** The last frames at frame resolution — see `FrameRing`. Read in place; never mutate. */
  frameRing(): FrameRing { return this.ring; }

  /** Every registered counter's value RIGHT NOW — for the live strip. A handful of `.length` reads. */
  counterSnapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, fn] of this.counters) { try { out[name] = fn(); } catch { /* a counter must never break the HUD */ } }
    return out;
  }

  /** Annotate the timeline: `perfMonitor.mark('weld')` when an FX fires. No-op when not running, so call
   *  sites don't need to guard. This is what turns "a spike at t=412s" into "a spike on 7 batched welds". */
  mark(label: string): void {
    if (!this.running) return;
    this.noteActivity();
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
    this.begin(label);
    try {
      return fn();
    } finally {
      this.end();
    }
  }

  /**
   * Open a span without a callback — for brackets that start in one listener and end in another (the Pixi
   * ticker pass: `fx:tick` opens at HIGH priority and closes at UTILITY, with `fx:sim` and `fx:render`
   * nested inside it). Every `begin` needs its `end`; an unbalanced `end` is ignored, and `start()` clears
   * the stack so a monitor switched on mid-frame cannot inherit a half-open span. One branch when off.
   */
  begin(label: string): void {
    if (!this.running) return;
    // Every measured span is activity worth sampling frames around, EXCEPT the FX ticker's own per-frame brackets
    // (`fx:tick`, `fx:sim`, `fx:render`, `fx:def:<id>`): a looping effect would otherwise hold the frame loop awake for
    // as long as it lives. The FIRE of an effect is a `mark` (and usually a store commit), which does wake it.
    if (!label.startsWith('fx:')) this.noteActivity();
    this.spanLabel.push(label);
    this.spanT0.push(performance.now());
    this.childMs.push(0);
    if (isInputLabel(label)) this.inputDepth++;
  }

  end(): void {
    if (!this.running || this.spanLabel.length === 0) return;
    const now = performance.now();
    const t0 = this.spanT0.pop()!;
    const dt = now - t0;
    const label = this.spanLabel.pop()!;
    const child = this.childMs.pop()!;
    const depth = this.childMs.length;
    if (depth > 0) this.childMs[depth - 1]! += dt;
    if (isInputLabel(label) && this.inputDepth > 0) this.inputDepth--;
    this.rememberSpan(label, t0, now);
    // SELF time = the span minus what it nested. `store:set` wraps `reduce:<action>`; without this the
    // reducer's milliseconds would be charged twice and the offenders list would name the wrapper.
    this.recordSpan(label, dt, dt - child);
  }

  /**
   * Attribute a pre-measured duration to `label` — the same accumulator `measure()` feeds, for spans you can't
   * wrap in a single synchronous callback. The motivating case: React reconciliation + commit happens
   * asynchronously after `setState`, so it can't be timed with `measure()`; instead a component captures
   * `performance.now()` at the top of its render and records the delta in a post-commit `useLayoutEffect`.
   * No-op when the monitor is off.
   *
   * `self` defaults to the whole duration. Pass `0` for a BREAKDOWN of a span already recorded — the
   * `React.Profiler` children of `render:recruit` — so it shows in `timings` (n / total / max) without being
   * charged a second time in the dropped-frame attribution its parent already owns.
   */
  record(label: string, ms: number, self: number = ms): void {
    if (!this.running) return;
    this.noteActivity();
    const now = performance.now();
    this.rememberSpan(label, now - ms, now);
    this.recordSpan(label, ms, self);
  }

  /** A closed span into the attribution ring — three stores. */
  private rememberSpan(label: string, t0: number, t1: number): void { this.spans.push(label, t0, t1); }

  /**
   * A `longtask` entry arrived: name what ran inside it, or — when nothing instrumented did — the input event
   * that was being dispatched. Keeps the worst few per bucket. Exposed (not private) so the attribution can
   * be exercised without a real PerformanceObserver.
   */
  noteLongTask(startTime: number, duration: number): void {
    if (!this.running) return;
    const attrib = attributeLongTask(this.spans, this.events, startTime, startTime + duration);
    const task: PerfLongTask = { t: Math.round(startTime - this.t0), ms: +duration.toFixed(1), ...attrib };
    const list = this.pendingLongTasks;
    list.push(task);
    if (list.length > MAX_LONG_TASKS_PER_BUCKET) {
      list.sort((a, b) => b.ms - a.ms);
      list.length = MAX_LONG_TASKS_PER_BUCKET;
    }
  }

  /**
   * A long animation frame (> 50 ms) arrived — see the observer in `start()`. Its scripts over `LOAF_MIN_SCRIPT_MS`
   * become `loaf:<invoker type>:<function or invoker>` spans and its rendering tail becomes `loaf:style-layout-paint`,
   * all recorded as breakdowns (self 0) at their real times. Exposed for the tests.
   */
  noteLongAnimationFrame(e: LoafEntry): void {
    if (!this.running) return;
    const end = e.startTime + e.duration;
    for (const sc of e.scripts ?? []) {
      if (!(sc.duration >= LOAF_MIN_SCRIPT_MS)) continue;
      const label = loafScriptLabel(sc);
      this.rememberSpan(label, sc.startTime, sc.startTime + sc.duration);
      this.recordSpan(label, sc.duration, 0);
    }
    if (e.styleAndLayoutStart > 0 && e.styleAndLayoutStart < end) {
      const ms = end - e.styleAndLayoutStart;
      if (ms >= LOAF_MIN_SCRIPT_MS) {
        this.rememberSpan('loaf:style-layout-paint', e.styleAndLayoutStart, end);
        this.recordSpan('loaf:style-layout-paint', ms, 0);
      }
    }
  }

  /** One capture-phase listener for every `EVENT_RING_TYPES` type: one ring write, no clock read (the
   *  event carries its own `timeStamp` on the same clock as `performance.now()`). */
  private readonly onDomEvent = (e: Event): void => { this.events.push(e.type, e.target, e.timeStamp); this.noteActivity(); };

  // ── Duty cycle ─────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Ask for every frame (the HUD's rolling graph, the phone perf log, an explicit `?perf=1`), or give that back.
   * Counted, so two askers do not cancel each other. Safe before `start()`.
   */
  setContinuous(on: boolean): void {
    this.continuousAsks = Math.max(0, this.continuousAsks + (on ? 1 : -1));
    if (on && this.running) this.wake(0);
  }

  /** Is the frame loop live right now (false = parked)? For the tests and the dev readout. */
  get isSampling(): boolean { return this.sampling; }

  /** Something happened that frames should be sampled around. While the loop is live this is one store. */
  private noteActivity(): void {
    if (this.sampling) { this.activity = true; return; }
    this.wake(ACTIVE_HOLD_MS);
  }

  /** Start the frame loop (if parked) and keep it for at least `holdMs`. */
  private wake(holdMs: number): void {
    if (!this.running) return;
    const now = performance.now();
    if (now + holdMs > this.activeUntil) this.activeUntil = now + holdMs;
    if (this.sampling) return;
    this.sampling = true;
    if (this.parkTimer !== null) { clearTimeout(this.parkTimer); this.parkTimer = null; }
    // The interval of the first frame back starts HERE: the work that woke the loop runs between now and that frame,
    // so a slow action's own frame is still measured (see `wakeFrame` in `tick`).
    this.lastFrame = now;
    this.wakeFrame = true;
    this.bucketPartial = true;
    this.raf = requestAnimationFrame(this.tick);
  }

  private wantsFrames(now: number): boolean {
    return shouldSampleFrames({
      continuous: this.continuousAsks > 0, warming: this.warm !== null, inCombat: this.phaseCode === PHASE_CODES.combat,
      nowMs: now, activeUntilMs: this.activeUntil,
    });
  }

  /** Stop the frame loop; keep the buckets and the heartbeat on one timer. */
  private park(now: number): void {
    this.sampling = false;
    this.raf = 0;
    this.bucketPartial = true;
    this.lastHeartbeat = now; // frames were just sampled: the next idle sample is a full interval away
    this.armParkTimer(now);
  }

  private armParkTimer(now: number): void {
    const nextBucket = this.bucketStart + BUCKET_MS;
    const nextBeat = this.lastHeartbeat + HEARTBEAT_EVERY_MS;
    this.parkTimer = setTimeout(this.onParkTimer, Math.max(16, Math.min(nextBucket, nextBeat) - now));
  }

  private readonly onParkTimer = (): void => {
    this.parkTimer = null;
    if (!this.running || this.sampling) return;
    const now = performance.now();
    if (now - this.bucketStart >= BUCKET_MS) {
      // No frames to aggregate: `closeBucket` carries anything pending into the next sampled bucket. Counters still
      // get their peak sample, and the phase is re-read (a fight that starts with no mark must still be sampled).
      this.sampleCounters();
      this.closeBucket(now);
    }
    if (document.hidden) { this.armParkTimer(now); return; }
    if (now - this.lastHeartbeat >= HEARTBEAT_EVERY_MS) { this.lastHeartbeat = now; this.wake(HEARTBEAT_MS); return; }
    if (this.wantsFrames(now)) { this.wake(0); return; }
    this.armParkTimer(now);
  };

  /** Take the DOM census on idle time (never inside a frame the player is waiting on). */
  private scheduleNodeCount(): void {
    if (this.nodeCountPending) return;
    this.nodeCountPending = true;
    const run = (): void => {
      this.nodeCountPending = false;
      if (!this.running) return;
      this.takeNodeCount();
    };
    const ric = (globalThis as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') ric(run, { timeout: 3000 }); else setTimeout(run, 200);
  }

  private takeNodeCount(): void {
    const nodes = document.getElementsByTagName('*').length;
    // Per-container counts: a `querySelectorAll` per container and a `.length` read of each match's descendants.
    // The remainder is `other`. See `perfDomContainers.ts` for why the map is disjoint.
    let nodesBy: Record<string, number> | undefined;
    const containerNames = Object.keys(this.domContainers);
    if (containerNames.length > 0) {
      nodesBy = {};
      let inContainers = 0;
      for (const name of containerNames) {
        let count = 0;
        try {
          for (const el of document.querySelectorAll(this.domContainers[name]!)) count += 1 + el.getElementsByTagName('*').length;
        } catch { /* a bad selector must never break the sampler */ }
        nodesBy[name] = count;
        inContainers += count;
      }
      nodesBy.other = Math.max(0, nodes - inContainers);
    }
    this.nodeCount = nodes;
    this.nodeCountBy = nodesBy;
    this.nodeCountAt = performance.now();
  }

  /**
   * A layout read (`getBoundingClientRect`, `offsetLeft`, `elementFromPoint`) just happened — see
   * `layoutRead.ts`. Counted as `layout:read-in-move` ONLY while an `input:` span is open, because a read
   * inside a pointer-move handler after a style write is a forced synchronous reflow of the whole shop per
   * pointer event — the strongest lead for the 2026-09-17 "Mode B" spikes. PR 2 asserts this reads 0.
   */
  noteLayoutRead(): void {
    if (this.inputDepth > 0) this.count('layout:read-in-move');
  }

  /** Register the containers whose node counts are taken at bucket close (`PerfBucket.nodesBy`). */
  setDomContainers(map: Readonly<Record<string, string>>): void { this.domContainers = map; }

  private recordSpan(label: string, ms: number, self: number): void {
    // Inside a warm-up the span belongs to the startup record, so the main timeline's hotspots describe play
    // and the shader link / first layout pass are still attributed — just to the phase start that paid them.
    if (this.warm) {
      const prev = this.warm.timings.get(label);
      if (prev) { prev.n++; prev.total += ms; if (ms > prev.max) prev.max = ms; }
      else this.warm.timings.set(label, { n: 1, total: ms, max: ms });
      return;
    }
    const prev = this.pendingTimings.get(label);
    if (prev) {
      prev.n++;
      prev.total += ms;
      prev.self += self;
      if (ms > prev.max) prev.max = ms;
    } else {
      this.pendingTimings.set(label, { n: 1, total: ms, max: ms, self });
    }
    // Per-FRAME self time, so a long frame can be charged to what ran inside it (see `tick`).
    this.frameSelf.set(label, (this.frameSelf.get(label) ?? 0) + self);
  }

  // ── Warm-up ────────────────────────────────────────────────────────────────────────────────────────────

  /** The warm-up rule in force. Persisted (`ascent.perf.warmup`) so a tuned value survives a reload. */
  warmupConfig(): WarmupConfig { return this.warmupCfg; }
  setWarmup(cfg: Partial<WarmupConfig>): void {
    this.warmupCfg = {
      ms: Math.max(0, cfg.ms ?? this.warmupCfg.ms),
      frames: Math.max(0, Math.floor(cfg.frames ?? this.warmupCfg.frames)),
    };
    try { localStorage.setItem(WARMUP_KEY, JSON.stringify(this.warmupCfg)); } catch { /* storage unavailable */ }
  }
  private loadWarmupConfig(): void {
    try {
      const raw = localStorage.getItem(WARMUP_KEY);
      if (!raw) return;
      const v = JSON.parse(raw) as Partial<WarmupConfig>;
      if (typeof v.ms === 'number' && typeof v.frames === 'number') this.warmupCfg = { ms: Math.max(0, v.ms), frames: Math.max(0, v.frames) };
    } catch { /* keep the default */ }
  }

  /**
   * A phase just started: divert the coming frames to a startup record until the warm-up rule is satisfied.
   * A phase start DURING a warm-up closes the one in progress and starts afresh — combat opening two seconds
   * into a shop that itself just opened is two spikes, and both are kept. No-op when the monitor is off.
   */
  beginWarmup(reason: string): void {
    if (!this.running) return;
    const now = performance.now();
    if (this.warm) this.closeWarmup(now);
    const ctx = this.context();
    this.refreshPhaseCode(ctx);
    this.warm = {
      reason, startedAt: now,
      until: now + this.warmupCfg.ms,
      framesLeft: this.warmupCfg.frames,
      ...(ctx.phase !== undefined ? { phase: ctx.phase } : {}),
      ...(ctx.wave !== undefined ? { wave: ctx.wave } : {}),
      timings: new Map(),
      hiddenMs: 0,
    };
    this.nWarmFrames = 0;
    this.wake(0); // a warm-up is measured in frames: the loop runs until it closes (`wantsFrames`)
  }

  /** Close the warm-up into a `PerfStartup`. Frames it diverted are aggregated against the SAME thresholds
   *  as the main timeline, so its `long` / `jank` read the same way. */
  private closeWarmup(now: number): void {
    const w = this.warm;
    if (!w) return;
    this.warm = null;
    const n = this.nWarmFrames;
    this.nWarmFrames = 0;
    // A warm-up that saw no frames (a StrictMode start/stop/start, a stop() right after start()) is not a
    // spike; recording it would list a 0-frame "startup" at the top of every dev session.
    if (n === 0) return;
    const intervals = Array.from(this.warmFrames.subarray(0, n));
    // Warm-up frames are safe evidence for the refresh estimate — load can only LENGTHEN an interval, and the
    // estimator reads the low decile — and they are the first frames of the session, so without them the
    // opening startup record would be judged against the assumed 60 Hz calibration.
    if (n > 0 && !document.hidden) {
      this.refresh = nextRefreshState(this.refresh, estimateRefreshHz(intervals));
      thresholds = thresholdsFor(this.refresh.hz);
    }
    const stats = aggregateFrames(intervals, Math.max(1, now - w.startedAt), thresholds);
    const timings: PerfStartup['timings'] = {};
    for (const [k, v] of w.timings) timings[k] = { n: v.n, total: +v.total.toFixed(2), max: +v.max.toFixed(2) };
    this.startupList.push({
      t: Math.round(w.startedAt - this.t0),
      reason: w.reason,
      ...(w.phase !== undefined ? { phase: w.phase } : {}),
      ...(w.wave !== undefined ? { wave: w.wave } : {}),
      frames: n,
      ms: Math.round(now - w.startedAt),
      worst: stats.worst, p95: stats.p95, long: stats.long, jank: stats.jank,
      hz: thresholds.refreshHz,
      timings,
      ...(w.hiddenMs > 0 ? { hiddenMs: Math.round(w.hiddenMs) } : {}),
    });
    if (this.startupList.length > 200) this.startupList.shift();
  }

  /** Every phase start's diverted spike so far, oldest first. */
  startups(): readonly PerfStartup[] { return this.startupList; }

  /** Is a warm-up running right now, and how much of it is left? Read by the HUD once per redraw. */
  warmupState(): WarmupState {
    const w = this.warm;
    if (!w) return { active: false, reason: '', remainingMs: 0, framesLeft: 0 };
    return {
      active: true, reason: w.reason,
      remainingMs: Math.max(0, Math.round(w.until - performance.now())),
      framesLeft: Math.max(0, w.framesLeft),
    };
  }

  subscribe(fn: (b: PerfBucket) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(): void {
    if (this.running || typeof window === 'undefined') return;
    if (this.frames.length !== MAX_FRAMES_PER_BUCKET) this.frames = new Float32Array(MAX_FRAMES_PER_BUCKET);
    if (this.warmFrames.length !== MAX_WARMUP_FRAMES) this.warmFrames = new Float32Array(MAX_WARMUP_FRAMES);
    if (this.ring.dt.length !== RING_FRAMES) {
      this.ring = { dt: new Float32Array(RING_FRAMES), t: new Float64Array(RING_FRAMES), flag: new Uint8Array(RING_FRAMES), head: 0, n: 0 };
    } else {
      this.ring.head = 0;
      this.ring.n = 0;
    }
    this.loadWarmupConfig();
    this.running = true;
    this.nFrames = 0;
    this.warmThisBucket = 0;
    this.longestTask = 0;
    this.childMs.length = 0;
    this.spanLabel.length = 0;
    this.spanT0.length = 0;
    this.frameSelf.clear();
    this.pendingLongAttrib.clear();
    this.inputDepth = 0;
    this.spans.clear();
    this.events.clear();
    this.pendingLongTasks.length = 0;
    this.t0 = performance.now();
    this.lastFrame = this.t0;
    this.bucketStart = this.t0;
    this.hiddenSinceFrame = false;
    this.sampling = false;
    this.activity = false;
    this.activeUntil = this.t0 + ACTIVE_HOLD_MS;
    this.lastHeartbeat = this.t0;
    this.wakeFrame = false;
    this.bucketPartial = false;
    this.bucketSampledMs = 0;
    this.nodeCountAt = -Infinity;
    this.nodeCountKey = '';
    this.nodeCountPending = false;
    if (this.parkTimer !== null) { clearTimeout(this.parkTimer); this.parkTimer = null; }
    // The monitor's own start is a phase start: page load / module eval / first paint is the biggest spike
    // of all, and the one every capture used to open with.
    this.beginWarmup('start');
    // Long tasks are the strongest single signal for "the main thread blocked" — and they're attributed by
    // the browser, not inferred from frame gaps. Optional: not every engine implements the entry type.
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          this.longestTask = Math.max(this.longestTask, e.duration);
          this.noteLongTask(e.startTime, e.duration);
        }
      });
      this.observer.observe({ entryTypes: ['longtask'] });
    } catch { this.observer = null; }
    // LONG ANIMATION FRAMES (perf 2026-10-10): the owner's 2026-10-10 report was 94% unattributed, with 75-150 ms
    // long tasks that no label covered. The `long-animation-frame` entry (Chromium; frames over 50 ms) says what a
    // slow frame was made of: each script's invoker and function, plus how long style + layout + paint took. They
    // are recorded as `loaf:*` BREAKDOWN spans (self 0, so nothing is charged twice) and remembered in the
    // attribution ring, so a long task that overlaps one is named instead of blamed on the last pointermove.
    try {
      this.loafObserver = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) this.noteLongAnimationFrame(e as unknown as LoafEntry);
      });
      this.loafObserver.observe({ type: 'long-animation-frame', buffered: false });
    } catch { this.loafObserver = null; }
    document.addEventListener('visibilitychange', this.onVisibility);
    // The input-event ring (see `perfEventRing.ts`): capture phase, so the entry is written before any
    // handler runs; passive, so it can never delay scrolling. Only while the monitor runs.
    for (const type of EVENT_RING_TYPES) document.addEventListener(type, this.onDomEvent, { capture: true, passive: true });
    // `beginWarmup('start')` above already woke the frame loop. This is the fallback for a warm-up rule of zero.
    if (!this.sampling) { this.sampling = true; this.raf = requestAnimationFrame(this.tick); }
    this.wakeFrame = false; // the monitor's first frame is a real interval from `t0`, as it always was
    this.bucketPartial = false;
  }

  stop(): void {
    if (!this.running) return;
    if (this.warm) this.closeWarmup(performance.now());
    this.running = false;
    this.inputDepth = 0;
    cancelAnimationFrame(this.raf);
    this.sampling = false;
    if (this.parkTimer !== null) { clearTimeout(this.parkTimer); this.parkTimer = null; }
    this.observer?.disconnect();
    this.observer = null;
    this.loafObserver?.disconnect();
    this.loafObserver = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const type of EVENT_RING_TYPES) document.removeEventListener(type, this.onDomEvent, { capture: true });
  }

  /** Set when the tab goes hidden; the next frame's interval then spans the absence (see `PerfStartup.hiddenMs`). */
  private hiddenSinceFrame = false;
  private readonly onVisibility = (): void => {
    if (document.hidden) { this.hiddenDuringBucket = true; this.hiddenSinceFrame = true; }
  };

  /** Per-frame work: one clock read and one store, plus a counter sample at most every COUNTER_SAMPLE_MS. */
  private readonly tick = (now: number): void => {
    if (!this.running) return;
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    const w = this.warm;
    if (this.activity) { this.activity = false; if (now + ACTIVE_HOLD_MS > this.activeUntil) this.activeUntil = now + ACTIVE_HOLD_MS; }
    // THE FIRST FRAME AFTER A WAKE (R-PERF-MONITOR-DUTY-01). Its interval began at the wake (the input event, the
    // dispatch), not at the previous display frame, so it reads SHORT by up to one refresh interval. It is kept only
    // when it is a long frame anyway (the action that woke the loop was itself slow: exactly the frame worth having);
    // a short one would be a made-up fast frame, so it is left out of the ring, the bucket and the warm-up.
    const skipFrame = this.wakeFrame && !(dt > thresholds.longFrameMs);
    this.wakeFrame = false;
    const spannedHidden = this.hiddenSinceFrame;
    this.hiddenSinceFrame = false;
    if (skipFrame) {
      // not a measured interval: nothing is recorded
    } else {
    // The frame ring: three stores and a masked increment. See `FrameRing`.
    const r = this.ring;
    r.dt[r.head] = dt;
    r.t[r.head] = now;
    r.flag[r.head] = (w ? FLAG_WARM : 0) | (this.phaseCode << 1);
    r.head = (r.head + 1) & (RING_FRAMES - 1);
    if (r.n < RING_FRAMES) r.n++;
    }
    if (skipFrame) {
      // (see above)
    } else if (w && spannedHidden) {
      // The interval spans a hidden tab: no frame was dropped, the tab was away. Kept out of the record.
      w.hiddenMs += dt;
      this.warmThisBucket++;
      if (now >= w.until && w.framesLeft <= 0) this.closeWarmup(now);
    } else if (w) {
      // Warming up: the frame goes to the startup record, not the bucket. One extra branch per frame.
      if (this.nWarmFrames < this.warmFrames.length) this.warmFrames[this.nWarmFrames++] = dt;
      this.warmThisBucket++;
      w.framesLeft--;
      if (w.framesLeft <= 0 && now >= w.until) this.closeWarmup(now);
    } else if (this.nFrames < this.frames.length) {
      this.frames[this.nFrames++] = dt;
      this.bucketSampledMs += dt;
    }
    // ATTRIBUTE THE FRAME. Everything measured since the last tick ran inside the interval that just ended;
    // if that interval was a dropped frame, charge each label its self time. `frameSelf` is empty on the
    // overwhelming majority of frames, so this is one `.size` read per frame and a clear only when needed.
    if (this.frameSelf.size > 0) {
      if (!w && dt > thresholds.longFrameMs) {
        for (const [label, self] of this.frameSelf) {
          const cur = this.pendingLongAttrib.get(label);
          if (cur) { cur.ms += self; cur.frames++; }
          else this.pendingLongAttrib.set(label, { ms: self, frames: 1 });
        }
      }
      this.frameSelf.clear();
    }
    if (now - this.lastCounterSample >= COUNTER_SAMPLE_MS) {
      this.lastCounterSample = now;
      this.sampleCounters();
    }
    if (now - this.bucketStart >= BUCKET_MS) this.closeBucket(now);
    if (this.wantsFrames(now)) this.raf = requestAnimationFrame(this.tick);
    else this.park(now);
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
    const partial = this.bucketPartial;
    const sampledMs = this.bucketSampledMs;
    // `fps` is frames over the time they covered. A fully sampled second is the whole second, as before.
    const elapsed = partial && sampledMs > 0 ? sampledMs : now - this.bucketStart;
    this.bucketStart = now;
    this.nFrames = 0;
    this.bucketPartial = !this.sampling;
    this.bucketSampledMs = 0;
    const warmup = this.warmThisBucket;
    this.warmThisBucket = 0;
    // The phase is re-read every second, sampled or parked: `wantsFrames` keys on it (a fight is always sampled).
    const ctx = this.context();
    this.refreshPhaseCode(ctx);
    // NO FRAMES WERE SAMPLED this second and the sampler was parked for it (R-PERF-MONITOR-DUTY-01): there is no
    // bucket to write, and whatever is pending (marks, timings, long tasks, the longest task, counter peaks) is
    // CARRIED into the next bucket that has frames, never dropped. A warm-up-only second keeps its old path below.
    if (n === 0 && partial && warmup === 0) return;
    const longestTask = this.longestTask;
    this.longestTask = 0;
    const hidden = this.hiddenDuringBucket || document.hidden;
    this.hiddenDuringBucket = false;

    const marks: Record<string, number> = {};
    for (const [k, v] of this.pendingMarks) marks[k] = v;
    this.pendingMarks.clear();
    const timings: Record<string, PerfSpan> = {};
    for (const [k, v] of this.pendingTimings) {
      timings[k] = { n: v.n, total: +v.total.toFixed(2), max: +v.max.toFixed(2), self: +v.self.toFixed(2) };
    }
    this.pendingTimings.clear();
    let longAttrib: PerfBucket['longAttrib'];
    if (this.pendingLongAttrib.size > 0) {
      longAttrib = {};
      for (const [k, v] of this.pendingLongAttrib) longAttrib[k] = { ms: +v.ms.toFixed(2), frames: v.frames };
      this.pendingLongAttrib.clear();
    }
    let longTasks: PerfLongTask[] | undefined;
    if (this.pendingLongTasks.length > 0) {
      longTasks = [...this.pendingLongTasks].sort((a, b) => b.ms - a.ms);
      this.pendingLongTasks.length = 0;
    }

    if (n === 0) return; // no frames at all (fully throttled) — nothing meaningful to record

    const intervals = Array.from(this.frames.subarray(0, n));
    // Re-estimate the display refresh from this second's own intervals — no extra per-frame work, the
    // sampler already recorded them. A HIDDEN bucket is never fed in: a backgrounded tab throttles rAF to
    // near zero, which is the one input that could drag the estimate to the floor faster than the
    // "slower must be corroborated" rule can absorb it. `null` means "no evidence", and holds the estimate.
    if (!hidden) {
      this.refresh = nextRefreshState(this.refresh, estimateRefreshHz(intervals));
      thresholds = thresholdsFor(this.refresh.hz);
    }
    // Percentiles over n samples, once per second: negligible, and off the frame path.
    const stats = aggregateFrames(intervals, elapsed, thresholds);
    // PEAK across the bucket, not the value at close — see `sampleCounters`.
    this.sampleCounters(); // one final sample so a bucket is never empty
    const counts: Record<string, number> = {};
    for (const [name, v] of this.counterPeak) counts[name] = v;
    this.counterPeak.clear();
    for (const [name, v] of this.tallies) counts[name] = v; // rates (per bucket), alongside the peak levels
    this.tallies.clear();
    const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory;
    // THE DOM CENSUS, off the frame path (see `NODE_COUNT_EVERY_MS`): the very first bucket takes it in place (there
    // is nothing to repeat yet); after that it is refreshed on idle time when the phase or wave moves, or when it is
    // old, and every bucket in between repeats the last count.
    const nodeKey = `${ctx.overlay ?? ctx.phase ?? ''}|${ctx.wave ?? ''}`;
    if (this.nodeCountAt === -Infinity) { this.takeNodeCount(); this.nodeCountKey = nodeKey; }
    else if (nodeKey !== this.nodeCountKey || now - this.nodeCountAt >= NODE_COUNT_EVERY_MS) { this.nodeCountKey = nodeKey; this.scheduleNodeCount(); }
    const nodes = this.nodeCount;
    const nodesBy = this.nodeCountBy ? { ...this.nodeCountBy } : undefined;

    const bucket: PerfBucket = {
      t: Math.round(now - this.t0),
      ...stats,
      hz: thresholds.refreshHz,
      task: +longestTask.toFixed(1),
      ...(ctx.phase !== undefined ? { phase: ctx.phase } : {}),
      ...(ctx.wave !== undefined ? { wave: ctx.wave } : {}),
      counts,
      heapMb: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : 0,
      nodes,
      marks,
      timings,
      ...(longAttrib ? { longAttrib } : {}),
      ...(longTasks ? { longTasks } : {}),
      ...(nodesBy ? { nodesBy } : {}),
      ...(hidden ? { hidden: true } : {}),
      ...(warmup > 0 ? { warmup } : {}),
      ...(partial ? { sampledMs: Math.round(sampledMs) } : {}),
    };

    this.buckets.push(bucket);
    if (this.buckets.length > MAX_BUCKETS) this.buckets.shift();
    for (const fn of this.listeners) fn(bucket);
  }

  /** The display refresh currently believed, and whether that is measured or still the assumed default. */
  get display(): { refreshHz: number; detected: boolean } {
    return { refreshHz: this.refresh.hz, detected: this.refresh.detected };
  }

  latest(): PerfBucket | null { return this.buckets[this.buckets.length - 1] ?? null; }
  history(): readonly PerfBucket[] { return this.buckets; }
  clear(): void { this.buckets.length = 0; this.startupList.length = 0; }

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
        // WITHOUT these a saved log is uninterpretable: `long: 0` means "smooth" at one refresh and
        // "we weren't looking" at another. `display.detected` distinguishes a measured panel from the
        // assumed 60 Hz default (a session too short to ever close a visible bucket).
        display: { ...this.display, frameBudgetMs: thresholds.frameMs },
        thresholds: { ...thresholds, bucketMs: BUCKET_MS },
        // The project's stated target, so a log can be judged without going back to the docs.
        budget: { targetHz: 240, targetMs: 4.17, stretchHz: 360, stretchMs: 2.78 },
        summary: this.summary(),
        // Every phase start's diverted spike, kept apart so the buckets describe play (see `WarmupConfig`).
        warmup: this.warmupCfg,
        startups: this.startupList,
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
export type { FrameThresholds } from './refreshRate';

/** The `long-animation-frame` entry fields this reads (not yet in TS's DOM lib). */
export interface LoafScript { duration: number; startTime: number; invokerType?: string; invoker?: string; sourceFunctionName?: string }
export interface LoafEntry { startTime: number; duration: number; styleAndLayoutStart: number; scripts?: LoafScript[] }
/** Scripts shorter than this inside a long frame are noise, not a cause. */
const LOAF_MIN_SCRIPT_MS = 4;
/** `loaf:<invoker type>:<function, else invoker>`, kept short: an invoker can be a whole URL. */
export function loafScriptLabel(sc: LoafScript): string {
  const kind = sc.invokerType || 'script';
  const who = (sc.sourceFunctionName || sc.invoker || '').replace(/^https?:\/\/[^ ]*\//, '').slice(0, 48) || 'anonymous';
  return `loaf:${kind}:${who}`;
}
