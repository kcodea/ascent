// @vitest-environment jsdom
/**
 * LOBBY STRENGTH IS THE FIELD GOING IN (owner 2026-09-22: "the lobby difficulty shows 47 in my career and 50 in
 * recent games, why"). The client's stamp (Recent Games) and the server's (Career) must agree, so the client
 * subtracts the fights of the lobby it is about to upload from what the view reports, exactly as `settle_rank`
 * excludes them by seed. This pins the store's side: the run-end tick hands `fetchLobbyStrength` this lobby's
 * own fight rows (the same rows it uploads), and the fetch folds them out before the formula. The upload seams
 * are mocked; the reducer, the lobby and the run-end block are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import { createLobbyRun, excludeOwnFights, lobbyStrengthOf, type BoardCard, type FightRow, type LobbyStrength, type RunState } from '@game/sim';

let resolveStrength: (s: LobbyStrength | null) => void = () => {};

vi.mock('./remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./remoteBoards')>();
  return {
    ...mod,
    uploadBoards: vi.fn(async () => {}),
    uploadVictory: vi.fn(async () => {}),
    uploadRunTelemetry: vi.fn(async () => {}),
    uploadRunHistory: vi.fn(async () => {}),
    uploadPlayerProfile: vi.fn(async () => {}),
    fetchRunHistory: vi.fn(async () => null),
    recordFightResult: vi.fn(async () => {}),
    recordLobbyFights: vi.fn(async () => {}),
    fetchLobbyStrength: vi.fn(() => new Promise<LobbyStrength | null>((r) => { resolveStrength = r; })),
    refreshOpponentPoolAndRecords: vi.fn(),
  };
});
vi.mock('./rank/rankSubmission', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./rank/rankSubmission')>();
  return {
    ...mod,
    enqueuePendingRank: vi.fn((req: unknown) => ({ ...(req as object), userId: 'me', at: 'now', attempts: 0 })),
    flushPendingRanks: vi.fn(async () => {}),
    installRankRetryTriggers: vi.fn(),
  };
});

import { useGame } from './store';
import { fetchLobbyStrength, recordLobbyFights } from './remoteBoards';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const alley = (): BoardCard => ({ uid: 'e', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });

function lastCombat(): CombatResult {
  return {
    result: 'win', playerDamage: 0, enemyDamage: 5, playerDeathrattles: 0, enemyDeaths: 0,
    events: [{ type: 'attack', attacker: 'c1', defender: 'x1' } as unknown as CombatResult['events'][number]],
    initial: { player: [{ uid: 'c1', cardId: 'alley', name: 'Alleycat', tribe: 'beast', attack: 1, health: 1, keywords: [] }], enemy: [] },
  };
}

/** A real lobby run at its last combat: only the player and s1 stand, s1 at 1 Resolve, so the win finishes it. */
function finishingLobbyRun(seed: number): RunState {
  const base = createLobbyRun(seed, 'brackus');
  const lobby = { ...base.lobby!, seats: base.lobby!.seats.map((s) => ({ ...s })) };
  for (const s of lobby.seats) if (s.id !== 's0' && s.id !== 's1') { s.alive = false; s.placement = 3; }
  const s1 = lobby.seats.find((s) => s.id === 's1')!;
  s1.resolve = 1; s1.armor = 0;
  return { ...base, lobby, phase: 'combat', combatSettled: false, board: [alley()], lastCombat: lastCombat() };
}

describe('lobby strength is the field going in', () => {
  beforeEach(() => {
    vi.mocked(fetchLobbyStrength).mockClear();
    vi.mocked(recordLobbyFights).mockClear();
    localStorage.clear();
    useGame.setState({ playerName: 'Kev', run: finishingLobbyRun(7), showTitle: false, replaying: false, replayActions: [], capturedBoards: [], lastReplay: null });
  });
  afterEach(() => { resolveStrength(null); });

  it('the run-end tick hands the strength fetch the SAME fight rows it uploads for this lobby', async () => {
    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(useGame.getState().run.phase).toBe('gameover');
    await sleep(30); // the run-end block is a deferred setTimeout(0)
    expect(vi.mocked(recordLobbyFights)).toHaveBeenCalledTimes(1);
    const uploaded = vi.mocked(recordLobbyFights).mock.calls[0]![0] as FightRow[];
    expect(uploaded.length).toBeGreaterThan(0);
    expect(uploaded.every((r) => r.lobbySeed === 7)).toBe(true);
    expect(vi.mocked(fetchLobbyStrength)).toHaveBeenCalledTimes(1);
    const [keys, ownRows] = vi.mocked(fetchLobbyStrength).mock.calls[0]!;
    expect(keys).toHaveLength(7);
    expect(ownRows).toBe(uploaded); // the very rows, not a copy of something else
  });

  it('the owner\'s case: seven unserved opponents read 50 going in; the same seven WITH this game folded in read lower; subtracting the game restores 50', () => {
    const keys = ['a|h|1', 'b|h|2', 'c|h|3', 'd|h|4', 'e|h|5', 'f|h|6', 'g|h|7'];
    const before = lobbyStrengthOf(keys.map((key) => ({ key, fights: 0, wins: 0 })));
    expect(before.value).toBe(50);
    // This lobby's rows: the reporter beat everyone once; the others split their games.
    const own: FightRow[] = [
      ...keys.map((k, i) => ({ lobbySeed: 9, round: i + 1, runA: 'me|h|9', runB: k, outcome: 'a' as const, observed: true, patch: 't' })),
      { lobbySeed: 9, round: 1, runA: 'a|h|1', runB: 'b|h|2', outcome: 'a', observed: true, patch: 't' },
      { lobbySeed: 9, round: 2, runA: 'c|h|3', runB: 'd|h|4', outcome: 'b', observed: false, patch: 't' },
    ];
    // What the view reports AFTER those rows land (each key: its fights and wins from `own`).
    const after = keys.map((key) => ({
      key,
      fights: own.filter((r) => r.runA === key || r.runB === key).length,
      wins: own.filter((r) => (r.runA === key && r.outcome === 'a') || (r.runB === key && r.outcome === 'b')).length,
    }));
    expect(lobbyStrengthOf(after).value).toBeLessThan(50); // the game itself dragged the field down
    expect(lobbyStrengthOf(excludeOwnFights(after, own))).toMatchObject({ value: 50 });
    expect(excludeOwnFights(after, own).every((i) => i.fights === 0 && i.wins === 0)).toBe(true);
  });

  it('subtracting never goes below zero and leaves a key the rows do not name untouched', () => {
    const rows: FightRow[] = [{ lobbySeed: 1, round: 1, runA: 'x', runB: 'y', outcome: 'a', observed: true, patch: 't' }];
    expect(excludeOwnFights([{ key: 'x', fights: 0, wins: 0 }, { key: 'z', fights: 5, wins: 2 }], rows))
      .toEqual([{ key: 'x', fights: 0, wins: 0 }, { key: 'z', fights: 5, wins: 2 }]);
    expect(excludeOwnFights([{ key: 'y', fights: 3, wins: 1 }], rows)).toEqual([{ key: 'y', fights: 2, wins: 1 }]);
  });
});
