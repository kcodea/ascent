/**
 * CAREER LOAD (perf 2026-10-09): the Career's shared, progressive load. Pins: one request per key however many
 * callers (the title's prefetch + the page), the history rows reach a late joiner at once, the finished rows land in
 * the store's cache, and a background refresh keeps the older answer's Watch handles until its own join lands.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareerRun } from './careerData';

const fetchMyRuns = vi.fn();
vi.mock('./remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./remoteBoards')>()),
  fetchMyRuns: (...a: unknown[]) => fetchMyRuns(...a),
}));

import { careerFresh, carryTelemetry, loadCareer, resetCareerLoadForTests } from './careerLoad';
import { useGame } from './store';

const run = (id: number, over: Partial<CareerRun> = {}): CareerRun => ({
  id, heroId: 'sable', at: null, atMs: NaN, wave: 10, wins: 5, losses: 5, draws: 0, placement: 3, goldSpent: null, apt: null,
  ratingDelta: null, ratingAfter: null, seed: id, dominantTribe: null, mode: 'lobby', board: null, detailed: false, runes: [],
  replayRowId: null, durationMs: null, lobbyStrength: null, ...over,
});

beforeEach(() => { resetCareerLoadForTests(); fetchMyRuns.mockReset(); useGame.setState({ careerCache: null }); });

describe('loadCareer', () => {
  it('makes ONE request per key, hands the history to a late joiner at once, and caches the joined rows', async () => {
    let finish: (rows: CareerRun[]) => void = () => {};
    fetchMyRuns.mockImplementation((_limit: number, opts: { onHistory?: (r: CareerRun[]) => void }) => {
      opts.onHistory?.([run(1)]);
      return new Promise<CareerRun[]>((r) => { finish = r; });
    });
    const first = loadCareer('me|0');
    const seen: CareerRun[][] = [];
    const second = loadCareer('me|0', { onHistory: (r) => seen.push(r) });
    expect(fetchMyRuns).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([[run(1)]]);
    finish([run(1, { replayRowId: 9 })]);
    expect(await first).toEqual(await second);
    expect(useGame.getState().careerCache).toEqual({ key: 'me|0', runs: [run(1, { replayRowId: 9 })] });
    expect(careerFresh('me|0')).toBe(true);
    expect(careerFresh('me|1')).toBe(false);
  });

  it('carries the older answer\'s Watch handle + length onto fresh history rows that lack them', () => {
    const prev = [run(1, { replayRowId: 9, durationMs: 600_000 }), run(2)];
    const fresh = [run(3), run(1), run(2)];
    const out = carryTelemetry(fresh, prev);
    expect(out[0]).toBe(fresh[0]);
    expect(out[1]).toMatchObject({ id: 1, replayRowId: 9, durationMs: 600_000 });
    expect(out[2]!.replayRowId).toBeNull();
  });
});
