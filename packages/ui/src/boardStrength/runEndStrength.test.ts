// @vitest-environment jsdom
/**
 * BOARD STRENGTH at run end (R-LOBBY-09, 2026-09-30), through the REAL store: the captured boards are scored in the
 * background, the boards upload with their scores, and the run's percentile is frozen into the history entry (the
 * Career row), the replay result (the Recent Games row) and Match details. Without the pool's histogram nothing is
 * frozen (never a guess), and the uploads still go out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import { createLobbyRun, loadStrengthReference, parseMatchDetails, scoreBoard, type BoardCard, type BoardSnapshot, type RunState, type StrengthHistogram } from '@game/sim';

let hist: StrengthHistogram | null = null;
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
    recordFightResult: vi.fn(async () => {}),
    recordLobbyFights: vi.fn(async () => {}),
    refreshOpponentPoolAndRecords: vi.fn(),
    strengthHistogram: () => hist,
  };
});

import { useGame } from '../store';
import { uploadBoards, uploadRunHistory } from '../remoteBoards';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const alley = (): BoardCard => ({ uid: 'e', cardId: 'alley', tribe: 'beast', attack: 3, health: 2, keywords: [], golden: false });
const combat = (): CombatResult => ({
  result: 'lose', playerDamage: 9, enemyDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, events: [],
  initial: { player: [{ uid: 'c1', cardId: 'alley', name: 'Alleycat', tribe: 'beast', attack: 3, health: 2, keywords: [] }], enemy: [] },
});

async function finishWith(captured: BoardSnapshot[], seed: number): Promise<void> {
  const base = createLobbyRun(seed, 'brackus', {}, 'lobby', undefined, 'set2');
  const lobby = { ...base.lobby!, round: 2, seats: base.lobby!.seats.map((s) => ({ ...s })) };
  lobby.seats[0]!.resolve = 1; lobby.seats[0]!.armor = 0;
  const run: RunState = { ...base, lobby, wave: 2, phase: 'combat', combatSettled: false, board: [alley()], resolve: 1, armor: 0 };
  useGame.setState({ run: { ...run, lastCombat: combat() }, showTitle: false, replaying: false, replayActions: [], capturedBoards: captured, lastReplay: null, lastMatch: null });
  useGame.getState().dispatch({ type: 'resolveCombat' });
  expect(useGame.getState().run.phase).toBe('gameover');
  for (let i = 0; i < 200 && vi.mocked(uploadRunHistory).mock.calls.length === 0; i++) await sleep(25);
}

describe('run end freezes the board strength', () => {
  beforeEach(() => { vi.mocked(uploadRunHistory).mockClear(); vi.mocked(uploadBoards).mockClear(); localStorage.clear(); });

  it('scores the captured boards, uploads them with their scores, and freezes the percentile on the record', async () => {
    const ref = await loadStrengthReference();
    const captured = [1, 2].map((w) => ({ ...ref.waves[String(w)]![10]!, wave: w } as BoardSnapshot));
    const scores = captured.map((b) => scoreBoard({ ...b, setId: 'set2' }, ref)!);
    // A pool where every board at those waves scored exactly 0.5.
    hist = { '1': [{ raw: 0.5, count: 9 }], '2': [{ raw: 0.5, count: 9 }] };
    await finishWith(captured, 31);
    const uploaded = vi.mocked(uploadBoards).mock.calls[0]![0] as Array<BoardSnapshot & { strengthScore?: unknown }>;
    expect(uploaded.map((b) => b.strengthScore)).toEqual(scores);
    const pct = (raw: number): number => (raw > 0.5 ? 95 : raw < 0.5 ? 5 : 50);
    const want = Math.round((pct(scores[0]!.raw) + pct(scores[1]!.raw)) / 2);
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
