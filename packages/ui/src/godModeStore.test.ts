// @vitest-environment jsdom
/**
 * GOD MODE in the store (owner 2026-10-08): the Practice draft remembers the mode, `pickHero` launches a God Mode
 * run (sandbox + godMode + 999 Gold, God Mode's own fixed config), nothing is saved, and the wallet refills after
 * every committed action while a refused action stays a no-op.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunState } from '@game/sim';

const KEY = 'ascent.practiceconfig';
async function freshStore(persisted: object) {
  localStorage.setItem(KEY, JSON.stringify(persisted));
  vi.resetModules();
  return (await import('./store')).useGame;
}
afterEach(() => { localStorage.clear(); });

// A fresh store import is a cold load of the whole UI graph — give it room.
describe('God Mode in the store', { timeout: 60_000 }, () => {
  it('persists godMode on the practice draft', async () => {
    const useGame = await freshStore({ godMode: true });
    expect(useGame.getState().practiceDraft.godMode).toBe(true);
  });

  it('launches a sandbox God Mode run with 999 Gold and writes no save', async () => {
    const useGame = await freshStore({ godMode: true });
    useGame.getState().confirmPracticeSetup();
    const hero = useGame.getState().heroChoices![0]!;
    useGame.getState().pickHero(hero);
    const run = useGame.getState().run;
    expect(run.godMode).toBe(true);
    expect(run.sandbox).toBe(true);
    expect(run.embers).toBe(999);
    expect(run.practiceConfig?.health).toBe('unlimited'); // God Mode ignores the Sandbox options
    expect(useGame.getState().practiceDraft.godMode).toBe(true); // ...and leaves the player's draft alone
    expect(Object.keys(localStorage).filter((k) => /save|resum/i.test(k))).toEqual([]);
  });

  it('keeps the player\'s own saved run as the Continue slot, and their saved Practice timer', async () => {
    const useGame = await freshStore({ godMode: true, timeMult: 2 });
    localStorage.setItem('ascent.practicetimer', '2');
    const real = { wave: 6 } as unknown as RunState;
    useGame.setState({ savedRun: real });
    useGame.getState().confirmPracticeSetup();
    useGame.getState().pickHero(useGame.getState().heroChoices![0]!);
    expect(useGame.getState().run.godMode).toBe(true);
    expect(useGame.getState().savedRun).toBe(real);
    expect(localStorage.getItem('ascent.practicetimer')).toBe('2');
    expect(useGame.getState().practiceDraft.timeMult).toBe(2);
  });

  it('Sandbox Mode practice is untouched (Review Focus 3)', async () => {
    const useGame = await freshStore({ godMode: false });
    useGame.getState().confirmPracticeSetup();
    useGame.getState().pickHero(useGame.getState().heroChoices![0]!);
    const run = useGame.getState().run;
    expect(run.godMode).toBeUndefined();
    expect(run.sandbox).toBeFalsy();
  });

  it('refills Gold to 999 after a committed spend; a refused action changes nothing (Review Focus 2)', async () => {
    const useGame = await freshStore({ godMode: true });
    useGame.getState().confirmPracticeSetup();
    useGame.getState().pickHero(useGame.getState().heroChoices![0]!);
    useGame.setState({ run: { ...useGame.getState().run, embers: 10 } });
    useGame.getState().dispatch({ type: 'roll' });
    expect(useGame.getState().run.embers).toBe(999);
    const before = useGame.getState().run;
    const replayLen = useGame.getState().replayActions.length;
    useGame.getState().dispatch({ type: 'godPrint', cardId: 'no_such_card' });
    expect(useGame.getState().run).toBe(before);
    expect(useGame.getState().replayActions.length).toBe(replayLen);
  });
});
