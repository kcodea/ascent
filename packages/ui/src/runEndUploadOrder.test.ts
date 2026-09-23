// @vitest-environment jsdom
/**
 * THE RUN-END UPLOAD ORDER (review fix 2026-09-22, the fight-ledger branch).
 *
 * `settle_rank` stamps the confirmed rank (and its own lobby-strength value) onto the run's `run_history` row
 * with a best-effort UPDATE by seed when the settlement commits, and the client has no re-stamp path (the table
 * is insert-only for clients). So the history insert must be ISSUED in the same synchronous tick as the rank
 * request and AHEAD of it — never after a network round trip. The first cut of the fight ledger held the insert
 * behind the lobby-strength fetch (up to the 4 s fetch timeout on a dead view), which let the settlement run
 * before the row existed: those runs would have shown no rank on the Career and dropped out of the MMR trend.
 *
 * Pinned here against the REAL store (`dispatch({ type: 'resolveCombat' })` on a hand-built last combat, the
 * `finalBoardPostSettle.test.ts` pattern) with the upload seams mocked and the strength fetch held open:
 *   1. `uploadRunHistory` is called before the rank request is queued / flushed;
 *   2. it is called while the strength fetch is still pending, with the `author` stamp and no `lobbyStrength`
 *      (the server's settle stamps that);
 *   3. only the TELEMETRY row waits: `uploadRunTelemetry` is not called until the strength resolves, and then
 *      carries the client's stamp on the v2 replay result (Recent Games reads that row and can never be
 *      back-stamped).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import { createLobbyRun, type BoardCard, type LobbyStrength, type RunState } from '@game/sim';

const calls: string[] = [];
let resolveStrength: (s: LobbyStrength | null) => void = () => {};

vi.mock('./remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./remoteBoards')>();
  return {
    ...mod,
    remoteEnabled: () => true,
    uploadBoards: vi.fn(async () => {}),
    uploadVictory: vi.fn(async () => {}),
    uploadRunTelemetry: vi.fn(async () => { calls.push('telemetry'); }),
    uploadRunHistory: vi.fn(async () => { calls.push('history'); }),
    uploadPlayerProfile: vi.fn(async () => {}),
    fetchRunHistory: vi.fn(async () => null),
    recordFightResult: vi.fn(async () => {}),
    recordLobbyFights: vi.fn(async () => { calls.push('fights'); }),
    fetchLobbyStrength: vi.fn(() => { calls.push('strength'); return new Promise<LobbyStrength | null>((r) => { resolveStrength = r; }); }),
    refreshOpponentPoolAndRecords: vi.fn(),
  };
});

vi.mock('./rank/rankSubmission', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./rank/rankSubmission')>();
  return {
    ...mod,
    enqueuePendingRank: vi.fn((req: unknown) => { calls.push('rank-queued'); return { ...(req as object), userId: 'me', at: 'now', attempts: 0 }; }),
    flushPendingRanks: vi.fn(async () => { calls.push('rank-sent'); }),
    installRankRetryTriggers: vi.fn(),
  };
});

import { useGame } from './store';
import { fetchLobbyStrength, uploadRunHistory, uploadRunTelemetry } from './remoteBoards';
import { enqueuePendingRank } from './rank/rankSubmission';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const alley = (): BoardCard => ({ uid: 'e', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });

/** A hand-built last combat the player wins (the lobby finishes on it, see below). */
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

describe('the run-end uploads: the history insert goes first and never waits on the strength fetch', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.mocked(uploadRunHistory).mockClear();
    vi.mocked(uploadRunTelemetry).mockClear();
    vi.mocked(fetchLobbyStrength).mockClear();
    vi.mocked(enqueuePendingRank).mockClear();
    localStorage.clear();
    useGame.setState({ playerName: 'Kev', run: finishingLobbyRun(7), showTitle: false, replaying: false, replayActions: [], capturedBoards: [], lastReplay: null });
  });
  afterEach(() => { resolveStrength(null); });

  it('history is issued in the run-end tick, ahead of the rank request, while the strength fetch is still open; only telemetry waits for the stamp', async () => {
    useGame.getState().dispatch({ type: 'resolveCombat' });
    const after = useGame.getState().run;
    expect(after.phase).toBe('gameover');
    expect(after.lobby?.finished).toBe(true);
    expect(after.lobby?.seats[0]!.placement).toBe(1);

    await sleep(30); // the run-end block is a deferred setTimeout(0)
    expect(vi.mocked(fetchLobbyStrength)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(uploadRunHistory), 'the history insert did not wait for the strength fetch').toHaveBeenCalledTimes(1);
    // The order of the issued calls: the strength fetch starts, the history insert goes, THEN the rank request.
    expect(calls.indexOf('history')).toBeGreaterThan(calls.indexOf('strength'));
    expect(calls.indexOf('history')).toBeLessThan(calls.indexOf('rank-queued'));
    expect(calls.indexOf('rank-queued')).toBeLessThan(calls.indexOf('rank-sent'));
    // The entry carries the author stamp (the Hall's join key) and NO client strength: the server stamps that.
    const entry = vi.mocked(uploadRunHistory).mock.calls[0]![0];
    expect(entry.author).toBe('Kev');
    expect(entry.seed).toBe(7);
    expect(entry.placement).toBe(1);
    expect(entry).not.toHaveProperty('lobbyStrength');
    // The rank request rode the seven seat keys.
    const req = vi.mocked(enqueuePendingRank).mock.calls[0]![0];
    expect(req.seatKeys).toHaveLength(7);
    // Telemetry has NOT gone yet: it is the one upload that waits for the stamp.
    expect(vi.mocked(uploadRunTelemetry)).not.toHaveBeenCalled();

    resolveStrength({ value: 74, tier: 'Brutal', inputs: [] });
    await sleep(30);
    expect(vi.mocked(uploadRunTelemetry)).toHaveBeenCalledTimes(1);
    const meta = vi.mocked(uploadRunTelemetry).mock.calls[0]![1] as { replay: { v2: { result: { lobbyStrength?: LobbyStrength } } } };
    expect(meta.replay.v2.result.lobbyStrength).toEqual({ value: 74, tier: 'Brutal', inputs: [] });
    expect(useGame.getState().lastReplay?.result.lobbyStrength).toEqual({ value: 74, tier: 'Brutal', inputs: [] });
    // And the history row was never re-sent with the stamp.
    expect(vi.mocked(uploadRunHistory)).toHaveBeenCalledTimes(1);
  });

  it('a strength fetch that yields nothing (dead view) still lets the telemetry row go, unstamped', async () => {
    useGame.getState().dispatch({ type: 'resolveCombat' });
    await sleep(30);
    expect(vi.mocked(uploadRunHistory)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(uploadRunTelemetry)).not.toHaveBeenCalled();
    resolveStrength(null);
    await sleep(30);
    expect(vi.mocked(uploadRunTelemetry)).toHaveBeenCalledTimes(1);
    const meta = vi.mocked(uploadRunTelemetry).mock.calls[0]![1] as { replay: { v2: { result: Record<string, unknown> } } };
    expect(meta.replay.v2.result).not.toHaveProperty('lobbyStrength');
  });
});
