// @vitest-environment jsdom
/**
 * BOARD STRENGTH at run end (R-LOBBY-09, 2026-09-30), through the REAL store: the captured boards are scored in the
 * background, the boards upload with their scores, and the run's percentile is frozen into the history entry (the
 * Career row), the replay result (the Recent Games row) and Match details. That number is the run's round-weighted
 * average ranked among the pool's runs (R-LOBBY-12: restored 2026-10-06 after three days of the final board's
 * percentile, so the run-average histogram is read again). Without the pool's histogram nothing is
 * frozen (never a guess), and the uploads still go out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import { createLobbyRun, loadStrengthReference, parseMatchDetails, scoreBoard, type BoardCard, type BoardSnapshot, type RunState, type StrengthHistogram } from '@game/sim';

let hist: StrengthHistogram | null = null;
let runHist: Array<{ avg: number; count: number }> | null = null;
vi.mock('../remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../remoteBoards')>();
  return {
    ...mod,
    uploadBoards: vi.fn(async () => {}),
    uploadVictory: vi.fn(async () => {}),
    uploadRunTelemetry: vi.fn(async () => {}),
    uploadRunHistory: vi.fn(async () => {}),
    uploadPlayerProfile: vi.fn(async () => {}),
    uploadPracticeGame: vi.fn(async () => null),
    fetchRunHistory: vi.fn(async () => null),
    fetchCareerTotals: vi.fn(async () => null),
    recordLobbyFights: vi.fn(async () => {}),
    refreshOpponentPoolAndRecords: vi.fn(),
    strengthHistogram: () => hist,
    runStrengthHistogram: () => runHist,
  };
});

import { useGame } from '../store';
import { carriedUploadOf, finalBoardOf, shouldScoreRunEnd } from './index';
import { uploadBoards, uploadRunHistory } from '../remoteBoards';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const alley = (): BoardCard => ({ uid: 'e', cardId: 'alley', tribe: 'beast', attack: 3, health: 2, keywords: [], golden: false });
const combat = (): CombatResult => ({
  result: 'lose', playerDamage: 9, enemyDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, events: [],
  initial: { player: [{ uid: 'c1', cardId: 'alley', name: 'Alleycat', tribe: 'beast', attack: 3, health: 2, keywords: [] }], enemy: [] },
});

async function finishWith(captured: BoardSnapshot[], seed: number, waitMs = 5000): Promise<void> {
  const base = createLobbyRun(seed, 'brackus', {}, 'lobby', undefined, 'set2');
  const lobby = { ...base.lobby!, round: 2, seats: base.lobby!.seats.map((s) => ({ ...s })) };
  lobby.seats[0]!.resolve = 1; lobby.seats[0]!.armor = 0;
  const run: RunState = { ...base, lobby, wave: 2, phase: 'combat', combatSettled: false, board: [alley()], resolve: 1, armor: 0 };
  useGame.setState({ run: { ...run, lastCombat: combat() }, showTitle: false, replaying: false, replayActions: [], capturedBoards: captured, lastReplay: null, lastMatch: null });
  useGame.getState().dispatch({ type: 'resolveCombat' });
  expect(useGame.getState().run.phase).toBe('gameover');
  for (let i = 0; i < waitMs / 25 && vi.mocked(uploadRunHistory).mock.calls.length === 0; i++) await sleep(25);
}

describe('run end freezes the board strength', () => {
  beforeEach(() => { vi.mocked(uploadRunHistory).mockClear(); vi.mocked(uploadBoards).mockClear(); localStorage.clear(); });

  it('scores the captured boards, uploads them with their scores, and freezes the percentile on the record', async () => {
    const ref = await loadStrengthReference();
    const captured = [1, 2].map((w) => ({ ...ref.waves[String(w)]![10]!, wave: w } as BoardSnapshot));
    const scores = captured.map((b) => scoreBoard({ ...b, setId: 'set2' }, ref)!);
    // A pool where every board at those waves scored exactly 0.5.
    hist = { '1': [{ raw: 0.5, count: 9 }], '2': [{ raw: 0.5, count: 9 }] };
    // …and a pool of 10 runs: 4 averaging 20, 4 averaging 50, 2 averaging 95.
    runHist = [{ avg: 20, count: 4 }, { avg: 50, count: 4 }, { avg: 95, count: 2 }];
    await finishWith(captured, 31);
    const uploaded = vi.mocked(uploadBoards).mock.calls[0]![0] as Array<BoardSnapshot & { strengthScore?: unknown }>;
    expect(uploaded.map((b) => b.strengthScore)).toEqual(scores);
    const pct = (raw: number): number => (raw > 0.5 ? 95 : raw < 0.5 ? 5 : 50);
    const avg = Math.round((pct(scores[0]!.raw) + pct(scores[1]!.raw)) / 2);
    // The frozen number is the run's AVERAGE ranked among the pool's runs (itself counted once): 11 runs in all.
    const below = runHist.filter((r) => r.avg < avg).reduce((a, r) => a + r.count, 0);
    const equal = 1 + runHist.filter((r) => r.avg === avg).reduce((a, r) => a + r.count, 0);
    const want = Math.min(100, Math.max(1, Math.floor((2 * (200 * below + 100 * equal) + 22) / 44)));
    const entry = vi.mocked(uploadRunHistory).mock.calls[0]![0] as Record<string, unknown>;
    expect(entry.boardStrength).toBe(want);
    const me = parseMatchDetails(entry.match)!.seats.find((s) => s.self)!;
    expect(me.strength).toBe(want);
    expect(me.roundStrength).toEqual([{ round: 1, value: pct(scores[0]!.raw) }, { round: 2, value: pct(scores[1]!.raw) }]);
    expect(useGame.getState().lastReplay?.result.boardStrength).toBe(want);
  }, 30_000);

  it('without the histogram (the SQL not run): the boards still upload with their raw scores, nothing is frozen', async () => {
    const ref = await loadStrengthReference();
    hist = null;
    await finishWith([{ ...ref.waves['3']![4]!, wave: 3 } as BoardSnapshot], 32);
    const uploaded = vi.mocked(uploadBoards).mock.calls[0]![0] as Array<BoardSnapshot & { strengthScore?: unknown }>;
    expect(uploaded[0]!.strengthScore).toBeTruthy();
    const entry = vi.mocked(uploadRunHistory).mock.calls[0]![0] as Record<string, unknown>;
    expect(entry.boardStrength).toBeUndefined();
    expect(parseMatchDetails(entry.match)!.seats.find((s) => s.self)!.strength).toBeUndefined();
    expect(useGame.getState().lastReplay?.result.boardStrength).toBeUndefined();
  }, 30_000);
});

/**
 * STRENGTH V2 AT RUN END (owner 2026-11-16): a lobby game that reached round 7 is scored in full before it uploads.
 * Its final board is scored against every later reference round (the carried scores, on the final board's row only),
 * and `runScoring` (the end screen's "Calculating Score" lock) is set while that runs and null when it is done.
 */
