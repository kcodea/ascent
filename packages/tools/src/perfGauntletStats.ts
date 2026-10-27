/**
 * The pure judging half of `npm run perf:gauntlet` (scripts/perf-gauntlet.mjs, R-PERF-GAUNTLET-01): how a run's raw
 * frame timestamps become per-scene numbers, and how two builds' runs are compared. Kept here, apart from the Chrome
 * driving, so the rules the judge applies are unit-tested (perfGauntletStats.test.ts).
 */

/** The frame budget every scene is judged against (docs/performance.md §0: 240 Hz). */
export const FRAME_BUDGET_MS = 4.17;
/** Slack on the budget for vsync jitter: a 240 Hz frame measures 4.0 to 4.4 ms. */
export const BUDGET_SLACK = 1.2;
/** Below this the display cannot show a 4.17 ms miss (every interval is at least one refresh). */
export const MIN_BUDGET_HZ = 235;

export interface SceneStats {
  frames: number;
  worst: number; p99: number; p95: number; p50: number;
  /** frames that dropped at least one refresh (>= 2 intervals, with jitter slack) */ long: number;
  /** frames that dropped two or more (>= 3 intervals): a visible hitch */ jank: number;
  /** frames over the budget (with slack) */ overBudget: number;
  /** main-thread ms per frame (all tasks / script / style + layout) */ workPerFrame: number; scriptPerFrame: number; stylePerFrame: number;
  /** long animation frames (> 50 ms) and their summed blocking ms */ loaf: number; loafBlocking: number;
}

export interface SceneWork { task: number; script: number; style: number; layout: number }

/** The p-quantile of an ASCENDING array (nearest rank, never past the end). */
export function quantile(sorted: readonly number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : 0;
}

export function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return 0;
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

/** The display's refresh interval: the LOW DECILE of the observed frame intervals. Load only ever lengthens a frame,
 *  so the fastest sustained cadence is the panel (the same reading as refreshRate.ts). Absurd samples are ignored. */
export function refreshInterval(intervals: readonly number[]): number {
  const s = intervals.filter((x) => x > 0.5 && x < 100).sort((a, b) => a - b);
  return quantile(s, 0.1) || 16.67;
}

/** Per-scene numbers from one scene's frame intervals. */
export function sceneStats(dts: readonly number[], interval: number, work: SceneWork, loaf: readonly (readonly [number, number, number])[], budget = FRAME_BUDGET_MS): SceneStats {
  const sorted = [...dts].sort((a, b) => a - b);
  const n = Math.max(1, dts.length);
  return {
    frames: dts.length,
    worst: sorted[sorted.length - 1] ?? 0, p99: quantile(sorted, 0.99), p95: quantile(sorted, 0.95), p50: quantile(sorted, 0.5),
    long: dts.filter((x) => x >= interval * 1.5).length,
    jank: dts.filter((x) => x >= interval * 2.5).length,
    overBudget: dts.filter((x) => x > budget * BUDGET_SLACK).length,
    workPerFrame: work.task / n, scriptPerFrame: work.script / n, stylePerFrame: (work.style + work.layout) / n,
    loaf: loaf.length, loafBlocking: loaf.reduce((a, [, , b]) => a + b, 0),
  };
}

/** Splits a run's rAF timestamps into per-scene frame intervals. A frame belongs to the scene it STARTED in; frames
 *  that overlap a hidden-page span are dropped (and counted), since a hidden page's frames say nothing about the game. */
export function framesByScene(t: readonly number[], marks: readonly (readonly [number, string])[], hidden: readonly (readonly [number, number])[], ignore: readonly string[] = ['end']): { by: Map<string, number[]>; hiddenFrames: number; intervals: number[] } {
  const by = new Map<string, number[]>();
  const intervals: number[] = [];
  let hiddenFrames = 0;
  let mi = -1;
  for (let i = 1; i < t.length; i++) {
    const start = t[i - 1]!; const end = t[i]!; const dt = end - start;
    intervals.push(dt);
    while (mi + 1 < marks.length && marks[mi + 1]![0] <= start) mi++;
    const scene = mi >= 0 ? marks[mi]![1] : null;
    if (!scene || ignore.includes(scene)) continue;
    if (hidden.some(([a, b]) => start < b && end > a)) { hiddenFrames++; continue; }
    let list = by.get(scene);
    if (!list) { list = []; by.set(scene, list); }
    list.push(dt);
  }
  return { by, hiddenFrames, intervals };
}

