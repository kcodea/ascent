import { describe, expect, it } from 'vitest';
import { createRun, type RunState } from '@game/sim';
import { buildRunHistoryEntry, careerStats, ordinal, runVerdict, type RunHistoryEntry } from './runHistory';

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

  it('marks a died run as not completed, but still a line win if it covered par', () => {
    // finishedRun has 11 scored wins over par 9 — dying doesn't erase covering the line.
    const e = buildRunHistoryEntry(finishedRun({ phase: 'gameover', wave: 9 }), extra);
    expect(e.completed).toBe(false); // didn't finish the course
    expect(e.lineStatus).toBe('exceeded'); // but covered par → a win
  });

  it('marks a died run under par as failed', () => {
    const e = buildRunHistoryEntry(finishedRun({ phase: 'gameover', wave: 5, history: ['lose', 'lose', 'win', 'win', 'lose'] }), extra);
    expect(e.completed).toBe(false);
    expect(e.lineStatus).toBe('failed'); // 2 scored wins < par 9, and died
  });
});

describe('careerStats (A7)', () => {
  const entry = (heroId: string, wins: number, completed: boolean, over: Partial<RunHistoryEntry> = {}): RunHistoryEntry => ({
    v: 1, date: '2026-06-30', seed: 1, heroId, wins, losses: scored - wins, draws: 0,
    line: 9, lineStatus: 'covered', completed, wave: 17, tags: [], tribes: [], boardsContributed: 0, board: null, ...over,
  });

  it('returns zeros for an empty history', () => {
    expect(careerStats([])).toMatchObject({ runs: 0, bestWins: 0, avgWins: 0, completions: 0, flawless: 0, triples: 0, avgGold: 0, avgApt: 0, winRate: 0, streak: 0, bestRun: null, topTribes: [], favoriteMechanic: null, perHero: [], lobbyRuns: 0, firsts: 0, topFours: 0, top4Rate: 0, avgPlacement: null, bestPlacement: null, lobbyStreak: 0 });
  });

  it('picks the favorite mechanic (most common per-run top mechanic)', () => {
    const s = careerStats([
      entry('rohan', 10, true, { topMechanic: { name: 'Echo', count: 5 } }),
      entry('rohan', 8, true, { topMechanic: { name: 'Echo', count: 3 } }),
      entry('warden', 9, true, { topMechanic: { name: 'Summon', count: 4 } }),
    ]);
    expect(s.favoriteMechanic).toBe('Echo');
  });

  it('breaks the current streak at the newest run that missed its line', () => {
    const s = careerStats([
      entry('rohan', 5, false, { lineStatus: 'missed' }), // newest — breaks the streak immediately
      entry('rohan', 10, true, { lineStatus: 'covered' }),
      entry('rohan', 12, true, { lineStatus: 'flawless' }),
    ]);
    expect(s.streak).toBe(0);
  });

  it('win rate counts runs that met their line, not rounds won', () => {
    // Every run lost its line (like a fresh player who never covered), even though
    // plenty of individual rounds were won — win rate must read 0%, not the round split.
    const s = careerStats([
      entry('robin', 3, false, { lineStatus: 'missed', losses: 4 }),
      entry('nadja', 1, false, { lineStatus: 'missed', losses: 4 }),
      entry('soren', 7, false, { lineStatus: 'missed', losses: 2 }),
    ]);
    expect(s.winRate).toBe(0);
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
    expect(s.winRate).toBe(100); // 3 of 3 runs met their line (flawless/covered/covered)
    expect(s.bestRun).toEqual({ wins: 11, losses: 4 }); // the highest-win run
    expect(s.streak).toBe(3); // all three met their line (flawless/covered/covered)
    expect(s.topTribes[0]).toEqual({ tribe: 'beast', count: 2 });
    expect(s.perHero[0]).toMatchObject({ heroId: 'rohan', runs: 2, bestWins: 11, avgWins: 9, completions: 1, lineWins: 2, lineLosses: 0 });
  });

  it('tracks per-hero line record (covered vs fell short)', () => {
    const s = careerStats([
      entry('cassen', 10, true, { lineStatus: 'covered' }),  // win
      entry('cassen', 3, false, { lineStatus: 'missed' }),   // loss
      entry('cassen', 2, false, { lineStatus: 'failed' }),   // loss
    ]);
    expect(s.perHero[0]).toMatchObject({ heroId: 'cassen', runs: 3, lineWins: 1, lineLosses: 2 });
  });

  it('picks the favorite minion (most-used across final boards)', () => {
    const board = (...cardIds: string[]) => ({ minions: cardIds.map((cardId) => ({ cardId, attack: 1, health: 1, keywords: [] })) }) as unknown as RunHistoryEntry['board'];
    const s = careerStats([
      entry('rohan', 9, true, { board: board('alley', 'pack') }),
      entry('rohan', 9, true, { board: board('alley', 'kennel') }),
    ]);
    expect(s.favoriteMinion).toBe('Pennycat'); // 'alley' 2× vs 1× for the others
  });
});

