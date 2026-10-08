// @vitest-environment jsdom
/**
 * GOD MODE in the store (owner 2026-10-08): the Practice draft remembers the mode, `pickHero` launches a God Mode
 * run (sandbox + godMode + 999 Gold, God Mode's own fixed config), nothing is saved, and the wallet refills after
 * every committed action while a refused action stays a no-op.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunState } from '@game/sim';

const KEY = 'ascent.practiceconfig';
const SAVE_KEY = 'ascent.save';
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

  it('Continue after a God Mode game resumes the REAL saved run, and the save on disk is untouched (spec §6)', async () => {
    const useGame = await freshStore({ godMode: false, timeMult: 2 });
    // A real (Sandbox Mode) Practice game: it takes the save slot.
    useGame.getState().confirmPracticeSetup();
    useGame.getState().pickHero(useGame.getState().heroChoices![0]!);
    const real = useGame.getState().run;
    const onDisk = localStorage.getItem(SAVE_KEY);
    expect(onDisk).not.toBeNull();
    // ...then a God Mode game, played a little, then back to the title.
    useGame.getState().setPracticeDraft({ godMode: true });
    useGame.getState().confirmPracticeSetup();
    expect(useGame.getState().practiceTimer).toBe(2); // the player's own Practice timer, never God Mode's 0
    useGame.getState().pickHero(useGame.getState().heroChoices![0]!);
    expect(useGame.getState().run.godMode).toBe(true);
    useGame.getState().dispatch({ type: 'roll' });
    useGame.getState().openTitle();
    expect(localStorage.getItem(SAVE_KEY)).toBe(onDisk);
    expect(localStorage.getItem('ascent.practicetimer')).toBe('2');
    // The title offers the real run, and Continue resumes it.
    expect(useGame.getState().savedRun?.godMode).toBeUndefined();
    expect(useGame.getState().savedRun?.seed).toBe(real.seed);
    useGame.getState().continueRun();
    const resumed = useGame.getState().run;
    expect(resumed.godMode).toBeUndefined();
    expect(resumed.sandbox).toBeFalsy();
    expect(resumed.seed).toBe(real.seed);
    expect(resumed.heroId).toBe(real.heroId);
    expect(localStorage.getItem(SAVE_KEY)).toBe(onDisk);
  });

  it('leaving God Mode mid-End-of-Turn drops the pending fight: a quick Continue never gets the God Mode combat (M1)', async () => {
    const useGame = await freshStore({ godMode: false });
    useGame.getState().confirmPracticeSetup();
    useGame.getState().pickHero(useGame.getState().heroChoices![0]!);
    const real = useGame.getState().run;
    useGame.getState().setPracticeDraft({ godMode: true });
    useGame.getState().confirmPracticeSetup();
    useGame.getState().pickHero(useGame.getState().heroChoices![0]!);
    expect(useGame.getState().run.godMode).toBe(true);
    // End Turn pressed: the fight is prepared and the End of Turn is playing...
    expect(useGame.getState().preparePresentationAction({ type: 'faceOmen' })).not.toBeNull();
    useGame.getState().setEndTurnAnimating(true);
    // ...and the player leaves through the Esc menu, then presses Continue inside the unmount pad window.
    useGame.getState().openTitle();
    expect(useGame.getState().presentationTx).toBeNull();
    expect(useGame.getState().endTurnAnimating).toBe(false);
    useGame.getState().continueRun();
    const replayLen = useGame.getState().replayActions.length;
    // The unmounted Recruit's late safety-net commit is now a no-op.
    useGame.getState().commitPresentationAction();
    const resumed = useGame.getState().run;
    expect(resumed.godMode).toBeUndefined();
    expect(resumed.seed).toBe(real.seed);
    expect(resumed.phase).toBe(real.phase);
    expect(useGame.getState().replayActions.length).toBe(replayLen);
  });

  it('with no save, leaving God Mode offers no Continue and leaves no God Mode run behind the title', async () => {
    const useGame = await freshStore({ godMode: true });
    useGame.getState().confirmPracticeSetup();
    useGame.getState().pickHero(useGame.getState().heroChoices![0]!);
    useGame.getState().openTitle();
    expect(useGame.getState().savedRun).toBeNull();
    expect(useGame.getState().run.godMode).toBeUndefined();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
  });

  it('a sandbox run that ends never clears the real save', async () => {
    // Force the run to end on a roll: a God Mode run cannot really reach gameover, which is the point of the guard.
    vi.resetModules();
    vi.doMock('@game/sim', async (importOriginal) => {
      const sim = await importOriginal<typeof import('@game/sim')>();
      const end = <T extends { state: RunState }>(r: T, a: { type: string }): T =>
        (a.type === 'roll' && r.state.godMode ? { ...r, state: { ...r.state, phase: 'gameover' } } : r);
      return {
        ...sim,
        reduce: (s: RunState, a: Parameters<typeof sim.reduce>[1]) => end({ state: sim.reduce(s, a) }, a).state,
        reduceWithPresentation: (...args: Parameters<typeof sim.reduceWithPresentation>) => end(sim.reduceWithPresentation(...args), args[1]),
      };
    });
    try {
      localStorage.setItem(KEY, JSON.stringify({ godMode: false }));
      const useGame = (await import('./store')).useGame;
      useGame.getState().confirmPracticeSetup();
      useGame.getState().pickHero(useGame.getState().heroChoices![0]!);
      const onDisk = localStorage.getItem(SAVE_KEY);
      const realSaved = useGame.getState().savedRun;
      expect(onDisk).not.toBeNull();
      useGame.getState().setPracticeDraft({ godMode: true });
      useGame.getState().confirmPracticeSetup();
      useGame.getState().pickHero(useGame.getState().heroChoices![0]!);
      useGame.getState().dispatch({ type: 'roll' });
      expect(useGame.getState().run.phase).toBe('gameover');
      expect(localStorage.getItem(SAVE_KEY)).toBe(onDisk);
      expect(useGame.getState().savedRun).toBe(realSaved);
    } finally {
      vi.doUnmock('@game/sim');
    }
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
