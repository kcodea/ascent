// @vitest-environment jsdom
/**
 * QUITTING COSTS RATING (owner 2026-09-29, R-RANK-05), verbatim: "yes, quitting an official game should lose you
 * MMR relative to the lowest available place when you quit. for example. if one player was already out, then
 * quitting would place you in 7th place. losing you MMR".
 *
 * Pinned against the REAL store with the rank queue mocked (the `runEndUploadOrder.test.ts` pattern):
 *   - discarding an unfinished RATED save (title Clear) settles it at the lowest open place (8th / 7th);
 *   - starting a new game over it (`pickHero`) does the same;
 *   - a practice save, an all-generated (unrated) lobby and an empty slot cost nothing;
 *   - Save & Quit + Continue is NOT a quit: nothing settles until the game really ends, and then it settles once,
 *     at the real placement.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import { RANK_RULES, createLobbyRun, resolveRank, type BoardCard, type RunState } from '@game/sim';

vi.mock('../remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../remoteBoards')>();
  return {
    ...mod,
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
  };
});

vi.mock('./rankSubmission', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./rankSubmission')>();
  return {
    ...mod,
    enqueuePendingRank: vi.fn((req: unknown) => ({ ...(req as object), userId: 'me', at: 'now', attempts: 0 })),
    flushPendingRanks: vi.fn(async () => {}),
    installRankRetryTriggers: vi.fn(),
  };
});

import { useGame } from '../store';
import { enqueuePendingRank, flushPendingRanks } from './rankSubmission';
import { abandonWarningOf, rankedAbandonOf } from './ratedRun';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const MID = { divisionIndex: 4, points: 50, demotionReady: false };

/** A RATED lobby (one recorded run seated, the `runEndUploadOrder` recipe) in the shop, `out` seats already out. */
function ratedLobby(seed: number, out: number, runId = `r-${seed}`): RunState {
  const base = createLobbyRun(seed, 'brackus');
  const lobby = { ...base.lobby!, unrated: undefined, seats: base.lobby!.seats.map((s) => (s.id === 's2' ? { ...s, kind: 'snapshot' as const, runKey: 'Rival|drakko|99' } : { ...s })) };
  lobby.seats.filter((s) => s.id !== 's0').slice(0, out).forEach((s, i) => { s.alive = false; s.placement = 8 - i; });
  return { ...base, runId, lobby, phase: 'recruit' };
}

const alley = (): BoardCard => ({ uid: 'e', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });
/** The same rated lobby at its LAST combat: only the player and s1 stand, s1 at 1 Resolve, so the win ends it. */
function finishingRatedLobby(seed: number, runId: string): RunState {
  const run = ratedLobby(seed, 0, runId);
  for (const s of run.lobby!.seats) if (s.id !== 's0' && s.id !== 's1') { s.alive = false; s.placement = 3; }
  const s1 = run.lobby!.seats.find((s) => s.id === 's1')!;
  s1.resolve = 1; s1.armor = 0;
  const lastCombat: CombatResult = {
    result: 'win', playerDamage: 0, enemyDamage: 5, playerDeathrattles: 0, enemyDeaths: 0,
    events: [{ type: 'attack', attacker: 'c1', defender: 'x1' } as unknown as CombatResult['events'][number]],
    initial: { player: [{ uid: 'c1', cardId: 'alley', name: 'Alleycat', tribe: 'beast', attack: 1, health: 1, keywords: [] }], enemy: [] },
  } as unknown as CombatResult;
  return { ...run, phase: 'combat', combatSettled: false, board: [alley()], lastCombat };
}

const queued = () => vi.mocked(enqueuePendingRank).mock.calls.map((c) => c[0]);

