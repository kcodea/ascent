import { describe, expect, it } from 'vitest';
import { budgetVerdict, foldRuns, framesByScene, median, refreshInterval, sceneStats, winner, type SceneStats } from './perfGauntletStats';

// R-PERF-GAUNTLET-01: the rules the perf gauntlet judges by (scripts/perf-gauntlet.mjs).

const NO_WORK = { task: 0, script: 0, style: 0, layout: 0 };
/** Timestamps for a run of frame intervals, starting at t = 0. */
const stamps = (dts: number[]): number[] => dts.reduce<number[]>((t, d) => [...t, t[t.length - 1]! + d], [0]);

describe('perf gauntlet judging (R-PERF-GAUNTLET-01)', () => {
  it('reads the refresh from the low decile, so a loaded stretch cannot pass for a slow panel', () => {
    const at360 = Array.from({ length: 900 }, () => 2.78);
    const hitches = Array.from({ length: 100 }, () => 40);
    expect(refreshInterval([...at360, ...hitches])).toBeCloseTo(2.78);
    expect(refreshInterval([0.1, 500, 16.7, 16.7, 16.7])).toBeCloseTo(16.7); // absurd samples ignored
  });

  it('judges the worst frame, and counts long / jank by refresh intervals', () => {
    const s = sceneStats([2.78, 2.78, 5.56, 8.34, 30], 2.78, NO_WORK, []);
    expect(s.worst).toBe(30);
    expect(s.long).toBe(3); // 5.56, 8.34, 30 each dropped at least one refresh
    expect(s.jank).toBe(2); // 8.34 and 30 dropped two or more
    expect(s.overBudget).toBe(3); // over 4.17 ms (with the 20% vsync slack)
  });

  it('files a frame under the scene it started in, and drops frames while the page was hidden', () => {
    const t = stamps([3, 3, 3, 3, 3, 3]); // 0 3 6 9 12 15 18
    const { by, hiddenFrames } = framesByScene(t, [[0, 'a'], [7, 'b'], [16, 'end']], [[12.5, 13]]);
    expect(by.get('a')).toEqual([3, 3, 3]); // frames starting at 0, 3, 6
    expect(by.get('b')).toEqual([3, 3]); // 9->12 and 15->18 (starts before 'end' at 16); 12->15 overlaps the hidden span
    expect(hiddenFrames).toBe(1);
  });

  it('only calls a winner when every run beats every run of the other AND the gap is big enough', () => {
    const run = (taskMs: number): Record<string, SceneStats> => ({ drag: sceneStats([2.78, 2.78, 2.78, 2.78], 2.78, { ...NO_WORK, task: taskMs }, []) });
    const slow = foldRuns([run(20), run(22), run(21)], ['drag']); // 5.0-5.5 ms of work a frame
    const fast = foldRuns([run(9), run(10), run(11)], ['drag']);
    const overlapping = foldRuns([run(9), run(25), run(11)], ['drag']);
    const barely = foldRuns([run(19), run(19.5), run(19.8)], ['drag']); // every run better, but only ~7%
    expect(winner(slow.drag, fast.drag, 'workPerFrame')).toBe('Y');
    expect(winner(fast.drag, slow.drag, 'workPerFrame')).toBe('X');
    expect(winner(slow.drag, overlapping.drag, 'workPerFrame')).toBe('~'); // one bad run keeps it within noise
    expect(winner(slow.drag, barely.drag, 'workPerFrame')).toBe('~'); // inside the null A/B's ~5% noise
    expect(median([3, 1, 2])).toBe(2);
  });

  it('never lets the worst frame alone decide a win (identical builds differed 2.5x on it)', () => {
    const run = (worst: number): Record<string, SceneStats> => ({ s: sceneStats([2.78, worst], 2.78, NO_WORK, []) });
    expect(winner(foldRuns([run(160), run(170)], ['s']).s, foldRuns([run(60), run(70)], ['s']).s, 'worst')).toBe('·');
  });

  it('needs at least one refresh step on the quantized p95 / p99', () => {
    const run = (p: number): Record<string, SceneStats> => ({ s: sceneStats(Array.from({ length: 100 }, (_, i) => (i < 95 ? 2.78 : p)), 2.78, NO_WORK, []) });
    const a = foldRuns([run(5.56), run(5.56)], ['s']).s; const b = foldRuns([run(2.9), run(2.9)], ['s']).s;
    expect(winner(a, b, 'p99', 2.78)).toBe('~'); // 2.66 ms apart: under one 360 Hz refresh
    const c = foldRuns([run(8.34), run(8.34)], ['s']).s;
    expect(winner(c, b, 'p99', 2.78)).toBe('Y'); // two refreshes apart
  });

  it('passes a scene only under budget on a fast display, and refuses to judge where it cannot see a miss', () => {
    const smooth = foldRuns([{ s: sceneStats([2.78, 2.9, 3.0], 2.78, NO_WORK, []) }], ['s']).s;
    const hitch = foldRuns([{ s: sceneStats([2.78, 9], 2.78, NO_WORK, []) }], ['s']).s;
    expect(budgetVerdict(smooth, 360, false)).toBe('PASS');
    expect(budgetVerdict(hitch, 360, false)).toBe('FAIL');
    expect(budgetVerdict(smooth, 60, false)).toBe('n/a (60 Hz display)');
    expect(budgetVerdict(smooth, 360, true)).toBe('n/a (headless)');
  });
});
