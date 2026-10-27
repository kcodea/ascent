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

  it('only calls a winner when every run of one build beats every run of the other', () => {
    const run = (worst: number): Record<string, SceneStats> => ({ drag: sceneStats([2.78, worst], 2.78, NO_WORK, []) });
    const clear = foldRuns([run(20), run(22), run(21)], ['drag']);
    const better = foldRuns([run(9), run(10), run(11)], ['drag']);
    const overlapping = foldRuns([run(9), run(25), run(11)], ['drag']);
    expect(winner(clear.drag, better.drag, 'worst')).toBe('Y');
    expect(winner(better.drag, clear.drag, 'worst')).toBe('X');
    expect(winner(clear.drag, overlapping.drag, 'worst')).toBe('~'); // one bad run keeps it within noise
    expect(median([3, 1, 2])).toBe(2);
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
