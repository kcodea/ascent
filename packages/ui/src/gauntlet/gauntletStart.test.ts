// @vitest-environment jsdom
/**
 * GAUNTLET — the store's door and its run end. `startGauntlet` opens an ALL-hero picker for a playable stage (and
 * refuses anything else), `pickHero` then builds the 2-seat gauntlet lobby, and a finished run records the clear
 * locally and hands the end screen its result WITHOUT any of the ladder's uploads (boards, history, telemetry,
 * fight results, rank) or a replay. Stage data is injected: the shipped stages are all empty drafts today.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import type { GauntletStage } from '@game/content';

const stages = vi.hoisted(() => new Map<number, unknown>());
const remote = vi.hoisted(() => ({ on: true }));
vi.mock('@game/content', async (orig) => ({
  ...(await orig<typeof import('@game/content')>()),
  gauntletStage: (n: number) => stages.get(n),
}));

vi.mock('../remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../remoteBoards')>();
  return {
    ...mod,
    remoteEnabled: () => remote.on,
    uploadBoards: vi.fn(async () => {}),
    uploadVictory: vi.fn(async () => {}),
    uploadRunTelemetry: vi.fn(async () => {}),
    uploadRunHistory: vi.fn(async () => {}),
    uploadPlayerProfile: vi.fn(async () => {}),
    uploadPracticeGame: vi.fn(async () => null),
    fetchRunHistory: vi.fn(async () => null),
    recordFightResult: vi.fn(async () => {}),
    recordLobbyFights: vi.fn(async () => {}),
    fetchLobbyStrength: vi.fn(async () => null),
    refreshOpponentPoolAndRecords: vi.fn(),
  };
});

import { createGauntletRun, practiceHeroChoiceIds, runTribesForSeed, type BoardCard, type RunState } from '@game/sim';
import { useGame } from '../store';
import { recordFightResult, uploadBoards, uploadPracticeGame, uploadRunHistory, uploadRunTelemetry } from '../remoteBoards';
import { clearedStages, recordClear } from './gauntletProgress';
import { clearGauntletClearQueue, pendingGauntletClears } from './gauntletClearQueue';
import { resetIdentityForTests, setIdentity } from '../identity';

const minion = { cardId: 'alley', attack: 1, health: 1, cardVersion: 'x' };
const stage = (number: number, status: 'ready' | 'draft', filledRounds: number): GauntletStage => ({
  number, name: `S${number}`, opponentName: 'The Host', status, runes: {},
  rounds: Array.from({ length: 10 }, (_, i) => ({ board: i < filledRounds ? [minion] : [] })),
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const alley = (): BoardCard => ({ uid: 'e', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });

beforeEach(() => {
  localStorage.clear();
  stages.clear();
  stages.set(1, stage(1, 'ready', 10));
  stages.set(2, stage(2, 'draft', 1)); // DEV-playable draft
  stages.set(3, stage(3, 'draft', 0)); // never playable
  useGame.setState({ showTitle: true, heroChoices: null, pendingMode: 'ascent', pendingSeed: undefined, pendingGauntletStage: undefined, gauntletResult: null });
});
afterEach(() => { vi.unstubAllEnvs(); remote.on = true; resetIdentityForTests(); clearGauntletClearQueue(); });

describe('startGauntlet', () => {
  it('opens the full-roster hero picker for a playable stage', () => {
    useGame.getState().startGauntlet(1);
    const s = useGame.getState();
    expect(s.showTitle).toBe(false);
    expect(s.pendingMode).toBe('gauntlet');
    expect(s.pendingGauntletStage).toBe(1);
    expect(s.pendingSeed).toBeTypeOf('number');
    expect(s.heroChoices).toEqual(practiceHeroChoiceIds('all', runTribesForSeed(s.pendingSeed!)));
    expect(s.heroChoices!.length).toBeGreaterThan(3); // "any hero", not the 3-hero roll
  });

  it('refuses a stage with no playable data', () => {
    useGame.getState().startGauntlet(3);
    useGame.getState().startGauntlet(9);
    const s = useGame.getState();
    expect(s.showTitle).toBe(true);
    expect(s.pendingMode).toBe('ascent');
    expect(s.heroChoices).toBeNull();
  });

  it('a draft with content opens in DEV and is refused in a player build', () => {
    vi.stubEnv('DEV', false);
    useGame.getState().startGauntlet(2);
    expect(useGame.getState().heroChoices).toBeNull();
    vi.unstubAllEnvs();
    useGame.getState().startGauntlet(2);
    expect(useGame.getState().pendingGauntletStage).toBe(2);
  });
});

describe('pickHero in gauntlet mode', () => {
  it('builds a 2-seat gauntlet lobby on the chosen stage and clears the pending stage', () => {
    useGame.getState().startGauntlet(1);
    useGame.getState().pickHero('brackus');
    const s = useGame.getState();
    expect(s.run.mode).toBe('gauntlet');
    expect(s.run.gauntletStage).toBe(1);
    expect(s.run.heroId).toBe('brackus');
    expect(s.run.lobby?.seats).toHaveLength(2);
    expect(s.run.lobby?.seats[1]).toMatchObject({ label: 'The Host', invulnerable: true });
    expect(s.pendingGauntletStage).toBeUndefined();
    expect(s.heroChoices).toBeNull();
  });

  it('a stage that vanished before the pick returns to the title and starts nothing', () => {
    useGame.getState().startGauntlet(1);
    const before = useGame.getState().run;
    stages.delete(1);
    useGame.getState().pickHero('brackus');
    const s = useGame.getState();
    expect(s.run).toBe(before);
    expect(s.showTitle).toBe(true);
    expect(s.heroChoices).toBeNull();
  });
});

/** A real gauntlet run at round 10's combat, the player winning it: the lobby finishes on this settle. */
function finishingGauntletRun(seed: number): RunState {
  const base = createGauntletRun(seed, 'brackus', stage(1, 'ready', 10) as GauntletStage);
  const lobby = { ...base.lobby!, round: 10 };
  const lastCombat: CombatResult = {
    result: 'win', playerDamage: 0, enemyDamage: 5, playerDeathrattles: 0, enemyDeaths: 0,
    events: [{ type: 'attack', attacker: 'c1', defender: 'x1' } as unknown as CombatResult['events'][number]],
    initial: { player: [{ uid: 'c1', cardId: 'alley', name: 'Alleycat', tribe: 'beast', attack: 1, health: 1, keywords: [] }], enemy: [] },
  };
  return { ...base, lobby, wave: 10, phase: 'combat', combatSettled: false, board: [alley()], lastCombat };
}

