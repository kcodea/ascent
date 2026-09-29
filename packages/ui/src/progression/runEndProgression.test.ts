// @vitest-environment jsdom
/**
 * ACCOUNT PROGRESSION at the RUN-END SEAM (store.ts), against the REAL store: a finishing combat is dispatched
 * (the `runEndUploadOrder.test.ts` pattern) with the upload seams and the progression entry points mocked.
 *
 *   • Ranked: the XP request is queued AFTER the rank request (the server reads the placement from the accepted
 *     rank result), with the rank run id, the settled placement and the observer's facts.
 *   • Practice: the end screen expects XP at once; the request waits for the practice row id and settles on
 *     `practice:<id>`; no row (a rejected / unconfigured upload) marks the run as earning nothing.
 *   • A sandbox run never queues progression.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import { createLobbyRun, DEFAULT_PRACTICE_CONFIG, type BoardCard, type RunState } from '@game/sim';

const calls: string[] = [];
let practiceRowId: number | null = 55;

vi.mock('../remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../remoteBoards')>()),
  remoteEnabled: () => true,
  uploadBoards: vi.fn(async () => {}),
  uploadVictory: vi.fn(async () => {}),
  uploadRunTelemetry: vi.fn(async () => {}),
  uploadRunHistory: vi.fn(async () => {}),
  uploadPlayerProfile: vi.fn(async () => {}),
  fetchRunHistory: vi.fn(async () => null),
  recordFightResult: vi.fn(async () => {}),
  recordLobbyFights: vi.fn(async () => {}),
  fetchLobbyStrength: vi.fn(async () => null),
  refreshOpponentPoolAndRecords: vi.fn(),
  uploadPracticeGame: vi.fn(async () => { calls.push('practice-row'); return practiceRowId; }),
}));
vi.mock('../rank/rankSubmission', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rank/rankSubmission')>()),
  enqueuePendingRank: vi.fn((req: unknown) => { calls.push('rank-queued'); return { ...(req as object), userId: 'me', at: 'now', attempts: 0 }; }),
  flushPendingRanks: vi.fn(async () => {}),
  installRankRetryTriggers: vi.fn(),
}));
vi.mock('./progressionStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./progressionStore')>()),
  beginRunProgression: vi.fn(() => { calls.push('xp-queued'); return true; }),
  expectRunProgression: vi.fn(() => { calls.push('xp-expected'); }),
  markRunProgressionUnavailable: vi.fn(() => { calls.push('xp-unavailable'); }),
  probeProgression: vi.fn(async () => {}),
}));

import { useGame } from '../store';
import { beginRunProgression, expectRunProgression, markRunProgressionUnavailable } from './progressionStore';
import { enqueuePendingRank } from '../rank/rankSubmission';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const alley = (): BoardCard => ({ uid: 'e', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });
function lastCombat(): CombatResult {
  return {
    result: 'win', playerDamage: 0, enemyDamage: 5, playerDeathrattles: 0, enemyDeaths: 0,
    events: [{ type: 'attack', attacker: 'c1', defender: 'x1' } as unknown as CombatResult['events'][number]],
    initial: { player: [{ uid: 'c1', cardId: 'alley', name: 'Alleycat', tribe: 'beast', attack: 1, health: 1, keywords: [] }], enemy: [] },
  };
}
/** A lobby at its last combat: only s0 and s1 stand, s1 at 1 Resolve, so this win finishes it in 1st. */
function finishing(seed: number, mode: 'lobby' | 'practice', over: Partial<RunState> = {}): RunState {
  const base = createLobbyRun(seed, 'brackus', {}, mode, mode === 'practice' ? { ...DEFAULT_PRACTICE_CONFIG, health: 'normal' } : undefined);
  // A RATED table: one recorded player run seated (an all-generated lobby is unrated, owner 2026-09-28). With no
  // pool in the test the seat's driver falls back to a hybrid, exactly as a restored seat without its run does.
  const lobby = { ...base.lobby!, unrated: undefined, seats: base.lobby!.seats.map((s) => (s.id === 's2' ? { ...s, kind: 'snapshot' as const, runKey: 'Rival|drakko|99' } : { ...s })) };
  for (const s of lobby.seats) if (s.id !== 's0' && s.id !== 's1') { s.alive = false; s.placement = 3; }
  const s1 = lobby.seats.find((s) => s.id === 's1')!;
  s1.resolve = 1; s1.armor = 0;
  return { ...base, lobby, phase: 'combat', combatSettled: false, board: [alley()], lastCombat: lastCombat(), ...over };
}

