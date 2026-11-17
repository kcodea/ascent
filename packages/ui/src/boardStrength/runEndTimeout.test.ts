// @vitest-environment jsdom
/**
 * THE SAFETY LIMIT of the run-end scoring (strength v2, owner 2026-11-16: Continue is greyed out while the game is
 * scored; the design's limit: "after 5 seconds Continue unlocks regardless and the run goes up with what is ready
 * (an incomplete run is unscored). The button must never stay locked"). Here the limit is shrunk to 1 ms, so the
 * scoring can never finish in time: the lock must still clear at once.
 *
 * WHAT HAPPENS TO THE GAME THEN (owner 2026-11-16, asked "Should a slow device's game finish scoring after Continue
 * unlocks at 5 seconds?": "Yes, finish scoring"): the Career row, the rank and everything else go out at the limit as
 * before, but the BOARDS wait for the scoring to finish and then go up once, complete, with their carried scores. A
 * slow device's game is scored like anyone else's instead of being left unscored.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import { createLobbyRun, loadStrengthReference, type BoardCard, type BoardSnapshot, type RunState } from '@game/sim';

vi.mock('../remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../remoteBoards')>();
  return {
    ...mod,
    uploadBoards: vi.fn(async () => {}), uploadVictory: vi.fn(async () => {}), uploadRunTelemetry: vi.fn(async () => {}),
    uploadRunHistory: vi.fn(async () => {}), uploadPlayerProfile: vi.fn(async () => {}), uploadPracticeGame: vi.fn(async () => null),
    fetchRunHistory: vi.fn(async () => null), fetchCareerTotals: vi.fn(async () => null), recordLobbyFights: vi.fn(async () => {}),
    refreshOpponentPoolAndRecords: vi.fn(), strengthHistogram: () => null, runStrengthHistogram: () => null,
  };
});
vi.mock('./index', async (importOriginal) => ({ ...(await importOriginal<typeof import('./index')>()), STRENGTH_RUN_END_WAIT_MS: 1 }));

import { useGame } from '../store';
import { uploadBoards, uploadRunHistory } from '../remoteBoards';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const alley = (): BoardCard => ({ uid: 'e', cardId: 'alley', tribe: 'beast', attack: 3, health: 2, keywords: [], golden: false });
const combat = (): CombatResult => ({
  result: 'lose', playerDamage: 9, enemyDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, events: [],
  initial: { player: [{ uid: 'c1', cardId: 'alley', name: 'Alleycat', tribe: 'beast', attack: 3, health: 2, keywords: [] }], enemy: [] },
});

describe('the run-end scoring never holds Continue past its limit', () => {
  beforeEach(() => { vi.mocked(uploadRunHistory).mockClear(); vi.mocked(uploadBoards).mockClear(); localStorage.clear(); });

  it('past the limit: the lock clears and the record goes out; the boards follow when the scoring is done, complete', async () => {
    const ref = await loadStrengthReference();
    const captured = [1, 2, 3, 4, 5, 6, 7].map((w) => ({ ...ref.waves[String(w)]![10]!, wave: w, id: `t${w}` } as BoardSnapshot));
    const base = createLobbyRun(51, 'brackus', {}, 'lobby', undefined, 'set2');
    const lobby = { ...base.lobby!, round: 2, seats: base.lobby!.seats.map((s) => ({ ...s })) };
    lobby.seats[0]!.resolve = 1; lobby.seats[0]!.armor = 0;
    const run: RunState = { ...base, lobby, wave: 2, phase: 'combat', combatSettled: false, board: [alley()], resolve: 1, armor: 0 };
    useGame.setState({ run: { ...run, lastCombat: combat() }, showTitle: false, replaying: false, replayActions: [], capturedBoards: captured, lastReplay: null, lastMatch: null });
    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(useGame.getState().run.phase).toBe('gameover');
    expect(useGame.getState().runScoring).not.toBeNull(); // held the moment the game ended
    for (let i = 0; i < 200 && vi.mocked(uploadRunHistory).mock.calls.length === 0; i++) await sleep(25);
    // At the limit: unlocked, the Career row is out, and the boards are NOT (they would be unscored).
    expect(useGame.getState().runScoring).toBeNull();
    expect(vi.mocked(uploadRunHistory).mock.calls).toHaveLength(1);
    expect(vi.mocked(uploadBoards).mock.calls).toHaveLength(0);
    // The scoring carries on behind the unlocked screen, then the boards go up ONCE, every one scored, the last one
    // with its carried rounds.
    for (let i = 0; i < 2400 && vi.mocked(uploadBoards).mock.calls.length === 0; i++) await sleep(25);
    expect(vi.mocked(uploadBoards).mock.calls).toHaveLength(1);
    const uploaded = vi.mocked(uploadBoards).mock.calls[0]![0] as Array<BoardSnapshot & { strengthScore?: unknown; strengthCarried?: { rounds: Record<string, number> } }>;
    expect(uploaded).toHaveLength(7);
    expect(uploaded.every((b) => b.strengthScore)).toBe(true);
    expect(Object.keys(uploaded.find((b) => b.wave === 7)!.strengthCarried!.rounds)).toEqual(['8', '9', '10', '11', '12', '13', '14', '15']);
    expect(uploaded.filter((b) => b.wave !== 7).every((b) => b.strengthCarried === undefined)).toBe(true);
    expect(useGame.getState().runScoring).toBeNull(); // the lock never came back
  }, 90_000);
});
