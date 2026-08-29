import type { PerfBucket } from './perfMonitor';
import { thresholdsFor, type FrameThresholds } from './refreshRate';

/**
 * PERF DIAGNOSIS — turn a recorded timeline into named, evidenced findings.
 *
 * `perfMonitor` answers *what happened*; this answers *what is wrong and what to do about it*. It is the
 * half that was missing: a HUD full of percentiles still leaves the reader to know that a low measured-time
 * share means the cost is in paint rather than in any instrumented block, or that DOM nodes climbing across
 * a run is a leak that will surface as slow style recalc. Those readings live in `docs/performance.md` and
 * in people's heads. Here they are code.
 *
 * ── Three rules this file is built on ─────────────────────────────────────────────────────────────────────
 *
 * 1. **`worst` is the metric, not the mean** (`performance.md` §0). A mean improvement that leaves the worst
 *    frame where it was has not fixed anything a player can feel. Every budget verdict is judged on worst
 *    frame first, then long/jank counts, then p95.
 * 2. **Never hardcode a millisecond threshold for "slow"** (§4). `LONG_FRAME_MS = 33` is "2 frames at 60 Hz"
 *    in a neutral costume; on a 360 Hz panel it only fires after eight dropped frames. Every threshold here
 *    is derived from the `hz` each bucket recorded.
 * 3. **Correlation is labelled as correlation.** A mark firing in a janky second does not make it the cause —
 *    a bucket is a whole second and several marks share it. Verdicts carry `confidence`, and the wording
 *    changes with it. Overstating a suspect wastes an afternoon; the existing `suspects` field is named that
 *    way for the same reason.
 *
 * Pure and DOM-free on purpose: the sampler cannot be exercised headlessly, but all of this can, so the
 * reasoning that matters is unit-tested rather than eyeballed through a panel.
 */

/** The frame budget, in frames rather than milliseconds — see rule 2. One frame at the measured refresh. */
const BUDGET_FRAMES = 1;
/** Below this share of wall-clock accounted for by instrumented blocks, the cost is somewhere unmeasured. */
const LOW_ATTRIBUTION = 0.15;
/** DOM growth across a run beyond this multiple of the opening count reads as a leak rather than content. */
const NODE_GROWTH_FACTOR = 1.6;
/** Heap growth (MB) across a run that is worth mentioning at all. */
const HEAP_GROWTH_MB = 120;
/** A phase needs at least this many live seconds before its numbers mean anything. */
const MIN_PHASE_BUCKETS = 3;

export type Severity = 'critical' | 'warn' | 'info';

/**
 * How much the evidence supports the claim.
 *
 * `measured` — the number IS the finding (a timing's own max exceeded budget).
 * `correlated` — the finding co-occurs with the symptom but a second is a long time and several things
 *   share one. Ranks what to look at; never names a culprit.
 */
export type Confidence = 'measured' | 'correlated';

export interface Verdict {
  /** Stable id, so a report can be diffed run over run and a fix can be pointed at one. */
  id: string;
  severity: Severity;
  /** One line, plain English, no jargon — this is the sentence someone reads first. */
  title: string;
  /** The evidence, with its numbers. */
  detail: string;
  /** What to actually do next. Project-specific where the pattern is known. */
  suggestion: string;
  confidence: Confidence;
  /** Set when the finding is concentrated in one phase. */
  phase?: string;
}

export interface PhaseStat {
  phase: string;
  seconds: number;
  fpsMed: number;
  /** Worst single frame seen in this phase, ms. */
  worst: number;
  p95: number;
  long: number;
  jank: number;
  /** Janky frames per second of the phase — what makes phases of different lengths comparable. */
  jankRate: number;
  /** Share of the run's total janky frames that landed in this phase. */
  jankShare: number;
  overBudget: boolean;
}

export interface Spike {
  /** ms since monitoring started. */
  t: number;
  worst: number;
  p95: number;
  jank: number;
  phase?: string;
  wave?: number;
  /** Longest main-thread task in the second, ms. */
  task: number;
  /** What fired in this second, biggest first — the annotation that makes a spike triageable. */
  marks: { label: string; n: number }[];
  /** Measured work in this second, worst single call first. */
  timings: { label: string; n: number; total: number; max: number }[];
  /** Peak live FX counts in this second. */
  counts: { label: string; n: number }[];
}