beforeEach(() => {
  calls.length = 0;
  practiceRowId = 55;
  vi.mocked(beginRunProgression).mockClear();
  vi.mocked(expectRunProgression).mockClear();
  vi.mocked(markRunProgressionUnavailable).mockClear();
  vi.mocked(enqueuePendingRank).mockClear();
  localStorage.clear();
});

describe('run-end progression', () => {
  it('ranked: queued after the rank request, on the rank run id, with the settled placement and observer facts', async () => {
    useGame.setState({ playerName: 'Kev', run: { ...finishing(7, 'lobby'), runId: 'rank-run-7' }, showTitle: false, replaying: false, replayActions: [], capturedBoards: [], lastReplay: null });
    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(useGame.getState().run.phase).toBe('gameover');
    await sleep(30);
    expect(calls.indexOf('rank-queued')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('xp-queued')).toBeGreaterThan(calls.indexOf('rank-queued'));
    const [localKey, facts] = vi.mocked(beginRunProgression).mock.calls[0]!;
    const rankReq = vi.mocked(enqueuePendingRank).mock.calls[0]![0];
    expect(localKey).toBe('7');
    expect(facts).toMatchObject({ version: 2, mode: 'ranked', runId: rankReq.runId, placement: 1, terminal: true, heroId: 'brackus' });
    expect((facts as { metrics?: unknown }).metrics).toBeTypeOf('object'); // the observer's run metrics ride along (achievements batch 1)
  });

  it('practice: expected at once, then settled on the uploaded row id', async () => {
    useGame.setState({ playerName: 'Kev', run: finishing(8, 'practice'), showTitle: false, replaying: false, replayActions: [], capturedBoards: [], lastReplay: null });
    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(vi.mocked(expectRunProgression)).toHaveBeenCalledWith('8', 'practice');
    await sleep(30);
    expect(calls).toEqual(['xp-expected', 'practice-row', 'xp-queued']);
    const [localKey, facts, sourceId] = vi.mocked(beginRunProgression).mock.calls[0]!;
    expect(localKey).toBe('8');
    expect(sourceId).toBe(55);
    expect(facts).toMatchObject({ mode: 'practice', runId: 'practice:55', placement: 1, terminal: true });
    expect(vi.mocked(enqueuePendingRank)).not.toHaveBeenCalled();
  });

  it('practice with no recorded row earns nothing (the end screen stops waiting)', async () => {
    practiceRowId = null;
    useGame.setState({ playerName: 'Kev', run: finishing(9, 'practice'), showTitle: false, replaying: false, replayActions: [], capturedBoards: [], lastReplay: null });
    useGame.getState().dispatch({ type: 'resolveCombat' });
    await sleep(30);
    expect(vi.mocked(markRunProgressionUnavailable)).toHaveBeenCalledWith('9');
    expect(vi.mocked(beginRunProgression)).not.toHaveBeenCalled();
  });

  it('a sandbox run never queues progression', async () => {
    useGame.setState({ playerName: 'Kev', run: finishing(10, 'lobby', { sandbox: true }), showTitle: false, replaying: false, replayActions: [], capturedBoards: [], lastReplay: null });
    useGame.getState().dispatch({ type: 'resolveCombat' });
    await sleep(30);
    expect(vi.mocked(beginRunProgression)).not.toHaveBeenCalled();
    expect(vi.mocked(expectRunProgression)).not.toHaveBeenCalled();
  });
});
