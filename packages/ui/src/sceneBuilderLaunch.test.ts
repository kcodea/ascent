// @vitest-environment jsdom
/**
 * SCENE BUILDER launch (owner ask 2026-09-09): the sandbox is a LOBBY GAME AGAINST BOTS — eight seats, the
 * player invulnerable — under GOD rules (infinite Gold) or NORMAL rules (the real per-turn Gold). This pins
 * the store's door: what `startSceneBuilder` builds, and what flipping the rules does to the live run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./remoteBoards')>();
  return {
    ...mod,
    uploadBoards: vi.fn(async () => {}),
    uploadVictory: vi.fn(async () => {}),
    uploadRunTelemetry: vi.fn(async () => {}),
    uploadRunHistory: vi.fn(async () => {}),
    uploadPlayerProfile: vi.fn(async () => {}),
    recordFightResult: vi.fn(async () => {}),
    refreshOpponentPoolAndRecords: vi.fn(),
  };
});

import { useGame } from './store';

describe('startSceneBuilder', () => {
  beforeEach(() => {
    localStorage.clear();
    useGame.setState({ sbRules: 'god', sbBotLevel: 5 });
  });

  it('builds an eight-seat practice-bots lobby flagged sandbox, with an invulnerable seat', () => {
    useGame.getState().startSceneBuilder('warden');
    const run = useGame.getState().run;
    expect(run.sandbox).toBe(true);
    expect(run.mode).toBe('practice');
    expect(run.lobby?.seats).toHaveLength(8);
    expect(run.practiceConfig).toMatchObject({ opponents: 'bots', botDifficulty: 5, health: 'unlimited' });
    expect(run.heroId).toBe('warden');
    expect(run.tier).toBe(1);
    // Disposable: never the offered Continue.
    expect(useGame.getState().savedRun).toBeNull();
  });

  it('god rules start on the 999 Gold float; normal rules start on the real opening Gold', () => {
    useGame.getState().startSceneBuilder('warden');
    expect(useGame.getState().run.embers).toBe(999);
    useGame.getState().setSbRules('normal');
    useGame.getState().startSceneBuilder('warden');
    const run = useGame.getState().run;
    expect(run.embers).toBeLessThan(999);
    expect(run.embers).toBe(run.maxEmbers);
  });

  it('flipping the rules mid-run moves the Gold, is remembered, and touches nothing else', () => {
    useGame.getState().startSceneBuilder('warden');
    const before = useGame.getState().run;
    useGame.getState().setSbRules('normal');
    const normal = useGame.getState().run;
    expect(normal.embers).toBe(before.maxEmbers);
    expect(normal.lobby).toBe(before.lobby);
    expect(normal.wave).toBe(before.wave);
    expect(localStorage.getItem('ascent.sb.rules')).toBe('normal');
    useGame.getState().setSbRules('god');
    expect(useGame.getState().run.embers).toBe(999);
  });

  it('a bot level is applied to the lobby and remembered', () => {
    useGame.getState().startSceneBuilder('warden', undefined, 9);
    expect(useGame.getState().run.practiceConfig?.botDifficulty).toBe(9);
    expect(useGame.getState().sbBotLevel).toBe(9);
    expect(localStorage.getItem('ascent.sb.botlevel')).toBe('9');
  });

  it('pins the requested set on the run', () => {
    useGame.getState().startSceneBuilder('warden', 'set1');
    expect(useGame.getState().run.setId).toBe('set1');
  });
});
