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

const extra = { date: '2026-06-30', boardsContributed: 8, board: null, apt: 6.2, cardsPlayed: 14 };

describe('buildRunHistoryEntry (A7)', () => {
  it('captures the record, line verdict, tags, and run stats (calibration excluded)', () => {
    const e = buildRunHistoryEntry(finishedRun({ heroId: 'rohan', triplesMade: 3, goldSpent: 120 }), extra);
    expect(e).toMatchObject({
      v: 1, date: '2026-06-30', heroId: 'rohan',
      wins: 11, losses: 4, draws: 0, // scored only
      line: 9, lineStatus: 'exceeded', completed: true, wave: 17,
      boardsContributed: 8, triples: 3, goldSpent: 120, apt: 6.2, cardsPlayed: 14,
    });
    expect(Array.isArray(e.tags)).toBe(true);
  });

  it('marks a died run as not completed', () => {
    const e = buildRunHistoryEntry(finishedRun({ phase: 'gameover', wave: 9 }), extra);
    expect(e.completed).toBe(false);
    expect(e.lineStatus).toBe('failed');
  });
});

describe('careerStats (A7)', () => {
  const entry = (heroId: string, wins: number, completed: boolean, over: Partial<RunHistoryEntry> = {}): RunHistoryEntry => ({
    v: 1, date: '2026-06-30', seed: 1, heroId, wins, losses: scored - wins, draws: 0,
    line: 9, lineStatus: 'covered', completed, wave: 17, tags: [], tribes: [], boardsContributed: 0, board: null, ...over,
  });

  it('returns zeros for an empty history', () => {
    expect(careerStats([])).toMatchObject({ runs: 0, bestWins: 0, avgWins: 0, completions: 0, flawless: 0, triples: 0, avgGold: 0, avgApt: 0, topTribes: [], perHero: [] });
  });

  it('aggregates overall + per-hero + run stats, sorted by runs', () => {
    const s = careerStats([
      entry('rohan', 11, true, { lineStatus: 'flawless', triples: 3, goldSpent: 100, apt: 6, dominantTribe: 'beast' }),
      entry('rohan', 7, false, { triples: 1, goldSpent: 50, apt: 4, dominantTribe: 'beast' }),
      entry('warden', 9, true, { triples: 2, goldSpent: 90, apt: 5, dominantTribe: 'dragon' }),
    ]);
    expect(s.runs).toBe(3);
    expect(s.bestWins).toBe(11);
    expect(s.avgWins).toBe(9); // (11+7+9)/3
    expect(s.completions).toBe(2);
    expect(s.flawless).toBe(1);
    expect(s.triples).toBe(6);
    expect(s.avgGold).toBe(80); // (100+50+90)/3
    expect(s.avgApt).toBe(5); // (6+4+5)/3
    expect(s.topTribes[0]).toEqual({ tribe: 'beast', count: 2 });
    expect(s.perHero[0]).toMatchObject({ heroId: 'rohan', runs: 2, bestWins: 11, avgWins: 9, completions: 1 });
  });
});