describe('quitting a rated game settles it at the lowest open place', () => {
  beforeEach(() => {
    vi.mocked(enqueuePendingRank).mockClear();
    vi.mocked(flushPendingRanks).mockClear();
    localStorage.clear();
  });

  it('Clear with nobody out: an 8th, submitted through the rank queue, with the 8th-place award', () => {
    const saved = ratedLobby(11, 0);
    useGame.setState({ playerName: 'Kev', run: saved, savedRun: saved, showTitle: true, replaying: false });
    useGame.getState().clearRun();
    expect(queued()).toHaveLength(1);
    const req = queued()[0]!;
    expect(req).toMatchObject({ runId: 'r-11', placement: 8, seed: 11 });
    expect(req.seatKeys).toHaveLength(7);
    expect(vi.mocked(flushPendingRanks)).toHaveBeenCalled();
    expect(resolveRank(MID, req.placement).appliedDelta).toBe(RANK_RULES.placementAwards[7]);
    expect(useGame.getState().savedRun).toBeNull();
  });

  it('Clear with one seat already out: a 7th, with the 7th-place award', () => {
    const saved = ratedLobby(12, 1);
    useGame.setState({ playerName: 'Kev', run: saved, savedRun: saved, showTitle: true, replaying: false });
    useGame.getState().clearRun();
    expect(queued()).toHaveLength(1);
    expect(queued()[0]).toMatchObject({ runId: 'r-12', placement: 7 });
    expect(resolveRank(MID, 7).appliedDelta).toBe(RANK_RULES.placementAwards[6]);
  });

  it('starting a new game over the save abandons it the same way', () => {
    const saved = ratedLobby(13, 1);
    useGame.setState({ playerName: 'Kev', run: saved, savedRun: saved, showTitle: false, pendingMode: 'practice', pendingSeed: 99, replaying: false });
    useGame.getState().pickHero('brackus');
    expect(queued()).toHaveLength(1);
    expect(queued()[0]).toMatchObject({ runId: 'r-13', placement: 7 });
    expect(useGame.getState().run.seed).toBe(99);
  });

  it('practice, an unrated all-generated lobby and an empty slot cost nothing', () => {
    const practice = createLobbyRun(14, 'brackus', {}, 'practice');
    useGame.setState({ run: practice, savedRun: practice, showTitle: true });
    useGame.getState().clearRun();
    const unrated = { ...createLobbyRun(15, 'brackus'), runId: 'r-15' };
    expect(unrated.lobby!.unrated).toBe('all-generated');
    useGame.setState({ run: unrated, savedRun: unrated, showTitle: true });
    useGame.getState().clearRun();
    useGame.setState({ savedRun: null, showTitle: true });
    useGame.getState().clearRun();
    expect(queued()).toHaveLength(0);
    expect(rankedAbandonOf(practice)).toBeNull();
    expect(abandonWarningOf(practice)).toBeNull();
    expect(abandonWarningOf(ratedLobby(16, 1))).toBe('It is a rated game, so giving it up counts as finishing 7th.');
  });

  it('Save & Quit then Continue is not a quit: the game settles once, at its real end', async () => {
    const live = finishingRatedLobby(17, 'r-17');
    useGame.setState({ playerName: 'Kev', run: live, savedRun: live, showTitle: false, replaying: false, replayActions: [], capturedBoards: [], lastReplay: null });
    useGame.getState().flushSave(); // Save & Quit
    useGame.setState({ showTitle: true });
    useGame.getState().continueRun(); // Continue
    expect(queued(), 'Save & Quit / Continue settled a live game').toHaveLength(0);

    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(useGame.getState().run.phase).toBe('gameover');
    await sleep(30); // the run-end block is deferred
    expect(queued()).toHaveLength(1);
    expect(queued()[0]).toMatchObject({ runId: 'r-17', placement: 1 });
    // The finished game left no save behind, so a later Clear or new game cannot settle it a second time.
    expect(useGame.getState().savedRun).toBeNull();
    useGame.getState().clearRun();
    expect(queued()).toHaveLength(1);
  });
});
