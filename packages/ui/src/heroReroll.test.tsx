// @vitest-environment jsdom
/**
 * THE HERO RE-ROLL on the real store + HeroSelect (owner 2026-10-15, R-HERO-REROLL-01). Owner, verbatim: "add a feature
 * to the hero select that allows a player to re-roll a single hero option once to get a new one in its place". Owner
 * choices: ONE re-roll per hero select, any slot, then the option is gone, in every mode.
 *
 * Pinned here: every tile shows the control while it is unused; one press swaps exactly that slot for a seeded draw
 * (pending seed + "hero-reroll") from the mode's pool, never an offered hero; every control then disappears and a second
 * call is a no-op; the RANKED ENTRY keeps the re-rolled heroes and the spent re-roll (no free refresh by closing the
 * game); the run built by the pick records { slot, from, to }; Practice / Gauntlet (whose offer is their whole pool)
 * and Versus (the server draws) never re-roll locally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { playableHeroes, rollHeroReroll, runTribesForSeed } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

vi.mock('./remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./remoteBoards')>();
  return { ...mod, remoteEnabled: () => true, refreshOpponentPoolAndRecords: vi.fn() };
});
vi.mock('./rank/rankSubmission', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./rank/rankSubmission')>();
  return {
    ...mod,
    enqueuePendingRank: vi.fn((req: unknown) => ({ ...(req as object), userId: 'me', at: 'now', attempts: 0 })),
    flushPendingRanks: vi.fn(async () => {}),
    installRankRetryTriggers: vi.fn(),
  };
});

import { HeroSelect } from './HeroSelect';
import { heroRerollPoolOf, useGame } from './store';
import { loadRankedEntry } from './rank/rankedEntry';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
beforeEach(() => {
  localStorage.clear();
  useGame.setState({ showTitle: true, titleView: 'modes', heroChoices: null, heroReroll: null, pendingMode: 'lobby', pendingSeed: undefined, rankedEntry: null, savedRun: null, replaying: false, playerName: 'Mike' });
});

const rerollButtons = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.hcreroll')];

describe('the hero re-roll (R-HERO-REROLL-01)', () => {
  it('Ranked: one press swaps exactly that slot for a seeded, never-offered hero from the tribe-gated pool; then it is gone', () => {
    act(() => useGame.getState().startLobby());
    const before = [...useGame.getState().heroChoices!];
    const seed = useGame.getState().pendingSeed!;
    ui = mount(<HeroSelect />);
    expect(rerollButtons()).toHaveLength(before.length);

    act(() => rerollButtons()[1]!.click());
    const s = useGame.getState();
    const pool = playableHeroes(runTribesForSeed(seed)).map((h) => h.id);
    // The draw is the seeded one, reproducible from the seed alone.
    expect(s.heroReroll).toEqual(rollHeroReroll(seed, before, 1, pool));
    expect(s.heroChoices![0]).toBe(before[0]);
    expect(s.heroChoices![2]).toBe(before[2]);
    expect(before).not.toContain(s.heroChoices![1]);
    expect(pool).toContain(s.heroChoices![1]);
    // Gone: no control left, and a second call changes nothing.
    expect(rerollButtons()).toHaveLength(0);
    const after = s.heroChoices;
    act(() => useGame.getState().rerollHero(0));
    expect(useGame.getState().heroChoices).toBe(after);

    // The ranked entry kept it: a restart reopens the re-rolled heroes with the re-roll spent.
    const entry = loadRankedEntry(() => true)!;
    expect(entry.heroChoices).toEqual(after);
    expect(entry.heroReroll).toEqual(s.heroReroll);
    act(() => useGame.setState({ heroChoices: null, heroReroll: null }));
    act(() => useGame.getState().startLobby()); // the live entry resumes
    expect(useGame.getState().heroChoices).toEqual(after);
    expect(useGame.getState().heroReroll).toEqual(s.heroReroll);
    expect(rerollButtons()).toHaveLength(0);
  });

  it('the run built by the pick records the re-roll, and the next hero select starts unused', () => {
    act(() => useGame.getState().startHeroSelect());
    act(() => useGame.getState().rerollHero(2));
    const r = useGame.getState().heroReroll!;
    expect(r.slot).toBe(2);
    act(() => useGame.getState().pickHero(r.to));
    expect(useGame.getState().run.heroReroll).toEqual(r);
    expect(useGame.getState().run.heroId).toBe(r.to);
    expect(useGame.getState().heroReroll).toBeNull();
    act(() => useGame.getState().startHeroSelect());
    expect(useGame.getState().heroReroll).toBeNull();
  });

  it('a run picked without a re-roll records none', () => {
    act(() => useGame.getState().startHeroSelect());
    act(() => useGame.getState().pickHero(useGame.getState().heroChoices![0]!));
    expect(useGame.getState().run.heroReroll).toBeUndefined();
  });

  it('Practice and Gauntlet offer their whole pool, so there is nothing to draw and no control', () => {
    act(() => { useGame.getState().confirmPracticeSetup(); });
    const s = useGame.getState();
    expect(s.pendingMode).toBe('practice');
    expect(heroRerollPoolOf(s).every((id) => s.heroChoices!.includes(id))).toBe(true);
    const offer = s.heroChoices;
    act(() => useGame.getState().rerollHero(0));
    expect(useGame.getState().heroChoices).toBe(offer);
    ui = mount(<HeroSelect />);
    expect(rerollButtons()).toHaveLength(0);
  });

  it('Versus never re-rolls locally (the server draws it)', () => {
    act(() => useGame.setState({ showTitle: false, pendingMode: 'versus', pendingSeed: 5, heroChoices: ['indy', 'warden', 'keshi'], heroReroll: null }));
    act(() => useGame.getState().rerollHero(0));
    expect(useGame.getState().heroChoices).toEqual(['indy', 'warden', 'keshi']);
    expect(useGame.getState().heroReroll).toBeNull();
  });
});