export interface Diagnosis {
  /** Live (non-backgrounded) seconds the diagnosis is drawn from. */
  seconds: number;
  hz: number;
  /** The per-frame budget in force, ms — derived from `hz`, never assumed. */
  budgetMs: number;
  thresholds: FrameThresholds;
  fpsMed: number;
  worstFrame: number;
  longFrames: number;
  jankFrames: number;
  /** Frames over budget as a share of all frames — the headline health number. */
  jankRate: number;
  /** Share of wall-clock accounted for by instrumented blocks. Low is itself a finding, not a gap. */
  attribution: number;
  verdicts: Verdict[];
  phases: PhaseStat[];
  spikes: Spike[];
  /** True when there is too little data to say anything. Everything else is then meaningless. */
  thin: boolean;
}

const round = (n: number, p = 1): number => +n.toFixed(p);
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const top = (rec: Record<string, number> | undefined, n: number): { label: string; n: number }[] =>
  Object.entries(rec ?? {}).map(([label, v]) => ({ label, n: v })).sort((a, b) => b.n - a.n).slice(0, n);

/** The refresh the run actually ran at — the median of what each bucket recorded, so one odd bucket
 *  (a resize, a monitor switch) cannot move the budget every verdict is judged against. */
function runHz(live: readonly PerfBucket[]): number {
  const hz = live.map((b) => b.hz).filter((h) => h > 0).sort((a, b) => a - b);
  return hz.length ? hz[Math.floor(hz.length / 2)]! : 60;
}

/** Per-phase frame health. Phases are compared by jank RATE, not total, so a long shop phase does not
 *  automatically out-rank a short combat one. */
export function phaseBreakdown(live: readonly PerfBucket[], budgetMs: number): PhaseStat[] {
  const byPhase = new Map<string, PerfBucket[]>();
  for (const b of live) {
    const key = b.phase ?? 'unknown';
    const list = byPhase.get(key) ?? [];
    list.push(b);
    byPhase.set(key, list);
  }
  const totalJank = live.reduce((a, b) => a + b.jank, 0);
  const out: PhaseStat[] = [];
  for (const [phase, bs] of byPhase) {
    const fps = bs.map((b) => b.fps).sort((a, b) => a - b);
    const p95s = bs.map((b) => b.p95).sort((a, b) => a - b);
    const jank = bs.reduce((a, b) => a + b.jank, 0);
    out.push({
      phase,
      seconds: bs.length,
      fpsMed: round(fps[Math.floor(fps.length / 2)] ?? 0),
      worst: round(bs.reduce((a, b) => Math.max(a, b.worst), 0), 2),
      p95: round(p95s[Math.floor(p95s.length / 2)] ?? 0, 2),
      long: bs.reduce((a, b) => a + b.long, 0),
      jank,
      jankRate: round(jank / bs.length, 2),
      jankShare: totalJank > 0 ? jank / totalJank : 0,
      overBudget: bs.reduce((a, b) => Math.max(a, b.worst), 0) > budgetMs,
    });
  }
  return out.sort((a, b) => b.jankRate - a.jankRate);
}

/** The worst seconds of the run, annotated with everything that was happening in them. */
export function worstSpikes(live: readonly PerfBucket[], n = 8): Spike[] {
  return [...live]
    .sort((a, b) => b.worst - a.worst)
    .slice(0, n)
    .map((b) => ({
      t: b.t,
      worst: round(b.worst, 2),
      p95: round(b.p95, 2),
      jank: b.jank,
      phase: b.phase,
      wave: b.wave,
      task: round(b.task, 1),
      marks: top(b.marks, 6),
      timings: Object.entries(b.timings ?? {})
        .map(([label, v]) => ({ label, n: v.n, total: round(v.total, 1), max: round(v.max, 1) }))
        .sort((a, c) => c.max - a.max)
        .slice(0, 6),
      counts: top(b.counts, 6),
    }));
}