/** One build's runs folded per scene: the median of each metric, plus its min and max across runs (the noise band). */
export type Band = { med: number; min: number; max: number };
export type FoldedScene = Record<keyof SceneStats, Band>;

export function foldRuns(runs: readonly Record<string, SceneStats>[], scenes: readonly string[]): Record<string, FoldedScene> {
  const out: Record<string, FoldedScene> = {};
  for (const s of scenes) {
    const rs = runs.map((r) => r[s]).filter((x): x is SceneStats => !!x);
    if (!rs.length) continue;
    const keys = Object.keys(rs[0]!) as (keyof SceneStats)[];
    out[s] = Object.fromEntries(keys.map((k) => {
      const v = rs.map((r) => r[k]);
      return [k, { med: median(v), min: Math.min(...v), max: Math.max(...v) }];
    })) as FoldedScene;
  }
  return out;
}

/** The smallest gap between the two builds' medians that can count as a win, per metric: a relative gap, and an
 *  absolute floor (`interval` = one refresh, since p95 / p99 frame times move in whole refresh steps). Calibrated on a
 *  null A/B of two identical builds (2026-10-27): p95 / p99 / work agreed within ~5%, dropped-frame counts within
 *  ~20%, and the worst frame differed 2.5x, so the worst frame never decides a win (`null`). */
export const WIN_GAP: Partial<Record<keyof SceneStats, (interval: number) => { rel: number; abs: number } | null>> = {
  worst: () => null,
  p99: (iv) => ({ rel: 0.1, abs: iv }), p95: (iv) => ({ rel: 0.1, abs: iv }), p50: (iv) => ({ rel: 0.1, abs: iv }),
  workPerFrame: () => ({ rel: 0.1, abs: 0.1 }), scriptPerFrame: () => ({ rel: 0.1, abs: 0.1 }), stylePerFrame: () => ({ rel: 0.1, abs: 0.1 }),
  long: () => ({ rel: 0.25, abs: 10 }), jank: () => ({ rel: 0.25, abs: 10 }), overBudget: () => ({ rel: 0.25, abs: 10 }),
  loaf: () => ({ rel: 0.25, abs: 2 }), loafBlocking: () => ({ rel: 0.25, abs: 50 }),
};

/** Which build wins one metric (lower is better for all of them). A win must be CLEAR on two counts: every run of the
 *  winner beats every run of the other (the bands do not overlap), AND the medians differ by at least the metric's
 *  WIN_GAP. Anything else is noise ('~'). The worst frame is shown but never wins ('·'). */
export function winner(x: FoldedScene | undefined, y: FoldedScene | undefined, k: keyof SceneStats, interval = 2.78): 'X' | 'Y' | '~' | '·' | '' {
  if (!x || !y) return '';
  const gapOf = WIN_GAP[k];
  const gap = gapOf ? gapOf(interval) : { rel: 0.1, abs: 0 };
  if (!gap) return '·';
  const a = x[k].med; const b = y[k].med;
  const big = Math.abs(a - b) >= Math.max(gap.abs, gap.rel * Math.max(a, b));
  if (big && x[k].max < y[k].min) return 'X';
  if (big && y[k].max < x[k].min) return 'Y';
  return '~';
}

/** The budget verdict for one scene: PASS only when the worst frame (median across runs) is within the budget and no
 *  frame went over it. A display slower than 240 Hz, or a headless run, cannot show a 4.17 ms miss, so it says so
 *  instead of passing everything. */
export function budgetVerdict(s: FoldedScene | undefined, hz: number, headless: boolean, budget = FRAME_BUDGET_MS): string {
  if (!s) return '-';
  if (headless) return 'n/a (headless)';
  if (hz < MIN_BUDGET_HZ) return `n/a (${Math.round(hz)} Hz display)`;
  return s.worst.med <= budget * BUDGET_SLACK && s.overBudget.med === 0 ? 'PASS' : 'FAIL';
}
