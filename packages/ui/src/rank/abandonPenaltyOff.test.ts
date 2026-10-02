// @vitest-environment jsdom
/**
 * THE ABANDON PENALTY IS OFF (owner 2026-10-02, R-RANK-05 switched off), verbatim: "oh i didnt know there was an
 * abandon penalty in. can we remove that for now?". Found when three Ranked wins in a row each came back to the same
 * MMR: after every win he started a new game, left it, and the abandon settled it as an 8th (-40).
 *
 * Pinned against the REAL store and the REAL `ABANDON_PENALTY_ENABLED` (false), with the rank queue mocked (the
 * `quitCostsRating.test.ts` recipe). Every door that gives up an unfinished RATED save (title Clear, a new game
 * over it via `pickHero` / `newRun` / `startTutorial`, a cloud copy adopted over it) drops the run and queues
 * NOTHING; the title tips carry no warning; a real finish still settles.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import { TUTORIAL_COURSES, createLobbyRun, serialize, type BoardCard, type RunState } from '@game/sim';

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

import { adoptCloudRun, useGame } from '../store';
import { enqueuePendingRank } from './rankSubmission';
import { ABANDON_PENALTY_ENABLED, abandonWarningOf, rankedAbandonOf, withAbandonWarning } from './ratedRun';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const queued = () => vi.mocked(enqueuePendingRank).mock.calls.map((c) => c[0]);

/** A RATED lobby (one recorded run seated) in the shop, nobody out: under the old rule, leaving it was an 8th. */
function ratedLobby(seed: number, runId = `r-${seed}`): RunState {
  const base = createLobbyRun(seed, 'brackus');
  const lobby = { ...base.lobby!, unrated: undefined, seats: base.lobby!.seats.map((s) => (s.id === 's2' ? { ...s, kind: 'snapshot' as const, runKey: 'Rival|drakko|99' } : { ...s })) };
  return { ...base, runId, lobby, phase: 'recruit' };
}

const alley = (): BoardCard => ({ uid: 'e', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });
/** The same rated lobby at its LAST combat: only the player and s1 stand, s1 at 1 Resolve, so the win ends it. */
function finishingRatedLobby(seed: number, runId: string): RunState {
  const run = ratedLobby(seed, runId);
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

describe('leaving a rated game costs nothing while the abandon penalty is off', () => {
  beforeEach(() => {
    vi.mocked(enqueuePendingRank).mockClear();
    localStorage.clear();
  });

  it('the switch is off, and the rule answers "nothing to settle" for a rated save', () => {
    expect(ABANDON_PENALTY_ENABLED).toBe(false);
    const saved = ratedLobby(21);
    expect(rankedAbandonOf(saved)).toBeNull();
    expect(rankedAbandonOf(saved, true), 'the kept rule still works when switched on').toEqual({ runId: 'r-21', placement: 8 });
  });

  it('title Clear drops the rated save and queues nothing', () => {
    const saved = ratedLobby(22);
    useGame.setState({ playerName: 'Kev', run: saved, savedRun: saved, showTitle: true, replaying: false });
    useGame.getState().clearRun();
    expect(queued()).toHaveLength(0);
    expect(useGame.getState().savedRun).toBeNull();
  });

  it('a new Ranked game, a Practice game, newRun and the tutorial over the save queue nothing', () => {
    for (const mode of ['lobby', 'practice'] as const) {
      const saved = ratedLobby(mode === 'lobby' ? 23 : 24);
      useGame.setState({ playerName: 'Kev', run: saved, savedRun: saved, showTitle: false, pendingMode: mode, pendingSeed: 99, replaying: false });
      useGame.getState().pickHero('brackus');
      expect(useGame.getState().run.seed).toBe(99);
    }
    const a = ratedLobby(25);
    useGame.setState({ run: a, savedRun: a, showTitle: false });
    useGame.getState().newRun(77, 'brackus');
    const b = ratedLobby(26);
    useGame.setState({ run: b, savedRun: b, showTitle: false });
    useGame.getState().startTutorial(Object.values(TUTORIAL_COURSES)[0]!);
    expect(queued(), 'no door charged the left game').toHaveLength(0);
  });

  it('a cloud copy of another run adopted over the save queues nothing', () => {
    const local = ratedLobby(27);
    useGame.setState({ run: local, savedRun: local, showTitle: true, heroChoices: null, practiceSetupOpen: false, replaying: false });
    const other = ratedLobby(28, 'r-other');
    const ok = adoptCloudRun({ runKey: 'run:r-other', revision: 3, deviceId: 'elsewhere', updatedAt: new Date().toISOString(), payload: { v: 1, save: JSON.stringify({ run: serialize(other), actions: [] }) } });
    expect(ok).toBe(true);
    expect(useGame.getState().savedRun?.runId).toBe('r-other');
    expect(queued()).toHaveLength(0);
  });

  it('the title tips carry no abandon warning', () => {
    const saved = ratedLobby(29);
    expect(abandonWarningOf(saved)).toBeNull();
    expect(withAbandonWarning('New run. Replaces your saved run.', saved)).toBe('New run. Replaces your saved run.');
  });

  it('a real finish still settles, once, tagged as a finish', async () => {
    const live = finishingRatedLobby(30, 'r-30');
    useGame.setState({ playerName: 'Kev', run: live, savedRun: live, showTitle: false, replaying: false, replayActions: [], capturedBoards: [], lastReplay: null });
    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(useGame.getState().run.phase).toBe('gameover');
    await sleep(30); // the run-end block is deferred
    expect(queued()).toHaveLength(1);
    expect(queued()[0]).toMatchObject({ runId: 'r-30', placement: 1, kind: 'finish' });
  });
});
