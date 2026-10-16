import { describe, expect, it } from 'vitest';
import { rolling, trendFigures, trendRuns } from './careerTrends';
import type { CareerRun } from './careerData';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 16);
const run = (atMs: number, placement: number | null): CareerRun => ({ atMs, placement, ratingAfter: 500, ratingDelta: 10, heroId: 'sable', apt: null, wave: 10, durationMs: null } as unknown as CareerRun);

describe('careerTrends (owner 2026-10-16: trends with depth)', () => {
  it('rolling is a trailing mean of the last n, not a cumulative one', () => {
    expect(rolling([1, 8, 1, 8], 2)).toEqual([1, 4.5, 4.5, 4.5]);
    expect(rolling([8, 8, 8, 1, 1, 1], 3)).toEqual([8, 8, 8, 17 / 3, 10 / 3, 1]);
  });
  it('a window and the period before it; the figures and their change', () => {
    const runs = [run(NOW - 1 * DAY, 1), run(NOW - 2 * DAY, 3), run(NOW - 9 * DAY, 7), run(NOW - 10 * DAY, 5)];
    const { cur, prev } = trendRuns(runs, 7, NOW);
    expect(cur.map((p) => p.place)).toEqual([3, 1]);
    expect(prev?.map((p) => p.place)).toEqual([5, 7]);
    const f = trendFigures(cur, prev);
    expect(f.place).toBe(2);
    expect(f.placeD).toBe(-4); // better (lower) than the 6.0 before
    expect(f.top4).toBe(100);
    expect(f.top4D).toBe(100);
    expect(trendRuns(runs, 'all', NOW).prev).toBeNull();
  });
});