describe('a finished gauntlet run', () => {
  beforeEach(() => {
    for (const f of [uploadBoards, uploadRunHistory, uploadRunTelemetry, uploadPracticeGame, recordFightResult]) vi.mocked(f).mockClear();
    useGame.setState({ playerName: 'Mike', run: finishingGauntletRun(7), showTitle: false, replaying: false, replayActions: [], capturedBoards: [], lastReplay: null, lastMatch: null });
  });

  it('records the clear, reports the result, and uploads nothing', async () => {
    useGame.getState().dispatch({ type: 'resolveCombat' });
    const s = useGame.getState();
    expect(s.run.phase).toBe('gameover');
    expect(clearedStages()).toEqual([1]);
    expect(s.gauntletResult).toEqual({ stage: 1, outcome: 'cleared', round: 10, firstClear: true });

    await sleep(30); // every run-end write is a deferred setTimeout(0)
    expect(vi.mocked(uploadBoards)).not.toHaveBeenCalled();
    expect(vi.mocked(uploadRunHistory)).not.toHaveBeenCalled();
    expect(vi.mocked(uploadRunTelemetry)).not.toHaveBeenCalled();
    expect(vi.mocked(uploadPracticeGame)).not.toHaveBeenCalled();
    expect(vi.mocked(recordFightResult)).not.toHaveBeenCalled();
    expect(useGame.getState().lastReplay).toBeNull();
    expect(useGame.getState().lastMatch).toBeNull();
    expect(useGame.getState().rankSubmission).toBe('unrated');
  });

  it('a second clear of the same stage is not a first clear', async () => {
    localStorage.setItem('ascent.gauntlet.local', '[1]');
    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(useGame.getState().gauntletResult).toMatchObject({ stage: 1, outcome: 'cleared', firstClear: false });
    expect(clearedStages()).toEqual([1]);
  });

  it('a knockout records no clear and reports the round it fell on', async () => {
    const run = finishingGauntletRun(7);
    const lobby = { ...run.lobby!, round: 5, seats: run.lobby!.seats.map((seat) => (seat.id === 's0' ? { ...seat, resolve: 1, armor: 0 } : { ...seat })) };
    const lastCombat: CombatResult = { ...run.lastCombat!, result: 'lose', playerDamage: 5, enemyDamage: 0 };
    useGame.setState({ run: { ...run, lobby, wave: 5, resolve: 1, armor: 0, lastCombat } });
    useGame.getState().dispatch({ type: 'resolveCombat' });
    const s = useGame.getState();
    expect(s.run.phase).toBe('gameover');
    expect(s.gauntletResult).toEqual({ stage: 1, outcome: 'defeated', round: 5, firstClear: false });
    expect(clearedStages()).toEqual([]);
    await sleep(30);
    expect(vi.mocked(uploadRunHistory)).not.toHaveBeenCalled();
  });

  it('signed in with a backend: the clear is queued, so the end screen shows "saving"', () => {
    setIdentity({ userId: 'u-1', displayName: 'Mike', anonymous: false, email: 'm@example.com' });
    useGame.setState({ gauntletSaving: null });
    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(pendingGauntletClears()).toEqual([expect.objectContaining({ userId: 'u-1', stage: 1 })]);
    expect(useGame.getState().gauntletSaving).toBe(1);
  });

  it('signed in, a REPLAY of a cleared stage: queued for the server but never shows "saving"', () => {
    setIdentity({ userId: 'u-1', displayName: 'Mike', anonymous: false, email: 'm@example.com' });
    recordClear(1); // already cleared, so this run's clear is not a first clear
    clearGauntletClearQueue();
    useGame.setState({ gauntletSaving: null });
    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(useGame.getState().gauntletResult).toMatchObject({ stage: 1, outcome: 'cleared', firstClear: false });
    expect(useGame.getState().gauntletSaving).toBeNull();
  });

  it('signed in, the server unreachable (retryable): "saving" turns into "saved, arrives when back online"', async () => {
    setIdentity({ userId: 'u-1', displayName: 'Mike', anonymous: false, email: 'm@example.com' });
    useGame.setState({ gauntletSaving: null, gauntletSaveDeferred: null });
    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(useGame.getState().gauntletSaveDeferred).toBeNull();
    await sleep(60); // the deferred flush gets its (retryable) answer
    expect(useGame.getState().gauntletSaving).toBe(1);
    expect(useGame.getState().gauntletSaveDeferred).toBe(1);
  });

  it('signed in but no backend: nothing is queued, so "saving" never shows (it would never end)', () => {
    remote.on = false;
    setIdentity({ userId: 'u-1', displayName: 'Mike', anonymous: false, email: 'm@example.com' });
    useGame.setState({ gauntletSaving: null });
    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(useGame.getState().gauntletResult).toMatchObject({ stage: 1, outcome: 'cleared', firstClear: true });
    expect(pendingGauntletClears()).toHaveLength(0);
    expect(useGame.getState().gauntletSaving).toBeNull();
  });

  it('a new run clears the previous result', () => {
    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(useGame.getState().gauntletResult).not.toBeNull();
    useGame.getState().startGauntlet(1);
    useGame.getState().pickHero('brackus');
    expect(useGame.getState().gauntletResult).toBeNull();
  });
});