/**
 * The rule set. Each rule reads the timeline and either returns a verdict or stays quiet.
 *
 * A rule earns its place by being ACTIONABLE — every one names a next step, and where this codebase has a
 * known pattern for the symptom, it names that pattern rather than offering general advice.
 */
export function diagnose(buckets: readonly PerfBucket[]): Diagnosis {
  const live = buckets.filter((b) => !b.hidden);
  const hz = runHz(live);
  const th = thresholdsFor(hz);
  const budgetMs = round(1000 / hz / BUDGET_FRAMES, 2);

  const fps = live.map((b) => b.fps).sort((a, b) => a - b);
  const worstFrame = live.reduce((a, b) => Math.max(a, b.worst), 0);
  const longFrames = live.reduce((a, b) => a + b.long, 0);
  const jankFrames = live.reduce((a, b) => a + b.jank, 0);
  const totalFrames = live.reduce((a, b) => a + Math.round(b.fps), 0);
  const measuredMs = live.reduce(
    (a, b) => a + Object.values(b.timings ?? {}).reduce((s, v) => s + v.total, 0), 0,
  );
  const attribution = live.length > 0 ? measuredMs / (live.length * 1000) : 0;
  const phases = phaseBreakdown(live, budgetMs);
  const spikes = worstSpikes(live);

  const base: Diagnosis = {
    seconds: live.length,
    hz,
    budgetMs,
    thresholds: th,
    fpsMed: round(fps[Math.floor(fps.length / 2)] ?? 0),
    worstFrame: round(worstFrame, 2),
    longFrames,
    jankFrames,
    jankRate: totalFrames > 0 ? jankFrames / totalFrames : 0,
    attribution: round(attribution, 3),
    verdicts: [],
    phases,
    spikes,
    thin: live.length < MIN_PHASE_BUCKETS,
  };

  if (base.thin) {
    base.verdicts = [{
      id: 'thin-sample',
      severity: 'info',
      title: 'Not enough recorded time to judge anything yet',
      detail: `${live.length} live second(s). Percentiles and phase rates need a real sample before they mean anything.`,
      suggestion: 'Play a few waves with the monitor on — a shop phase, a combat, and an End of Turn — then read this again.',
      confidence: 'measured',
    }];
    return base;
  }

  const v: Verdict[] = [];

  // ── 1. THE BUDGET. Worst frame first, per §0 — a mean is context, not a verdict. ─────────────────────────
  if (worstFrame > budgetMs) {
    const over = worstFrame / budgetMs;
    v.push({
      id: 'over-budget',
      severity: over >= 4 ? 'critical' : over >= 2 ? 'warn' : 'info',
      title: `Worst frame was ${round(worstFrame, 1)} ms — ${round(over, 1)}× the ${budgetMs} ms budget`,
      // The two counts NEST — `jank` is a subset of `long` — so they are phrased as a subset. Listing them
      // side by side reads as two independent tallies, which invites the reader to add them.
      detail: `At ${hz} Hz every frame has ${budgetMs} ms. Across ${live.length}s, ${longFrames} frame(s) went over ${round(th.longFrameMs, 1)} ms, of which ${jankFrames} went over ${round(th.jankMs, 1)} ms.`,
      suggestion: over >= 2
        ? 'Start at the worst spike in the timeline below and read what fired in that second — its marks and timings are the shortlist.'
        : 'Close to budget. Worth a look only if it lands somewhere the player feels it.',
      confidence: 'measured',
    });
  } else {
    v.push({
      id: 'within-budget',
      severity: 'info',
      title: `Every frame fit the ${budgetMs} ms budget`,
      detail: `Worst frame ${round(worstFrame, 1)} ms at ${hz} Hz across ${live.length}s.`,
      suggestion: 'Nothing to chase in this recording. fps is a ceiling, not a score — a clean run means nothing dropped, not that there is headroom.',
      confidence: 'measured',
    });
  }

  // ── 2. ATTRIBUTION. A low share is a FINDING, not a gap — it says the cost is not in any timed block. ────
  if (jankFrames > 0 && attribution < LOW_ATTRIBUTION) {
    v.push({
      id: 'unattributed-time',
      severity: 'warn',
      title: `Only ${pct(attribution)} of the time is accounted for by instrumented code`,
      detail: `${round(measuredMs)} ms measured across ${live.length}s of wall clock, while ${jankFrames} frame(s) went over. The cost is landing somewhere nothing times.`,
      suggestion: 'That points at render, paint, style recalc or GC rather than any block we time. Profile in Chrome DevTools (docs/performance.md §3) and check for a paint property animating in a LOOP — box-shadow, filter, background, border-radius. Those repaint every frame forever.',
      confidence: 'measured',
    });
  }

  // ── 3. LONG TASKS. A blocked main thread is a different problem from a heavy frame. ──────────────────────
  const worstTask = live.reduce((a, b) => Math.max(a, b.task), 0);
  if (worstTask > th.jankMs * 2) {
    const at = live.find((b) => b.task === worstTask);
    v.push({
      id: 'long-task',
      severity: worstTask > 100 ? 'critical' : 'warn',
      title: `A single main-thread task ran ${round(worstTask)} ms`,
      detail: `Longest blocking task of the run${at?.phase ? `, during ${at.phase}` : ''}${at?.wave !== undefined ? ` on wave ${at.wave}` : ''}. Nothing renders while it runs.`,
      suggestion: 'This is synchronous work, not draw cost — a big clone, a shader compile, a save, or a reducer pass. Check the timings on that spike; if none of them own it, it is uninstrumented and worth wrapping in a timing.',
      confidence: 'measured',
      phase: at?.phase,
    });
  }

  // ── 4. PHASE CONCENTRATION. The whole point of splitting by phase: is it one phase or everywhere? ────────
  // Ranked over every phase with enough seconds to judge — INCLUDING clean ones, because a phase with zero
  // jank is precisely the contrast that makes "it is only combat" a finding rather than an observation.
  const ranked = phases.filter((p) => p.seconds >= MIN_PHASE_BUCKETS);
  if (ranked.length > 1 && jankFrames > 0) {
    const worstPhase = ranked[0]!;
    const next = ranked[1]!;
    // TWO conditions, because either alone misreads a common case: a share test alone calls an even 50/50
    // split "concentrated", and a rate test alone fires on noise between two nearly-equal phases.
    const dominant = worstPhase.jankShare >= 0.6 && worstPhase.jankRate >= Math.max(next.jankRate * 1.5, 0.5);
    if (dominant) {
      v.push({
        id: 'phase-concentrated',
        severity: 'warn',
        title: `${pct(worstPhase.jankShare)} of the dropped frames are in one phase: ${worstPhase.phase}`,
        detail: `${worstPhase.phase} drops ${worstPhase.jankRate} frame(s) per second against ${round(next.jankRate, 2)} in ${next.phase}. Worst frame there: ${worstPhase.worst} ms.`,
        suggestion: `The problem is not the whole game — it is ${worstPhase.phase}. Filter the timeline to that phase and read what only happens there.`,
        confidence: 'measured',
        phase: worstPhase.phase,
      });
    }
  }

  // ── 5. MEASURED HOTSPOTS. The one place a culprit can be NAMED rather than suspected. ────────────────────
  const acc = new Map<string, { n: number; total: number; max: number }>();
  for (const b of live) {
    for (const [k, t] of Object.entries(b.timings ?? {})) {
      const cur = acc.get(k);
      if (cur) { cur.n += t.n; cur.total += t.total; cur.max = Math.max(cur.max, t.max); }
      else acc.set(k, { n: t.n, total: t.total, max: t.max });
    }
  }
  const hot = [...acc.entries()].sort((a, b) => b[1].max - a[1].max);
  for (const [label, t] of hot.slice(0, 3)) {
    if (t.max <= budgetMs) break; // ranked by max, so once one fits the budget the rest do too
    v.push({
      id: `hotspot:${label}`,
      severity: t.max > th.jankMs ? 'critical' : 'warn',
      title: `${label} took ${round(t.max)} ms in its worst call`,
      detail: `Called ${t.n}× for ${round(t.total)} ms total. One call alone is ${round(t.max / budgetMs, 1)}× the frame budget.`,
      suggestion: 'This is measured attribution, not a guess — the milliseconds are on the clock for that block. Make it cheaper, defer it off the frame that shows it, or split it across frames.',
      confidence: 'measured',
    });
  }

  // ── 6. FX VOLUME. Correlation, and said so. ──────────────────────────────────────────────────────────────
  const janky = live.filter((b) => b.jank > 0);
  const calm = live.filter((b) => b.jank === 0);
  if (janky.length >= 2 && calm.length >= 2) {
    const avgCount = (bs: PerfBucket[], key: string): number =>
      bs.reduce((a, b) => a + (b.counts?.[key] ?? 0), 0) / bs.length;
    const keys = new Set<string>();
    for (const b of live) for (const k of Object.keys(b.counts ?? {})) keys.add(k);
    for (const k of keys) {
      const j = avgCount(janky, k);
      const c = avgCount(calm, k);
      if (j >= 8 && j > c * 2.5) {
        // The ratio, stated as a ratio. An earlier draft printed the AVERAGE COUNT with a `×` after it —
        // "particles runs 260× higher" when 260 was simply how many were live. In a tool whose whole value
        // is precision, a number that means something other than what it says is the worst kind of bug.
        const ratio = c > 0 ? j / c : Infinity;
        v.push({
          id: `fx-volume:${k}`,
          severity: 'warn',
          title: c > 0
            ? `${k} runs ${round(ratio)}× higher in the seconds that drop frames`
            : `${k} appears only in the seconds that drop frames`,
          detail: `Averages ${round(j)} live in janky seconds against ${round(c, 1)} in clean ones.`,
          suggestion: `Co-occurrence, not proof — a second is a long time. But if ${k} is genuinely spiking there, pool or cap it and re-record to confirm the link.`,
          confidence: 'correlated',
        });
        break; // one is a lead; a list of them is noise
      }
    }
  }

  // ── 7. DOM GROWTH. A leak surfaces as slow style recalc long before it looks like a leak. ────────────────
  const nodesFirst = live.find((b) => b.nodes > 0)?.nodes ?? 0;
  const nodesLast = [...live].reverse().find((b) => b.nodes > 0)?.nodes ?? 0;
  if (nodesFirst > 0 && nodesLast > nodesFirst * NODE_GROWTH_FACTOR && live.length > 30) {
    v.push({
      id: 'dom-growth',
      severity: 'warn',
      title: `DOM grew from ${nodesFirst} to ${nodesLast} nodes over the run`,
      detail: `${round(nodesLast / nodesFirst, 1)}× growth across ${live.length}s. Style recalc scales with node count, so this gets slower the longer a run goes.`,
      suggestion: 'Look for transient elements that are never removed — FX layers, floats, portals. Something is mounting and not cleaning up.',
      confidence: 'measured',
    });
  }

  // ── 8. HEAP GROWTH. GC pressure reads as random spikes with no owner. ───────────────────────────────────
  const heapFirst = live.find((b) => b.heapMb > 0)?.heapMb ?? 0;
  const heapLast = [...live].reverse().find((b) => b.heapMb > 0)?.heapMb ?? 0;
  if (heapFirst > 0 && heapLast - heapFirst > HEAP_GROWTH_MB) {
    v.push({
      id: 'heap-growth',
      severity: 'info',
      title: `JS heap grew ${round(heapLast - heapFirst)} MB over the run`,
      detail: `${round(heapFirst)} MB → ${round(heapLast)} MB across ${live.length}s.`,
      suggestion: 'Growth alone is not a leak — the heap climbs until a GC. But if spikes have no owner in the timings, GC pressure is a candidate: look for per-frame allocation and large clones.',
      confidence: 'correlated',
    });
  }

  // ── 9. INPUT FLOOD. A known project anti-pattern with a known fix. ──────────────────────────────────────
  const moves = live.reduce((a, b) => a + (b.counts?.pointermoves ?? 0), 0) / live.length;
  if (moves > 200 && jankFrames > 0) {
    v.push({
      id: 'input-flood',
      severity: 'info',
      title: `${round(moves)} pointer moves per second`,
      detail: 'A high-polling mouse delivers far above the frame rate. Harmless on its own — expensive if a handler turns each one into a state update or a layout read.',
      suggestion: 'Check the drag path: rects should be cached once per drag (insertRectsRef), not read per move. See docs/performance.md §4.',
      confidence: 'correlated',
    });
  }

  // ── 10. MARK CORRELATION, last and clearly hedged. Ranks what to look at; never names a culprit. ─────────
  const markJank: Record<string, number> = {};
  for (const b of janky) for (const [k, n] of Object.entries(b.marks ?? {})) markJank[k] = (markJank[k] ?? 0) + n;
  const suspect = Object.entries(markJank).sort((a, b) => b[1] - a[1])[0];
  if (suspect && jankFrames > 4 && hot.every(([, t]) => t.max <= budgetMs)) {
    v.push({
      id: `suspect:${suspect[0]}`,
      severity: 'info',
      title: `${suspect[0]} fires most often in the seconds that drop frames`,
      detail: `${suspect[1]} firing(s) inside janky seconds. No timed block exceeded the budget, so nothing is directly attributable yet.`,
      suggestion: `Wrap ${suspect[0]}'s work in a timing (perfMonitor.time) and re-record — that converts this guess into an attribution or clears it.`,
      confidence: 'correlated',
    });
  }

  const rank: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
  base.verdicts = v.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return base;
}

