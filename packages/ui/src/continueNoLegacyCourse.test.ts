// @vitest-environment jsdom
/**
 * CONTINUE ONLY RESUMES A STARTED LOBBY GAME (owner bug report 2026-09-30, R-PERSIST-01):
 * "if i quit from this menu, i have a continue option that put me in the old wave format. remove the wave
 * format option entirely, and only create a continue option if the player selects a hero and starts a game."
 *
 * Root cause: the hero picker's "Main Menu" calls `openTitle`, which calls `flushSave`. `flushSave` only
 * refused while `showTitle` was up, but the picker runs with `showTitle: false`, so it persisted the dormant
 * throwaway run behind the title (a lobby-less `createRun`, i.e. the retired 17-round course) and the title
 * offered it as Continue.
 *
 * Each case boots a FRESH store module (the save is read at module load) against a clean localStorage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRun, serialize } from '@game/sim';

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

const SAVE_KEY = 'ascent.save';
// Each case re-imports the whole store module graph (the save is read at load); the first cold import is slow.
vi.setConfig({ testTimeout: 30_000 });

async function bootStore(): Promise<typeof import('./store')> {
  vi.resetModules();
  return import('./store');
}

beforeEach(() => {
  localStorage.clear();
});

describe('Continue only exists once a hero is picked and the game started', () => {
  it('quitting from the hero picker leaves no saved run and no Continue', async () => {
    const { useGame } = await bootStore();
    expect(useGame.getState().savedRun).toBeNull();
    useGame.getState().startLobby();
    expect(useGame.getState().heroChoices).not.toBeNull();
    useGame.getState().flushSave(); // a tab-hide while the picker is up must not write either
    useGame.getState().openTitle(); // the picker's "Main Menu"
    expect(useGame.getState().savedRun).toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    // …and the next boot offers nothing to continue.
    const reboot = await bootStore();
    expect(reboot.useGame.getState().savedRun).toBeNull();
  });

  it('quitting from the Practice setup screen leaves no saved run', async () => {
    const { useGame } = await bootStore();
    useGame.getState().startPractice();
    useGame.getState().flushSave();
    useGame.getState().cancelPracticeSetup();
    expect(useGame.getState().savedRun).toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
  });

  it('a started lobby run saves, and Continue resumes it as the SAME lobby run', async () => {
    const { useGame } = await bootStore();
    useGame.getState().startLobby();
    useGame.getState().pickHero('warden');
    const run = useGame.getState().run;
    expect(run.mode).toBe('lobby');
    expect(run.lobby).toBeDefined();
    useGame.getState().openTitle(); // Save & Quit
    expect(useGame.getState().savedRun?.seed).toBe(run.seed);
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();

    const reboot = await bootStore();
    const g = reboot.useGame.getState();
    expect(g.savedRun?.seed).toBe(run.seed);
    expect(g.savedRun?.lobby).toBeDefined();
    g.continueRun();
    const resumed = reboot.useGame.getState();
    expect(resumed.showTitle).toBe(false);
    expect(resumed.run.seed).toBe(run.seed);
    expect(resumed.run.mode).toBe('lobby');
    expect(resumed.run.lobby?.seats).toHaveLength(8);
  });

  it('re-opening the picker over a real save and backing out keeps that save untouched', async () => {
    const { useGame } = await bootStore();
    useGame.getState().startLobby();
    useGame.getState().pickHero('warden');
    const run = useGame.getState().run;
    useGame.getState().openTitle();
    const before = localStorage.getItem(SAVE_KEY);
    useGame.getState().startLobby(); // Play again, then back out of the picker
    useGame.getState().openTitle();
    expect(useGame.getState().savedRun?.seed).toBe(run.seed);
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
  });
});

describe('the retired course (wave) format is never resumed or created', () => {
  it('a legacy course save in localStorage is discarded at boot and no Continue is offered', async () => {
    const legacy = { ...createRun(12345, 'warden'), phase: 'recruit' as const };
    expect(legacy.lobby).toBeUndefined();
    localStorage.setItem(SAVE_KEY, JSON.stringify({ run: serialize(legacy), actions: [] }));
    const { useGame } = await bootStore();
    expect(useGame.getState().savedRun).toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    expect(useGame.getState().run.seed).not.toBe(12345); // the dormant run is a throwaway, not the legacy save
  });

  it('isResumableRun refuses a lobby-less run and accepts a lobby run', async () => {
    const { isResumableRun, useGame } = await bootStore();
    expect(isResumableRun({ ...createRun(1, 'warden'), phase: 'recruit' })).toBe(false);
    useGame.getState().startLobby();
    useGame.getState().pickHero('warden');
    expect(isResumableRun(useGame.getState().run)).toBe(true);
  });

  it('no store entry point builds a course run: a stale ascent/rift pendingMode still yields a lobby', async () => {
    const { useGame } = await bootStore();
    const store = useGame.getState() as unknown as Record<string, unknown>;
    expect(store.startAscent).toBeUndefined();
    expect(store.startRift).toBeUndefined();
    for (const pendingMode of ['ascent', 'rift'] as const) {
      useGame.setState({ pendingMode, heroChoices: ['warden'] });
      useGame.getState().pickHero('warden');
      expect(useGame.getState().run.mode).toBe('lobby');
      expect(useGame.getState().run.lobby).toBeDefined();
    }
    useGame.getState().newRun(77, 'warden');
    expect(useGame.getState().run.lobby).toBeDefined();
    // Play (startLobby) and Practice still build their lobbies.
    useGame.getState().startLobby();
    useGame.getState().pickHero('warden');
    expect(useGame.getState().run.mode).toBe('lobby');
    useGame.getState().startPractice();
    useGame.getState().confirmPracticeSetup();
    useGame.getState().pickHero('warden');
    expect(useGame.getState().run.mode).toBe('practice');
    expect(useGame.getState().run.lobby).toBeDefined();
  });
});
