import { describe, expect, it } from 'vitest';
import { createRun, type RunState } from '@game/sim';
import { buildRunHistoryEntry, careerStats, type RunHistoryEntry } from './runHistory';

const scored = 15;
const finishedRun = (over: Partial<RunState> = {}): RunState => ({
  ...createRun(1),
  phase: 'victory',
  wave: 17,
  line: 9,
  history: ['lose', 'lose', ...Array(11).fill('win'), ...Array(4).fill('lose')], // 2 calibration + 11W 4L
  ...over,
});

describe('buildRunHistoryEntry (A7)', () => {
  it('captures the record, line verdict, tags, and metadata (calibration excluded)', () => {
    const e = buildRunHistoryEntry(finishedRun({ heroId: 'rohan' }), { date: '2026-06-30', boardsContributed: 8, board: null });
    expect(e).toMatchObject({
      v: 1, date: '2026-06-30', heroId: 'rohan',
      wins: 11, losses: 4, draws: 0, // scored only
      line: 9, lineStatus: 'exceeded', completed: true, wave: 17,
      boardsContributed: 8,
    });
    expect(Array.isArray(e.tags)).toBe(true);
  });

  it('marks a died run as not completed', () => {
    const e = buildRunHistoryEntry(finishedRun({ phase: 'gameover', wave: 9 }), { date: '2026-06-30', boardsContributed: 3, board: null });
    expect(e.completed).toBe(false);
    expect(e.lineStatus).toBe('failed');
  });
});

describe('careerStats (A7)', () => {
  const entry = (heroId: string, wins: number, completed: boolean): RunHistoryEntry => ({
    v: 1, date: '2026-06-30', seed: 1, heroId, wins, losses: scored - wins, draws: 0,
    line: 9, lineStatus: 'covered', completed, wave: 17, tags: [], tribes: [], boardsContributed: 0, board: null,
  });

  it('returns zeros for an empty history', () => {
    expect(careerStats([])).toEqual({ runs: 0, bestWins: 0, avgWins: 0, completions: 0, perHero: [] });
  });

  it('aggregates overall + per-hero, sorted by runs', () => {
    const s = careerStats([
      entry('rohan', 11, true),
      entry('rohan', 7, false),
      entry('warden', 9, true),
    ]);
    expect(s.runs).toBe(3);
    expect(s.bestWins).toBe(11);
    expect(s.avgWins).toBe(9); // (11+7+9)/3 = 9
    expect(s.completions).toBe(2);
    expect(s.perHero[0]).toMatchObject({ heroId: 'rohan', runs: 2, bestWins: 11, avgWins: 9, completions: 1 });
    expect(s.perHero[1]).toMatchObject({ heroId: 'warden', runs: 1, bestWins: 9 });
  });
});