// ── Run-over-run comparison ────────────────────────────────────────────────────────────────────────────────

export interface Regression {
  metric: string;
  before: number;
  after: number;
  /** Signed change as a share of `before`. Positive = got worse. */
  delta: number;
  severity: Severity;
  note: string;
}

/** A change smaller than this is noise between two recordings of the same build. */
const NOISE = 0.15;

/**
 * Compare two runs. Ordered `before` → `after`, and phrased as "got worse / got better" rather than raw
 * deltas, because the question being asked is always "did my change regress this?".
 *
 * Only comparable metrics are reported: two runs at different refresh rates have different budgets, so the
 * comparison says so instead of pretending the millisecond numbers line up.
 */
export function compareRuns(before: Diagnosis, after: Diagnosis): Regression[] {
  const out: Regression[] = [];
  if (before.thin || after.thin) return out;
  if (before.hz !== after.hz) {
    out.push({
      metric: 'refresh',
      before: before.hz, after: after.hz, delta: 0, severity: 'info',
      note: `Recorded at different refresh rates (${before.hz} Hz vs ${after.hz} Hz), so the frame budgets differ — jank COUNTS are not comparable between these two. Rates and shares still are.`,
    });
  }
  const cmp = (metric: string, b: number, a: number, higherIsWorse: boolean, note: string): void => {
    if (b <= 0 && a <= 0) return;
    const delta = b === 0 ? (a > 0 ? 1 : 0) : (a - b) / b;
    const worse = higherIsWorse ? delta > NOISE : delta < -NOISE;
    const better = higherIsWorse ? delta < -NOISE : delta > NOISE;
    if (!worse && !better) return;
    out.push({
      metric,
      before: round(b, 2),
      after: round(a, 2),
      delta: round(higherIsWorse ? delta : -delta, 3),
      severity: worse ? (Math.abs(delta) > 0.4 ? 'critical' : 'warn') : 'info',
      note: worse ? note : `${metric} improved.`,
    });
  };
  // Worst first — §0's ordering, in the comparison as well as the verdicts.
  cmp('worst frame', before.worstFrame, after.worstFrame, true,
    'The worst frame got worse. This is the metric a player feels; treat it ahead of the averages.');
  cmp('jank rate', before.jankRate, after.jankRate, true,
    'A larger share of frames is now over the jank threshold.');
  cmp('long frames', before.longFrames, after.longFrames, true,
    'More frames over the long-frame threshold.');
  cmp('median fps', before.fpsMed, after.fpsMed, false,
    'Median fps fell. Remember fps is a ceiling — a fall here means frames are being dropped steadily, not that the game got "slower" in general.');
  return out;
}
