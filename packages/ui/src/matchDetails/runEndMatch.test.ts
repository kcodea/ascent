// @vitest-environment jsdom
/**
 * MATCH DETAILS at run end (owner ask 2026-09-28): the REAL store's run-end blocks record the table once, show it on
 * the end screen (`lastMatch`, keyed by seed) and save it into the run's own record: the ranked `run_history` entry
 * (`entry.match`) and the practice row's `replay` payload (`replay.match`). Driven the way
 * `finalBoardPostSettle.test.ts` drives it: a hand-built last combat, `dispatch({ type: 'resolveCombat' })`, and the
 * mocked upload seams.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import { createLobbyRun, driverFor, parseMatchDetails, type BoardCard, type RunState } from '@game/sim';

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
  };
});

import { useGame } from '../store';
import { uploadPracticeGame, uploadRunHistory } from '../remoteBoards';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const alley = (): BoardCard => ({ uid: 'e', cardId: 'alley', tribe: 'beast', attack: 3, health: 2, keywords: [], golden: false });
const combat = (result: CombatResult['result'], playerDamage: number, enemyDamage: number): CombatResult => ({
  result, playerDamage, enemyDamage, playerDeathrattles: 0, enemyDeaths: 0, events: [],
  initial: { player: [{ uid: 'c1', cardId: 'alley', name: 'Alleycat', tribe: 'beast', attack: 3, health: 2, keywords: [] }], enemy: [] },
});

/** A lobby at round `round` where s3 and s5 fell earlier (rounds 2 and 3). */
function lobbyRun(seed: number, mode: 'lobby' | 'practice', round: number): RunState {
  const base = createLobbyRun(seed, 'brackus', {}, mode, mode === 'practice' ? { opponents: 'bots', botDifficulty: 3, health: 'normal', timeMult: 0, tribes: [] } as never : undefined);
  const lobby = { ...base.lobby!, round, seats: base.lobby!.seats.map((s) => ({ ...s })) };
  const fell = [['s3', 2, 8], ['s5', 3, 7]] as const;
  for (const [id, r, p] of fell) { const s = lobby.seats.find((x) => x.id === id)!; s.alive = false; s.eliminatedRound = r; s.placement = p; s.resolve = 0; s.armor = 0; }
  return { ...base, lobby, wave: round, phase: 'combat', combatSettled: false, board: [alley()] };
}

describe('run end records the match', () => {
  beforeEach(() => {
    vi.mocked(uploadRunHistory).mockClear();
    vi.mocked(uploadPracticeGame).mockClear();
    localStorage.clear();
  });

  it('a RANKED knockout: the history entry carries the table at the knockout round, and the end screen gets the same record', async () => {
    const run = lobbyRun(11, 'lobby', 6);
    run.lobby!.seats[0]!.resolve = 1; run.lobby!.seats[0]!.armor = 0; run.resolve = 1; run.armor = 0;
    useGame.setState({ run: { ...run, lastCombat: combat('lose', 9, 0) }, showTitle: false, replaying: false, replayActions: [], capturedBoards: [], lastReplay: null, lastMatch: null });
    useGame.getState().dispatch({ type: 'resolveCombat' });
    const after = useGame.getState().run;
    expect(after.phase).toBe('gameover');
    await sleep(30);

    const entry = vi.mocked(uploadRunHistory).mock.calls[0]![0] as Record<string, unknown>;
    const match = parseMatchDetails(entry.match)!;
    expect(match).not.toBeNull();
    expect(useGame.getState().lastMatch).toEqual({ seed: after.seed, details: entry.match });
    expect(match.eliminated).toBe(true);
    expect(match.endRound).toBe(6);
    expect(match.seats).toHaveLength(8);
    // seats that fell earlier show their knockout board; everyone standing, the knockout round's
    const s3 = match.seats.find((s) => s.id === 's3')!;
    expect(s3.board?.round).toBe(2);
    const standing = match.seats.find((s) => !s.self && s.placement === undefined)!;
    expect(standing.board?.round).toBe(6);
    const fielded = driverFor(after.lobby!.seats.find((s) => s.id === standing.id)!, after.lobby!.setId)!.prepare(6)!;
    expect(standing.board!.minions.map((m) => [m.cardId, m.attack, m.health])).toEqual(fielded.minions.map((m) => [m.cardId, m.attack, m.health]));
    // you: your end-state board, your name
    const me = match.seats.find((s) => s.self)!;
    expect(me.board!.minions[0]!.cardId).toBe('alley');
    // the whole record stays small
    expect(JSON.stringify(entry.match).length).toBeLessThan(16_000);
  });

  it('a PRACTICE game: the row\'s replay payload carries the match', async () => {
    const run = lobbyRun(12, 'practice', 5);
    run.lobby!.seats[0]!.resolve = 1; run.lobby!.seats[0]!.armor = 0; run.resolve = 1; run.armor = 0;
    useGame.setState({ run: { ...run, lastCombat: combat('lose', 9, 0) }, showTitle: false, replaying: false, replayActions: [], capturedBoards: [], lastReplay: null, lastMatch: null });
    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(useGame.getState().run.phase).toBe('gameover');
    await sleep(30);
    expect(vi.mocked(uploadRunHistory)).not.toHaveBeenCalled(); // practice never touches the ladder tables
    const upload = vi.mocked(uploadPracticeGame).mock.calls[0]![0];
    const match = parseMatchDetails(upload.replay?.match)!;
    expect(match.endRound).toBe(5);
    expect(match.seats.filter((s) => s.bot)).toHaveLength(7); // Practice's bot table
    expect(useGame.getState().lastMatch?.details).toEqual(upload.replay?.match);
  });
});
