// @vitest-environment jsdom
/**
 * The Scene Builder's Ancients toggle works on Set 2 rigs as well as Set 3 (owner ask 2026-11-16, R-SB-ANCIENTS-SET2-01).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./remoteBoards')>();
  return {
    ...mod,
    uploadBoards: vi.fn(async () => {}),
    uploadVictory: vi.fn(async () => {}),
    uploadRunTelemetry: vi.fn(async () => {}),
    uploadRunHistory: vi.fn(async () => {}),
    uploadPlayerProfile: vi.fn(async () => {}),
    refreshOpponentPoolAndRecords: vi.fn(),
  };
});

import { sceneAncientsSet, useGame } from './store';

describe('Scene Builder Ancients toggle by set', () => {
  afterEach(() => { useGame.getState().setSbAncients(false); });

  it('offers the toggle on Sets 2 and 3 only', () => {
    expect(sceneAncientsSet('set2')).toBe(true);
    expect(sceneAncientsSet('set3')).toBe(true);
    expect(sceneAncientsSet('set1')).toBe(false);
    expect(sceneAncientsSet(undefined)).toBe(false);
  });

  it('a Set 2 rig with the toggle on starts with Ancients enabled', () => {
    useGame.getState().setSbAncients(true);
    useGame.getState().startSceneBuilder('warden', 'set2');
    const run = useGame.getState().run;
    expect(run.setId).toBe('set2');
    expect(run.ancientsEnabled).toBe(true);
    expect(run.ancients).toBeTruthy();
  });

  it('with the toggle off, a Set 2 rig has no Ancients', () => {
    useGame.getState().setSbAncients(false);
    useGame.getState().startSceneBuilder('warden', 'set2');
    expect(useGame.getState().run.ancientsEnabled).toBeFalsy();
  });
});