/**
 * The verdict no longer comes from the Oath (owner 2026-08-04), and it is no longer BINARY: an eight-seat
 * lobby grades Victory / Top 4 / Defeat, because 2nd–4th score positive Rating and calling them defeats
 * contradicted the number printed beside them. Older entries predate lobbies, have no placement to grade,
 * and would ALL read as losses if the Line fallback were dropped — which is why it is kept.
 */
describe('runVerdict', () => {
  const e = (over: Partial<RunHistoryEntry>): RunHistoryEntry =>
    ({ v: 1, date: '2026-08-04', seed: 1, heroId: 'warden', wins: 5, losses: 4, draws: 0, line: 9,
       lineStatus: 'failed', completed: false, wave: 12, tags: [], tribes: [], boardsContributed: 0,
       board: null, ...over }) as RunHistoryEntry;

  it('placement 1 is a victory even when the Line was missed', () => {
    expect(runVerdict(e({ placement: 1, lineStatus: 'failed' }))).toBe('victory');
  });

  it('2nd through 4th are Top 4, not defeats — they score positive Rating', () => {
    for (const placement of [2, 3, 4]) {
      expect(runVerdict(e({ placement, lineStatus: 'failed' })), `${placement} should be top4`).toBe('top4');
    }
  });

  it('5th and below are defeats', () => {
    for (const placement of [5, 6, 7, 8]) {
      expect(runVerdict(e({ placement, lineStatus: 'flawless' })), `${placement} should be a defeat`).toBe('defeat');
    }
  });

  it('an entry with NO placement falls back to the Line and stays BINARY', () => {
    // A course run has no finish position, so there is no honest way to infer a top-4 from one.
    expect(runVerdict(e({ lineStatus: 'covered' }))).toBe('victory');
    expect(runVerdict(e({ lineStatus: 'failed' }))).toBe('defeat');
  });
});

/** Ordinals for the Career's lobby-placement chip. The 11–13 cases are the ones a last-digit rule gets wrong. */
describe('ordinal', () => {
  it('handles the ordinary cases', () => {
    expect([1, 2, 3, 4, 8].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '8th']);
  });
  it('handles the teens, which a naive last-digit rule gets wrong', () => {
    expect([11, 12, 13].map(ordinal)).toEqual(['11th', '12th', '13th']);
    expect([21, 22, 23, 111].map(ordinal)).toEqual(['21st', '22nd', '23rd', '111th']);
  });
});

describe('lobby career stats (owner recalibration 2026-08-08)', () => {
  // The course-shaped numbers are structurally 0 for lobby play, so the Career shows these instead.
  const lob = (placement: number, wins = 3): RunHistoryEntry => ({
    v: 1, date: '2026-08-08', seed: 1, heroId: 'indy', wins, losses: 2, draws: 0, line: 0,
    lineStatus: 'missed', completed: false, wave: 9, tags: [], tribes: [], boardsContributed: 0, board: null,
    placement, mode: 'lobby',
  });

  it('counts 1sts, top-4s and the average placement over lobby entries only', () => {
    // Newest-first: 1st, 3rd, 6th, 1st. Four lobby runs; three of them top 4.
    const s = careerStats([lob(1), lob(3), lob(6), lob(1)]);
    expect(s.lobbyRuns).toBe(4);
    expect(s.firsts).toBe(2);
    expect(s.topFours).toBe(3);
    expect(s.top4Rate).toBe(75);
    expect(s.avgPlacement).toBe(2.8); // (1+3+6+1)/4 = 2.75 → 2.8
    expect(s.bestPlacement).toBe(1);
  });

  it('the top-4 streak walks the newest entries and stops at the first miss', () => {
    expect(careerStats([lob(2), lob(4), lob(7), lob(1)]).lobbyStreak).toBe(2);
    expect(careerStats([lob(5), lob(1)]).lobbyStreak).toBe(0);
  });

  it('a course run neither breaks nor extends the lobby streak — it is not a lobby result', () => {
    const course: RunHistoryEntry = { ...lob(1), placement: undefined };
    expect(careerStats([lob(2), course, lob(3)]).lobbyStreak).toBe(2);
  });

  it('a history with no placements reports zero lobby runs, so the Career keeps the course stats', () => {
    const course: RunHistoryEntry = { ...lob(1), placement: undefined };
    const s = careerStats([course, course]);
    expect(s.lobbyRuns).toBe(0);
    expect(s.avgPlacement).toBeNull();
  });
});
