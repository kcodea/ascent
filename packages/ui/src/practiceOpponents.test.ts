// @vitest-environment jsdom
/**
 * PRACTICE IS ALWAYS VS PLAYERS (2026-09-29): the Bots option is gone from the Practice setup screen, so a draft
 * persisted while it existed (`opponents: 'bots'`) must not survive — not when the store loads it, and not when the
 * setup is confirmed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'ascent.practiceconfig';

async function freshStore(persisted: object) {
  localStorage.setItem(KEY, JSON.stringify(persisted));
  vi.resetModules();
  return (await import('./store')).useGame;
}

afterEach(() => { localStorage.removeItem(KEY); });

// A fresh store import is a cold load of the whole UI graph — give it room.
describe('a persisted Bots practice draft', { timeout: 60_000 }, () => {
  it('loads as vs players, keeping the rest of the draft', async () => {
    const useGame = await freshStore({ opponents: 'bots', botDifficulty: 7, timeMult: 2 });
    const draft = useGame.getState().practiceDraft;
    expect(draft.opponents).toBe('players');
    expect(draft.timeMult).toBe(2);
  });

  it('confirms as vs players even if the draft in memory still says bots', async () => {
    const useGame = await freshStore({ opponents: 'bots' });
    useGame.setState({ practiceDraft: { ...useGame.getState().practiceDraft, opponents: 'bots' } });
    useGame.getState().confirmPracticeSetup();
    const s = useGame.getState();
    expect(s.practiceDraft.opponents).toBe('players');
    expect(s.pendingMode).toBe('practice');
  });
});
