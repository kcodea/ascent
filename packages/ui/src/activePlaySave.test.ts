/**
 * ACTIVE PLAY TIME through the save (owner bug 2026-10-09, R-MATCH-LENGTH-01): the match length rides in
 * `ascent.save` as `activeMs`, and a boot restores it PAUSED — so quitting, leaving the app closed for hours and
 * pressing Continue never adds the closed time. A save written before the clock existed restores as UNKNOWN and
 * the next save carries no `activeMs` at all (the Career then falls back to the plausibility-gated span).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLobbyRun, type RunState } from '@game/sim';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
});
vi.setConfig({ testTimeout: 60000 });

const SAVE_KEY = 'ascent.save';
const readSave = (): { activeMs?: number } | null => {
  const raw = mem.get(SAVE_KEY);
  return raw ? JSON.parse(raw) : null;
};
const midRun = (): RunState => ({ ...createLobbyRun(4242, 'brackus'), phase: 'recruit' });

/** Boot a fresh copy of the store module against whatever `ascent.save` holds now. */
async function boot() {
  vi.resetModules();
  return (await import('./store')).useGame;
}

describe('the match length survives a quit-and-resume without counting the closed time', () => {
  beforeEach(() => { mem.clear(); });

  it('a save carrying activeMs is restored and written back unchanged (the closed hours never count)', async () => {
    let useGame = await boot();
    useGame.setState({ run: midRun(), showTitle: false, replaying: false, replayActions: [], capturedBoards: [] });
    useGame.getState().flushSave();
    const saved = JSON.parse(mem.get(SAVE_KEY)!);
    mem.set(SAVE_KEY, JSON.stringify({ ...saved, activeMs: 12 * 60_000 }));

    useGame = await boot(); // "the app was closed for a day" — nothing in between is observed
    useGame.getState().flushSave();
    expect(readSave()?.activeMs).toBe(12 * 60_000);
  });

  it('a pre-clock save (no activeMs) stays unknown: the next save carries no activeMs', async () => {
    let useGame = await boot();
    useGame.setState({ run: midRun(), showTitle: false, replaying: false, replayActions: [], capturedBoards: [] });
    useGame.getState().flushSave();
    const saved = JSON.parse(mem.get(SAVE_KEY)!);
    delete saved.activeMs;
    mem.set(SAVE_KEY, JSON.stringify(saved));

    useGame = await boot();
    useGame.getState().flushSave();
    expect(readSave()).not.toBeNull();
    expect(readSave()!.activeMs).toBeUndefined();
  });
});