describe('run end scores the run in full before it uploads', () => {
  beforeEach(() => { vi.mocked(uploadRunHistory).mockClear(); vi.mocked(uploadBoards).mockClear(); localStorage.clear(); hist = null; runHist = null; });

  it('the gate: a lobby game that reached round 7, and nothing else', () => {
    const boards = (last: number): { wave: number }[] => Array.from({ length: last }, (_, i) => ({ wave: i + 1 }));
    expect(shouldScoreRunEnd({ mode: 'lobby' }, boards(12))).toBe(true);
    expect(shouldScoreRunEnd({ mode: 'lobby' }, boards(7))).toBe(true);
    expect(shouldScoreRunEnd({ mode: 'lobby' }, boards(6))).toBe(false);
    expect(shouldScoreRunEnd({ mode: 'lobby', sandbox: true }, boards(12))).toBe(false);
    expect(shouldScoreRunEnd({ mode: 'lobby' }, [])).toBe(false);
    expect(shouldScoreRunEnd({ mode: 'lobby' }, null)).toBe(false);
    for (const mode of ['practice', 'tutorial', 'gauntlet', 'versus'] as const) expect(shouldScoreRunEnd({ mode }, boards(12)), mode).toBe(false);
  });

  it('the carried map goes up only when every round to 15 is there', () => {
    const all = new Map([13, 14, 15].map((r) => [r, r / 100] as const));
    expect(carriedUploadOf(12, all)).toEqual({ ref: 'set2-v2', rounds: { '13': 0.13, '14': 0.14, '15': 0.15 } });
    expect(carriedUploadOf(12, new Map([[13, 0.1], [15, 0.2]]))).toBeNull();
    expect(carriedUploadOf(15, new Map())).toEqual({ ref: 'set2-v2', rounds: {} });
    expect(carriedUploadOf(17, new Map())).toEqual({ ref: 'set2-v2', rounds: {} });
    expect(finalBoardOf([{ wave: 2, id: 'a' }, { wave: 9, id: 'b' }, { wave: 9, id: 'c' }])).toEqual({ wave: 9, id: 'b' });
    expect(finalBoardOf([])).toBeNull();
  });

  it('a 7-round game: Continue is held while it scores, then its last board carries rounds 8-15 and no other board does', async () => {
    const ref = await loadStrengthReference();
    const captured = [1, 2, 3, 4, 5, 6, 7].map((w) => ({ ...ref.waves[String(w)]![10]!, wave: w, id: `b${w}` } as BoardSnapshot));
    const final = { ...captured[6]!, setId: 'set2' } as BoardSnapshot;
    const seen: Array<{ done: number; total: number } | null> = [];
    const stop = useGame.subscribe((st) => { if (seen[seen.length - 1] !== st.runScoring) seen.push(st.runScoring); });
    const t0 = Date.now();
    await finishWith(captured, 41, 20_000);
    console.log(`7-round run end scored in ${Date.now() - t0} ms`);
    stop();
    // Held the moment the game ended, with real numbers, and released when the work was done.
    const held = seen.filter((x): x is { done: number; total: number } => x !== null);
    expect(held.length).toBeGreaterThan(0);
    expect(held[0]!.total).toBeGreaterThan(0);
    expect(held[0]!.done).toBeLessThan(held[0]!.total);
    for (let i = 1; i < held.length; i++) expect(held[i]!.done).toBeGreaterThanOrEqual(held[i - 1]!.done);
    expect(useGame.getState().runScoring).toBeNull();
    const uploaded = vi.mocked(uploadBoards).mock.calls[0]![0] as Array<BoardSnapshot & { strengthScore?: unknown; strengthCarried?: { ref: string; rounds: Record<string, number> } }>;
    expect(uploaded).toHaveLength(7);
    expect(uploaded.every((b) => b.strengthScore)).toBe(true);
    const last = uploaded.find((b) => b.wave === 7)!;
    expect(last.strengthCarried!.ref).toBe('set2-v2');
    expect(Object.keys(last.strengthCarried!.rounds)).toEqual(['8', '9', '10', '11', '12', '13', '14', '15']);
    for (const round of [8, 12, 15]) expect(last.strengthCarried!.rounds[String(round)]).toBe(scoreBoard(final, ref, round)!.raw);
    expect(uploaded.filter((b) => b.wave !== 7).every((b) => b.strengthCarried === undefined)).toBe(true);
  }, 60_000);

  it('a game that ended before round 7 is never held and carries nothing (it can never be an opponent)', async () => {
    const ref = await loadStrengthReference();
    const captured = [1, 2, 3].map((w) => ({ ...ref.waves[String(w)]![10]!, wave: w, id: `s${w}` } as BoardSnapshot));
    const seen: unknown[] = [];
    const stop = useGame.subscribe((st) => { if (st.runScoring !== null) seen.push(st.runScoring); });
    await finishWith(captured, 42);
    stop();
    expect(seen).toEqual([]);
    const uploaded = vi.mocked(uploadBoards).mock.calls[0]![0] as Array<BoardSnapshot & { strengthCarried?: unknown }>;
    expect(uploaded).toHaveLength(3);
    expect(uploaded.every((b) => b.strengthCarried === undefined)).toBe(true);
  }, 30_000);
});
