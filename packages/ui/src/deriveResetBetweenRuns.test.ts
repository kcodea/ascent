// @vitest-environment jsdom
/**
 * THE LIVE DERIVE STATE STARTS FRESH FOR EVERY NEW RUN (owner report 2026-09-22). The Balance Report's
 * `derived` payload is observed LIVE from the store's dispatch (`beginDerive` / `observeAction` /
 * `finishDerive`), and a read-only probe of the 114 live rows found 53 whose `gold[]`, `boards[]` and
 * `offers[]` carried EARLIER runs' events in front of the uploaded run's own (the wave dropping back to 1
 * where the next run began; one row held three runs). The observers (`deriveState` + the flat `telemetryLog`)
 * were reset only by `clearRun` and the sandbox rigs, never by the doors a player actually walks through
 * (the hero picker, `newRun`, a tutorial), so one browser session stacked its runs into one payload.
 *
 * This pins it from the store's own door: two lobby runs back to back, the first spending Gold on a refresh,
 * and the SECOND upload's derived streams must hold only the second run's events, waves never dropping.
 * The upload seam is mocked; the reducer, the lobby, the observers and the run-end block are real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beginDerive, TUTORIAL_COURSES, type RunState } from '@game/sim';

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

/** Make the live run lose its first combat outright (1 Resolve, no Armor, an empty board, on the run AND its
 *  lobby seat) so the lobby ends the run at `gameover` on wave 1. */
function armToDieOnWaveOne(extra: Partial<RunState> = {}): void {
  const run = useGame.getState().run;
  const lobby = run.lobby!;
  const seats = lobby.seats.map((s, i) => (i === 0 ? { ...s, resolve: 1, armor: 0 } : s));
  useGame.setState({ run: { ...run, resolve: 1, armor: 0, board: [], lobby: { ...lobby, seats }, ...extra } });
}

async function finishTheRun(): Promise<void> {
  useGame.getState().dispatch({ type: 'faceOmen' });
  expect(useGame.getState().run.phase).toBe('combat');
  useGame.getState().dispatch({ type: 'resolveCombat' });
  expect(useGame.getState().run.phase).toBe('gameover');
  await sleep(40); // the run-end uploads are deferred a tick
}

function startLobbyRun(): RunState {
  useGame.setState({ pendingMode: 'lobby' });
  useGame.getState().pickHero('warden');
  const run = useGame.getState().run;
  expect(run.mode).toBe('lobby');
  return run;
}

/** Waves along a stream never drop: a drop is the signature of a previous run's events sitting in front. */
function wavesNeverDrop(rows: ReadonlyArray<{ wave: number }>): boolean {
  for (let i = 1; i < rows.length; i++) if (rows[i]!.wave < rows[i - 1]!.wave) return false;
  return true;
}

describe('the live derive state between runs', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(uploadRunTelemetry).mockClear();
  });

  it('two lobby runs back to back: the second upload carries only the second run (no stacked gold, offers or boards, no wave drop)', async () => {
    // Run 1: spend Gold on a refresh so the ledger has an event to leak, then die.
    startLobbyRun();
    expect(useGame.getState().run.embers).toBeGreaterThanOrEqual(1);
    useGame.getState().dispatch({ type: 'roll' });
    armToDieOnWaveOne();
    await finishTheRun();
    expect(vi.mocked(uploadRunTelemetry)).toHaveBeenCalledTimes(1);
    const first = vi.mocked(uploadRunTelemetry).mock.calls[0]![1].derived!;
    expect(first.gold.some((g) => g.category === 'refresh')).toBe(true); // the leak has something to leak

    // Run 2: a fresh lobby, no Gold spent, dies the same way.
    const run2 = startLobbyRun();
    const freshOffers = beginDerive(run2).offers.length; // what a clean observer sees at wave 1
    expect(freshOffers).toBeGreaterThan(0);
    armToDieOnWaveOne();
    await finishTheRun();
    expect(vi.mocked(uploadRunTelemetry)).toHaveBeenCalledTimes(2);
    const [flat, meta] = vi.mocked(uploadRunTelemetry).mock.calls[1]!;
    const second = meta.derived!;
    expect(second.seed).toBe(run2.seed);
    expect(second.gold.filter((g) => g.category === 'refresh')).toHaveLength(0); // run 1's refresh is not here
    expect(second.offers).toHaveLength(freshOffers); // run 2's opening shop, once — not run 1's in front of it
    expect(second.offers.every((o) => o.wave === 1)).toBe(true);
    expect(wavesNeverDrop(second.gold)).toBe(true);
    expect(wavesNeverDrop(second.offers)).toBe(true);
    expect(wavesNeverDrop(second.boards)).toBe(true);
    // The flat summary's live streams start fresh too (it is overlaid from the same per-run log).
    expect(flat.offeredCards.length).toBeLessThanOrEqual(freshOffers);
  });

  it('newRun and a tutorial start also begin a fresh observer, not the previous run\'s', () => {
    startLobbyRun();
    useGame.getState().dispatch({ type: 'roll' });
    expect(useGame.getState().deriveState.gold.some((g) => g.category === 'refresh')).toBe(true);

    useGame.getState().newRun(7, 'warden');
    expect(useGame.getState().deriveState.gold).toHaveLength(0);
    expect(useGame.getState().deriveState.offers).toHaveLength(beginDerive(useGame.getState().run).offers.length);
    expect(useGame.getState().telemetryLog.offeredCards.length).toBeLessThanOrEqual(useGame.getState().run.shop.length);

    useGame.getState().dispatch({ type: 'roll' });
    expect(useGame.getState().deriveState.gold.some((g) => g.category === 'refresh')).toBe(true);
    const course = Object.values(TUTORIAL_COURSES)[0]!;
    useGame.getState().startTutorial(course);
    expect(useGame.getState().deriveState.gold).toHaveLength(0);
    expect(useGame.getState().deriveState.offers).toHaveLength(beginDerive(useGame.getState().run).offers.length);
  });
});
