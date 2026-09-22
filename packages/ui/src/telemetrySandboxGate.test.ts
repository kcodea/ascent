// @vitest-environment jsdom
/**
 * NOTHING FROM SCENE BUILDER (owner ask 2026-09-22). The Balance Report reads the one telemetry upload the
 * run-end block fires, so this pins the gate from the store's own door: the SAME lobby run finishing with
 * and without the `sandbox` flag, and the Scene Builder rig itself. A ladder finish uploads one row stamped
 * `source: 'ladder'` with the run's set (on the flat row AND inside `derived`); a sandbox finish uploads
 * nothing at all. The upload seams are mocked so "called / never called" is observable; the reducer, the
 * lobby and the run-end block are real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setIdOf, type RunState } from '@game/sim';

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
import { uploadRunTelemetry } from './remoteBoards';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Make the live run lose its first combat outright: 1 Resolve, no Armor, an empty board, on the run AND on
 *  its lobby seat (the seat's pools are the run's health). A lobby ends the run at `gameover` the moment the
 *  player's seat is knocked out. */
function armToDieOnWaveOne(extra: Partial<RunState> = {}): void {
  const run = useGame.getState().run;
  const lobby = run.lobby!;
  const seats = lobby.seats.map((s, i) => (i === 0 ? { ...s, resolve: 1, armor: 0 } : s));
  const config = run.practiceConfig ? { ...run.practiceConfig, health: 'normal' as const } : undefined;
  useGame.setState({ run: { ...run, resolve: 1, armor: 0, board: [], lobby: { ...lobby, seats }, ...(config ? { practiceConfig: config } : {}), ...extra } });
}

async function finishTheRun(): Promise<void> {
  useGame.getState().dispatch({ type: 'faceOmen' });
  expect(useGame.getState().run.phase).toBe('combat');
  expect(useGame.getState().run.lastCombat?.result).toBe('lose');
  useGame.getState().dispatch({ type: 'resolveCombat' });
  expect(useGame.getState().run.phase).toBe('gameover');
  await sleep(40); // the run-end uploads are deferred a tick
}

describe('the telemetry upload and the sandbox flag', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(uploadRunTelemetry).mockClear();
  });

  it('a real lobby run finishing uploads ONE row stamped ladder with its set, on the row and inside derived', async () => {
    useGame.setState({ pendingMode: 'lobby' });
    useGame.getState().pickHero('warden');
    const run = useGame.getState().run;
    expect(run.mode).toBe('lobby');
    expect(run.sandbox).toBeFalsy();
    armToDieOnWaveOne();
    await finishTheRun();
    expect(vi.mocked(uploadRunTelemetry)).toHaveBeenCalledTimes(1);
    const [t, meta] = vi.mocked(uploadRunTelemetry).mock.calls[0]!;
    expect(t.mode).toBe('lobby');
    expect(t.source).toBe('ladder');
    expect(t.setId).toBe(setIdOf(run));
    expect(t.placement).toBe(8);
    expect(meta.derived?.source).toBe('ladder');
    expect(meta.derived?.setId).toBe(setIdOf(run));
  });

  it('the SAME lobby run flagged sandbox (a loaded bug scenario keeps its lobby mode) uploads nothing', async () => {
    useGame.setState({ pendingMode: 'lobby' });
    useGame.getState().pickHero('warden');
    armToDieOnWaveOne({ sandbox: true });
    expect(useGame.getState().run.mode).toBe('lobby');
    await finishTheRun();
    expect(vi.mocked(uploadRunTelemetry)).not.toHaveBeenCalled();
  });

  it('the Scene Builder rig itself, launched from the title, uploads nothing when its lobby ends', async () => {
    useGame.setState({ sbRules: 'normal', sbBotLevel: 3 });
    useGame.getState().startSceneBuilder('warden');
    expect(useGame.getState().run.sandbox).toBe(true);
    armToDieOnWaveOne(); // normal health, so the seat can actually be knocked out
    await finishTheRun();
    expect(vi.mocked(uploadRunTelemetry)).not.toHaveBeenCalled();
  });
});
